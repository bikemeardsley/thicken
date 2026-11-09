// Contributed photos, Mike's side (relay/pull.ts): from the relay's inbox to Label Studio and review.jsonl, and gone
// again when rejected or forgotten. The relay's admin API and Label Studio are stand-ins.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mock, test } from 'node:test';
import sharp from 'sharp';
import './helpers.ts';
import { pull } from '../relay/pull.ts';
import type { Annotation } from '../src/reviews.ts';

const corners = [[126, 70], [882, 54], [928, 971], [120, 955]];
const polygon = (points: number[][], face: string) => ({ from_name: 'faces', type: 'polygonlabels', original_width: 1000, original_height: 1000,
  value: { points: points.map(([x, y]) => [x / 10, y / 10]), closed: true, polygonlabels: [face] } });
const annotated = (result: object[], verdict: string): Annotation[] => [{ id: 9, updated_at: '2026-11-08T12:00:00Z',
  result: [...result, { from_name: 'verdict', type: 'choices', value: { choices: [verdict] } }] as Annotation['result'] }];

test('pull: new photos go to Label Studio; a keep is a row, a reject and a forgotten photo are deleted everywhere', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  const inbox = path.join(folder, 'contributed-inbox');
  Object.assign(process.env, { THICKEN_INBOX_URL: 'http://relay.test/thicken/', THICKEN_INBOX_TOKEN: 'admin-secret', THICKEN_INBOX_DIR: inbox,
    LABEL_STUDIO_URL: 'http://studio.test', LABEL_STUDIO_API_KEY: 'legacy-key' });
  const jpeg = await sharp({ create: { width: 1000, height: 1000, channels: 3, background: '#8b5a2b' } }).jpeg().toBuffer();
  const png = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#8b5a2b' } }).png().toBuffer();
  const meta = (profile: string, face: string) => ({ v: 1, thicken: '0.3.0', consent: '2026-11-08', profile, faces: [{ face, corners, score: 0.5 }, { face: 'nonsense', corners }] });
  const at = new Date().toISOString();
  const [keep, reject, bad, forget] = ['1b0e5a2c-8f3d-4c1e-9a7b-2d4e6f8a0b1c', '2b0e5a2c-8f3d-4c1e-9a7b-2d4e6f8a0b1c', '3b0e5a2c-8f3d-4c1e-9a7b-2d4e6f8a0b1c', '4b0e5a2c-8f3d-4c1e-9a7b-2d4e6f8a0b1c'];
  // The relay's inbox: each photo and its record, the meta beside the relay's own fields; and the ids forgotten.
  const relay = new Map<string, { jpg: Buffer; json: object }>([
    [keep, { jpg: jpeg, json: { meta: meta('book', 'front'), at, asn: 1136, prefix: '0123456789abcdef', ua: 'thicken/0.3.0' } }],
    [reject, { jpg: jpeg, json: { meta: meta('box', 'top'), at } }],
    [bad, { jpg: png, json: { meta: meta('card', 'front'), at } }],
    [forget, { jpg: jpeg, json: { meta: meta('slab', 'front'), at } }],
  ]);
  const forgotten: string[] = [];
  const asked: string[] = []; // the forgotten routes asked for
  const contributor = (id: string) => { // thicken contribute forget
    relay.delete(id);
    forgotten.push(id);
  };
  const deleted: string[] = [];
  const projects: { id: number; title: string }[] = [];
  const tasks = new Map<string, number>(); // by group
  const predictions = new Map<number, any>();
  const annotations = new Map<number, Annotation[]>();
  const removed: number[] = [];
  const fetch = mock.method(globalThis, 'fetch', async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (href.startsWith('http://relay.test/thicken/v1/admin/')) {
      if (new Headers(init?.headers).get('authorization') !== 'Bearer admin-secret') return new Response('', { status: 404 });
      const route = href.slice('http://relay.test/thicken/v1/admin/'.length);
      const ids = [...relay.keys()];
      if (route === 'inbox?cursor=') return Response.json({ ids: [...ids.slice(0, 2), '../escape'], cursor: 'two' });
      if (route === 'inbox?cursor=two') return Response.json({ ids: ids.slice(2) });
      if (route.startsWith('forgotten')) {
        asked.push(route);
        return Response.json({ ids: forgotten });
      }
      const [, id, kind] = /^photos\/([^/.]+)(?:\.(jpg|json))?$/.exec(route) ?? [];
      if (method === 'DELETE') {
        deleted.push(id);
        relay.delete(id);
        return new Response(null, { status: 204 });
      }
      const item = relay.get(id);
      if (item && kind === 'jpg') return new Response(new Uint8Array(item.jpg));
      if (item && kind === 'json') return Response.json(item.json);
      return new Response('', { status: 404 });
    }
    if (!href.startsWith('http://studio.test/')) return new Response('', { status: 404 });
    const route = href.slice('http://studio.test'.length);
    if (route.startsWith('/api/projects?')) return Response.json({ results: projects });
    if (route === '/api/projects') {
      projects.push({ id: projects.length + 1, title: body.title });
      return Response.json({ id: projects.length });
    }
    if (route.startsWith('/api/projects/')) return Response.json({});
    if (route === '/api/tasks') {
      tasks.set(body.data.group, 70 + tasks.size);
      return Response.json({ id: tasks.get(body.data.group) });
    }
    if (route === '/api/predictions') {
      predictions.set(body.task, body);
      return Response.json({ id: 1 });
    }
    const task = /^\/api\/tasks\/(\d+)(\/annotations)?$/.exec(route);
    if (task && task[2]) return Response.json(annotations.get(Number(task[1])) ?? []);
    if (task && method === 'DELETE') {
      removed.push(Number(task[1]));
      return new Response(null, { status: 204 });
    }
    return new Response('', { status: 404 });
  });
  const said: string[] = [];
  const stderr = mock.method(process.stderr, 'write', (text: string) => { said.push(text); return true; });
  t.after(async () => { fetch.mock.restore(); stderr.mock.restore(); await rm(folder, { recursive: true, force: true }); });
  t.after(() => { for (const key of ['THICKEN_INBOX_URL', 'THICKEN_INBOX_TOKEN', 'THICKEN_INBOX_DIR', 'LABEL_STUDIO_URL', 'LABEL_STUDIO_API_KEY', 'THICKEN_DATASET']) delete process.env[key]; });
  const frame = (id: string) => path.join(inbox, 'frames', `${id}.jpg`);

  // 1. Three photos to review, each in its profile's project with its contributor's faces; the PNG is deleted from the relay.
  assert.deepEqual(await pull(), { added: 3, kept: 0, rejected: 0, dropped: 0 });
  assert.deepEqual(projects.map(({ title }) => title), ['003 · book faces · contributed photos', '003 · box faces · contributed photos', '003 · slab faces · contributed photos']);
  assert.deepEqual(deleted, [bad]);
  assert.deepEqual(await readFile(frame(keep)), jpeg, 'the relay\'s bytes, as they came');
  const proposed = predictions.get(tasks.get(`contributed:${keep}`)!);
  assert.deepEqual(proposed.result.filter((r: any) => r.type === 'polygonlabels').map((r: any) => [r.value.polygonlabels, r.score]), [[['front'], 0.5]], 'only the profile\'s own faces');
  assert.equal(existsSync(path.join(inbox, 'review.jsonl')), false);

  // 2. One kept, one rejected, one forgotten before review.
  annotations.set(tasks.get(`contributed:${keep}`)!, annotated([polygon(corners, 'front')], 'keep'));
  annotations.set(tasks.get(`contributed:${reject}`)!, annotated([], 'reject'));
  contributor(forget);
  assert.deepEqual(await pull(), { added: 0, kept: 1, rejected: 1, dropped: 1 });
  const rows = (await readFile(path.join(inbox, 'review.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(rows.map(({ group, verdict, source }) => [group, verdict, source]), [[`contributed:${keep}`, 'keep', 'contributed'], [`contributed:${reject}`, 'reject', 'contributed']]);
  const [row] = rows;
  assert.deepEqual([row.faces, row.file_name, row.frame, row.profile, row.consent, row.contributedAt, row.thicken, row.proposal.faces],
    [[{ face: 'front', corners }], `frames/${keep}.jpg`, 'letterbox-1000', 'book', '2026-11-08', at, '0.3.0', [{ face: 'front', corners, score: 0.5 }]]);
  assert.deepEqual(row.labelStudio, { url: 'http://studio.test', project: 1, task: tasks.get(`contributed:${keep}`), annotation: 9 });
  assert.ok(!JSON.stringify(rows).includes('0123456789abcdef') && !JSON.stringify(rows).includes('1136'), 'nothing of the address or network');
  assert.deepEqual(deleted, [bad, reject]);
  assert.deepEqual([existsSync(frame(keep)), existsSync(frame(reject)), existsSync(frame(forget))], [true, false, false]);
  assert.deepEqual(removed, [tasks.get(`contributed:${reject}`), tasks.get(`contributed:${forget}`)]);
  assert.deepEqual(await readdir(path.join(inbox, 'waiting')), []);

  // 3. The kept photo, once the relay's 180 days are up, stays: gone from the relay isn't forgotten.
  relay.delete(keep);
  assert.deepEqual(await pull(), { added: 0, kept: 0, rejected: 0, dropped: 0 });
  assert.equal(existsSync(frame(keep)), true);

  // 4. Forgotten by its contributor, then or any time later: its frame, task and line go; the reject's line stays.
  contributor(keep);
  assert.deepEqual(await pull(), { added: 0, kept: 0, rejected: 0, dropped: 1 });
  assert.equal(existsSync(frame(keep)), false);
  assert.equal(removed.at(-1), tasks.get(`contributed:${keep}`));
  assert.deepEqual((await readFile(path.join(inbox, 'review.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line).group), [`contributed:${reject}`]);
  // Each pull asks for the ids forgotten since a day before the last one: all of them, the first time.
  assert.equal(asked[0], 'forgotten');
  assert.ok(asked.slice(1).every((route) => {
    const since = Date.parse(decodeURIComponent(route.split('since=')[1]));
    return Date.now() - since > 86_000_000 && Date.now() - since < 87_000_000;
  }), asked.join(', '));
  for (const file of [...await readdir(inbox, { recursive: true })].filter((f) => /\.(json|jsonl)$/.test(f))) {
    assert.ok(!(await readFile(path.join(inbox, file), 'utf8')).includes('secret'), `${file} holds no token`);
  }
  assert.ok(!said.join('').includes('admin-secret') && !said.join('').includes('legacy-key'), 'no token printed');

  // Never an exam's folder, nor THICKEN_DATASET's.
  process.env.THICKEN_INBOX_DIR = path.join(folder, 'library', 'Exam');
  await assert.rejects(pull(), /never go in an exam's folder/);
  Object.assign(process.env, { THICKEN_INBOX_DIR: inbox, THICKEN_DATASET: folder });
  await assert.rejects(pull(), /never go in THICKEN_DATASET/);
});
