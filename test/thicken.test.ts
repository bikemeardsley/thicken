import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mock, test } from 'node:test';
import { getBounds, NodeIO, type Document, type Primitive, type vec2, type vec3 } from '@gltf-transform/core';
import { KHRMaterialsUnlit } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { thicken } from '../src/thicken.ts';

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

// slab.jpg: 296 × 500, a PSA holder's shape, with a QR code to a psacard.com cert on the label.
test('slab: a grader\'s QR code picks the holder, and the holder its size', async () => {
  const { glb, sidecar } = await thicken([fixture('slab.jpg')]);
  assert.deepEqual(sidecar, { profile: 'slab', sources: ['slab.jpg'], holder: 'psa', widthMm: 80.5, heightMm: 136, depthMm: 6.5, measuredBy: 'table', warnings: [] });
  assertExtents(await read(glb), [0.0805, 0.136, 0.0065]);
});

test('a picture with nothing to go on is refused, not guessed', async () => {
  await assert.rejects(thicken([fixture('plain.jpg')]), /can't tell what this is/);
});

/** Stand-in catalogues: Open Library knows one edition, Google Books is out of quota. */
function catalogue(edition: object) {
  return mock.method(globalThis, 'fetch', async (url: string | URL) => {
    if (String(url) === 'https://openlibrary.org/isbn/9780140328721.json') return Response.json(edition);
    if (String(url).startsWith('https://www.googleapis.com/')) return new Response('{}', { status: 429 });
    return new Response('', { status: 404 });
  });
}

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
