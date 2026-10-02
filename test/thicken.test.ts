import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mock, test } from 'node:test';
import { getBounds, NodeIO, type Document, type Primitive, type vec2, type vec3 } from '@gltf-transform/core';
import { KHRMaterialsUnlit } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { batchItems, thicken } from '../src/thicken.ts';

const fixture = (name: string) => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));

// badge.png: 40 × 30, transparent, with two #3366cc regions: an L (x 2–19,
// y 2–25 plus x 20–29, y 18–25) and a square (x 32–37, y 2–7). Through
// boundary-pixel centres they span 35 × 23 px and enclose 466 + 25 px²
// (simplifying turns the L's inside corner into a slant).
test('badge: cut-out artwork, its outline extruded to a closed solid at real-world size', async () => {
  const { glb, sidecar } = await thicken([fixture('badge.png')], { widthMm: 35, depthMm: 2 }); // 1 mm per pixel
  assert.deepEqual(sidecar, { profile: 'badge', sources: ['badge.png'], widthMm: 35, heightMm: 23, depthMm: 2, edge: '#3366cc', regions: 2, warnings: [] });

  const doc = await read(glb);
  assertExtents(doc, [0.035, 0.023, 0.002]);
  const [face, rim] = doc.getRoot().listMeshes()[0].listPrimitives();
  const faceMaterial = face.getMaterial()!;
  assert.equal(faceMaterial.getAlphaMode(), 'MASK');
  assert.equal(faceMaterial.getBaseColorTexture()?.getMimeType(), 'image/png');
  assert.ok(faceMaterial.getExtension('KHR_materials_unlit'));
  // #3366cc in linear light, as glTF factors are; unconverted it would be 0.2, 0.4, 0.8.
  rim.getMaterial()!.getBaseColorFactor().slice(0, 3).forEach((c, i) => assert.ok(Math.abs(c - [0.0331, 0.1329, 0.6038][i]) < 1e-3));

  // Every front triangle faces +Z, and they cover the traced shape.
  let area = 0;
  for (const [a, b, c] of triangles(face)) {
    const z = ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
    assert.ok(z > 0, 'front triangle faces away');
    area += z * 1e6; // mm²
  }
  assert.ok(Math.abs(area - 491) < 0.01, `front area ${area} mm²`);
  assertClosed(doc, area * 2);

  // Each front vertex's UV lands on an opaque pixel: no V flip, no offset.
  const { data, info } = await sharp(fixture('badge.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const uv = face.getAttribute('TEXCOORD_0')!;
  for (let i = 0; i < uv.getCount(); i++) {
    const [u, v] = uv.getElement(i, [0, 0]) as vec2;
    const [x, y] = [Math.floor(u * info.width), Math.floor(v * info.height)];
    assert.equal(data[(y * info.width + x) * 4 + 3], 255, `UV ${u},${v} misses the art`);
  }
});

// book-scan.pdf: two pages of 500 × 800 (a 5 × 8 in shape) as a scanner app
// writes them: the front cover, then the back with ISBN 9780140328721's barcode.
test('book: a scanned PDF, its ISBN read off the back cover, its size from Open Library', async (t) => {
  const fetch = catalogue({ physical_dimensions: '8 x 5 x 1 inches', number_of_pages: 320 });
  t.after(() => fetch.mock.restore());
  const { glb, sidecar } = await thicken([fixture('book-scan.pdf')]);
  assert.deepEqual(sidecar, {
    profile: 'book', sources: ['book-scan.pdf'], isbn: '9780140328721', widthMm: 127, heightMm: 203.2, depthMm: 25.4,
    measuredBy: { width: 'openlibrary', height: 'openlibrary', depth: 'openlibrary' }, pages: 320, warnings: [],
  });
  assert.equal(fetch.mock.callCount(), 1, 'Open Library had every dimension, so no backup was asked');

  const doc = await read(glb);
  assertExtents(doc, [0.127, 0.2032, 0.0254]);
  assertClosed(doc, 0.127 * 0.2032 * 0.0254 * 1e9);
  // Read from outside, each cover's top-left corner (UV 0,0) is at its top left:
  // the front's at -X, the back's at +X (turn a book over and the spine is on your right).
  assert.deepEqual(cornerAt(doc, [0, 0, 1]), [-1, 1, 1]);
  assert.deepEqual(cornerAt(doc, [0, 0, -1]), [1, 1, -1]);
});

test('book: dimensions the catalogue lacks fall through to the backup sources', async (t) => {
  const fetch = catalogue({ physical_dimensions: '21 cm', number_of_pages: 300, physical_format: 'Hardcover' });
  t.after(() => fetch.mock.restore());
  const { sidecar } = await thicken([fixture('book-scan.pdf')]);
  assert.deepEqual(
    [sidecar.widthMm, sidecar.heightMm, sidecar.depthMm, sidecar.measuredBy, sidecar.warnings],
    [131.3, 210, 26.5, { height: 'openlibrary', depth: 'pages', width: 'cover' }, ['www.googleapis.com answered 429']],
  ); // width from the cover's 5:8 shape; depth 300 pages × 0.075 mm + 4 mm of boards
});

// book-back.jpg: the back cover alone, barcode and all, as a phone shoots it.
test('book: a photo of the back alone is enough, the front cover coming from Open Library', async (t) => {
  const cover = await sharp({ create: { width: 500, height: 800, channels: 3, background: '#1d2b53' } }).jpeg().toBuffer();
  const fetch = catalogue({ physical_dimensions: '8 x 5 x 1 inches' }, cover);
  t.after(() => fetch.mock.restore());
  const { glb, sidecar } = await thicken([fixture('book-back.jpg')]);
  assert.equal(sidecar.coverUrl, 'https://covers.openlibrary.org/b/isbn/9780140328721-L.jpg');
  assert.deepEqual([sidecar.widthMm, sidecar.heightMm, sidecar.warnings], [127, 203.2, []]);
  // The navy cover went on the front, the cream photo on the back.
  const doc = await read(glb);
  assert.ok(near(await colourOf(doc, [0, 0, 1]), '#1d2b53'), 'front is the downloaded cover');
  assert.ok(Math.min(...await colourOf(doc, [0, 0, -1])) > 180, 'back is the photo');
});

test('book: pictures in any order are placed by what they show', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const solid = async (name: string, width: number, colour: string) => {
    const file = path.join(folder, name);
    await sharp({ create: { width, height: 800, channels: 3, background: colour } }).png().toFile(file);
    return file;
  };
  const fetch = catalogue({ physical_dimensions: '8 x 5 x 1 inches' });
  t.after(() => fetch.mock.restore());
  // Spine first, back (the barcode) second, then the front and a fourth picture nobody needs.
  const pictures = [await solid('spine.png', 60, '#c62828'), fixture('book-back.jpg'), await solid('front.png', 500, '#1d2b53'), await solid('extra.png', 500, '#2e7d32')];
  const { glb, sidecar } = await thicken(pictures);
  assert.deepEqual(sidecar.warnings, ['1 picture(s) not used: a book takes one front, back and spine']);
  const doc = await read(glb);
  assert.ok(near(await colourOf(doc, [0, 0, 1]), '#1d2b53'), 'the front is the first picture that is neither barcode nor spine');
  assert.ok(Math.min(...await colourOf(doc, [0, 0, -1])) > 180, 'the back is the barcode picture');
  assert.ok(near(await colourOf(doc, [-1, 0, 0]), '#c62828'), 'the spine is the tall narrow picture');
});

// slab.jpg: 296 × 500, a PSA holder's shape, with a QR code to a psacard.com cert on the label.
test('slab: a grader\'s QR code picks the holder, and the holder its size', async () => {
  const { glb, sidecar } = await thicken([fixture('slab.jpg')]);
  assert.deepEqual(sidecar, { profile: 'slab', sources: ['slab.jpg'], holder: 'psa', widthMm: 80.5, heightMm: 136, depthMm: 6.5, measuredBy: 'table', warnings: [] });
  assertExtents(await read(glb), [0.0805, 0.136, 0.0065]);
});

test('a picture with nothing to go on is refused, not guessed', async () => {
  await assert.rejects(thicken([fixture('plain.jpg')]), /can't tell what this is/);
});

test('batch: a folder is one model per picture, PDF or subfolder, none overwriting another', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  for (const name of [
    'IMG_10.jpg', 'IMG_2.jpg', 'img_2.PNG', 'notes.txt', '.x.jpg', 'pair/b.jpg', 'pair/a.jpg', 'pair/._a.jpg',
    'nested/photos/b.jpg', 'nested/a.jpg', 'nested/photos/.thumbs/c.jpg', 'empty/readme.md', '.hidden/c.jpg', 'thicken/old.jpg',
  ]) {
    await mkdir(path.dirname(path.join(folder, name)), { recursive: true });
    await writeFile(path.join(folder, name), '');
  }
  const items = await batchItems(folder, path.join(folder, 'thicken'));
  assert.deepEqual(items.map(({ name, files }) => [name, files.map((file) => path.relative(folder, file).replaceAll('\\', '/'))]), [
    ['IMG_2', ['IMG_2.jpg']],
    ['img_2-2', ['img_2.PNG']], // the same name but for case, which Windows and macOS treat as one file
    ['IMG_10', ['IMG_10.jpg']],
    ['nested', ['nested/a.jpg', 'nested/photos/b.jpg']],
    ['pair', ['pair/a.jpg', 'pair/b.jpg']],
  ]);
});

test('batch: every model is made, and one that fails is reported without stopping the rest', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  await copyFile(fixture('badge.png'), path.join(folder, 'badge.png'));
  await copyFile(fixture('plain.jpg'), path.join(folder, 'plain.jpg'));
  await mkdir(path.join(folder, 'slab'));
  await copyFile(fixture('slab.jpg'), path.join(folder, 'slab', '1-front.jpg'));
  await copyFile(fixture('slab.jpg'), path.join(folder, 'slab', '2-back.jpg'));
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  const batch = () => spawnSync(process.execPath, [cli, 'batch', folder], { encoding: 'utf8' });
  const first = batch();
  assert.equal(first.status, 1, 'a failed model fails the batch');
  assert.match(first.stderr, /plain: failed: can't tell what this is/);
  assert.match(first.stdout, /2 made, 0 already up to date, 1 failed/);
  assert.deepEqual((await readdir(path.join(folder, 'thicken'))).sort(), ['badge.glb', 'badge.json', 'slab.glb', 'slab.json']);

  // Run again: the models are newer than their pictures, so they're left alone, until a picture changes.
  assert.match(batch().stdout, /0 made, 2 already up to date, 1 failed/);
  const later = new Date(Date.now() + 60_000);
  await utimes(path.join(folder, 'slab', '2-back.jpg'), later, later);
  assert.match(batch().stdout, /1 made, 1 already up to date, 1 failed/);
});

/** Stand-in catalogues: Open Library knows one edition (and maybe its cover), Google Books is out of quota. */
function catalogue(edition: object, cover?: Uint8Array) {
  return mock.method(globalThis, 'fetch', async (url: string | URL) => {
    const href = String(url);
    if (href === 'https://openlibrary.org/isbn/9780140328721.json') return Response.json(edition);
    if (cover && href.startsWith('https://covers.openlibrary.org/b/isbn/9780140328721-L.jpg')) return new Response(new Uint8Array(cover));
    if (href.startsWith('https://www.googleapis.com/')) return new Response('{}', { status: 429 });
    return new Response('', { status: 404 });
  });
}

/** Mean colour [r, g, b] (0–255) of the picture on the face with this outward normal. */
async function colourOf(doc: Document, normal: number[]): Promise<number[]> {
  for (const primitive of doc.getRoot().listMeshes()[0].listPrimitives()) {
    const image = primitive.getMaterial()?.getBaseColorTexture()?.getImage();
    const facing = primitive.getAttribute('NORMAL')!.getElement(0, [0, 0, 0]);
    if (image && facing.every((c, k) => Math.abs(c - normal[k]) < 1e-6)) {
      const { channels } = await sharp(image).stats();
      return channels.slice(0, 3).map((channel) => channel.mean);
    }
  }
  throw new Error(`no picture on the face with normal ${normal}`);
}

/** Within JPEG's wobble of a #rrggbb colour. */
const near = (colour: number[], hex: string) => colour.every((c, i) => Math.abs(c - parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16)) < 12);

const read = (glb: Uint8Array) => new NodeIO().registerExtensions([KHRMaterialsUnlit]).readBinary(glb);

function assertExtents(doc: Document, metres: number[]) {
  const { min, max } = getBounds(doc.getRoot().getDefaultScene()!);
  metres.forEach((size, i) => assert.ok(Math.abs(max[i] - min[i] - size) < 1e-6, `extent ${i}: ${max[i] - min[i]} m`));
}

/** Closed and wound outward everywhere: the divergence-theorem volume is exactly the solid's. A missing, flipped or inward face breaks it. */
function assertClosed(doc: Document, mm3: number) {
  let volume = 0;
  for (const primitive of doc.getRoot().listMeshes()[0].listPrimitives()) {
    for (const [a, b, c] of triangles(primitive)) {
      volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
  }
  assert.ok(Math.abs(volume * 1e9 - mm3) < mm3 * 1e-4, `volume ${volume * 1e9} mm³, expected ${mm3}`);
}

/** Signs of the position whose UV is (0, 0) on the textured face with this normal. */
function cornerAt(doc: Document, normal: number[]): number[] {
  for (const primitive of doc.getRoot().listMeshes()[0].listPrimitives()) {
    const uv = primitive.getAttribute('TEXCOORD_0');
    const normals = primitive.getAttribute('NORMAL')!;
    for (let i = 0; uv && i < uv.getCount(); i++) {
      const [u, v] = uv.getElement(i, [0, 0]);
      if (u === 0 && v === 0 && normals.getElement(i, [0, 0, 0]).every((n, k) => Math.abs(n - normal[k]) < 1e-6)) {
        return primitive.getAttribute('POSITION')!.getElement(i, [0, 0, 0]).map(Math.sign);
      }
    }
  }
  throw new Error(`no textured face with normal ${normal}`);
}

function triangles(primitive: Primitive): vec3[][] {
  const position = primitive.getAttribute('POSITION')!;
  const index = primitive.getIndices()!.getArray()!;
  const out: vec3[][] = [];
  for (let i = 0; i < index.length; i += 3) out.push([0, 1, 2].map((k) => position.getElement(index[i + k], [0, 0, 0]) as vec3));
  return out;
}
