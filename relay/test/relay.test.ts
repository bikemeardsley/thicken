// The relay end to end in the Workers runtime, offline: R2, D1 and KV are Miniflare's; AI, Images, the rate limiter
// and all four hash lists are stubbed (fetch for Arachnid and PhotoDNA, the check itself for the two not written yet).
// Knobs (thresholds, caps) come from env, as wrangler.jsonc sets them.
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.ts';
import { LISTS } from '../src/known.ts';

const base = env as unknown as Env & Record<'SCHEMA' | 'ARACHNID_USER' | 'ARACHNID_KEY' | 'PHOTODNA_KEY', string>;
const API = 'https://contribute.wendellresearch.ai/thicken/v1';
const ARACHNID = 'https://shield.projectarachnid.com/v1/media/';
const PHOTODNA = 'https://api.microsoftmoderator.com/photodna/v1.0/Match';
const SECRETS = {
  offlimits: ['HASHCHECK_URL', 'HASHCHECK_KEY'],
  arachnid: ['ARACHNID_USER', 'ARACHNID_KEY'],
  photodna: ['PHOTODNA_KEY'],
  ncmec: ['NCMEC_USER', 'NCMEC_KEY'],
};
const NONE = Object.fromEntries(Object.values(SECRETS).flat().map((k) => [k, '']));
const ADMIN = { authorization: 'Bearer admin-test' };
const CLEAN = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 7, 7, 7]); // what the Images stub re-encodes every photo to
const META = {
  v: 1,
  thicken: '0.3.0',
  consent: '2026-11-08',
  profile: 'book',
  faces: [{ face: 'front', corners: [[10, 10], [990, 12], [988, 990], [12, 988]], score: 0.67 }],
};

type Over = Record<string, unknown>;
type Hash = () => Response | Promise<Response>;
let scores: { sexual: number; face: number; topic: number };
let answer: () => unknown;
let info: () => unknown;
let output: () => unknown;
let rateOk: boolean;
let offlimits: () => Promise<boolean>;
let ncmec: () => Promise<boolean>;
let arachnid: Hash;
let photodna: Hash;
let seen: { rate: string[]; ai: { model: string; inputs: any }[]; output: unknown[]; input: number; fetch: Request[] };
let count = 0;
const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(`photo ${count++}`)]);

const stubs = () => ({
  AI: {
    run: async (model: string, inputs: unknown) => {
      seen.ai.push({ model, inputs });
      return answer();
    },
  },
  IMAGES: {
    info: async (s: ReadableStream) => (await new Response(s).arrayBuffer(), info()),
    input: (s: ReadableStream) => {
      seen.input++;
      return {
        output: async (o: unknown) => {
          await new Response(s).arrayBuffer();
          seen.output.push(o);
          return output();
        },
      };
    },
  },
  RATE: {
    limit: async ({ key }: { key: string }) => {
      seen.rate.push(key);
      return { success: rateOk };
    },
  },
});

const call = (req: Request, over: Over = {}) => worker.fetch(req, { ...base, ...stubs(), ...over } as never);
const get = (path: string, headers: HeadersInit = {}, over: Over = {}) => call(new Request(API + path, { headers }), over);
const send = (method: string, path: string, headers: HeadersInit = {}) => call(new Request(API + path, { method, headers }));

async function post(o: { meta?: unknown; photo?: Uint8Array | null; ip?: string; asn?: number } = {}, over: Over = {}) {
  const form = new FormData();
  if (o.photo !== null) form.append('photo', new File([o.photo ?? jpeg()], 'p.jpg', { type: 'image/jpeg' }));
  if (o.meta !== null) form.append('meta', typeof o.meta === 'string' ? o.meta : JSON.stringify(o.meta ?? META));
  const r = new Response(form);
  const body = await r.arrayBuffer();
  const headers = {
    'content-type': r.headers.get('content-type')!,
    'content-length': String(body.byteLength),
    'cf-connecting-ip': o.ip ?? '203.0.113.7',
    'user-agent': 'thicken/0.3.0',
  };
  return call(new Request(`${API}/photos`, { method: 'POST', headers, body, cf: { asn: o.asn ?? 64500 } } as RequestInit), over);
}

const rows = async (table: string) => (await base.DB.prepare(`SELECT * FROM ${table}`).all<Record<string, any>>()).results;
const keys = async () => (await base.INBOX.list()).objects.map((o) => o.key).sort();
const bytesOf = async (key: string) => new Uint8Array(await (await base.INBOX.get(key))!.arrayBuffer());
const sha256 = async (b: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('');

beforeAll(async () => {
  const statements = base.SCHEMA.replace(/--.*$/gm, '').split(';').map((s) => s.trim()).filter(Boolean);
  await base.DB.batch(statements.map((s) => base.DB.prepare(s)));
});

beforeEach(async () => {
  await base.DB.batch(['photos', 'counters', 'incidents', 'forgotten', 'rejections'].map((t) => base.DB.prepare(`DELETE FROM ${t}`)));
  await base.FLAGS.delete('paused');
  const all = await keys();
  if (all.length) await base.INBOX.delete(all);
  scores = { sexual: 0.01, face: 0.02, topic: 0.97 };
  answer = () => ({
    model: 'clef-flash',
    answers: Object.fromEntries(Object.entries(scores).map(([q, p]) => [q, { type: 'noul', noul: p }])),
    usage: { input_tokens: 1000, output_tokens: 0 },
  });
  info = () => ({ format: 'image/jpeg', fileSize: 1234, width: 1000, height: 1000 });
  output = () => ({ response: () => new Response(CLEAN) });
  rateOk = true;
  offlimits = async () => false;
  ncmec = async () => false;
  arachnid = () => Response.json({ sha256_hex: 'ab', sha1_base32: 'CD', size_bytes: 9, classification: 'no-known-match', match_type: null });
  photodna = () => Response.json({ Status: { Code: 3000, Description: 'OK' }, IsMatch: false, TrackingId: 't' });
  seen = { rate: [], ai: [], output: [], input: 0, fetch: [] };
  vi.restoreAllMocks();
  vi.spyOn(LISTS.offlimits, 'check').mockImplementation(() => offlimits());
  vi.spyOn(LISTS.ncmec, 'check').mockImplementation(() => ncmec());
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const req = new Request(input as RequestInfo, init as RequestInit);
    seen.fetch.push(req);
    if (req.url === ARACHNID) return arachnid();
    if (req.url === PHOTODNA) return photodna();
    throw new Error(`offline: ${req.url}`);
  });
});

describe('GET /thicken/v1/status', () => {
  it('is accepting with hash lists configured, and sends no CORS headers', async () => {
    const res = await get('/status');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepting: true });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it.each(Object.entries(SECRETS))('opens with %s as the only list', async (_, names) => {
    const only = { ...NONE, ...Object.fromEntries(names.map((k) => [k, 'set'])) };
    expect(await (await get('/status', {}, only)).json()).toEqual({ accepting: true });
    for (const k of names) expect(await (await get('/status', {}, { ...only, [k]: '' })).json()).toEqual({ accepting: false, reason: 'not open' });
  });

  it.each<[string, Over]>([
    ['no hash list', NONE],
    ['no IP_SALT', { IP_SALT: undefined }],
  ])('is "not open" with %s', async (_, over) => {
    expect(await (await get('/status', {}, over)).json()).toEqual({ accepting: false, reason: 'not open' });
    const res = await post({}, over);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ reason: 'not open' });
    expect(seen.fetch).toHaveLength(0);
  });

  it('is paused by the admin, and resumed', async () => {
    expect((await send('POST', '/admin/pause', ADMIN)).status).toBe(204);
    expect(await (await get('/status')).json()).toEqual({ accepting: false, reason: 'paused' });
    const res = await post();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ reason: 'paused' });
    expect((await send('POST', '/admin/resume', ADMIN)).status).toBe(204);
    expect(await (await get('/status')).json()).toEqual({ accepting: true });
  });

  it('answers 410 once contributing has ended for good', async () => {
    await base.FLAGS.put('paused', 'ended');
    const res = await get('/status');
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ accepting: false, reason: 'ended' });
  });
});

describe('POST /thicken/v1/photos', () => {
  it('stores the re-encoded photo and its meta, and answers 201 {id}', async () => {
    const photo = jpeg();
    const res = await post({ photo });
    expect(res.status).toBe(201);
    const { id } = await res.json<{ id: string }>();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await keys()).toEqual([`inbox/${id}.jpg`, `inbox/${id}.json`]);

    // 8: only the re-encoded bytes go on, at quality 90.
    expect(seen.output).toEqual([{ format: 'image/jpeg', quality: 90 }]);
    expect(await bytesOf(`inbox/${id}.jpg`)).toEqual(CLEAN);

    // 9: three yes/no questions about the re-encoded image.
    expect(seen.ai).toHaveLength(1);
    const { model, inputs } = seen.ai[0];
    expect(model).toBe('@cf/cloudflare/clef-flash');
    expect(inputs.model).toBe('clef-flash');
    expect(inputs.images).toEqual([{ content_type: 'image/jpeg', base64: btoa(String.fromCharCode(...CLEAN)) }]);
    expect(Object.keys(inputs.questions)).toEqual(['sexual', 'face', 'topic']);
    expect(Object.values(inputs.questions).every((q: any) => q.type === 'noul' && q.instructions)).toBe(true);
    expect(inputs.questions.face.instructions).toContain('A hand or arm holding the object is not a face');

    // 10: the meta plus what the relay adds, the prefix hashed and never the IP.
    const sidecar = JSON.parse(new TextDecoder().decode(await bytesOf(`inbox/${id}.json`)));
    expect(sidecar).toEqual({ meta: META, at: expect.any(String), asn: 64500, prefix: expect.stringMatching(/^[0-9a-f]{16}$/), ua: 'thicken/0.3.0', scores });
    expect(JSON.stringify(sidecar)).not.toContain('203.0.113');
    expect(await rows('photos')).toEqual([{ id, sha256: await sha256(photo), at: sidecar.at, prefix: sidecar.prefix, asn: 64500 }]);
    const day = sidecar.at.slice(0, 10);
    expect((await rows('counters')).map((r) => [r.day, r.key, r.n]).sort()).toEqual(
      [[day, `a:64500`, 1], [day, 'all', 1], [day, `p:${sidecar.prefix}`, 1]].sort(),
    );

    // 7: every list was asked about the received bytes, each with its own timeout.
    expect(seen.fetch.map((r) => r.url).sort()).toEqual([ARACHNID, PHOTODNA].sort());
    for (const r of seen.fetch) expect(new Uint8Array(await r.arrayBuffer())).toEqual(photo);
    const [[a, , sa]] = vi.mocked(LISTS.offlimits.check).mock.calls;
    const [[b, , sb]] = vi.mocked(LISTS.ncmec.check).mock.calls;
    expect([a, b]).toEqual([photo, photo]);
    expect(sa).toBeInstanceOf(AbortSignal);
    expect(sa).not.toBe(sb);
  });

  it('takes faces: [] and a face without a score', async () => {
    expect((await post({ meta: { ...META, faces: [] } })).status).toBe(201);
    expect((await post({ meta: { ...META, profile: 'slab', faces: [{ face: 'back', corners: META.faces[0].corners }] } })).status).toBe(201);
  });

  describe('2. size', () => {
    const raw = (headers: Record<string, string>, body: BodyInit) =>
      call(new Request(`${API}/photos`, { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x', ...headers }, body }));

    it('answers 413 without a Content-Length', async () => {
      const stream = new ReadableStream({ start: (c) => (c.enqueue(new Uint8Array(10)), c.close()) });
      const res = await raw({}, stream);
      expect(res.status).toBe(413);
    });

    it('answers 413 for a Content-Length over 1.5 MB', async () => {
      expect((await raw({ 'content-length': String(1.5 * 1024 * 1024 + 1) }, 'x')).status).toBe(413);
    });

    it('counts the bytes as they arrive', async () => {
      const stream = new ReadableStream({
        start: (c) => {
          for (let i = 0; i < 4; i++) c.enqueue(new Uint8Array(500_000));
          c.close();
        },
      });
      const res = await raw({ 'content-length': '1000' }, stream);
      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({ reason: 'too large' });
    });
  });

  describe('3. meta', () => {
    const face = META.faces[0];
    it.each<[string, unknown]>([
      ['an unknown key', { ...META, host: 'pc' }],
      ['a missing key', { v: 1, thicken: '0.3.0', profile: 'book', faces: [] }],
      ['v 2', { ...META, v: 2 }],
      ['a profile without faces', { ...META, profile: 'badge' }],
      ['a thicken that is not a version', { ...META, thicken: 'latest' }],
      ['a consent that is not a date', { ...META, consent: 'yes' }],
      ['faces not an array', { ...META, faces: {} }],
      ['a face over 32 characters', { ...META, faces: [{ ...face, face: 'f'.repeat(33) }] }],
      ['an empty face', { ...META, faces: [{ ...face, face: '' }] }],
      ['an unknown key in a face', { ...META, faces: [{ ...face, file: 'IMG_0001.jpg' }] }],
      ['three corners', { ...META, faces: [{ ...face, corners: face.corners.slice(0, 3) }] }],
      ['a coordinate over 1000', { ...META, faces: [{ ...face, corners: [[1001, 0], ...face.corners.slice(1)] }] }],
      ['a negative coordinate', { ...META, faces: [{ ...face, corners: [[-1, 0], ...face.corners.slice(1)] }] }],
      ['a coordinate that is a string', { ...META, faces: [{ ...face, corners: [['1', 0], ...face.corners.slice(1)] }] }],
      ['a point with three numbers', { ...META, faces: [{ ...face, corners: [[1, 2, 3], ...face.corners.slice(1)] }] }],
      ['a score over 1', { ...META, faces: [{ ...face, score: 1.5 }] }],
      ['a score of null', { ...META, faces: [{ ...face, score: null }] }],
      ['an array', [META]],
      ['over 4 KB', JSON.stringify(META) + ' '.repeat(4096)],
      ['not JSON', '{"v":1,'],
      ['no meta part', null],
    ])('answers 400 {reason:"meta"} for %s', async (_, meta) => {
      const res = await post({ meta });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ reason: 'meta' });
      expect(await keys()).toEqual([]);
    });

    it('answers 400 for a body that is not multipart', async () => {
      const res = await call(new Request(`${API}/photos`, { method: 'POST', headers: { 'content-type': 'text/plain', 'content-length': '5' }, body: 'hello' }));
      expect(res.status).toBe(400);
    });
  });

  describe('4. a JPEG, no side over 1024', () => {
    it('answers 415 when the bytes do not start FF D8 FF', async () => {
      const res = await post({ photo: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]) });
      expect(res.status).toBe(415);
      expect(await res.json()).toEqual({ reason: 'not a JPEG' });
    });

    it('answers 415 when Images says it is not a JPEG', async () => {
      info = () => ({ format: 'image/png', fileSize: 10, width: 10, height: 10 });
      expect((await post()).status).toBe(415);
      info = () => ({ format: 'image/svg+xml' });
      expect((await post()).status).toBe(415);
    });

    it('answers 415 when Images cannot read it, or there is no photo', async () => {
      info = () => {
        throw new Error('9412: not an image');
      };
      expect((await post()).status).toBe(415);
      expect((await post({ photo: null })).status).toBe(415);
    });

    it.each([[1025, 1000], [1000, 1025]])('answers 413 for %ix%i', async (width, height) => {
      info = () => ({ format: 'image/jpeg', fileSize: 10, width, height });
      const res = await post();
      expect(res.status).toBe(413);
    });
  });

  describe('5. rate limits', () => {
    it('answers 429 when the per-minute limiter says so', async () => {
      rateOk = false;
      const res = await post();
      expect(res.status).toBe(429);
      expect(await res.json()).toEqual({ reason: 'rate limit' });
    });

    it('keys on the IPv4 address or the IPv6 /64, normalized and hashed', async () => {
      for (const ip of ['2001:db8:1:2::1', '2001:0DB8:0001:0002:ffff::9', '2001:db8:1:3::1', '203.0.113.7', '::ffff:203.0.113.7', '203.0.113.8']) {
        await post({ ip });
      }
      const [a, b, c, d, e, f] = seen.rate;
      expect(a).toMatch(/^[0-9a-f]{16}$/);
      expect(b).toBe(a);
      expect(c).not.toBe(a);
      expect(e).toBe(d);
      expect(f).not.toBe(d);
    });

    it('caps a prefix per day (PER_PREFIX_DAY)', async () => {
      const over = { PER_PREFIX_DAY: 1 };
      expect((await post({ ip: '2001:db8:1:2::1' }, over)).status).toBe(201);
      expect((await post({ ip: '2001:db8:1:2::2', asn: 1 }, over)).status).toBe(429);
      expect((await post({ ip: '2001:db8:9:9::1' }, over)).status).toBe(201);
    });

    it('caps an ASN per day (PER_ASN_DAY)', async () => {
      const over = { PER_ASN_DAY: 1 };
      expect((await post({ ip: '198.51.100.1', asn: 1 }, over)).status).toBe(201);
      expect((await post({ ip: '198.51.100.2', asn: 1 }, over)).status).toBe(429);
      expect((await post({ ip: '198.51.100.3', asn: 2 }, over)).status).toBe(201);
    });

    it('caps everything per day (GLOBAL_DAY)', async () => {
      const over = { GLOBAL_DAY: 2 };
      expect((await post({ ip: '198.51.100.1', asn: 1 }, over)).status).toBe(201);
      expect((await post({ ip: '198.51.100.2', asn: 2 }, over)).status).toBe(201);
      expect((await post({ ip: '198.51.100.3', asn: 3 }, over)).status).toBe(429);
    });

    it('pauses itself when more than SPIKE_HOUR would be accepted in an hour', async () => {
      const over = { SPIKE_HOUR: 2 };
      expect((await post({ ip: '198.51.100.1', asn: 1 }, over)).status).toBe(201);
      expect((await post({ ip: '198.51.100.2', asn: 2 }, over)).status).toBe(201);
      const res = await post({ ip: '198.51.100.3', asn: 3 }, over);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ reason: 'paused' });
      expect(await base.FLAGS.get('paused')).toBe('auto');
      expect(await (await get('/status')).json()).toEqual({ accepting: false, reason: 'paused' });
    });
  });

  it('6. answers an exact repeat as if stored, with an id that names nothing, and keeps one copy', async () => {
    const photo = jpeg();
    const first = await (await post({ photo })).json<{ id: string }>();
    const res = await post({ photo, ip: '198.51.100.9' });
    expect(res.status).toBe(201);
    const { id } = await res.json<{ id: string }>();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(id).not.toBe(first.id);
    expect(await keys()).toEqual([`inbox/${first.id}.jpg`, `inbox/${first.id}.json`]);
    expect(seen.ai).toHaveLength(1);
  });

  it('counts refused attempts toward the day caps too, so they bound what the checks cost', async () => {
    const over = { PER_PREFIX_DAY: 2 };
    scores = { sexual: 0.01, face: 0.02, topic: 0.1 }; // off topic: refused after the checks
    expect((await post({}, over)).status).toBe(422);
    expect((await post({}, over)).status).toBe(422);
    expect((await post({}, over)).status).toBe(429);
    expect(seen.ai).toHaveLength(2);
  });

  it('takes up to 8 faces, as many as slab names, and not 9', async () => {
    const corners = META.faces[0].corners;
    const faces = (n: number) => Array.from({ length: n }, (_, i) => ({ face: `f${i}`, corners }));
    expect((await post({ meta: { ...META, profile: 'slab', faces: faces(8) } })).status).toBe(201);
    expect((await post({ meta: { ...META, profile: 'slab', faces: faces(9) } })).status).toBe(400);
  });

  it('answers an upload 410 once contributing has ended for good', async () => {
    await base.FLAGS.put('paused', 'ended');
    expect((await post()).status).toBe(410);
  });

  describe('7. known CSAM', () => {
    const ALL = 'offlimits arachnid photodna ncmec';
    const down = () => Promise.reject(new TypeError('network'));
    const match = {
      offlimits: () => (offlimits = async () => true),
      arachnid: () => (arachnid = () => Response.json({ sha256_hex: 'ab', sha1_base32: 'CD', size_bytes: 9, classification: 'csam', match_type: 'exact' })),
      photodna: () => (photodna = () => Response.json({ Status: { Code: 3000, Description: 'OK' }, IsMatch: true })),
      ncmec: () => (ncmec = async () => true),
    };
    const fail = {
      offlimits: () => (offlimits = down),
      arachnid: () => (arachnid = () => Response.json({ detail: 'no' }, { status: 401 })),
      photodna: () => (photodna = () => Response.json({ Status: { Code: 3002, Description: 'Invalid' } })),
      ncmec: () => (ncmec = down),
    };

    it.each(Object.keys(match) as (keyof typeof match)[])(
      'on a match from %s: preserves the received bytes, records it, pauses and answers 422',
      async (list) => {
        match[list]();
        const photo = jpeg();
        const res = await post({ photo, ip: '2001:db8:1:2::77', asn: 64501 });
        expect(res.status).toBe(422);
        expect(await res.json()).toEqual({ reason: 'rejected' });

        const [row] = await rows('incidents');
        expect(row).toEqual({
          id: row.id, at: expect.any(String), sha256: await sha256(photo), ip: '2001:db8:1:2::77', asn: 64501, ua: 'thicken/0.3.0',
          matched: list, answered: ALL,
        });
        expect(await keys()).toEqual([`incidents/${row.id}.jpg`]);
        expect(await bytesOf(`incidents/${row.id}.jpg`)).toEqual(photo); // as received, never re-encoded
        expect(await base.FLAGS.get('paused')).toBe('incident');
        expect(await rows('photos')).toEqual([]);
        expect(seen.input).toBe(0);
        expect(seen.ai).toHaveLength(0);
      },
    );

    it('records every list that matched, and only those that answered', async () => {
      match.arachnid();
      match.ncmec();
      fail.photodna();
      expect((await post()).status).toBe(422);
      const [row] = await rows('incidents');
      expect([row.matched, row.answered]).toEqual(['arachnid ncmec', 'offlimits arachnid ncmec']);
    });

    it('asks Arachnid Shield as its SDKs do, and PhotoDNA with its subscription key', async () => {
      const photo = jpeg();
      await post({ photo });
      const a = seen.fetch.find((r) => r.url === ARACHNID)!;
      expect(a.method).toBe('POST');
      expect(a.headers.get('authorization')).toBe(`Basic ${btoa(`${base.ARACHNID_USER}:${base.ARACHNID_KEY}`)}`);
      expect(a.headers.get('content-type')).toBe('image/jpeg');
      const p = seen.fetch.find((r) => r.url === PHOTODNA)!;
      expect(p.method).toBe('POST');
      expect(p.headers.get('ocp-apim-subscription-key')).toBe(base.PHOTODNA_KEY);
      expect(p.headers.get('content-type')).toBe('image/jpeg');
      for (const r of [a, p]) expect(new Uint8Array(await r.arrayBuffer())).toEqual(photo);
    });

    it.each(Object.keys(fail) as (keyof typeof fail)[])('goes on when %s errs and another list answers', async (list) => {
      fail[list]();
      expect((await post()).status).toBe(201);
    });

    it('goes on when one list is configured and answers', async () => {
      const res = await post({}, { ...NONE, PHOTODNA_KEY: 'k' });
      expect(res.status).toBe(201);
      expect(seen.fetch.map((r) => r.url)).toEqual([PHOTODNA]);
    });

    it.each<[string, () => void]>([
      ['every list errs', () => Object.values(fail).forEach((f) => f())],
      ['every list errs in another way', () => {
        offlimits = ncmec = () => Promise.reject(new Error('offlimits: not written yet'));
        arachnid = () => Response.json({ classification: 'no-known-match' });
        photodna = down;
      }],
      ['the only list configured errs', () => fail.arachnid()],
    ])('fails closed with 503 when %s', async (name, failing) => {
      failing();
      const over = name.startsWith('the only') ? { ...NONE, ARACHNID_USER: 'u', ARACHNID_KEY: 'k' } : {};
      const res = await post({}, over);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ reason: 'unavailable' });
      expect(await keys()).toEqual([]);
      expect(await rows('incidents')).toEqual([]);
      expect(await base.FLAGS.get('paused')).toBeNull();
      expect(seen.ai).toHaveLength(0);
    });

    it('keeps incident bytes where no endpoint can read or delete them', async () => {
      match.offlimits();
      await post();
      const [{ id }] = await rows('incidents');
      await base.FLAGS.delete('paused');
      for (const path of [`/admin/photos/${id}.jpg`, `/admin/photos/${id}.json`, `/admin/photos/${id}`, `/admin/photos/../incidents/${id}.jpg`, `/incidents/${id}.jpg`]) {
        expect((await get(path, ADMIN)).status).toBe(404);
      }
      expect(await (await get('/admin/inbox', ADMIN)).json()).toEqual({ ids: [] });
      expect((await send('DELETE', `/photos/${id}`)).status).toBe(204);
      expect((await send('DELETE', `/admin/photos/${id}`, ADMIN)).status).toBe(204);
      expect(await keys()).toEqual([`incidents/${id}.jpg`]);
      const listed = await (await get('/admin/incidents', ADMIN)).json<Record<string, unknown>[]>();
      expect(listed).toHaveLength(1);
      expect(Object.keys(listed[0]).sort()).toEqual(['answered', 'asn', 'at', 'id', 'ip', 'matched', 'sha256', 'ua']);
    });
  });

  describe('8 and 9. re-encoding and the Workers AI checks', () => {
    it.each<[string, () => void]>([
      ['sexual', () => (scores.sexual = Number(base.SEXUAL_MAX))],
      ['face', () => (scores.face = Number(base.FACE_MAX))],
      ['topic', () => (scores.topic = Number(base.TOPIC_MIN) - 0.01)],
    ])('answers 422 {reason:"%s"} and records the scores only', async (reason, set) => {
      set();
      const res = await post();
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ reason });
      expect(await keys()).toEqual([]);
      expect(await rows('photos')).toEqual([]);
      const listed = await (await get('/admin/rejections', ADMIN)).json();
      expect(listed).toEqual([{ at: expect.any(String), reason, ...scores }]);
    });

    it('takes scores just inside the thresholds', async () => {
      scores = { sexual: Number(base.SEXUAL_MAX) - 0.01, face: Number(base.FACE_MAX) - 0.01, topic: Number(base.TOPIC_MIN) };
      expect((await post()).status).toBe(201);
    });

    it.each<[string, () => void]>([
      ['Workers AI fails', () => (answer = () => { throw new Error('3040: capacity'); })],
      ['an answer is missing', () => (answer = () => ({ answers: { sexual: { type: 'noul', noul: 0 } } }))],
      ['an answer is out of range', () => (scores.face = 2)],
      ['re-encoding fails', () => (output = () => { throw new Error('9422'); })],
    ])('fails closed with 503 when %s', async (_, fail) => {
      fail();
      const res = await post();
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ reason: 'unavailable' });
      expect(await keys()).toEqual([]);
      expect(await rows('rejections')).toEqual([]);
    });
  });
});

describe('DELETE /thicken/v1/photos/:id', () => {
  it('deletes both objects and the row, remembers the id as forgotten, and answers 204', async () => {
    const { id } = await (await post()).json<{ id: string }>();
    const other = await (await post()).json<{ id: string }>();
    const res = await send('DELETE', `/photos/${id}`);
    expect(res.status).toBe(204);
    expect(await keys()).toEqual([`inbox/${other.id}.jpg`, `inbox/${other.id}.json`]);
    expect((await rows('photos')).map((r) => r.id)).toEqual([other.id]);
    expect(await rows('forgotten')).toEqual([{ id, at: expect.any(String) }]);
    expect((await send('DELETE', `/photos/${id}`)).status).toBe(204); // again: nothing left, nothing new
    expect(await rows('forgotten')).toHaveLength(1);
  });

  it.each(['not-an-id', '..%2Fincidents'])('answers 204 for %s too, and remembers nothing', async (id) => {
    expect((await send('DELETE', `/photos/${id}`)).status).toBe(204);
    expect(await rows('forgotten')).toEqual([]);
  });

  it('remembers an id it no longer has (expired after 180 days), so the copies made of it still go', async () => {
    const id = crypto.randomUUID();
    expect((await send('DELETE', `/photos/${id}`)).status).toBe(204);
    expect(await rows('forgotten')).toEqual([{ id, at: expect.any(String) }]);
  });

  it('takes at most 500 forgets a day from one network', async () => {
    await base.DB.prepare("INSERT INTO counters (day, key, n) SELECT ?, 'd:' || ?, 500").bind(new Date().toISOString().slice(0, 10), 'x').run();
    const first = await call(new Request(`${API}/photos/${crypto.randomUUID()}`, { method: 'DELETE', headers: { 'cf-connecting-ip': '203.0.113.7' } }));
    expect(first.status).toBe(204);
    const [{ key }] = (await rows('counters')).filter((r) => r.key !== 'd:x');
    await base.DB.prepare('UPDATE counters SET n = 500 WHERE key = ?').bind(key).run();
    const over = await call(new Request(`${API}/photos/${crypto.randomUUID()}`, { method: 'DELETE', headers: { 'cf-connecting-ip': '203.0.113.7' } }));
    expect(over.status).toBe(429);
  });

  it('is rate-limited like POST', async () => {
    const { id } = await (await post()).json<{ id: string }>();
    rateOk = false;
    const res = await call(new Request(`${API}/photos/${id}`, { method: 'DELETE', headers: { 'cf-connecting-ip': '2001:db8:1:2::5' } }));
    expect(res.status).toBe(429);
    expect(await keys()).toHaveLength(2);
    expect(seen.rate.at(-1)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('admin', () => {
  it.each([
    ['GET', '/admin/inbox'],
    ['GET', `/admin/photos/${crypto.randomUUID()}.jpg`],
    ['DELETE', `/admin/photos/${crypto.randomUUID()}`],
    ['POST', '/admin/pause'],
    ['POST', '/admin/resume'],
    ['GET', '/admin/incidents'],
    ['GET', '/admin/rejections'],
    ['GET', '/admin/forgotten'],
  ])('%s %s answers 404 without the token, or with another', async (method, path) => {
    for (const headers of [{}, { authorization: 'Bearer admin-tes' }, { authorization: 'admin-test' }, { authorization: 'Bearer admin-test-' }] as Record<string, string>[]) {
      expect((await send(method, path, headers)).status).toBe(404);
    }
    expect((await call(new Request(API + path, { method, headers: ADMIN }), { ADMIN_TOKEN: undefined })).status).toBe(404);
    expect(await base.FLAGS.get('paused')).toBeNull();
  });

  it('lists the inbox and serves each photo and its JSON; its own delete is not a forget', async () => {
    const { id } = await (await post()).json<{ id: string }>();
    expect(await (await get('/admin/inbox', ADMIN)).json()).toEqual({ ids: [id] });
    const jpg = await get(`/admin/photos/${id}.jpg`, ADMIN);
    expect(jpg.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await jpg.arrayBuffer())).toEqual(CLEAN);
    const sidecar = await (await get(`/admin/photos/${id}.json`, ADMIN)).json<{ meta: typeof META }>();
    expect(sidecar.meta.profile).toBe('book');
    expect((await get(`/admin/photos/${crypto.randomUUID()}.jpg`, ADMIN)).status).toBe(404);
    expect((await send('DELETE', `/admin/photos/${id}`, ADMIN)).status).toBe(204);
    expect(await keys()).toEqual([]);
    expect(await rows('forgotten')).toEqual([]);
  });

  it('pages the inbox with a cursor', async () => {
    await Promise.all(Array.from({ length: 1001 }, () => base.INBOX.put(`inbox/${crypto.randomUUID()}.json`, '{}')));
    const first = await (await get('/admin/inbox', ADMIN)).json<{ ids: string[]; cursor?: string }>();
    expect(first.cursor).toEqual(expect.any(String));
    const next = await (await get(`/admin/inbox?cursor=${encodeURIComponent(first.cursor!)}`, ADMIN)).json<{ ids: string[]; cursor?: string }>();
    expect(next.cursor).toBeUndefined();
    expect(new Set([...first.ids, ...next.ids]).size).toBe(1001);
  }, 30_000);

  it('lists forgotten ids since a time', async () => {
    await base.DB.batch([
      base.DB.prepare("INSERT INTO forgotten VALUES ('a', '2026-01-01T00:00:00.000Z'), ('b', '2026-06-01T00:00:00.000Z')"),
    ]);
    expect(await (await get('/admin/forgotten', ADMIN)).json()).toEqual([
      { id: 'a', at: '2026-01-01T00:00:00.000Z' },
      { id: 'b', at: '2026-06-01T00:00:00.000Z' },
    ]);
    expect(await (await get('/admin/forgotten?since=2026-03-01T00:00:00.000Z', ADMIN)).json()).toEqual([{ id: 'b', at: '2026-06-01T00:00:00.000Z' }]);
  });
});

describe('the daily expiry', () => {
  it('drops photos and rejections after 180 days and counters after 2, and keeps incidents and forgotten ids', async () => {
    const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    await base.DB.batch([
      base.DB.prepare('INSERT INTO photos VALUES (?, ?, ?, ?, ?)').bind('old', 'sha-old', ago(181), 'p', 1),
      base.DB.prepare('INSERT INTO photos VALUES (?, ?, ?, ?, ?)').bind('new', 'sha-new', ago(179), 'p', 1),
      base.DB.prepare('INSERT INTO rejections VALUES (?, ?, 0, 0, 0)').bind(ago(181), 'old'),
      base.DB.prepare('INSERT INTO rejections VALUES (?, ?, 0, 0, 0)').bind(ago(179), 'new'),
      base.DB.prepare('INSERT INTO counters VALUES (?, ?, 1)').bind(ago(3).slice(0, 10), 'all'),
      base.DB.prepare('INSERT INTO counters VALUES (?, ?, 1)').bind(ago(1).slice(0, 10), 'all'),
      base.DB.prepare("INSERT INTO incidents VALUES ('i', ?, 'sha', '203.0.113.7', 1, 'ua', 'arachnid', 'arachnid')").bind(ago(400)),
      base.DB.prepare("INSERT INTO forgotten VALUES ('f', ?)").bind(ago(400)),
    ]);
    await worker.scheduled({} as ScheduledController, { ...base, ...stubs() } as never);
    expect((await rows('photos')).map((r) => r.id)).toEqual(['new']);
    expect((await rows('rejections')).map((r) => r.reason)).toEqual(['new']);
    expect((await rows('counters')).map((r) => r.day)).toEqual([ago(1).slice(0, 10)]);
    expect(await rows('incidents')).toHaveLength(1);
    expect(await rows('forgotten')).toHaveLength(1);
  });
});

it.each([
  ['GET', '/'],
  ['GET', '/v1/status'],
  ['GET', '/thicken/status'],
  ['POST', '/thicken/v1/status'],
  ['GET', '/thicken/v1/photos'],
  ['PUT', '/thicken/v1/photos/x'],
  ['GET', '/thicken/v1/nope'],
])('%s %s answers 404', async (method, path) => {
  const res = await call(new Request(`https://contribute.wendellresearch.ai${path}`, { method }));
  expect(res.status).toBe(404);
});
