import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type vec2 } from '@gltf-transform/core';
import sharp from 'sharp';
import { cut } from '../../src/faces.ts';
import { thicken } from '../../src/thicken.ts';
import { fixture, catalog, read, pick, assertExtents, assertClosed, triangles } from '../helpers.ts';

// badge.png: 40 × 30, transparent, with two #3366cc regions: an L (x 2–19,
// y 2–25 plus x 20–29, y 18–25) and a square (x 32–37, y 2–7). Through
// boundary-pixel centers they span 35 × 23 px and enclose 466 + 25 px²
// (simplifying turns the L's inside corner into a slant).
test('badge: cut-out artwork, its outline extruded to a closed solid at real-world size', async () => {
  const { glb, sidecar } = await thicken([fixture('badge.png')], { widthMm: 35, depthMm: 2 }); // 1 mm per pixel
  assert.deepEqual(pick(sidecar, ['profile', 'sources', 'widthMm', 'heightMm', 'depthMm', 'edge', 'regions', 'review', 'warnings']),
    { profile: 'badge', sources: ['badge.png'], widthMm: 35, heightMm: 23, depthMm: 2, edge: '#3366cc', regions: 2, review: [], warnings: [] });

  const doc = await read(glb);
  assertExtents(doc, [0.035, 0.023, 0.002]);
  const [face, rim] = doc.getRoot().listMeshes()[0].listPrimitives();
  const faceMaterial = face.getMaterial()!;
  assert.equal(faceMaterial.getAlphaMode(), 'MASK');
  assert.equal(faceMaterial.getBaseColorTexture()?.getMimeType(), 'image/png');
  // Artwork is unlit, its own colors in any viewer; the rim is lit, so the thickness shades as it turns.
  assert.ok(faceMaterial.getExtension('KHR_materials_unlit'), 'the art is unlit');
  assert.deepEqual([rim.getMaterial()!.getExtension('KHR_materials_unlit'), rim.getMaterial()!.getMetallicFactor()], [null, 0]);
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

test('badge: with vision, what it names and who issued it are read off it, with no faces to find or review', async (t) => {
  Object.assign(process.env, { THICKEN_VISION_URL: 'http://vision.test/api', THICKEN_VISION_MODELS: 'a,b' });
  t.after(() => { for (const key of ['THICKEN_VISION_URL', 'THICKEN_VISION_MODELS']) delete process.env[key]; });
  const prompts: string[] = [];
  const fetch = catalog({}, {
    vision: async ({ model, prompt }) => {
      prompts.push(prompt);
      return model === 'a' ? { name: 'Solutions Architect', issuer: 'Example Cloud', level: 'Associate' } : { name: 'Solutions Architect', issuer: 'Example Cloud' };
    },
  });
  t.after(() => fetch.mock.restore());
  const { sidecar } = await thicken([fixture('badge.png')], { widthMm: 35, depthMm: 2 });
  assert.ok(!prompts[0].includes('corners') && prompts[0].includes('"issuer":""'), 'asked to read, not to find faces');
  assert.deepEqual([sidecar.read, sidecar.readBy, sidecar.review], [
    { name: 'Solutions Architect', issuer: 'Example Cloud', level: 'Associate' }, { name: 'agreed', issuer: 'agreed', level: 'once' }, [],
  ]);
});
