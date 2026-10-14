import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import { thicken } from '../../src/thicken.ts';
import { read, pick, assertExtents } from '../helpers.ts';

test('box: anything box-shaped, at the size given, its sides plain until photographed', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const files = [path.join(folder, 'IMG_1.png'), path.join(folder, 'IMG_2.png')];
  await sharp({ create: { width: 350, height: 750, channels: 3, background: '#26323a' } }).png().toFile(files[0]);
  await sharp({ create: { width: 350, height: 750, channels: 3, background: '#b0bec5' } }).png().toFile(files[1]);
  await assert.rejects(thicken(files, { profile: 'box' }), /a box needs its size/);
  // Two photos and no vision: nothing says which is the front, and photo order is no evidence.
  await assert.rejects(thicken(files, { profile: 'box', sizeMm: [70, 150, 8] }), /a vision roster tells the sides apart/);
  const { glb, sidecar } = await thicken([files[0]], { profile: 'box', sizeMm: [70, 150, 8] });
  assert.deepEqual(pick(sidecar, ['profile', 'widthMm', 'heightMm', 'depthMm', 'faces', 'warnings', 'identifiedBy']), {
    profile: 'box', widthMm: 70, heightMm: 150, depthMm: 8, warnings: [], identifiedBy: { profile: 'given' },
    faces: { front: 'photo', back: 'color', left: 'plain', right: 'plain', top: 'plain', bottom: 'plain' },
  });
  assert.deepEqual(sidecar.review, ['back (plain color)']);
  assertExtents(await read(glb), [0.07, 0.15, 0.008]);
});

test('box: its product barcode is kept as what it is, without saying alone that a photo is a box', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const { prepareZXingModule, writeBarcode } = await import('zxing-wasm/full');
  prepareZXingModule({ overrides: { wasmBinary: readFileSync(createRequire(import.meta.url).resolve('zxing-wasm/full/zxing_full.wasm')) } });
  const ean = Buffer.from(await (await writeBarcode('4006381333931', { format: 'EAN13', scale: 3 })).image!.arrayBuffer());
  const front = path.join(folder, 'front.png');
  await sharp({ create: { width: 600, height: 400, channels: 3, background: '#ffffff' } }).composite([{ input: ean, left: 40, top: 40 }]).png().toFile(front);
  const { sidecar } = await thicken([front], { profile: 'box', sizeMm: [190, 135, 15] });
  assert.deepEqual(sidecar.barcode, { text: '4006381333931', format: 'EAN13' });
  assert.deepEqual(sidecar.codes, [{ picture: 0, format: 'EAN13', use: 'barcode', text: '4006381333931' }]);
  await assert.rejects(thicken([front]), /can't tell what this is/, 'a barcode alone picks no profile');
});
