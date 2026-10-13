import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import sharp from 'sharp';
import { cut } from '../src/faces.ts';
import { codes, load, snap } from '../src/image.ts';
import { startPreview } from '../src/preview.ts';
import { batchItems, thicken } from '../src/thicken.ts';
import { settle } from '../src/vision.ts';
import { fixture, hasFfmpeg, letterboxed, catalog, colorOf, near, read } from './helpers.ts';

test('video: its sharpest frames, upright, join the photos for the vision models, and a photo still beats a frame', { skip: !hasFfmpeg && 'ffmpeg isn\'t installed' }, async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  Object.assign(process.env, { THICKEN_VISION_URL: 'http://vision.test/api', THICKEN_VISION_MODELS: 'a,b' });
  t.after(() => { for (const key of ['THICKEN_VISION_URL', 'THICKEN_VISION_MODELS']) delete process.env[key]; });
  // The card on its table from the card test at half the size, with a white mark top left to show which way up.
  const quad = [[150, 165], [340.5, 165], [340.5, 431.7], [150, 431.7]];
  const scene = async (fill: string) => sharp(await sharp({ create: { width: 450, height: 600, channels: 3, background: '#8b5a2b' } })
    .composite([{ input: Buffer.from(`<svg width="450" height="600"><rect width="50" height="50" fill="#fff"/><polygon points="${quad.map((p) => p.join(',')).join(' ')}" fill="${fill}"/></svg>`) }])
    .png().toBuffer());
  // Its front in a photo a little soft; then a phone video, held upright, turning it over: four seconds, front then
  // back, most frames blurred by the moving phone. A phone stores an upright video sideways with a note to turn it,
  // and an iPhone's is HDR (HLG).
  const photo = path.join(folder, 'IMG_1.png');
  await (await scene('#2e7d32')).blur(1).toFile(photo);
  for (let k = 0; k < 24; k++) {
    const frame = await scene(k < 12 ? '#2e7d32' : '#1d4f9e');
    await (k % 4 === 2 ? frame : frame.blur(3)).rotate(90).png().toFile(path.join(folder, `f${String(k).padStart(2, '0')}.png`));
  }
  const ffmpeg = (...args: string[]) => assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-y', ...args]).status, 0);
  ffmpeg('-framerate', '6', '-i', path.join(folder, 'f%02d.png'), '-c:v', 'mpeg4', '-q:v', '2', '-pix_fmt', 'yuv420p', path.join(folder, 'sideways.mp4'));
  const video = path.join(folder, 'IMG_2.MOV');
  // Tagged when the turn is noted: tags given while encoding from PNG don't stick.
  ffmpeg('-display_rotation', '90', '-i', path.join(folder, 'sideways.mp4'), '-c', 'copy',
    '-color_trc', 'arib-std-b67', '-color_primaries', 'bt2020', '-colorspace', 'bt2020nc', video);

  // Six frames, the sharp one of each stretch of four, turned upright.
  const frames = await load(video);
  assert.deepEqual(frames.map(({ source }) => source.time), [0.3, 1, 1.7, 2.3, 3, 3.7]);
  const { file, format, width, height } = frames[0].source;
  assert.deepEqual({ file, format, width, height }, { file: 'IMG_2.MOV', format: 'mpeg4', width: 450, height: 600 });
  for (const frame of frames) {
    assert.deepEqual([frame.width, frame.height], [450, 600]);
    const [red, blue] = [0, 2].map((k) => (x: number, y: number) => frame.data[(y * frame.width + x) * 4 + k]);
    assert.ok(blue(25, 25) > 150, 'the white mark is top left');
    assert.ok(red(425, 25) > 165, 'toned down from HDR: the brown table, read as HLG, comes out lighter (red about 190, not 139)');
  }

  const seen = quad.map(([x, y]) => [125 + (x * 5) / 3, (y * 5) / 3]); // letterboxed into 1000 × 1000
  const fetch = catalog({}, {
    vision: async ({ model, photo: sent }) => {
      const { data, info } = await sharp(sent).raw().toBuffer({ resolveWithObject: true });
      const middle = (500 * info.width + 500) * info.channels; // green in the middle: the front
      // b puts every frame's card somewhere else: the frames are told from the photo by their table, toned lighter.
      const frame = data[(42 * info.width + 833) * info.channels] > 165;
      const corners = model === 'b' && frame ? seen.map(([x, y]) => [x + 80, y]) : seen; // 6% of the diagonal off: past agreeing
      return { faces: [{ face: data[middle + 1] > data[middle + 2] ? 'front' : 'back', corners }], corners: 'square' };
    },
  });
  t.after(() => fetch.mock.restore());
  const { sidecar } = await thicken([photo, video], { profile: 'card' });
  assert.deepEqual(sidecar.faces, { front: 'photo', back: 'photo' });
  const pictures = sidecar.pictures as { file: string; time?: number; sharpness: number; role: string }[];
  const fronts = pictures.filter(({ role }) => role.endsWith('front'));
  assert.deepEqual(fronts.map(({ file: name, time, role }) => [name, time, role]), [
    ['IMG_1.png', undefined, 'front'], ['IMG_2.MOV', 0.3, 'alternate front'], ['IMG_2.MOV', 1, 'alternate front'], ['IMG_2.MOV', 1.7, 'alternate front'],
  ]);
  assert.ok(Math.max(...fronts.slice(1).map(({ sharpness }) => sharpness)) > fronts[0].sharpness, 'the photo wins though a frame scores sharper');
  assert.ok([2.3, 3, 3.7].includes(pictures.find(({ role }) => role === 'back')?.time ?? 0), 'the back, which no photo shows, is a frame');
  // The models disagree on every frame, but only the one used, for the back, is worth a look.
  const doubts = sidecar.review.filter((item) => item.includes('disagree'));
  assert.equal(doubts.length, 1, doubts.join('; '));
  assert.match(doubts[0], /^back in IMG_2\.MOV at (2\.3|3|3\.7) s /);

  // Without vision, a video is no use: said, not ignored.
  delete process.env.THICKEN_VISION_URL;
  await assert.rejects(thicken([photo, video], { profile: 'card' }), /a video is for the vision models/);
});

test('vision: with nothing else to go on, the models say what it is and roughly how big; training mode keeps each question', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const dataset = path.join(folder, 'dataset');
  Object.assign(process.env, { THICKEN_VISION_URL: 'http://vision.test/api', THICKEN_VISION_MODELS: 'a,b,c', THICKEN_VISION_KEY: 'secret-key-456', THICKEN_DATASET: dataset });
  t.after(() => { for (const key of ['THICKEN_VISION_URL', 'THICKEN_VISION_MODELS', 'THICKEN_VISION_KEY', 'THICKEN_DATASET']) delete process.env[key]; });
  // A phone face down on a brown table, no codes on it: one photo, 900 x 1200, its front a dark rectangle.
  const photo = path.join(folder, 'IMG_1.png');
  const front = [[300, 200], [600, 200], [600, 800], [300, 800]];
  await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#8b5a2b' } })
    .composite([{ input: await sharp({ create: { width: 300, height: 600, channels: 3, background: '#26323a' } }).png().toBuffer(), left: 300, top: 200 }])
    .png().toFile(photo);
  const seen = front.map(([x, y]) => [125 + (x * 5) / 6, (y * 5) / 6]); // letterboxed into 1000 x 1000
  const fetch = catalog({}, {
    vision: async ({ model, prompt }) => {
      // Saying what it is: a and b disagree, so c is asked, and agrees with b, outvoting the primary.
      if (prompt.includes('Which of these is it?')) return model === 'a' ? { object: 'book', sizeMm: [140, 210, 20] } : { object: 'box', sizeMm: model === 'b' ? [70, 150, 8] : [72, 148, 9] };
      return { faces: [{ face: 'front', corners: seen }, { face: 'lid', corners: seen }] }; // a box has no lid
    },
  });
  t.after(() => fetch.mock.restore());
  const { glb, sidecar } = await thicken([photo]);

  assert.deepEqual([sidecar.profile, sidecar.identifiedBy], ['box', { profile: 'vision' }]);
  const { identified } = sidecar.vision as { identified: { profile: string; sizeMm: number[]; disputed: boolean; answers: { model: string }[] } };
  assert.deepEqual([identified.profile, identified.sizeMm, identified.disputed, identified.answers.map(({ model }) => model)], ['box', [71, 149, 8.5], false, ['a', 'b', 'c']]);
  // Sized by the agreeing estimates, and warned, not reviewed; the back, never photographed, is.
  assert.deepEqual([sidecar.widthMm, sidecar.heightMm, sidecar.depthMm], [71, 149, 8.5]);
  assert.deepEqual(sidecar.warnings, ['the size is partly the vision models\' estimate (71 × 149 × 8.5 mm): --size for the real one']);
  assert.deepEqual(sidecar.review, ['back (plain color)']);
  assert.ok(near(await colorOf(await read(glb), [0, 0, 1]), '#26323a'), 'the front is the phone, cut from the table');

  // Training mode: both questions kept, in order, about one image kept once, exactly as sent.
  const examples = (await readFile(path.join(dataset, 'metadata.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(examples.map(({ task }) => task), ['identify', 'faces']);
  assert.equal(examples[1].file_name, examples[0].file_name);
  assert.deepEqual((await readdir(dataset)).sort(), [examples[0].file_name, 'metadata.jsonl']);
  const { width, height, format } = await sharp(path.join(dataset, examples[0].file_name)).metadata();
  assert.deepEqual([width, height, format], [1000, 1000, 'jpeg']);
  assert.match(examples[0].prompt, /Which of these is it\?/);
  assert.deepEqual(examples[0].answers.map(({ model, object }: { model: string; object: string }) => [model, object]), [['a', 'book'], ['b', 'box'], ['c', 'box']]);
  assert.deepEqual([examples[0].label, examples[0].disputed], [{ object: 'box', sizeMm: [71, 149, 8.5] }, false]);
  // Faces: each answer as given, and the label snapped onto the phone's real edges, both in the image as sent.
  assert.equal(examples[1].profile, 'box');
  assert.deepEqual(examples[1].answers.map(({ model, faces }: { model: string; faces: { corners: number[][] }[] }) => [model, faces[0].corners]), [['a', seen], ['b', seen]]);
  assert.deepEqual(examples[1].label.faces.map(({ face }: { face: string }) => face), ['front'], 'a face the profile lacks is dropped');
  const [label] = examples[1].label.faces;
  assert.deepEqual([label.face, label.agreed], ['front', true]);
  assert.ok(label.corners.every((p: number[], i: number) => Math.hypot(p[0] - seen[i][0], p[1] - seen[i][1]) <= 1.5), `label ${JSON.stringify(label.corners)}`);
  assert.ok(!JSON.stringify(examples).includes('secret-key'), 'the key is never kept');
});

test('a code outranks the models: the face it is printed on is the face it proves, and crossed corners are no face', async () => {
  const [picture] = await load(fixture('book-back.jpg'));
  const [isbn] = await codes(picture);
  const { width: w, height: h } = picture;
  const sight = (corners: number[][]) => ({ faces: [{ face: 'front', corners, asSeen: corners, by: ['a', 'b'], agreed: true }], answers: [], disputed: [] });
  const proof = { picture: 0, face: 'back', at: isbn.at };
  // The models call the barcode's face the front; the barcode says back.
  assert.deepEqual(cut([picture], [sight([[0, 0], [w, 0], [w, h], [0, h]])], [proof]).placed, ['back']);
  // A face clear of the barcode keeps the models' name.
  assert.deepEqual(cut([picture], [sight([[0, 0], [w, 0], [w, 100], [0, 100]])], [proof]).placed, ['front']);
  // Crossed corners (a bow tie) warp to nothing, so they're no face: the photo is used whole, placed by its code.
  const crossed = cut([picture], [sight([[0, 0], [w, h], [w, 0], [0, h]])], [proof]);
  assert.deepEqual(crossed.placed, ['back']);
  assert.equal(crossed.parts[0], picture);
});

test('vision: a face given as its mirror image says it is there, but only a face as the camera saw it is placed', () => {
  const seen = [[100, 100], [300, 100], [300, 500], [100, 500]]; // reading order, clockwise on screen: as photographed
  const mirror = [seen[1], seen[0], seen[3], seen[2]];
  const answer = (model: string, corners: number[][]) => ({ model, ms: 1, faces: [{ face: 'spine', corners }] });
  // Two seats agreeing on the mirror image (a real Skipping Christmas spine, 2026-10-03) don't outvote the one right.
  assert.deepEqual(settle([answer('a', seen), answer('b', mirror), answer('c', mirror)]), {
    faces: [{ face: 'spine', corners: seen, asSeen: seen, by: ['a'], agreed: false }], disputed: ['spine'],
  });
  // Only mirror images: nothing placed, and disputed, so the next model is asked.
  assert.deepEqual(settle([answer('a', mirror), answer('b', mirror)]), { faces: [], disputed: ['spine'] });
  // A mirror image beside a right answer still counts as naming the face: it isn't dropped as one model's alone.
  assert.deepEqual(settle([answer('a', mirror), answer('b', seen)]).faces.map(({ face, by }) => [face, by]), [['spine', ['b']]]);
});

test('snap: a model\'s corners, a little off, move onto the cover\'s real edges, not onto print near them', async () => {
  // A navy cover shot from low down on a brown table, with a white line of print just inside its top edge,
  // running only the middle of the way across.
  const truth = [[300, 150], [600, 150], [760, 1000], [140, 1000]];
  const svg = `<svg width="900" height="1200"><polygon points="${truth.map((p) => p.join(',')).join(' ')}" fill="#1d2b53"/>`
    + '<rect x="380" y="172" width="140" height="10" fill="#ffffff"/></svg>';
  const png = await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#8b5a2b' } }).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
  const [picture] = await load(png);
  const off = [[312, 141], [589, 162], [775, 990], [128, 1013]]; // 10–19 px out, as a model's 1–2%
  const apart = (a: number[][], b: number[][]) => Math.max(...a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1])));
  assert.ok(apart(snap(picture, off), truth) < 2, `snapped to ${JSON.stringify(snap(picture, off).map((p) => p.map(Math.round)))}`);
  // Nothing to snap to: the corners stay put.
  const [blank] = await load(await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#8b5a2b' } }).png().toBuffer());
  assert.deepEqual(snap(blank, off), off);
});

test('a picture with nothing to go on is refused, not guessed', async () => {
  await assert.rejects(thicken([fixture('plain.jpg')]), /can't tell what this is/);
});

test('batch: a folder is one model per picture, PDF, video or subfolder, none overwriting another', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  for (const name of [
    'IMG_10.jpg', 'IMG_2.jpg', 'img_2.PNG', 'clip.MOV', 'notes.txt', '.x.jpg', 'pair/b.jpg', 'pair/a.jpg', 'pair/c.mp4', 'pair/._a.jpg',
    'nested/photos/b.jpg', 'nested/a.jpg', 'nested/photos/.thumbs/c.jpg', 'empty/readme.md', '.hidden/c.jpg', 'thicken/old.jpg',
  ]) {
    await mkdir(path.dirname(path.join(folder, name)), { recursive: true });
    await writeFile(path.join(folder, name), '');
  }
  const items = await batchItems(folder, path.join(folder, 'thicken'));
  assert.deepEqual(items.map(({ name, files }) => [name, files.map((file) => path.relative(folder, file).replaceAll('\\', '/'))]), [
    ['clip', ['clip.MOV']],
    ['IMG_2', ['IMG_2.jpg']],
    ['img_2-2', ['img_2.PNG']], // the same name but for case, which Windows and macOS treat as one file
    ['IMG_10', ['IMG_10.jpg']],
    ['nested', ['nested/a.jpg', 'nested/photos/b.jpg']],
    ['pair', ['pair/a.jpg', 'pair/b.jpg', 'pair/c.mp4']],
  ]);
});

test('batch: every model is made, and one that fails is reported without stopping the rest', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  await copyFile(fixture('badge.png'), path.join(folder, 'badge.png'));
  await copyFile(fixture('plain.jpg'), path.join(folder, 'plain.jpg'));
  await copyFile(fixture('slab.jpg'), path.join(folder, 'lone-slab.jpg')); // a front with no back
  await mkdir(path.join(folder, 'slab'));
  await copyFile(fixture('slab.jpg'), path.join(folder, 'slab', 'IMG_1.jpg'));
  await sharp({ create: { width: 296, height: 500, channels: 3, background: '#c8ccd0' } }).jpeg().toFile(path.join(folder, 'slab', 'IMG_2.jpg'));
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  const batch = () => spawnSync(process.execPath, [cli, 'batch', folder], { encoding: 'utf8' });
  const first = batch();
  assert.equal(first.status, 1, 'a failed model fails the batch');
  assert.match(first.stderr, /plain: failed: can't tell what this is/);
  // Two photos of a slab, and no vision roster to say which is the front: stopped, not guessed.
  assert.match(first.stderr, /slab: failed: nothing in the photos says which one shows the front/);
  assert.match(first.stdout, /2 made, 0 already up to date, 2 failed/);
  assert.match(first.stdout, /to review[^\n]*\n {2}lone-slab: back \(plain color\)$/m, 'the front-only slab is listed');
  assert.deepEqual((await readdir(path.join(folder, 'thicken'))).sort(), ['badge.glb', 'badge.json', 'lone-slab.glb', 'lone-slab.json']);

  // Run again: made from exactly these pictures, so left alone, until a picture changes,
  // even to one dated earlier (a camera keeps its photos' capture dates).
  assert.match(batch().stdout, /0 made, 2 already up to date, 2 failed/);
  const earlier = new Date(2001, 0, 1);
  await utimes(path.join(folder, 'lone-slab.jpg'), earlier, earlier);
  assert.match(batch().stdout, /1 made, 1 already up to date, 2 failed/);
});

test('preview: both sides of a model, drawn beside it as <name>.preview.png', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const { glb, sidecar } = await thicken([fixture('slab.jpg')]);
  const model = path.join(folder, 'slab.glb');
  await writeFile(model, glb);
  await writeFile(path.join(folder, 'slab.json'), JSON.stringify(sidecar));
  const preview = await startPreview().catch(() => undefined);
  if (!preview) return t.skip('no Chrome or Edge on this machine');
  try {
    assert.equal(await preview.render(model), path.join(folder, 'slab.preview.png'));
  } finally {
    await preview.close();
  }
  const { data, info } = await sharp(path.join(folder, 'slab.preview.png')).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height], [800, 574]);
  // The front view's middle is the slab's green card, not the background.
  const k = (300 * info.width + 200) * info.channels;
  assert.ok(data[k + 1] > data[k] + 40 && data[k + 1] > data[k + 2] + 40, `front view center is ${[...data.subarray(k, k + 3)]}`);
});
