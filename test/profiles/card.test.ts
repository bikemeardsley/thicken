import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { type Iridescence } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { cut } from '../../src/faces.ts';
import { thicken } from '../../src/thicken.ts';
import { letterboxed, catalog, colorOf, near, read, pick, assertExtents, assertClosed } from '../helpers.ts';

test('card: a raw trading card in uncropped photos, a thin plate with rounded corners; a thick one by its points', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  Object.assign(process.env, { THICKEN_VISION_URL: 'http://vision.test/api', THICKEN_VISION_MODELS: 'a,b,c' });
  t.after(() => { for (const key of ['THICKEN_VISION_URL', 'THICKEN_VISION_MODELS']) delete process.env[key]; });
  // The card's front (green) and back (blue), each lying on a brown table, 900 × 1200 px at 6 px a mm.
  const quad = [[300, 330], [681, 330], [681, 863.4], [300, 863.4]];
  const files = [path.join(folder, 'IMG_1.png'), path.join(folder, 'IMG_2.png')];
  for (const [file, fill] of [[files[0], '#2e7d32'], [files[1], '#1d4f9e']]) {
    const svg = `<svg width="900" height="1200"><polygon points="${quad.map((p) => p.join(',')).join(' ')}" fill="${fill}"/></svg>`;
    await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#8b5a2b' } }).composite([{ input: Buffer.from(svg) }]).png().toFile(file);
  }
  const seen = quad.map(([x, y]) => [125 + (x * 5) / 6, (y * 5) / 6]); // letterboxed into 1000 × 1000
  let corners = (model: string) => 'round'; // what each model says of the card's corners
  let said: object = {}; // and of anything else
  const fetch = catalog({}, {
    vision: async ({ model, prompt, photo }) => {
      if (prompt.includes('Which of these is it?')) return { object: 'card', sizeMm: [63, 88, 0.3] };
      const { data, info } = await sharp(photo).raw().toBuffer({ resolveWithObject: true });
      const middle = (500 * info.width + 500) * info.channels; // green in the middle: the front
      return { faces: [{ face: data[middle + 1] > data[middle + 2] ? 'front' : 'back', corners: seen }], corners: corners(model), ...said };
    },
  });
  t.after(() => fetch.mock.restore());

  // A trading-card-game card: clearly rounded corners, 3.2 mm.
  const { glb, sidecar } = await thicken(files);
  assert.deepEqual(pick(sidecar, ['profile', 'widthMm', 'heightMm', 'depthMm', 'corners', 'cornersBy', 'faces', 'review', 'identifiedBy']), {
    profile: 'card', widthMm: 63.5, heightMm: 88.9, depthMm: 0.35, corners: 'round', cornersBy: 'vision',
    faces: { front: 'photo', back: 'photo' }, review: [], identifiedBy: { profile: 'vision' },
  });
  const doc = await read(glb);
  assertExtents(doc, [0.0635, 0.0889, 0.00035]);
  assertClosed(doc, (63.5 * 88.9 - (4 - Math.PI) * 3.2 ** 2) * 0.35, 5e-4);
  // A vintage card, cut square, though b says round: c is asked, the majority says square, and they stay square.
  corners = (model) => (model === 'b' ? 'round' : 'square');
  const vintage = await thicken(files, { profile: 'card' });
  assert.deepEqual([vintage.sidecar.corners, vintage.sidecar.cornersBy], ['square', 'vision']);
  assert.deepEqual((vintage.sidecar.vision as { photos: { answers: { model: string }[] }[] }).photos[0].answers.map(({ model }) => model), ['a', 'b', 'c']);
  assertClosed(await read(vintage.glb), 63.5 * 88.9 * 0.35, 1e-4);
  // A Yu-Gi-Oh! card on thick stock, glossy, as the models see it: 59 × 86 mm, 55 pt (the thinnest thick), shiny.
  said = { format: 'small', stock: 'thick', finish: 'glossy' };
  const small = await thicken(files, { profile: 'card' });
  said = {};
  assert.deepEqual(pick(small.sidecar, ['widthMm', 'heightMm', 'depthMm', 'format', 'formatBy', 'stock', 'finish', 'finishBy']),
    { widthMm: 59, heightMm: 86, depthMm: 1.4, format: 'small', formatBy: 'vision', stock: 'thick', finish: 'glossy', finishBy: 'vision' });
  assert.ok(small.sidecar.warnings.some((w) => w.startsWith('a thick card (the models say)')), small.sidecar.warnings.join('; '));
  // A thick patch card, sold as 130 pt: 3.3 mm.
  const thick = await thicken(files, { profile: 'card', pt: 130 });
  assert.deepEqual([thick.sidecar.depthMm, thick.sidecar.pt, (thick.sidecar.measuredBy as { depth: string }).depth], [3.3, 130, 'pt']);
});

test('card: a person settles what the models can\'t: photos named for their faces, corners given, or photos cropped', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  // The same card on its table; and its front again, cropped to its edges.
  const quad = [[300, 330], [681, 330], [681, 863.4], [300, 863.4]];
  const [front, back, cropped] = [path.join(folder, 'front.png'), path.join(folder, 'back.png'), path.join(folder, 'IMG_3.png')];
  for (const [file, fill] of [[front, '#2e7d32'], [back, '#1d4f9e']]) {
    const svg = `<svg width="900" height="1200"><polygon points="${quad.map((p) => p.join(',')).join(' ')}" fill="${fill}"/></svg>`;
    await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#8b5a2b' } }).composite([{ input: Buffer.from(svg) }]).png().toFile(file);
  }
  await sharp({ create: { width: 381, height: 533, channels: 3, background: '#2e7d32' } }).png().toFile(cropped);
  const frontColor = async (glb: Uint8Array) => colorOf(await read(glb), [0, 0, 1]);

  // No vision: two photos would stop the run, but their names say which is which. Used whole, the table and all.
  const named = await thicken([back, front], { profile: 'card' });
  assert.deepEqual((named.sidecar.pictures as { file: string; role: string }[]).map(({ file, role }) => [file, role]), [['back.png', 'back'], ['front.png', 'front']]);
  assert.ok(!near(await frontColor(named.glb), '#2e7d32'), 'the front, uncropped, is mostly table');
  // Its corners given, in the photo's own pixels: cut to the card, still with no vision, and nothing to review.
  const given = await thicken([front, back], { profile: 'card', corners: { 'front.png': { front: quad } } });
  assert.ok(near(await frontColor(given.glb), '#2e7d32'), 'the front is the card alone');
  assert.equal(given.sidecar.vision, undefined);
  assert.ok(given.sidecar.review.every((item) => !item.includes('no vision model answered')), given.sidecar.review.join('; '));

  // With vision, the models name the cropped photo's face but put it well inside: --cropped makes it the whole photo.
  Object.assign(process.env, { THICKEN_VISION_URL: 'http://vision.test/api', THICKEN_VISION_MODELS: 'a,b' });
  t.after(() => { for (const key of ['THICKEN_VISION_URL', 'THICKEN_VISION_MODELS']) delete process.env[key]; });
  const fetch = catalog({}, { vision: async () => ({ faces: [{ face: 'front', corners: [[400, 400], [600, 400], [600, 600], [400, 600]] }] }) });
  t.after(() => fetch.mock.restore());
  const whole = await thicken([cropped], { profile: 'card', cropped: true });
  const [photo] = (whole.sidecar.vision as { photos: { faces: { face: string; corners: number[][]; agreed: boolean }[] }[] }).photos;
  assert.deepEqual(photo.faces.map(({ face, corners, agreed }) => [face, corners, agreed]), [['front', [[0, 0], [381, 0], [381, 533], [0, 533]], true]]);
});

test('card: with a model bench on this machine, its vision collection answers every photo, and each seat is judged', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  process.env.THICKEN_BENCH_URL = 'http://bench.test';
  t.after(() => { process.env.THICKEN_BENCH_URL = ''; });
  const quad = [[300, 330], [681, 330], [681, 863.4], [300, 863.4]];
  const files = [path.join(folder, 'IMG_1.png'), path.join(folder, 'IMG_2.png')];
  for (const [file, fill] of [[files[0], '#2e7d32'], [files[1], '#1d4f9e']]) {
    const svg = `<svg width="900" height="1200"><polygon points="${quad.map((p) => p.join(',')).join(' ')}" fill="${fill}"/></svg>`;
    await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#8b5a2b' } }).composite([{ input: Buffer.from(svg) }]).png().toFile(file);
  }
  const seen = quad.map(([x, y]) => [125 + (x * 5) / 6, (y * 5) / 6]);
  // Seats a and b answer; c, an explorer, fails. No roster is set: the bench is all there is.
  const fetch = catalog({}, {
    bench: ['a', 'b', 'c'],
    vision: async ({ model, photo }) => {
      if (model === 'c') return undefined;
      const { data, info } = await sharp(photo).raw().toBuffer({ resolveWithObject: true });
      const middle = (500 * info.width + 500) * info.channels;
      return { faces: [{ face: data[middle + 1] > data[middle + 2] ? 'front' : 'back', corners: seen }], corners: 'square' };
    },
  });
  t.after(() => fetch.mock.restore());
  const { sidecar } = await thicken(files, { profile: 'card' });
  const vision = sidecar.vision as { models: string[]; photos: { answers: { model: string; error?: string }[] }[] };
  assert.deepEqual([vision.models, sidecar.corners, sidecar.cornersBy, sidecar.faces], [['bench/vision'], 'square', 'vision', { front: 'photo', back: 'photo' }]);
  assert.deepEqual(vision.photos[0].answers.map(({ model, error }) => [model, Boolean(error)]), [['a', false], ['b', false], ['c', true]]);
  // Each photo's seats judged: a and b agreed on its face; c failed.
  await new Promise((resolve) => setImmediate(resolve));
  const verdicts = fetch.mock.calls.filter((call) => String(call.arguments[0]).endsWith('/bench/verdict')).map((call) => JSON.parse(String(call.arguments[1]!.body)));
  assert.deepEqual(verdicts.map(({ call, useful }) => `${call} ${useful}`).sort(), ['p1.a true', 'p1.a true', 'p1.b true', 'p1.b true', 'p1.c false', 'p1.c false']);
});

test('card: a bench that stops answering mid-run, with no roster to stand in, leaves the photos unread rather than crashing', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  process.env.THICKEN_BENCH_URL = 'http://bench.test';
  t.after(() => { process.env.THICKEN_BENCH_URL = ''; });
  const files = [path.join(folder, 'IMG_1.png'), path.join(folder, 'IMG_2.png')];
  for (const file of files) await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#8b5a2b' } }).png().toFile(file);
  // The gateway is found, then its first answer never comes: the connection drops, as a reply past 300 s did.
  const fetch = catalog({}, { bench: ['a'], vision: async () => { throw new TypeError('fetch failed'); } });
  t.after(() => fetch.mock.restore());
  await assert.rejects(thicken(files, { profile: 'card' }), (error: Error) => !/split/.test(error.message) && /front/.test(error.message));
});

test('card: holofoil as the models see it, a reverse holo shining everywhere but its picture box, as film-coated metal', async (t) => {
  Object.assign(process.env, { THICKEN_VISION_URL: 'http://vision.test/api', THICKEN_VISION_MODELS: 'a,b' });
  t.after(() => { for (const key of ['THICKEN_VISION_URL', 'THICKEN_VISION_MODELS']) delete process.env[key]; });
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  // The card test's card on its table; its picture box 10–90% across and 12–50% down its front.
  const quad = [[300, 330], [681, 330], [681, 863.4], [300, 863.4]];
  const at = (u: number, v: number) => [300 + u * 381, 330 + v * 533.4];
  const box = [at(0.1, 0.12), at(0.9, 0.12), at(0.9, 0.5), at(0.1, 0.5)];
  // The front where the foil caught the light; the back; then the front twice more where it didn't (a white mark on
  // the table tells those apart), as a video's frames are.
  const files = ['IMG_1.png', 'IMG_2.png', 'IMG_3.png', 'IMG_4.png'].map((name) => path.join(folder, name));
  for (const [file, fill, mark] of [[files[0], '#2e7d32', ''], [files[1], '#1d4f9e', ''], [files[2], '#2e7d32', '#fff'], [files[3], '#2e7d32', '#fff']]) {
    const svg = `<svg width="900" height="1200"><rect width="120" height="120" fill="${mark || '#8b5a2b'}"/><polygon points="${quad.map((p) => p.join(',')).join(' ')}" fill="${fill}"/></svg>`;
    await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#8b5a2b' } }).composite([{ input: Buffer.from(svg) }]).png().toFile(file);
  }
  const seen = (corners: number[][]) => corners.map(([x, y]) => [125 + (x * 5) / 6, (y * 5) / 6]);
  let flash = (model: string) => 'reverse'; // what each model says of the front where the foil caught the light
  let pattern: string | undefined = 'shards'; // and the foil's pattern there
  let border = 'foil'; // and its border
  const fetch = catalog({}, {
    vision: async ({ model, photo }) => {
      const { data, info } = await sharp(photo).raw().toBuffer({ resolveWithObject: true });
      const [middle, corner] = [(500 * info.width + 500) * info.channels, (40 * info.width + 165) * info.channels];
      // On the back, the models see no foil: that says nothing of the front, so it isn't counted.
      if (data[middle + 1] <= data[middle + 2]) return { faces: [{ face: 'back', corners: seen(quad) }], corners: 'round', foil: 'none' };
      if (data[corner + 2] > 200) return { faces: [{ face: 'front', corners: seen(quad) }], corners: 'round', foil: 'none' };
      return { faces: [{ face: 'front', corners: seen(quad) }, { face: 'art', corners: seen(box) }], corners: 'round', foil: flash(model), ...(pattern && { pattern }), border, texture: 'textured' };
    },
  });
  t.after(() => fetch.mock.restore());
  // Two answers naming the foil outweigh four from frames that missed it.
  const { glb, sidecar } = await thicken(files, { profile: 'card' });
  assert.deepEqual([sidecar.foil, sidecar.foilBy, sidecar.pictureBoxBy, sidecar.warnings], ['reverse', 'vision', 'vision', []]);
  assert.deepEqual([sidecar.foilLook, sidecar.foilLookBy, sidecar.review], ['shards', 'vision', []], 'the pattern the models saw: cracked ice');
  assert.deepEqual([sidecar.border, sidecar.frameBy, sidecar.texture], ['foil', 'layout', 'textured'], 'a foil border inside a standard frame; embossed');
  const found = sidecar.pictureBox as Record<string, number>;
  for (const [key, want] of Object.entries({ x0: 0.1, x1: 0.9, y0: 0.12, y1: 0.5 })) assert.ok(Math.abs(found[key] - want) < 0.01, `picture box ${key} ${found[key]}`);

  // The front is film-coated metal everywhere but the picture box; the back, print.
  const doc = await read(glb);
  const material = (name: string) => doc.getRoot().listMaterials().find((m) => m.getName() === name)!;
  const film = material('card-front').getExtension<Iridescence>('KHR_materials_iridescence');
  assert.ok(film, 'the front has a thin film');
  assert.equal(material('card-back').getExtension('KHR_materials_iridescence'), null);
  const { data, info } = await sharp(film.getIridescenceTexture()!.getImage()!).raw().toBuffer({ resolveWithObject: true });
  const pixel = (u: number, v: number) => [...data.subarray((Math.round(v * info.height) * info.width + Math.round(u * info.width)) * info.channels).subarray(0, 3)];
  assert.deepEqual(pixel(0.5, 0.3), [0, 102, 0], 'the picture box: print');
  assert.deepEqual(pixel(0.5, 0.75), [255, 77, 153], 'the rest: film, glossier, partly metal');
  // The foil in pieces (cracked ice): each its own film thickness, and tilted where there's film, flat on the print.
  const thick = await sharp(film.getIridescenceThicknessTexture()!.getImage()!).raw().toBuffer();
  assert.ok(new Set(thick).size > 50, 'many pieces, each its own thickness');
  const facets = await sharp(material('card-front').getNormalTexture()!.getImage()!).raw().toBuffer({ resolveWithObject: true });
  const tilt = (u: number, v: number) => { const at = (Math.round(v * facets.info.height) * facets.info.width + Math.round(u * facets.info.width)) * 3; return [...facets.data.subarray(at, at + 3)]; };
  assert.deepEqual(tilt(0.5, 0.3), [128, 128, 255], 'the print lies flat');
  const pieces = [0.6, 0.7, 0.8, 0.9].map((v) => tilt(0.5, v));
  assert.ok(pieces.every(([x, y, z]) => z > 230 && Math.hypot(x - 128, y - 128) < 34) && new Set(pieces.map(String)).size > 1, `the foil's pieces lean their own ways ${pieces}`);

  // The foil, its pattern unseen: drawn plain, and a video asked for.
  pattern = undefined;
  const unseen = (await thicken(files, { profile: 'card' })).sidecar;
  assert.deepEqual([unseen.foil, unseen.foilLook, unseen.foilLookBy], ['reverse', 'plain', 'assumed']);
  assert.ok((unseen.review as string[]).some((note) => note.includes('video')), 'a video asked for');

  // One model alone seeing foil isn't enough: a plain card stays plain (its border plain too).
  border = 'plain';
  flash = (model) => (model === 'a' ? 'holo' : 'none');
  const plain = await thicken(files, { profile: 'card' });
  assert.deepEqual([plain.sidecar.foil, plain.sidecar.foilBy], ['none', 'vision']);
  assert.ok((await read(plain.glb)).getRoot().listMaterials().find((m) => m.getName() === 'card-front')!.getNormalTexture(), 'still textured: embossed, without film');
  assert.equal((await read(plain.glb)).getRoot().listMaterials().find((m) => m.getName() === 'card-front')!.getExtension('KHR_materials_iridescence'), null);
});
