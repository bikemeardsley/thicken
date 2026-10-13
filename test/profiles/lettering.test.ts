import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getBounds } from '@gltf-transform/core';
import { thicken } from '../../src/thicken.ts';
import { assertWatertight, read, triangles } from '../helpers.ts';

test('lettering: words in, no picture, closed gold bubble letters out at the width asked, round in section', async () => {
  const { glb, sidecar } = await thicken(['hi', 'there'], { profile: 'lettering', widthMm: 60 });
  assert.deepEqual([sidecar.text, sidecar.font, sidecar.fontLicense, sidecar.sources, sidecar.warnings], ['hi there', 'Titan One', 'OFL-1.1', ['hi', 'there'], []]);
  assert.deepEqual(sidecar.measuredBy, { width: 'given', depth: 'round' });

  const doc = await read(glb);
  assertWatertight(doc);
  let volume = 0; // wound outward: the divergence theorem's volume comes out positive
  for (const [a, b, c] of triangles(doc.getRoot().listMeshes()[0].listPrimitives()[0])) {
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  assert.ok(volume > 0, `volume ${volume}`);
  // As wide as asked (its outline snapped onto the letters', within a fraction of a millimeter), the back mirroring
  // the front, and as thick as the sidecar says: round in section, the thickest stroke as deep as it is wide.
  const { min, max } = getBounds(doc.getRoot().getDefaultScene()!);
  assert.ok(Math.abs((max[0] - min[0]) * 1000 - 60) < 0.3, `width ${(max[0] - min[0]) * 1000} mm`);
  assert.ok(Math.abs(max[2] + min[2]) < 1e-6, 'the back mirrors the front');
  assert.ok(Math.abs((max[2] - min[2]) * 1000 - sidecar.depthMm) < 0.06, `depth ${(max[2] - min[2]) * 1000} mm`);
  const gold = doc.getRoot().listMaterials()[0];
  assert.deepEqual([gold.getMetallicFactor(), gold.getBaseColorFactor()], [1, [1, 0.766, 0.336, 1]]);
});

test('lettering: --depth sets the thickness, and a letter the font lacks is warned and left blank', async () => {
  const { glb, sidecar } = await thicken(['ab✓'], { profile: 'lettering', widthMm: 40, depthMm: 3 });
  const { min, max } = getBounds((await read(glb)).getRoot().getDefaultScene()!);
  assert.ok(Math.abs((max[2] - min[2]) * 1000 - 3) < 0.01, `depth ${(max[2] - min[2]) * 1000} mm`);
  assert.deepEqual([sidecar.depthMm, (sidecar.measuredBy as { depth: string }).depth], [3, 'given']);
  assert.deepEqual(sidecar.warnings, ['the font has no "✓": left blank']);
  await assert.rejects(thicken([' '], { profile: 'lettering' }), /lettering needs words/);
});
