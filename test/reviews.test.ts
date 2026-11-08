// Training mode, reviewed (src/reviews.ts): a person's decision in Label Studio, and the row and the build it makes.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mock, test } from 'node:test';
import sharp from 'sharp';
import { browser, decision, fourCorners, type Annotation } from '../src/reviews.ts';
import { thicken } from '../src/thicken.ts';
import { catalog } from './helpers.ts';

const shown = [[126, 70], [882, 54], [928, 971], [120, 955]];
const polygon = (corners: number[][], face = 'front') => ({ from_name: 'faces', type: 'polygonlabels', original_width: 1000, original_height: 1000,
  value: { points: corners.map(([x, y]) => [x / 10, y / 10]), closed: true, polygonlabels: [face] } });
const annotated = (result: object[], verdict = 'keep', extra: object[] = []): Annotation => ({ id: 1, updated_at: '2026-11-07T00:00:00Z',
  result: [...result, ...extra, { from_name: 'verdict', type: 'choices', value: { choices: [verdict] } }] as Annotation['result'] });

test('reviews: a submitted annotation is a keep, a fix or a reject, as experiment 003 exports them', () => {
  const proposal = [{ face: 'front', corners: shown }];
  assert.deepEqual(decision(annotated([polygon(shown)]), proposal), { verdict: 'keep', faces: proposal, at: '2026-11-07T00:00:00Z', someone: false });
  const moved = [shown[0], shown[1], [900, 950], shown[3]];
  assert.deepEqual(decision(annotated([polygon(moved)]), proposal), { verdict: 'fix', faces: [{ face: 'front', corners: moved }], at: '2026-11-07T00:00:00Z', someone: false });
  assert.equal((decision(annotated([]), proposal) as { verdict: string }).verdict, 'reject', 'every face deleted');
  // A point clicked on an edge goes; a shape with five real corners, or one going the wrong way round, is refused.
  assert.equal((decision(annotated([polygon([shown[0], [504, 62], ...shown.slice(1)])]), proposal) as { verdict: string }).verdict, 'keep');
  const house = [[100, 500], [500, 100], [900, 500], [900, 900], [100, 900]];
  assert.deepEqual(fourCorners(house), house);
  assert.ok('error' in decision(annotated([polygon(house)]), proposal));
  assert.ok('error' in decision(annotated([polygon([...moved].reverse())]), proposal));
  assert.equal((decision(annotated([polygon([...moved].reverse())], 'reject'), proposal) as { verdict: string }).verdict, 'reject');
  const spine = [[63, 70], [115, 84], [194, 78], [194, 967], [112, 975], [64, 958]]; // review 1, a thin face: corners survive
  assert.deepEqual(fourCorners(spine), [[63, 70], [194, 78], [194, 967], [64, 958]]);
  // A hand boxed, and someone else in frame, go with the decision.
  const hand = { from_name: 'obstruction', type: 'rectanglelabels', original_width: 1000, original_height: 1000, value: { x: 10, y: 20, width: 5, height: 7.5, rectanglelabels: ['hand'] } };
  const people = { from_name: 'people', type: 'choices', value: { choices: ['someone else in frame'] } };
  assert.deepEqual(decision(annotated([polygon(shown)], 'keep', [hand, people]), proposal),
    { verdict: 'keep', faces: proposal, obstructions: [{ what: 'hand', box: [100, 200, 150, 275] }], at: '2026-11-07T00:00:00Z', someone: true });
});

/** A stand-in Label Studio at http://studio.test, every request kept; `annotate` gives a task's annotations from its prediction. */
function studio(annotate: (prediction: { result: any[] }) => Annotation[]) {
  const asked: { method: string; route: string; body?: any; authorization: string | null }[] = [];
  const predictions = new Map<number, { result: any[] }>();
  const before = globalThis.fetch; // the stand-in vision endpoint
  const fetch = mock.method(globalThis, 'fetch', async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    if (!href.startsWith('http://studio.test/')) return before(url, init);
    const route = href.slice('http://studio.test'.length);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    asked.push({ method, route, body, authorization: new Headers(init?.headers).get('authorization') });
    if (route === '/api/token/refresh') return Response.json({ access: 'short-lived' });
    if (route.startsWith('/api/projects?')) return Response.json({ results: [] });
    if (route === '/api/projects') return Response.json({ id: 7 });
    if (route === '/api/tasks') return Response.json({ id: 70 + predictions.size });
    if (route === '/api/predictions') {
      predictions.set(body.task, body);
      return Response.json({ id: 1 });
    }
    const task = /^\/api\/tasks\/(\d+)\/annotations$/.exec(route);
    if (task) return Response.json(annotate(predictions.get(Number(task[1]))!));
    return new Response('', { status: 404 });
  });
  return { asked, restore: () => { fetch.mock.restore(); } };
}

test('reviews: a 3024 px phone photo, shrunk to 2048 on loading, is built from the reviewed corners, and they map back onto the original', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  const reviews = path.join(folder, 'training-mode');
  const dataset = path.join(folder, 'dataset');
  Object.assign(process.env, { THICKEN_VISION_URL: 'http://vision.test/api', THICKEN_VISION_MODELS: 'a,b', THICKEN_REVIEWS: reviews, THICKEN_DATASET: dataset,
    LABEL_STUDIO_URL: 'http://studio.test', LABEL_STUDIO_API_KEY: 'secret.token.789' });
  // A phone's portrait photo as phones store it: 4032 x 3024 on its side, EXIF turning it upright (3024 x 4032), and
  // metadata that mustn't be kept. Upright, the phone lying on the table is the rectangle 800-2200 by 1000-3000.
  const truth = [[800, 1000], [2200, 1000], [2200, 3000], [800, 3000]];
  const photo = path.join(folder, 'IMG_3024.jpg');
  await sharp({ create: { width: 4032, height: 3024, channels: 3, background: '#8b5a2b' } })
    .composite([{ input: await sharp({ create: { width: 2000, height: 1400, channels: 3, background: '#26323a' } }).png().toBuffer(), left: 1000, top: 3024 - 2200 }])
    .jpeg().withMetadata({ orientation: 6, exif: { IFD0: { Copyright: 'secret-owner' } } }).toFile(photo);
  // Upright and shrunk to 1536 x 2048, then letterboxed into 1000 x 1000: 1000/4032 of the original, 125 px in.
  const inFrame = truth.map(([x, y]) => [Math.round(125 + (x * 1000) / 4032), Math.round((y * 1000) / 4032)]);
  // The models call it the back, and put it 90 px to the right; the person drags it home, names it the front and boxes a hand.
  const vision = catalog({}, { vision: async () => ({ faces: [{ face: 'back', corners: inFrame.map(([x, y]) => [x + 90, y]) }], rounding: 'slight', finish: 'matte' }) });
  const hand = { from_name: 'obstruction', type: 'rectanglelabels', original_width: 1000, original_height: 1000, value: { x: 60, y: 70, width: 10, height: 20, rectanglelabels: ['hand'] } };
  const ls = studio((prediction) => [annotated([polygon(inFrame), ...prediction.result.filter((r) => r.type !== 'polygonlabels')], 'keep', [hand])]);
  const opened = mock.method(browser, 'open', () => {});
  t.after(async () => { ls.restore(); vision.mock.restore(); opened.mock.restore(); await rm(folder, { recursive: true, force: true }); });
  t.after(() => { for (const key of ['THICKEN_VISION_URL', 'THICKEN_VISION_MODELS', 'THICKEN_REVIEWS', 'THICKEN_DATASET', 'LABEL_STUDIO_URL', 'LABEL_STUDIO_API_KEY']) delete process.env[key]; });

  const { sidecar } = await thicken([photo], { profile: 'box', sizeMm: [70, 100, 8] });

  // Label Studio got the frame as sent, the models' face to edit with its confidence, and a tab opened on it.
  const task = ls.asked.find(({ route }) => route === '/api/tasks')!.body;
  assert.match(task.data.image, /^data:image\/jpeg;base64,/);
  assert.equal(task.data.confidence, 'back 1 (agreed: a, b)');
  const prediction = ls.asked.find(({ route }) => route === '/api/predictions')!.body;
  assert.deepEqual([prediction.model_version, prediction.score, prediction.result[0].score, prediction.result[0].value.polygonlabels], ['a,b', 1, 1, ['back']]);
  assert.deepEqual(opened.mock.calls.map(({ arguments: [url] }) => url), ['http://studio.test/projects/7/data?task=70']);
  assert.ok(ls.asked.slice(1).every(({ authorization }) => authorization === 'Bearer short-lived'), 'the personal token is traded for an access token');

  // The row: the person's corners in the frame, which map back onto the original photo, upright, within a frame pixel.
  const [row, ...more] = (await readFile(path.join(reviews, 'review.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(more.length, 0);
  assert.deepEqual([row.verdict, row.faces, row.obstructions, row.frame, row.photoSize, row.original], ['fix', [{ face: 'front', corners: inFrame }], [{ what: 'hand', box: [600, 700, 700, 900] }], 'letterbox-1000', [1536, 2048], [3024, 4032]]);
  const original = row.faces[0].corners.map(([x, y]: number[]) => [(x - row.sent.left) / row.sent.scale / row.shrink, (y - row.sent.top) / row.sent.scale / row.shrink]);
  original.forEach(([x, y]: number[], k: number) => assert.ok(Math.hypot(x - truth[k][0], y - truth[k][1]) < 3, `corner ${k + 1} at ${x}, ${y}, not ${truth[k]}`));
  assert.deepEqual(row.proposal.faces.map(({ face, by, agreed, score }: { face: string; by: string[]; agreed: boolean; score: number }) => [face, by, agreed, score]), [['back', ['a', 'b'], true, 1]]);
  assert.deepEqual(row.proposal.answers.map(({ model }: { model: string }) => model), ['a', 'b']);
  assert.equal(row.group, `training-mode:${path.basename(row.file_name)}`);
  assert.deepEqual([row.source, row.profile, row.labelStudio], [{ file: 'IMG_3024.jpg' }, 'box', { url: 'http://studio.test', project: 7, task: 70, annotation: 1 }]);
  assert.ok(!JSON.stringify(row).includes('secret'), 'no token, no metadata');
  // The frame and the photo, kept as pixels only.
  for (const file of [row.file_name, row.photo]) {
    const bytes = await readFile(path.join(reviews, file));
    const { exif, icc, xmp } = await sharp(bytes).metadata();
    assert.deepEqual([exif, icc, xmp, bytes.includes('secret-owner')], [undefined, undefined, undefined, false], file);
  }
  assert.deepEqual((await sharp(path.join(reviews, row.photo)).metadata()).width, 1536);

  // Built from the person's corners, not the models': in the loaded photo's pixels, 2048/4032 of the original's.
  const [face] = (sidecar.vision as { photos: { faces: { face: string; corners: number[][]; by: string[] }[] }[] }).photos[0].faces;
  assert.deepEqual([face.face, face.by], ['front', ['given']]);
  face.corners.forEach(([x, y], k) => assert.ok(Math.hypot(x - (truth[k][0] * 2048) / 4032, y - (truth[k][1] * 2048) / 4032) < 2, `built corner ${k + 1} at ${x}, ${y}`));
  assert.equal(existsSync(dataset), false, 'nothing goes to THICKEN_DATASET while reviewing');
});

test('reviews: a photo with someone else in it is held, not kept for training; an exam folder is refused', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  const reviews = path.join(folder, 'training-mode');
  Object.assign(process.env, { THICKEN_VISION_URL: 'http://vision.test/api', THICKEN_VISION_MODELS: 'a,b', THICKEN_REVIEWS: reviews,
    LABEL_STUDIO_URL: 'http://studio.test', LABEL_STUDIO_API_KEY: 'legacy-key' });
  const photo = path.join(folder, 'IMG_1.png');
  await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#8b5a2b' } }).png().toFile(photo);
  const vision = catalog({}, { vision: async () => ({ faces: [{ face: 'front', corners: [[300, 200], [700, 200], [700, 800], [300, 800]] }] }) });
  const people = { from_name: 'people', type: 'choices', value: { choices: ['someone else in frame'] } };
  const ls = studio(() => [annotated([], 'reject', [people])]);
  const opened = mock.method(browser, 'open', () => {});
  t.after(async () => { ls.restore(); vision.mock.restore(); opened.mock.restore(); await rm(folder, { recursive: true, force: true }); });
  t.after(() => { for (const key of ['THICKEN_VISION_URL', 'THICKEN_VISION_MODELS', 'THICKEN_REVIEWS', 'LABEL_STUDIO_URL', 'LABEL_STUDIO_API_KEY']) delete process.env[key]; });

  await thicken([photo], { profile: 'box', sizeMm: [70, 100, 8] });
  assert.equal(existsSync(path.join(reviews, 'review.jsonl')), false);
  const held = JSON.parse(await readFile(path.join(reviews, 'held', 'review.jsonl'), 'utf8'));
  assert.deepEqual([held.verdict, held.faces, held.held], ['reject', [], 'someone else in frame']);
  assert.ok(existsSync(path.join(reviews, 'held', held.photo)));
  assert.ok(ls.asked.every(({ authorization }) => authorization === 'Token legacy-key'), 'a legacy token goes as it is');

  process.env.THICKEN_REVIEWS = path.join(folder, 'library', 'Exam');
  await assert.rejects(thicken([photo], { profile: 'box', sizeMm: [70, 100, 8] }), /never go in an exam's folder/);
});
