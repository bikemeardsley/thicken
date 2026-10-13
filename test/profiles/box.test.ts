import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
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
