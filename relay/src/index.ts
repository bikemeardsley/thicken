// The relay that receives photos contributed to the corner model thicken uses (README.md). One upload is one
// letterboxed JPEG frame and its meta; it is checked in the numbered order below and stops at the first failure.
import { configured, known, type Lists } from './known.ts';

type E = Env & Lists & { ADMIN_TOKEN?: string; IP_SALT?: string };
type Meta = Record<string, unknown>;

const API = '/thicken/v1/';
const MAX = 1.5 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROFILES = ['book', 'box', 'card', 'slab'];
const FACES = 8; // the most a contributing profile names (slab)
const FORGET_DAY = 500; // forgets a network may send a day: --all for a long-time contributor, not a flood of made-up ids
const json = (body: unknown, status = 200) => Response.json(body, { status });
const empty = (status: number) => new Response(null, { status });
const text = (s: string) => new TextEncoder().encode(s);
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

export default {
  async fetch(req: Request, env: E): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (!path.startsWith(API)) return empty(404);
    const route = path.slice(API.length);
    const id = route.match(/^photos\/([^/]+)$/)?.[1];
    if (route === 'status' && req.method === 'GET') {
      const reason = await closed(env);
      return reason ? json({ accepting: false, reason }, reason === 'ended' ? 410 : 200) : json({ accepting: true });
    }
    if (route === 'photos' && req.method === 'POST') return upload(req, env);
    if (id && req.method === 'DELETE') {
      if (env.IP_SALT) {
        const prefix = await prefixOf(req, env);
        if (!(await env.RATE.limit({ key: prefix })).success || !(await counted(env, [`d:${prefix}`], [FORGET_DAY]))) {
          return json({ reason: 'rate limit' }, 429);
        }
      }
      return remove(env, id, true);
    }
    if (route.startsWith('admin/') && (await isAdmin(req, env))) return admin(req, env, route.slice(6));
    return empty(404);
  },

  // Daily (wrangler.jsonc): what D1 keeps expires with the photos (R2's lifecycle rule, 180 days). Incidents and
  // forgotten ids stay.
  async scheduled(_: ScheduledController, env: E): Promise<void> {
    const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM photos WHERE at < ?').bind(ago(180)),
      env.DB.prepare('DELETE FROM rejections WHERE at < ?').bind(ago(180)),
      env.DB.prepare('DELETE FROM counters WHERE day < ?').bind(ago(2).slice(0, 10)),
    ]);
  },
};

// Why the relay isn't accepting, or null. "not open" until at least one hash list (and the IP salt) is configured; the
// FLAGS key `paused` is manual, auto or incident, or `ended` once contributing has ended for good (status answers 410).
async function closed(env: E): Promise<string | null> {
  if (!env.IP_SALT || !configured(env).length) return 'not open';
  const flag = await env.FLAGS.get('paused');
  return flag === 'ended' ? 'ended' : flag ? 'paused' : null;
}

async function upload(req: Request, env: E): Promise<Response> {
  // 1. Accepting.
  const reason = await closed(env);
  if (reason) return json({ reason }, reason === 'ended' ? 410 : 503);

  // 2. Rate limits, keyed on the hashed /32 or /64, before anything is read or checked: every attempt counts toward
  // the day caps, refused ones too, so the caps also bound what the checks below cost.
  const ip = req.headers.get('cf-connecting-ip') ?? '';
  const asn = Number(req.cf?.asn) || 0;
  const prefix = await prefixOf(req, env);
  if (!(await env.RATE.limit({ key: prefix })).success) return json({ reason: 'rate limit' }, 429);
  const caps = [env.PER_PREFIX_DAY, env.PER_ASN_DAY, env.GLOBAL_DAY].map(Number);
  if (!(await counted(env, [`p:${prefix}`, `a:${asn}`, 'all'], caps))) return json({ reason: 'rate limit' }, 429);
  const now = new Date();
  const at = now.toISOString();
  const hour = await env.DB.prepare('SELECT count(*) AS n FROM photos WHERE at > ?')
    .bind(new Date(now.getTime() - 3_600_000).toISOString())
    .first<number>('n');
  if ((hour ?? 0) >= Number(env.SPIKE_HOUR)) {
    await env.FLAGS.put('paused', 'auto', { expirationTtl: 3600 }); // lifts itself after an hour
    return json({ reason: 'paused' }, 503);
  }

  // 3. Size, declared and counted.
  const body = await read(req);
  if (!body) return json({ reason: 'too large' }, 413);

  // 4. The meta.
  let form: FormData;
  try {
    form = await new Response(body, { headers: { 'content-type': req.headers.get('content-type') ?? '' } }).formData();
  } catch {
    return json({ reason: 'meta' }, 400);
  }
  const part = form.get('meta');
  const meta = parseMeta(typeof part === 'string' ? part : part ? await part.text() : '');
  if (!meta) return json({ reason: 'meta' }, 400);

  // 5. A JPEG, no side over 1024.
  const photo = form.get('photo');
  if (!photo || typeof photo === 'string') return json({ reason: 'not a JPEG' }, 415);
  const bytes = new Uint8Array(await photo.arrayBuffer());
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return json({ reason: 'not a JPEG' }, 415);
  const info = await env.IMAGES.info(photo.stream()).catch(() => null);
  if (!info || info.format !== 'image/jpeg' || !('width' in info)) return json({ reason: 'not a JPEG' }, 415);
  if (info.width > 1024 || info.height > 1024) return json({ reason: 'too large' }, 413);

  // 6. Not a repeat. A repeat is answered as if stored, with an id that names nothing, so the answer can't tell
  // anyone holding a copy of a photo that it was contributed before.
  const sha256 = hex(await crypto.subtle.digest('SHA-256', bytes));
  if (await env.DB.prepare('SELECT 1 FROM photos WHERE sha256 = ?').bind(sha256).first()) return json({ id: crypto.randomUUID() }, 201);

  // 7. Not known CSAM. A match is preserved for a year (18 U.S.C. § 2258A(h)) and reported by hand (README.md).
  let lists: { matched: string[]; answered: string[] };
  try {
    lists = await known(bytes, env);
  } catch {
    return json({ reason: 'unavailable' }, 503);
  }
  const ua = (req.headers.get('user-agent') ?? '').slice(0, 200);
  if (lists.matched.length) {
    const incident = crypto.randomUUID();
    await env.FLAGS.put('paused', 'incident');
    await env.INBOX.put(`incidents/${incident}.jpg`, bytes);
    await env.DB.prepare('INSERT INTO incidents (id, at, sha256, ip, asn, ua, matched, answered) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(incident, at, sha256, ip, asn, ua, lists.matched.join(' '), lists.answered.join(' '))
      .run();
    return json({ reason: 'rejected' }, 422);
  }

  // 8. Re-encoded, which drops the metadata; only these bytes from here on. 9. The Workers AI checks.
  let clean: Uint8Array;
  let scores: { sexual: number; face: number; topic: number };
  try {
    const out = await env.IMAGES.input(new Blob([bytes]).stream()).output({ format: 'image/jpeg', quality: 90 });
    clean = new Uint8Array(await out.response().arrayBuffer());
    scores = await ask(env, clean);
  } catch {
    return json({ reason: 'unavailable' }, 503);
  }
  const rejected =
    scores.sexual >= Number(env.SEXUAL_MAX) ? 'sexual'
    : scores.face >= Number(env.FACE_MAX) ? 'face'
    : scores.topic < Number(env.TOPIC_MIN) ? 'topic'
    : null;
  if (rejected) {
    await env.DB.prepare('INSERT INTO rejections (at, reason, sexual, face, topic) VALUES (?, ?, ?, ?, ?)')
      .bind(at, rejected, scores.sexual, scores.face, scores.topic)
      .run();
    return json({ reason: rejected }, 422);
  }

  // 10. Stored: the row first, so the same photo sent twice at once is stored once.
  const id = crypto.randomUUID();
  const row = await env.DB.prepare('INSERT INTO photos (id, sha256, at, prefix, asn) VALUES (?, ?, ?, ?, ?) ON CONFLICT (sha256) DO NOTHING RETURNING id')
    .bind(id, sha256, at, prefix, asn)
    .first();
  if (!row) return json({ id: crypto.randomUUID() }, 201);
  await env.INBOX.put(`inbox/${id}.jpg`, clean, { httpMetadata: { contentType: 'image/jpeg' } });
  await env.INBOX.put(`inbox/${id}.json`, JSON.stringify({ meta, at, asn, prefix, ua, scores }), {
    httpMetadata: { contentType: 'application/json' },
  });
  return json({ id }, 201);
}

// Counts one attempt against each key's cap for today, atomically; false once any is over its cap.
async function counted(env: E, keys: string[], caps: number[]): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const bump = env.DB.prepare('INSERT INTO counters (day, key, n) VALUES (?, ?, 1) ON CONFLICT (day, key) DO UPDATE SET n = n + 1 RETURNING n');
  const done = await env.DB.batch<{ n: number }>(keys.map((key) => bump.bind(day, key)));
  return done.every((r, i) => (r.results[0]?.n ?? 0) <= caps[i]);
}

// The body, or null when Content-Length is missing or over MAX, or more bytes than that arrive.
async function read(req: Request): Promise<Blob | null> {
  if (!(Number(req.headers.get('content-length') ?? NaN) <= MAX)) return null;
  const chunks: Uint8Array[] = [];
  let n = 0;
  const reader = req.body?.getReader();
  for (let r = await reader?.read(); r && !r.done; r = await reader!.read()) {
    n += r.value.byteLength;
    if (n > MAX) {
      await reader!.cancel();
      return null;
    }
    chunks.push(r.value);
  }
  return new Blob(chunks);
}

// The meta, with exactly its keys (the contract in README.md), or null.
function parseMeta(s: string): Meta | null {
  if (text(s).length > 4096) return null;
  let m: Meta;
  try {
    m = JSON.parse(s);
  } catch {
    return null;
  }
  const ok =
    exact(m, ['v', 'thicken', 'consent', 'profile', 'faces']) &&
    m.v === 1 &&
    typeof m.thicken === 'string' && m.thicken.length <= 32 && /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(m.thicken) &&
    typeof m.consent === 'string' && /^\d{4}-\d\d-\d\d$/.test(m.consent) &&
    PROFILES.includes(m.profile as string) &&
    Array.isArray(m.faces) && m.faces.length <= FACES && m.faces.every(face);
  return ok ? m : null;
}

function face(f: Meta): boolean {
  return (
    exact(f, ['face', 'corners'], ['score']) &&
    typeof f.face === 'string' && f.face.length > 0 && f.face.length <= 32 &&
    Array.isArray(f.corners) && f.corners.length === 4 &&
    f.corners.every((p) => Array.isArray(p) && p.length === 2 && p.every((c) => within(c, 1000))) &&
    (f.score === undefined || within(f.score, 1))
  );
}

const within = (x: unknown, max: number) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= max;

function exact(o: unknown, required: string[], optional: string[] = []): o is Meta {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  const keys = Object.keys(o);
  return required.every((k) => keys.includes(k)) && keys.every((k) => required.includes(k) || optional.includes(k));
}

// The network a client is keyed on: the IPv4 address, or the first 64 bits of an IPv6 one, normalized.
function net(ip: string): string {
  const v4 = ip.match(/^(?:::ffff:)?(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4) return v4[1];
  const [head, tail] = ip.toLowerCase().split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return `${groups.slice(0, 4).map((g) => (parseInt(g, 16) || 0).toString(16)).join(':')}::/64`;
}

// HMAC-SHA256(IP_SALT, the client's network), 16 hex: what the rate limits and the stored rows key on.
async function prefixOf(req: Request, env: E): Promise<string> {
  const key = await crypto.subtle.importKey('raw', text(env.IP_SALT!), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, text(net(req.headers.get('cf-connecting-ip') ?? '')))).slice(0, 16);
}

// Three yes/no questions to clef-flash, each answered with the probability of yes.
async function ask(env: E, jpeg: Uint8Array) {
  let bin = '';
  for (let i = 0; i < jpeg.length; i += 0x8000) bin += String.fromCharCode(...jpeg.subarray(i, i + 0x8000));
  const r = (await env.AI.run('@cf/cloudflare/clef-flash', {
    model: 'clef-flash',
    state: 'A photo someone contributed to train a model that finds the corners of objects.',
    images: [{ content_type: 'image/jpeg', base64: btoa(bin) }],
    questions: {
      sexual: { type: 'noul', instructions: 'Does the image show nudity or sexual content?' },
      face: {
        type: 'noul',
        instructions: 'Is a human face visible, even partly or in a reflection? A hand or arm holding the object is not a face.',
      },
      topic: { type: 'noul', instructions: 'Is this a photo of a physical book, trading card, graded card slab or box?' },
    },
  })) as { answers?: Record<string, { noul?: unknown }> };
  const p = (q: string) => {
    const v = r.answers?.[q]?.noul;
    if (!within(v, 1)) throw new Error(`no answer for ${q}`);
    return v as number;
  };
  return { sexual: p('sexual'), face: p('face'), topic: p('topic') };
}

// Deletes a photo and its row; always 204, so it can't tell whether an id exists. Never touches incidents/. A
// contributor's delete (forget) is kept in `forgotten` whether or not the relay still has the photo, so Mike's copies
// go too (pull.ts), even after the 180 days that expire the relay's own.
async function remove(env: E, id: string, forget = false): Promise<Response> {
  if (UUID.test(id)) {
    await env.INBOX.delete([`inbox/${id}.jpg`, `inbox/${id}.json`]);
    const remember = env.DB.prepare('INSERT OR IGNORE INTO forgotten (id, at) VALUES (?, ?)');
    await env.DB.batch([
      ...(forget ? [remember.bind(id, new Date().toISOString())] : []),
      env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(id),
    ]);
  }
  return empty(204);
}

// Authorization: Bearer ADMIN_TOKEN, compared in constant time (as digests, so the lengths match).
async function isAdmin(req: Request, env: E): Promise<boolean> {
  if (!env.ADMIN_TOKEN) return false;
  const digest = (s: string) => crypto.subtle.digest('SHA-256', text(s));
  const [a, b] = await Promise.all([digest(req.headers.get('authorization') ?? ''), digest(`Bearer ${env.ADMIN_TOKEN}`)]);
  return crypto.subtle.timingSafeEqual(a, b);
}

// Mike's side (pull.ts). Reads only inbox/: incident bytes are never served.
async function admin(req: Request, env: E, route: string): Promise<Response> {
  const get = req.method === 'GET';
  if (get && route === 'inbox') {
    const list = await env.INBOX.list({ prefix: 'inbox/', cursor: new URL(req.url).searchParams.get('cursor') || undefined });
    const ids = list.objects.map((o) => o.key.slice(6)).filter((k) => k.endsWith('.json')).map((k) => k.slice(0, -5));
    return json(list.truncated ? { ids, cursor: list.cursor } : { ids });
  }
  if (get && route === 'forgotten') {
    const since = new URL(req.url).searchParams.get('since') ?? '';
    return json((await env.DB.prepare('SELECT id, at FROM forgotten WHERE at > ? ORDER BY at').bind(since).all()).results);
  }
  const photo = route.match(/^photos\/(.+?)(\.jpg|\.json)?$/);
  if (photo && UUID.test(photo[1])) {
    if (get && photo[2]) {
      const obj = await env.INBOX.get(`inbox/${photo[1]}${photo[2]}`);
      return obj ? new Response(obj.body, { headers: { 'content-type': photo[2] === '.jpg' ? 'image/jpeg' : 'application/json' } }) : empty(404);
    }
    if (req.method === 'DELETE' && !photo[2]) return remove(env, photo[1]);
  }
  if (req.method === 'POST' && route === 'pause') {
    await env.FLAGS.put('paused', 'manual');
    return empty(204);
  }
  if (req.method === 'POST' && route === 'resume') {
    await env.FLAGS.delete('paused');
    return empty(204);
  }
  if (get && (route === 'incidents' || route === 'rejections')) {
    return json((await env.DB.prepare(`SELECT * FROM ${route} ORDER BY at DESC LIMIT 1000`).all()).results);
  }
  return empty(404);
}
