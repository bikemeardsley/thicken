import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import { thicken } from '../../src/thicken.ts';
import { read } from '../helpers.ts';

// TODO: test what makes __NAME__ what it is (its sizes, what it reads, how it's built), on pictures this test draws
// (as here) or small ones you made, in test/fixtures/__NAME__/. This one only checks it makes a model at its size.
test('__NAME__: a photo of its front makes a model at the size given', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const front = path.join(folder, 'front.png');
  await sharp({ create: { width: 400, height: 600, channels: 3, background: '#2e7d32' } }).png().toFile(front);
  const { glb, sidecar } = await thicken([front], { profile: '__NAME__', sizeMm: [100, 150, 20] });
  assert.deepEqual([sidecar.profile, sidecar.widthMm, sidecar.heightMm, sidecar.depthMm], ['__NAME__', 100, 150, 20]);
  assert.ok((await read(glb)).getRoot().listMeshes().length > 0, 'a model');
});
