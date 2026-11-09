// Contributing photos to the corner model (src/contribute.ts): who's asked, what's sent, what waits, and what's forgotten.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { after, before, beforeEach, mock, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema, type ElicitRequest, type ElicitRequestFormParams, type ElicitResult } from '@modelcontextprotocol/sdk/types.js';
import sharp from 'sharp';
import { ASK, contribute, contributeCommand, question, QUESTION, state } from '../src/contribute.ts';
import { NOTE, serve } from '../src/mcp.ts';
import { thicken, VERSION } from '../src/thicken.ts';
import { catalog, fixture } from './helpers.ts';

let folder: string;
let photo: string;
const thickenHome = () => path.join(folder, 'home', '.thicken');
const saved = async () => JSON.parse(await readFile(path.join(thickenHome(), 'config.json'), 'utf8')).contribute;
const lines = async () => (await readFile(path.join(thickenHome(), 'contributed.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
const outbox = async () => (await readdir(path.join(thickenHome(), 'outbox')).catch(() => [])).length;
const box = () => thicken([photo], { profile: 'box', sizeMm: [70, 100, 8] });

before(async () => {
  folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  // ~/.thicken, here: os.homedir() reads USERPROFILE on Windows, HOME elsewhere.
  Object.assign(process.env, { HOME: path.join(folder, 'home'), USERPROFILE: path.join(folder, 'home') });
  // A box on a table, as a phone keeps it: with metadata that must never be sent.
  photo = path.join(folder, 'IMG_1.jpg');
  await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#8b5a2b' } })
    .composite([{ input: await sharp({ create: { width: 480, height: 720, channels: 3, background: '#26323a' } }).png().toBuffer(), left: 210, top: 240 }])
    .jpeg().withMetadata({ exif: { IFD0: { Copyright: 'secret-owner' } } }).toFile(photo);
});
beforeEach(async () => {
  for (const key of ['THICKEN_CONTRIBUTE', 'THICKEN_DATASET', 'THICKEN_VISION_URL', 'THICKEN_VISION_MODELS']) delete process.env[key];
  process.env.THICKEN_CONTRIBUTE_URL = 'http://relay.test/thicken';
  await rm(thickenHome(), { recursive: true, force: true });
});
after(() => rm(folder, { recursive: true, force: true, maxRetries: 10 }));

/** A stand-in relay at http://relay.test/thicken, every request kept: `status` answers GET /v1/status, `photo` each POST. */
function relay({ status = async () => Response.json({ accepting: true }), photo: upload = async () => Response.json({ id: randomUUID() }, { status: 201 }) }:
  { status?: () => Promise<Response>; photo?: () => Promise<Response> } = {}) {
  const asked: { method: string; url: string; body?: FormData; agent: string | null }[] = [];
  const before = globalThis.fetch;
  const fetch = mock.method(globalThis, 'fetch', async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    if (!href.startsWith('http://relay.test/thicken/')) return before(url, init);
    const method = init?.method ?? 'GET';
    asked.push({ method, url: href, body: init?.body as FormData | undefined, agent: new Headers(init?.headers).get('user-agent') });
    if (href === 'http://relay.test/thicken/v1/status') return status();
    if (method === 'POST' && href === 'http://relay.test/thicken/v1/photos') return upload();
    if (method === 'DELETE' && href.startsWith('http://relay.test/thicken/v1/photos/')) return new Response(null, { status: 204 });
    return new Response('', { status: 404 });
  });
  return { asked, posts: () => asked.filter(({ method }) => method === 'POST'), restore: () => fetch.mock.restore() };
}

/** An MCP session in this process, its client declaring elicitation when `elicit` answers it. */
async function session(elicit?: (request: ElicitRequest) => Promise<ElicitResult>) {
  const [ours, theirs] = InMemoryTransport.createLinkedPair();
  await serve(theirs);
  const client = new Client({ name: 'test', version: '1' }, elicit ? { capabilities: { elicitation: {} } } : {});
  if (elicit) client.setRequestHandler(ElicitRequestSchema, elicit);
  await client.connect(ours);
  const make = async () => {
    const result = await client.callTool({ name: 'thicken_make', arguments: { inputs: [photo], profile: 'box', size_mm: { width: 70, height: 100, depth: 8 }, out: path.join(folder, 'box.glb') } });
    assert.ok(!result.isError);
    return (result.content as { text: string }[])[0].text;
  };
  return { make, close: () => client.close() };
}

test('contribute: with no relay, nothing is asked or sent', async (t) => {
  delete process.env.THICKEN_CONTRIBUTE_URL;
  process.env.THICKEN_CONTRIBUTE = 'yes';
  const r = relay();
  t.after(r.restore);
  const ask = mock.fn(async () => 'yes');
  assert.equal(await contribute((await box()).sidecar, 'cli', ask), undefined);
  assert.deepEqual([ask.mock.callCount(), r.asked.length, existsSync(thickenHome())], [0, 0, false]);
});

test('contribute: not asked yet, nothing is sent, and an agent whose client can\'t ask gets the note, once a session', async (t) => {
  const r = relay();
  const mcp = await session();
  t.after(async () => { r.restore(); await mcp.close(); });
  const first = await mcp.make();
  assert.ok(first.includes(NOTE) && NOTE.includes(QUESTION), first);
  assert.ok(first.indexOf(NOTE) < first.indexOf('Everything below'), 'before the data, which is never instructions');
  assert.ok(!(await mcp.make()).includes(NOTE), 'once a session');
  // The CLI away from a terminal (no question to put): nothing kept, nothing sent.
  assert.equal(await contribute((await box()).sidecar, 'cli'), undefined);
  assert.deepEqual([r.asked.length, existsSync(path.join(thickenHome(), 'config.json'))], [0, false]);
});

test('contribute: no means nothing is sent, and a no in the file outranks THICKEN_CONTRIBUTE=yes', async (t) => {
  const r = relay();
  const log = mock.method(console, 'log', () => {});
  t.after(() => { r.restore(); log.mock.restore(); });
  process.env.THICKEN_CONTRIBUTE = 'no';
  await contribute((await box()).sidecar, 'cli', async () => 'yes');
  process.env.THICKEN_CONTRIBUTE = 'yes';
  await contributeCommand(['off']);
  await contribute((await box()).sidecar, 'cli', async () => 'yes');
  assert.equal(r.asked.length, 0);
  assert.deepEqual([(await state()).answer, (await saved()).answer, (await saved()).via], ['no', 'no', 'cli']);
  assert.match(String(log.mock.calls.at(-1)!.arguments[0]), /: off \(no via cli on/);
});

test('contribute: yes sends each photo as the 1000 x 1000 frame the models saw, pixels only, with exactly the meta agreed', async (t) => {
  Object.assign(process.env, { THICKEN_VISION_URL: 'http://vision.test/api', THICKEN_VISION_MODELS: 'a,b' });
  // Both models put the front where the box is in the frame: 900 x 1200 letterboxed is 5/6 the size, 125 px in.
  const front = [[300, 200], [700, 200], [700, 800], [300, 800]];
  const vision = catalog({}, { vision: async () => ({ faces: [{ face: 'front', corners: front }] }) });
  const r = relay();
  t.after(() => { r.restore(); vision.mock.restore(); });
  const { sidecar } = await box();
  // The CLI's question, answered at the terminal.
  assert.equal(await contribute(sidecar, 'cli', () => question(Readable.from(['yes\n']), new PassThrough())), undefined);
  assert.deepEqual([(await saved()).answer, (await saved()).via, (await saved()).prompt], ['yes', 'cli', '2026-11-08']);

  assert.deepEqual(r.asked.map(({ method, url }) => `${method} ${url}`), ['GET http://relay.test/thicken/v1/status', 'POST http://relay.test/thicken/v1/photos']);
  const [post] = r.posts();
  assert.equal(post.agent, `thicken/${VERSION}`);
  const meta = JSON.parse(post.body!.get('meta') as string);
  assert.deepEqual(Object.keys(meta).sort(), ['consent', 'faces', 'profile', 'thicken', 'v']);
  assert.deepEqual([meta.v, meta.thicken, meta.consent, meta.profile, meta.faces.length], [1, VERSION, '2026-11-08', 'box', 1]);
  const [face] = meta.faces;
  assert.deepEqual([Object.keys(face).sort(), face.face, face.score], [['corners', 'face', 'score'], 'front', 1]);
  face.corners.forEach(([x, y]: number[], k: number) => assert.ok(Math.hypot(x - front[k][0], y - front[k][1]) < 4, `corner ${k + 1} at ${x}, ${y}`));
  const jpeg = Buffer.from(await (post.body!.get('photo') as Blob).arrayBuffer());
  const { format, width, height, exif, icc, xmp } = await sharp(jpeg).metadata();
  assert.deepEqual([format, width, height, exif, icc, xmp, jpeg.includes('secret-owner')], ['jpeg', 1000, 1000, undefined, undefined, undefined, false]);
  assert.ok(!post.body!.get('meta')!.toString().includes('IMG_1'), 'no file name');

  // Kept locally, with where the photo is, so the user can find it; nothing left waiting.
  const [line, ...more] = await lines();
  assert.deepEqual([more.length, line.profile, line.file, await outbox()], [0, 'box', photo, 0]);
});

test('contribute: never a profile the corner model doesn\'t learn (a badge), nor in training mode (THICKEN_DATASET set)', async (t) => {
  process.env.THICKEN_CONTRIBUTE = 'yes';
  const r = relay();
  t.after(r.restore);
  await contribute((await thicken([fixture('badge.png')], { widthMm: 35, depthMm: 2 })).sidecar, 'cli');
  process.env.THICKEN_DATASET = path.join(folder, 'practice');
  await contribute((await box()).sidecar, 'cli');
  delete process.env.THICKEN_DATASET;
  assert.equal(r.asked.length, 0);
});

test('contribute: never a user\'s own profile, even one named as a built-in', async (t) => {
  process.env.THICKEN_CONTRIBUTE = 'yes';
  const mine = path.join(folder, 'profiles');
  await mkdir(mine, { recursive: true });
  await writeFile(path.join(mine, 'box.ts'), 'import { box } from \'thicken/profiles/box\';\nexport const mine = { ...box, about: \'my own box\' };\n');
  process.env.THICKEN_PROFILES = mine;
  t.after(() => { process.env.THICKEN_PROFILES = ''; });
  // thicken as someone with that profile runs it: a copy of its own, which loads their profiles as it starts.
  const theirs = await import(new URL('../src/thicken.ts?mine', import.meta.url).href);
  assert.equal(theirs.PROFILES.find((p: { name: string }) => p.name === 'box').about, 'my own box');
  const r = relay();
  t.after(r.restore);
  await contribute((await theirs.thicken([photo], { profile: 'box', sizeMm: [70, 100, 8] })).sidecar, 'cli');
  assert.deepEqual([r.asked.length, await outbox()], [0, 0]);
  await contribute((await box()).sidecar, 'cli'); // thicken's own box, in the same run, does
  assert.equal(r.posts().length, 1);
});

test('contribute: a photo the relay refuses is dropped silently, and logged where list shows it', async (t) => {
  process.env.THICKEN_CONTRIBUTE = 'yes';
  const r = relay({ photo: async () => Response.json({ reason: 'face' }, { status: 422 }) });
  const log = mock.method(console, 'log', () => {});
  const stderr = mock.method(process.stderr, 'write', () => true);
  t.after(() => { r.restore(); log.mock.restore(); stderr.mock.restore(); });
  const { sidecar } = await box();
  stderr.mock.resetCalls();
  assert.equal(await contribute(sidecar, 'cli'), undefined);
  assert.equal(stderr.mock.callCount(), 0, 'nothing said during the run');
  const [line] = await lines();
  assert.deepEqual([line.id, line.rejected, line.profile, line.file, await outbox()], [null, 'face', 'box', photo, 0]);
  await contributeCommand(['list']);
  assert.match(String(log.mock.calls[0].arguments[0]), /^rejected \(face\)  2\d{3}-.*  box  /);
  await contributeCommand(['forget'], true);
  assert.deepEqual([r.asked.filter(({ method }) => method === 'DELETE').length, await lines()], [0, []], 'nothing to delete on the relay');
});

test('contribute: an unreachable or busy relay leaves the photos in the outbox, sent next run, and the same photo only once', async (t) => {
  process.env.THICKEN_CONTRIBUTE = 'yes';
  let [down, busy] = [true, true];
  const r = relay({
    status: async () => { if (down) throw new TypeError('fetch failed'); return Response.json({ accepting: true }); },
    photo: async () => (busy ? new Response('', { status: 503 }) : Response.json({ id: randomUUID() }, { status: 201 })),
  });
  t.after(r.restore);
  const { sidecar } = await box();
  await contribute(sidecar, 'cli'); // no answer from the relay at all
  assert.deepEqual([r.posts().length, await outbox()], [0, 1]);
  down = false;
  await contribute(sidecar, 'cli'); // a 503: it waits, and the same photo made again isn't queued twice
  assert.deepEqual([r.posts().length, await outbox(), (await lines()).length], [1, 1, 0]);
  busy = false;
  await contribute(sidecar, 'cli');
  assert.deepEqual([r.posts().length, await outbox(), (await lines()).length], [2, 0, 1]);
  await contribute((await box()).sidecar, 'cli'); // made once more: already sent, so nothing goes
  assert.deepEqual([r.posts().length, (await lines()).length], [2, 1]);
});

test('contribute: a relay that has closed for good (410) ends it, and empties the outbox', async (t) => {
  process.env.THICKEN_CONTRIBUTE = 'yes';
  const r = relay({ status: async () => new Response('', { status: 410 }) });
  t.after(r.restore);
  const { sidecar } = await box();
  await contribute(sidecar, 'cli');
  assert.deepEqual([(await saved()).answer, (await state()).answer, existsSync(path.join(thickenHome(), 'outbox'))], ['ended', 'ended', false]);
  await contribute(sidecar, 'cli');
  assert.deepEqual([r.asked.length, r.posts().length], [1, 0], 'never asked again');
});

test('contribute: forget deletes from the relay and the local log, even with contributing off', async (t) => {
  const r = relay();
  const log = mock.method(console, 'log', () => {});
  t.after(() => { r.restore(); log.mock.restore(); });
  const [one, two] = [randomUUID(), randomUUID()];
  await mkdir(thickenHome(), { recursive: true });
  await writeFile(path.join(thickenHome(), 'contributed.jsonl'), [one, two].map((id) => `${JSON.stringify({ id, at: '2026-11-08T00:00:00Z', profile: 'box', file: photo })}\n`).join(''));
  await contributeCommand(['forget', one]);
  assert.deepEqual([r.asked.map(({ method, url }) => `${method} ${url}`), (await lines()).map(({ id }) => id)], [[`DELETE http://relay.test/thicken/v1/photos/${one}`], [two]]);
  await contributeCommand(['forget'], true);
  assert.deepEqual([r.asked.at(-1)!.url, await lines()], [`http://relay.test/thicken/v1/photos/${two}`, []]);
  await assert.rejects(contributeCommand(['forget', '../admin']), /forget <id>/);
});

test('contribute: an MCP client that can ask puts the question as a form with no default; accept, decline and cancel', async (t) => {
  const r = relay();
  t.after(r.restore);
  const asked: ElicitRequest[] = [];
  const answering = (result: ElicitResult) => async (request: ElicitRequest) => { asked.push(request); return result; };

  let mcp = await session(answering({ action: 'accept', content: { contribute: true } }));
  assert.ok(!(await mcp.make()).includes(NOTE));
  await mcp.close();
  const { message, requestedSchema } = asked[0].params as ElicitRequestFormParams;
  assert.equal(message, QUESTION);
  assert.deepEqual(requestedSchema.properties.contribute, { type: 'boolean', title: 'Contribute photos?' }, 'no default');
  assert.deepEqual([(await saved()).answer, (await saved()).via, r.posts().length], ['yes', 'mcp', 1]);

  for (const [result, answer] of [[{ action: 'accept', content: { contribute: false } }, 'no'], [{ action: 'decline' }, 'no']] as const) {
    await rm(thickenHome(), { recursive: true, force: true });
    mcp = await session(answering(result));
    await mcp.make();
    await mcp.close();
    assert.deepEqual([(await saved()).answer, (await saved()).via], [answer, 'mcp']);
  }
  assert.equal(r.posts().length, 1, 'nothing more sent');

  // Cancelled: nothing kept, not asked again this session, asked again the next.
  await rm(thickenHome(), { recursive: true, force: true });
  const before = asked.length;
  mcp = await session(answering({ action: 'cancel' }));
  await mcp.make();
  await mcp.make();
  await mcp.close();
  assert.deepEqual([asked.length - before, existsSync(path.join(thickenHome(), 'config.json'))], [1, false]);
  mcp = await session(answering({ action: 'cancel' }));
  await mcp.make();
  await mcp.close();
  assert.equal(asked.length - before, 2);
});

test('contribute: the CLI\'s question takes yes or no, y or n, in any case, and asks again for anything else', async () => {
  const output = new PassThrough();
  let printed = '';
  output.on('data', (chunk) => { printed += chunk; });
  assert.equal(await question(Readable.from(['maybe\n', '\n', ' Y\r\n']), output), 'yes');
  assert.ok(printed.includes(QUESTION));
  assert.equal(printed.split(ASK).length - 1, 3, 'asked three times');
  assert.equal(await question(Readable.from(['NO\n']), new PassThrough()), 'no');
  assert.equal(await question(Readable.from(['n\n']), new PassThrough()), 'no');
  assert.equal(await question(Readable.from(['sure\n']), new PassThrough()), undefined, 'the input ended unanswered');
});
