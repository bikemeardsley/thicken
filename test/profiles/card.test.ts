import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { type Iridescence } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { cut } from '../../src/faces.ts';
import { thicken } from '../../src/thicken.ts';
import { letterboxed, catalog, read, pick, assertExtents, assertClosed } from '../helpers.ts';

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
  const fetch = catalog({}, {
    vision: async ({ model, prompt, photo }) => {
      if (prompt.includes('Which of these is it?')) return { object: 'card', sizeMm: [63, 88, 0.3] };
      const { data, info } = await sharp(photo).raw().toBuffer({ resolveWithObject: true });
      const middle = (500 * info.width + 500) * info.channels; // green in the middle: the front
      return { faces: [{ face: data[middle + 1] > data[middle + 2] ? 'front' : 'back', corners: seen }], corners: corners(model) };
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
  // A thick patch card, sold as 130 pt: 3.3 mm.
  const thick = await thicken(files, { profile: 'card', pt: 130 });
  assert.deepEqual([thick.sidecar.depthMm, thick.sidecar.pt, (thick.sidecar.measuredBy as { depth: string }).depth], [3.3, 130, 'pt']);
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
  const fetch = catalog({}, {
    vision: async ({ model, photo }) => {
      const { data, info } = await sharp(photo).raw().toBuffer({ resolveWithObject: true });
      const [middle, corner] = [(500 * info.width + 500) * info.channels, (40 * info.width + 165) * info.channels];
      // On the back, the models see no foil: that says nothing of the front, so it isn't counted.
      if (data[middle + 1] <= data[middle + 2]) return { faces: [{ face: 'back', corners: seen(quad) }], corners: 'round', foil: 'none' };
      if (data[corner + 2] > 200) return { faces: [{ face: 'front', corners: seen(quad) }], corners: 'round', foil: 'none' };
      return { faces: [{ face: 'front', corners: seen(quad) }, { face: 'art', corners: seen(box) }], corners: 'round', foil: flash(model), ...(pattern && { pattern }) };
    },
  });
  t.after(() => fetch.mock.restore());
  // Two answers naming the foil outweigh four from frames that missed it.
  const { glb, sidecar } = await thicken(files, { profile: 'card' });
  assert.deepEqual([sidecar.foil, sidecar.foilBy, sidecar.pictureBoxBy, sidecar.warnings], ['reverse', 'vision', 'vision', []]);
  assert.deepEqual([sidecar.foilLook, sidecar.foilLookBy, sidecar.review], ['shards', 'vision', []], 'the pattern the models saw: cracked ice');
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

  // One model alone seeing foil isn't enough: a plain card stays plain.
  flash = (model) => (model === 'a' ? 'holo' : 'none');
  const plain = await thicken(files, { profile: 'card' });
  assert.deepEqual([plain.sidecar.foil, plain.sidecar.foilBy], ['none', 'vision']);
  assert.equal((await read(plain.glb)).getRoot().listMaterials().find((m) => m.getName() === 'card-front')!.getExtension('KHR_materials_iridescence'), null);
});
