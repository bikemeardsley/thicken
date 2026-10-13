import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { type Iridescence } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { cut } from '../../src/faces.ts';
import { codes } from '../../src/image.ts';
import { thicken } from '../../src/thicken.ts';
import { fixture, letterboxed, slabPhoto, catalog, near, read, pick, assertExtents, assertWatertight } from '../helpers.ts';

// slab.jpg: 296 × 500, a PSA holder's shape, with a QR code to a psacard.com cert on its label.
test('slab: a grader\'s QR code picks the holder, and the holder its size', async () => {
  const { glb, sidecar } = await thicken([fixture('slab.jpg')]);
  assert.deepEqual(pick(sidecar, ['profile', 'sources', 'holder', 'grader', 'cert', 'verifyUrl', 'widthMm', 'heightMm', 'depthMm', 'measuredBy', 'faces', 'review', 'warnings', 'identifiedBy']), {
    profile: 'slab', sources: ['slab.jpg'], holder: 'psa', grader: 'psa', cert: '12345678', verifyUrl: 'https://www.psacard.com/cert/12345678',
    widthMm: 80.5, heightMm: 136, depthMm: 6.5, measuredBy: 'table', faces: { front: 'photo', back: 'color' }, review: ['back (plain color)'],
    warnings: ['the card and label are placed where a psa holder usually has them: with a vision roster they\'re found in the photos'],
    identifiedBy: { profile: 'recognized', grader: 'qr', cert: 'qr' },
  });
  const doc = await read(glb);
  assertExtents(doc, [0.0805, 0.136, 0.0065]);
  // Closed solids, built as a holder is: a rim standing proud of a recessed window, ridges framing the label and
  // the card inside, and the card and label themselves.
  const { card, label } = sidecar.inside as Record<string, { widthMm: number; heightMm: number; placedBy: string }>;
  assert.deepEqual([card.widthMm, card.heightMm, card.placedBy, label.placedBy], [63.5, 88.9, 'layout', 'layout']);
  assertWatertight(doc);
  // The holder is clear: blended, so a page shows through it; its rim and ridges denser, as their edges catch the light.
  const materials = Object.fromEntries(doc.getRoot().listMaterials().map((material) => [material.getName(), material]));
  assert.deepEqual([materials.acrylic.getAlphaMode(), materials.acrylic.getAlpha(), materials['acrylic-edges'].getAlpha()], ['BLEND', 0.12, 0.2]);
  // The window is recessed: the rim alone reaches the holder's full depth.
  const zs = (name: string) => doc.getRoot().listMeshes()[0].listPrimitives().filter((p) => p.getMaterial()?.getName() === name)
    .flatMap((p) => { const positions = p.getAttribute('POSITION')!; return [...Array(positions.getCount()).keys()].map((i) => positions.getElement(i, [0, 0, 0])[2]); });
  assert.deepEqual([Math.max(...zs('acrylic-edges')), Math.max(...zs('acrylic'))].map((z) => Math.round(z * 1e5) / 100), [3.25, 2.75]);
  // The card is cut from the photo (green there), and its back, never photographed, is plain card stock.
  const front = await sharp(materials['card-front'].getBaseColorTexture()!.getImage()!).raw().toBuffer({ resolveWithObject: true });
  const middle = (Math.floor(front.info.height / 2) * front.info.width + Math.floor(front.info.width / 2)) * front.info.channels;
  assert.ok(front.data[middle + 1] > 2 * front.data[middle], 'the card plate shows the green card');
  assert.equal(materials['card-back'].getBaseColorTexture(), null);
});

test('slab: with vision, the card and label are found in uncropped photos and set inside the clear holder', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  Object.assign(process.env, { THICKEN_VISION_URL: 'http://vision.test/api', THICKEN_VISION_MODELS: 'a,b,c' });
  t.after(() => { for (const key of ['THICKEN_VISION_URL', 'THICKEN_VISION_MODELS']) delete process.env[key]; });
  // A PSA slab (80.5 × 136 mm): its label across the top, and a green card a little lower than the usual layout has it
  // (its top 33 mm down, where the layout says 32.3), measuring a little big, 64.3 × 89.6 mm: near enough standard to be
  // taken for it. Its back the same, the card's back blue.
  const [slab, label, card] = [[0, 0, 80.5, 136], [4, 4.5, 76.5, 26.3], [8.1, 33, 72.4, 122.6]];
  const hologram = [6, 8, 26, 22]; // on the back of the label, at its left as the back is seen
  const [front, back] = [path.join(folder, 'IMG_1.png'), path.join(folder, 'IMG_2.png')];
  await slabPhoto(front, [[slab, '#c8ccd0'], [label, '#f8f8f8'], [card, '#2e7d32']]);
  await slabPhoto(back, [[slab, '#c8ccd0'], [label, '#f8f8f8'], [hologram, '#d0d0d8'], [card, '#1d4f9e']]);
  const fetch = catalog({}, {
    vision: async ({ model, photo }) => {
      const { data, info } = await sharp(photo).raw().toBuffer({ resolveWithObject: true });
      const middle = (500 * info.width + 500) * info.channels; // the card's middle: green on the front
      // As with real slabs, b calls the back the front: same place, another name, so c is asked, and agrees with a.
      const green = data[middle + 1] > data[middle + 2];
      const side = green || model === 'b' ? 'front' : 'back';
      // The card shines all over (a refractor); the label's back has a hologram. b, calling the back the front, says
      // the card shines there too: that photo isn't of the front, as settled, so it isn't counted.
      const faces = [{ face: side, corners: letterboxed(slab) }, { face: 'card', corners: letterboxed(card) }, { face: 'label', corners: letterboxed(label) }];
      return { faces: green ? faces : [...faces, { face: 'hologram', corners: letterboxed(hologram) }], foil: side === 'front' ? 'full' : 'none' };
    },
  });
  t.after(() => fetch.mock.restore());

  const { glb, sidecar } = await thicken([front, back], { profile: 'slab' });
  assert.deepEqual((sidecar.pictures as { file: string; role: string }[]).map(({ file, role }) => [file, role]), [['IMG_1.png', 'front'], ['IMG_2.png', 'back']]);
  const photos = (sidecar.vision as { photos: { faces: { face: string; by: string[]; agreed: boolean }[] }[] }).photos;
  assert.deepEqual(photos[1].faces.find(({ face }) => face === 'back'), { ...photos[1].faces.find(({ face }) => face === 'back'), by: ['a', 'c'], agreed: true });
  assert.ok(sidecar.review.every((item) => !item.includes('disagree')), 'the name was settled');
  // Found, not laid out: the card where it really is, at the standard size, and the label above it.
  const inside = sidecar.inside as Record<string, { widthMm: number; heightMm: number; atMm: number[]; placedBy: string }>;
  assert.deepEqual([inside.card.placedBy, inside.card.widthMm, inside.card.heightMm, inside.label.placedBy], ['vision', 63.5, 88.9, 'vision']);
  assert.ok(Math.abs(inside.card.atMm[0]) <= 0.2 && Math.abs(inside.card.atMm[1] - (68 - 77.8)) <= 0.2, `card at ${inside.card.atMm}`);
  assert.ok(Math.abs(inside.label.widthMm - 72.5) <= 0.3 && Math.abs(inside.label.heightMm - 21.8) <= 0.3, `label ${inside.label.widthMm} × ${inside.label.heightMm}`);
  assert.ok(sidecar.review.every((item) => !item.includes('didn\'t find')), 'nothing laid out by guess');
  // Each picture is its part alone: no table, no clear border.
  const doc = await read(glb);
  const materials = Object.fromEntries(doc.getRoot().listMaterials().map((material) => [material.getName(), material]));
  const share = async (name: string, wanted: (r: number, g: number, b: number) => boolean) => {
    const { data, info } = await sharp(materials[name].getBaseColorTexture()!.getImage()!).raw().toBuffer({ resolveWithObject: true });
    let hits = 0;
    for (let i = 0; i < data.length; i += info.channels) if (wanted(data[i], data[i + 1], data[i + 2])) hits++;
    return hits / (data.length / info.channels);
  };
  assert.ok(await share('card-front', (r, g, b) => g > 100 && r < 80 && b < 80) > 0.95, 'the card alone');
  assert.ok(await share('card-back', (r, g, b) => b > 120 && r < 80 && g < 110) > 0.95, 'the card\'s back alone');
  assert.ok(await share('label-front', (r, g, b) => Math.min(r, g, b) > 230) > 0.95, 'the label alone');
  // The card's foil on its front only; the hologram on the label's back, where it was found within it.
  assert.deepEqual([(inside.card as unknown as { foil: string }).foil, (inside.card as unknown as { foilBy: string }).foilBy], ['full', 'vision']);
  const film = (name: string) => materials[name].getExtension<Iridescence>('KHR_materials_iridescence');
  assert.deepEqual(['card-front', 'card-back', 'label-front', 'label-back'].map((name) => Boolean(film(name))), [true, false, false, true]);
  const held = (inside.label as unknown as { hologram: Record<string, Record<string, number>> }).hologram.back;
  for (const [key, want] of Object.entries({ x0: 2 / 72.5, x1: 22 / 72.5, y0: 3.5 / 21.8, y1: 17.5 / 21.8 })) assert.ok(Math.abs(held[key] - want) < 0.03, `hologram ${key} ${held[key]}`);
  const { data, info } = await sharp(film('label-back')!.getIridescenceTexture()!.getImage()!).raw().toBuffer({ resolveWithObject: true });
  const pixel = (u: number, v: number) => [...data.subarray((Math.round(v * info.height) * info.width + Math.round(u * info.width)) * info.channels).subarray(0, 3)];
  assert.deepEqual([pixel(0.15, 0.5), pixel(0.7, 0.5)], [[255, 77, 153], [0, 102, 0]], 'foil on the hologram, print beside it');
  assertWatertight(doc);
});

test('slab: a tall holder is told by its label, the same size on every holder but spanning much less of a tall one', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  Object.assign(process.env, { THICKEN_VISION_URL: 'http://vision.test/api', THICKEN_VISION_MODELS: 'a,b' });
  t.after(() => { for (const key of ['THICKEN_VISION_URL', 'THICKEN_VISION_MODELS']) delete process.env[key]; });
  const [slab, label, card] = [[0, 0, 80.5, 136], [15.25, 4.5, 65.25, 20], [12, 30, 68.5, 125]]; // the label spans 62%
  const photo = path.join(folder, 'IMG_1.png');
  await slabPhoto(photo, [[slab, '#c8ccd0'], [label, '#f8f8f8'], [card, '#2e7d32']]);
  const fetch = catalog({}, {
    vision: async () => ({ faces: [{ face: 'front', corners: letterboxed(slab) }, { face: 'card', corners: letterboxed(card) }, { face: 'label', corners: letterboxed(label) }] }),
  });
  t.after(() => fetch.mock.restore());
  const { sidecar } = await thicken([photo], { profile: 'slab' });
  assert.deepEqual([sidecar.holder, sidecar.widthMm, sidecar.heightMm], ['psa-tall', 108, 184]);
  assert.ok(sidecar.warnings.some((w) => w.startsWith('taken for a tall holder (psa-tall): its label spans 62% of its width')), String(sidecar.warnings));
  // A holder named is the holder made.
  assert.equal((await thicken([photo], { profile: 'slab', holder: 'psa' })).sidecar.holder, 'psa');
});

test('slab: the models read its label, the grade and the card, and with no QR code the grader they read picks the holder', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  Object.assign(process.env, { THICKEN_VISION_URL: 'http://vision.test/api', THICKEN_VISION_MODELS: 'a,b' });
  t.after(() => { for (const key of ['THICKEN_VISION_URL', 'THICKEN_VISION_MODELS']) delete process.env[key]; });
  const [slab, label, card] = [[0, 0, 80.5, 136], [15.25, 4.5, 65.25, 20], [12, 30, 68.5, 125]]; // a tall label: 62%
  const photo = path.join(folder, 'IMG_1.png');
  await slabPhoto(photo, [[slab, '#c8ccd0'], [label, '#f8f8f8'], [card, '#2e7d32']]);
  const prompts: string[] = [];
  const fetch = catalog({}, {
    vision: async ({ model, prompt }) => {
      prompts.push(prompt);
      const faces = [{ face: 'front', corners: letterboxed(slab) }, { face: 'card', corners: letterboxed(card) }, { face: 'label', corners: letterboxed(label) }];
      return model === 'a'
        ? { faces, grader: 'CGC', grade: '10', gradeName: 'GEM MINT', name: 'Charizard', set: 'Base Set', year: '1999' }
        : { faces, grader: 'CGC', grade: 10, gradeName: 'Gem  Mint', name: 'Charizard', year: 2000 };
    },
  });
  t.after(() => fetch.mock.restore());
  const { sidecar } = await thicken([photo], { profile: 'slab' });
  assert.ok(prompts[0].includes('"grade":""'), 'the models are asked for the grade');
  assert.deepEqual(sidecar.read, { grader: 'CGC', grade: '10', gradeName: 'GEM MINT', name: 'Charizard', set: 'Base Set', year: '1999' });
  assert.deepEqual(sidecar.readBy, { grader: 'agreed', grade: 'agreed', gradeName: 'agreed', name: 'agreed', set: 'once', year: 'disputed' });
  assert.deepEqual([sidecar.holder, sidecar.grader, (sidecar.identifiedBy as { grader: string }).grader], ['cgc-tall', 'cgc', 'vision']);
});

test('slab: the cert is the first whole cert number in the QR link, not a tracking number after it', async (t) => {
  const { prepareZXingModule, writeBarcode } = await import('zxing-wasm/full');
  prepareZXingModule({ overrides: { wasmBinary: readFileSync(createRequire(import.meta.url).resolve('zxing-wasm/full/zxing_full.wasm')) } });
  // In capitals, as real labels' QR codes hold their links.
  const written = await writeBarcode('HTTPS://WWW.PSACARD.COM/CERT/12345678?REF=98765432', { format: 'QRCode', scale: 2 });
  const qr = Buffer.from(await written.image!.arrayBuffer());
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const front = path.join(folder, 'front.png');
  await sharp({ create: { width: 296, height: 500, channels: 3, background: '#ffffff' } }).composite([{ input: qr, left: 20, top: 20 }]).png().toFile(front);
  const { sidecar } = await thicken([front]);
  assert.deepEqual([sidecar.grader, sidecar.cert, sidecar.verifyUrl], ['psa', '12345678', 'https://www.psacard.com/CERT/12345678?REF=98765432']);
});

test('slab: a label\'s codes say what it is, not which side a photo shows: without vision, two photos stop the run', async (t) => {
  // Which side a grader prints its QR code on changes with label designs (current PSA and CGC labels: the back), and
  // photo order is no evidence either: the vision models tell the sides apart.
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const plain = path.join(folder, 'IMG_1.png');
  await sharp({ create: { width: 296, height: 500, channels: 3, background: '#c8ccd0' } }).png().toFile(plain);
  await assert.rejects(thicken([fixture('slab.jpg'), plain]), /a vision roster tells the sides apart/);
  await assert.rejects(thicken([plain, fixture('slab.jpg')]), /a vision roster tells the sides apart/);
});

// slab-barcode.jpg: the same holder shape, but an older label with only a Code 128 cert barcode (BGS-style 0017041720).
test('slab: a cert barcode on a holder-shaped photo is a slab, of a grader it says it can\'t name', async (t) => {
  const { sidecar } = await thicken([fixture('slab-barcode.jpg')]);
  assert.deepEqual([sidecar.profile, sidecar.holder, sidecar.cert, sidecar.grader], ['slab', 'psa', '0017041720', undefined]);
  assert.ok(sidecar.warnings.some((warning) => warning.startsWith('a PSA-size holder is assumed')));
  assert.deepEqual(sidecar.identifiedBy, { profile: 'recognized', grader: 'assumed', cert: 'barcode' });

  // The same barcode on a square picture is no evidence of a slab.
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const square = path.join(folder, 'square.jpg');
  await sharp(fixture('slab-barcode.jpg')).extend({ right: 204, background: '#d0d4d8' }).toFile(square);
  await assert.rejects(thicken([square]), /can't tell what this is/);
});
