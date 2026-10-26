import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import sharp from 'sharp';
import { backgroundOf, grown, inQuad, tighten } from '../src/background.ts';
import { edgesOf } from '../src/edges.ts';
import { assignFaces, cut, type Shot } from '../src/faces.ts';
import { codes, level, load, snap } from '../src/image.ts';
import { startPreview } from '../src/preview.ts';
import { batchItems, thicken, VERSION } from '../src/thicken.ts';
import { decide, findBench, readOf, settle } from '../src/vision.ts';
import { fixture, hasFfmpeg, letterboxed, catalog, colorOf, near, read } from './helpers.ts';

test('video: its sharpest frames, upright, join the photos for the vision models, and a photo still beats a frame', { skip: !hasFfmpeg && 'ffmpeg isn\'t installed' }, async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  Object.assign(process.env, { THICKEN_VISION_URL: 'http://vision.test/api', THICKEN_VISION_MODELS: 'a,b,c' });
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
  // a and b disagree on every frame, and no seat outranks another: where the edges seat finds the card's outline
  // with a, that settles it; elsewhere c is asked, and agrees with a. b's place is never taken.
  const photos = (sidecar.vision as { photos: { answers: { model: string }[]; faces: { by: string[]; agreed: boolean }[] }[] }).photos;
  const settledBy = photos.slice(1).map(({ answers, faces }) => [answers.map(({ model }) => model).join(), faces.map(({ by, agreed }) => `${by.join()} ${agreed}`).join()]);
  assert.ok(settledBy.every(([asked, by]) => (asked === 'a,b,c' && by === 'a,c true') || (asked === 'a,b' && by === 'a,edges true')), JSON.stringify(settledBy));
  assert.ok(settledBy.some(([asked]) => asked === 'a,b,c'), 'c was asked where nothing else settled it');
  assert.ok(sidecar.review.every((item) => !item.includes('disagree')), sidecar.review.join('; '));

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
  // Its proportions the photo's (the phone is drawn exactly 1:2), scaled by the agreeing estimates (71 × 149), its
  // depth theirs, no side photographed: warned, not reviewed; the back, never photographed, is.
  assert.deepEqual([sidecar.widthMm, sidecar.heightMm, sidecar.depthMm], [72.7, 145.6, 8.5]);
  assert.deepEqual(sidecar.measuredBy, { width: 'photos', height: 'photos', depth: 'vision' });
  assert.deepEqual(sidecar.warnings, ['the size is scaled by the vision models\' estimate, its proportions the front photo\'s and the estimate\'s depth (72.7 × 145.6 × 8.5 mm): --size for the real one']);
  assert.deepEqual(sidecar.review, ['back (plain color)']);
  assert.ok(near(await colorOf(await read(glb), [0, 0, 1]), '#26323a'), 'the front is the phone, cut from the table');

  // Training mode: both questions kept, in order, about one image kept once, exactly as sent.
  const examples = (await readFile(path.join(dataset, 'metadata.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(examples.map(({ task }) => task), ['identify', 'faces']);
  assert.equal(examples[1].file_name, examples[0].file_name);
  assert.deepEqual((await readdir(dataset)).sort(), ['.originals', examples[0].file_name, 'metadata.jsonl']);
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
  // Each line says what it's about: the run, the object, the photo, where the photo sits in the image, what the
  // build made of it, and the photo itself, as loaded.
  const [first, second] = examples;
  assert.equal(first.run, second.run);
  assert.deepEqual([second.thicken, second.object, second.source.file, second.used], [VERSION, { profile: 'box', inputs: [`${path.basename(folder)}/${path.basename(photo)}`] }, path.basename(photo), ['front']]);
  assert.deepEqual(Object.keys(second.sent).sort(), ['left', 'scale', 'top']);
  const original = await sharp(path.join(dataset, second.original)).metadata();
  assert.deepEqual([original.width, original.height, original.exif], [second.source.width, second.source.height, undefined]);
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
  // Two seats agreeing on the mirror image (a real Skipping Christmas spine, 2026-10-03) don't outvote the one right:
  // they say where it is, and the one answer that can be right says which way up.
  assert.deepEqual(settle([answer('a', seen), answer('b', mirror), answer('c', mirror)]), {
    faces: [{ face: 'spine', corners: seen, asSeen: seen, by: ['a', 'b', 'c'], agreed: true }], disputed: [],
  });
  // Only mirror images: nothing placed, and disputed, so the next model is asked.
  assert.deepEqual(settle([answer('a', mirror), answer('b', mirror)]), { faces: [], disputed: ['spine'] });
  // A mirror image beside a right answer still counts as naming the face, and where it is.
  assert.deepEqual(settle([answer('a', mirror), answer('b', seen)]).faces.map(({ face, by }) => [face, by]), [['spine', ['b', 'a']]]);
});

test('vision: what\'s read counts each model once a photo, and a value one model alone gives, where others read none, is left out', () => {
  const sight = (answers: { model: string; read?: Record<string, string> }[]) => ({ faces: [], answers: answers.map((a) => ({ ms: 1, ...a })), disputed: [] });
  // The back of 497 (2026-10-25): asked twice, command-a made up an autograph both times; three others read none.
  const back = sight([
    { model: 'command-a', read: { grader: 'Beckett', autoGrade: '10' } }, { model: 'gemini', read: { grader: 'Beckett' } },
    { model: 'argon', read: { grader: 'Beckett' } }, { model: 'inkling', read: { grader: 'BGS' } },
    { model: 'command-a', read: { grader: 'Beckett', autoGrade: '10' } }, { model: 'gemini', read: { grader: 'Beckett' } },
  ]);
  assert.deepEqual(readOf([back]), { read: { grader: 'Beckett' }, readBy: { grader: 'disputed', autoGrade: 'alone' } });
  // Two models each way is a tie: no value, whichever came first.
  const split = sight([{ model: 'a', read: { year: '1999' } }, { model: 'b', read: { year: '2000' } }, { model: 'c', read: { year: '2000' } }, { model: 'd', read: { year: '1999' } }]);
  assert.deepEqual([readOf([split]), readOf([{ ...split, answers: split.answers.toReversed() }])].map(({ read }) => read), [{}, {}]);
});

test('vision: a tie goes to the models with the clearly better record on the bench, and is otherwise no answer', async (t) => {
  process.env.THICKEN_BENCH_URL = 'http://bench.test';
  t.after(() => { process.env.THICKEN_BENCH_URL = ''; });
  // As Benchwarmers' GET /bench/record counts them: a's useful nine times in ten, b once, c and d never judged.
  const fetch = catalog({}, { bench: ['a', 'b'], record: { a: { useful: 9, judged: 10 }, b: { useful: 1, judged: 10 } } });
  t.after(() => fetch.mock.restore());
  await findBench();
  assert.equal(decide([{ value: 'square', model: 'a' }, { value: 'round', model: 'b' }]), 'square');
  assert.equal(decide([{ value: 'square', model: 'b' }, { value: 'round', model: 'a' }]), 'round', 'the record, not the order');
  assert.equal(decide([{ value: 'square', model: 'c' }, { value: 'round', model: 'd' }]), undefined, 'no record: no answer');
  // More models outvote any record.
  assert.equal(decide([{ value: 'square', model: 'b' }, { value: 'square', model: 'c' }, { value: 'round', model: 'a' }]), 'square');
});

test('vision: two models naming different objects, with no third to ask, is no answer: the primary\'s isn\'t taken', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  Object.assign(process.env, { THICKEN_VISION_URL: 'http://vision.test/api', THICKEN_VISION_MODELS: 'a,b' });
  t.after(() => { for (const key of ['THICKEN_VISION_URL', 'THICKEN_VISION_MODELS']) delete process.env[key]; });
  const photo = path.join(folder, 'IMG_1.png');
  await sharp({ create: { width: 600, height: 800, channels: 3, background: '#26323a' } }).png().toFile(photo);
  const fetch = catalog({}, { vision: async ({ model }) => ({ object: model === 'a' ? 'book' : 'box', sizeMm: [70, 150, 8] }) });
  t.after(() => fetch.mock.restore());
  await assert.rejects(thicken([photo]), /can't tell what this is.*the vision models couldn't say/);
});

test('vision: a dispute goes by evidence, never by which seat was listed first, and a face nothing settles is left out', () => {
  // A BGS slab's back, hand-cropped (684 × 1000, so 158 px in from each side once letterboxed), as five seats placed
  // it on 2026-10-25 (VaultFlip item 497), in the photo's pixels.
  const sent = (corners: number[][]) => corners.map(([x, y]) => [x + 158, y]);
  const answer = (model: string, face: string, corners: number[][]) => ({ model, ms: 1, faces: [{ face, corners: sent(corners) }] });
  const gemini = answer('gemini-3.8-flash', 'back', [[678, 7], [10, 7], [6, 1000], [674, 1000]]); // right, listed as its mirror image
  const inkling = answer('inkling-small-free', 'back', [[7, 60], [787, 60], [787, 950], [7, 950]]); // past the photo, near square
  const nemotron = answer('nemotron', 'front', [[10, 8], [676, 8], [676, 998], [10, 998]]); // the right place, the wrong name
  const argon = answer('gemini-4-argon-high', 'back', [[7, 6], [660, 10], [681, 1042], [-2, 1042]]); // right
  const command = answer('command-a-vision', 'back', [[-158, 0], [842, 0], [842, 1000], [-158, 1000]]); // the whole image
  const holders = [80.5 / 136, 83 / 131, 80.5 / 135, 86.5 / 138.5, 79.5 / 133.5, 108 / 184, 113 / 195];
  const evidence = { bounds: [158, 0, 842, 1000], shapes: { front: holders, back: holders }, shows: { front: ['grade'] } };
  // inkling, the first seat to give a turn, went into the model before. Now its answer and command's can't be right
  // (past the photo, far off a holder's shape), and gemini's mirror image says argon's place is right.
  const { faces, disputed } = settle([gemini, inkling, nemotron, argon, command], evidence);
  assert.deepEqual([faces.map(({ face, by, agreed }) => [face, by, agreed]), disputed], [[['back', ['gemini-4-argon-high', 'gemini-3.8-flash'], true]], []]);
  assert.deepEqual(faces[0].corners, argon.faces[0].corners);
  // Without gemini, nothing backs argon over the rest: unsettled, left out, so more are asked, never a lone guess.
  assert.deepEqual(settle([inkling, argon, command], evidence), { faces: [], disputed: ['back'] });
  // The same place, two names: the one whose model read the grade a front always shows stands.
  const reading = { ...answer('a', 'front', [[10, 8], [676, 8], [676, 998], [10, 998]]), read: { grade: '9.5' } };
  assert.deepEqual(settle([reading, nemotron, answer('c', 'back', [[10, 8], [676, 8], [676, 998], [10, 998]])], evidence).faces.map(({ face, by }) => [face, by]),
    [['front', ['a', 'nemotron']]]);
  // Order decides nothing (the bench's review, 2026-10-25): two pairs agreeing on two places is a dispute either way
  // round, and a model asked twice counts once, however its answers are ordered.
  const at = (model: string, x: number) => ({ model, ms: 1, faces: [{ face: 'side', corners: [[x, 100], [x + 100, 100], [x + 100, 300], [x, 300]] }] });
  const pairs = [at('m1', 100), at('m2', 100), at('m3', 600), at('m4', 600)];
  assert.deepEqual([settle(pairs), settle(pairs.toReversed())], [{ faces: [], disputed: ['side'] }, { faces: [], disputed: ['side'] }]);
  const twice = [at('m1', 100), at('m1', 600), at('m2', 600)];
  assert.deepEqual(settle(twice).faces.map(({ corners, by }) => [corners[0], by]), [[[600, 100], ['m1', 'm2']]]);
  assert.deepEqual(settle(twice.toReversed()).faces.map(({ corners, by }) => [corners[0], by.toSorted()]), [[[600, 100], ['m1', 'm2']]]);
  // A front named by a model that read no grade loses to the back; with nothing read to tell them apart, neither stands.
  const back = answer('c', 'back', [[10, 8], [676, 8], [676, 998], [10, 998]]);
  assert.deepEqual(settle([nemotron, back], evidence).faces.map(({ face, by }) => [face, by]), [['back', ['c', 'nemotron']]]);
  assert.deepEqual(settle([reading, back], evidence), { faces: [], disputed: ['front', 'back'] });
});

test('edges: a card\'s outline on a busy table, found by its edges alone, and nothing found where there is none', async () => {
  // A card, a little turned, on speckled wood, with a picture box inside it a card's shape too, but smaller.
  const truth = [[300, 260], [640, 280], [620, 755], [280, 735]];
  const speckled = Buffer.alloc(900 * 1200 * 3);
  let seed = 1;
  for (let i = 0; i < speckled.length; i++) speckled[i] = 100 + ((seed = (seed * 48271) % 2147483647) % 61);
  const table = () => sharp(speckled, { raw: { width: 900, height: 1200, channels: 3 } });
  const svg = `<svg width="900" height="1200"><polygon points="${truth.map((p) => p.join(',')).join(' ')}" fill="#1d4f9e"/><polygon points="350,330 590,345 575,600 335,585" fill="#f2d16b"/></svg>`;
  const [picture] = await load(await table().composite([{ input: Buffer.from(svg) }]).png().toBuffer());
  const shapes = [63.5 / 88.9, 88.9 / 63.5];
  const found = (await edgesOf(picture)).outline(shapes);
  assert.ok(found && found.every((p, k) => Math.hypot(p[0] - truth[k][0], p[1] - truth[k][1]) < 0.01 * Math.hypot(900, 1200)), JSON.stringify(found));
  const [bare] = await load(await table().png().toBuffer());
  assert.equal((await edgesOf(bare)).outline(shapes), undefined);
});

test('background: a label\'s corners that run onto the speckled table behind it are pulled in to its edge, and no further', async () => {
  // A gold label with dark print on speckled granite; its given corners run 9 px past its bottom and 6 px past its right.
  let seed = 7;
  const granite = Buffer.alloc(600 * 300 * 3);
  for (let i = 0; i < granite.length; i += 3) {
    const v = 60 + ((seed = (seed * 48271) % 2147483647) % 140);
    granite.set([v, v * 0.85, v * 0.7], i);
  }
  const svg = '<svg width="600" height="300"><rect x="100" y="60" width="400" height="120" fill="#c9a640"/>'
    + '<text x="120" y="110" font-size="30" font-family="sans-serif" fill="#111">2024 TOPPS NOW</text><text x="420" y="160" font-size="40" fill="#111">10</text></svg>';
  const [picture] = await load(await sharp(granite, { raw: { width: 600, height: 300, channels: 3 } }).composite([{ input: Buffer.from(svg) }]).png().toBuffer());
  const given = [[100, 60], [506, 60], [506, 189], [100, 189]];
  const background = backgroundOf(picture, (point) => !inQuad(point, grown(given, 1.06)));
  const { corners, off } = tighten(picture, given, background);
  const truth = [[100, 60], [500, 60], [500, 180], [100, 180]];
  assert.ok(corners.every((p, k) => Math.hypot(p[0] - truth[k][0], p[1] - truth[k][1]) <= 2.5), JSON.stringify(corners));
  assert.deepEqual(off, []);
});

test('level: a label\'s corners that tilt its print are turned so every line of it reads level, top and bottom alike', async () => {
  // Lines of print on a pale label, its corners given tilted 2 degrees against the print (as 497's were, about 1.5).
  const svg = '<svg width="800" height="300"><rect width="800" height="300" fill="#d8c070"/>'
    + [60, 100, 200, 240].map((y) => `<rect x="60" y="${y}" width="${y < 150 ? 520 : 600}" height="14" fill="#111"/>`).join('')
    + '<rect x="660" y="60" width="70" height="140" fill="#111"/></svg>';
  const [picture] = await load(await sharp(Buffer.from(svg)).png().toBuffer());
  const t = Math.tan((2 * Math.PI) / 180) * 400;
  const tilted = [[20, 20 + t], [780, 20 - t], [780, 280 - t], [20, 280 + t]];
  const turned = level(picture, level(picture, tilted));
  const angle = (a: number[], b: number[]) => (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  assert.ok(Math.abs(angle(turned[0], turned[1])) < 0.25 && Math.abs(angle(turned[3], turned[2])) < 0.25, JSON.stringify(turned));
  // A face with too little print to tell keeps its corners.
  const [blank] = await load(await sharp({ create: { width: 400, height: 200, channels: 3, background: '#d8c070' } }).png().toBuffer());
  assert.deepEqual(level(blank, [[0, 0], [400, 0], [400, 200], [0, 200]]), [[0, 0], [400, 0], [400, 200], [0, 200]]);
});

test('background: a label\'s own colored border, nearer the dark scan bed than its white middle, is still no background', async () => {
  // As a grader's scan of a PSA slab (VaultFlip 364, 2026-10-25): a white label in a red border on a dark, even
  // holder insert, its corners exactly on it. Before, the border read as background: 11% off its top, and a review line.
  const svg = '<svg width="600" height="300"><rect width="600" height="300" fill="#3a3a3e"/>'
    + '<rect x="100" y="60" width="400" height="120" fill="#c8202c"/><rect x="108" y="68" width="384" height="104" fill="#f6f6f4"/>'
    + '<text x="125" y="110" font-size="24" font-family="sans-serif" fill="#111">1976 TOPPS  #1</text></svg>';
  const [picture] = await load(await sharp(Buffer.from(svg)).png().toBuffer());
  const given = [[100, 60], [500, 60], [500, 180], [100, 180]];
  const background = backgroundOf(picture, (point) => !inQuad(point, grown(given, 1.06)));
  const { trimmed, off } = tighten(picture, given, background);
  assert.ok(trimmed.every((share) => share < 0.02), JSON.stringify(trimmed));
  assert.deepEqual(off, []);
});

test('a face two models agreed on is kept over a sharper one only one placed, and a file name naming a face places it', () => {
  const shot = (source: object, sharpness: number) => ({ picture: { source: { file: 'IMG.png', ...source } }, sharpness, texture: { width: 600, height: 800 }, color: [90, 90, 90], stripes: 0 }) as unknown as Shot;
  const all = [shot({ face: 'front' }, 40), shot({ face: 'front', agreed: true }, 10), shot({ face: 'front', agreed: true, time: 1 }, 50)];
  assert.deepEqual(assignFaces(all, ['front', 'back'], { placed: ['front', 'front', 'front'] }).roles, ['alternate front', 'front', 'alternate front']);
  // Two whole photos with nothing else to tell them apart, but their names.
  const named = [shot({ file: 'card back.png' }, 10), shot({ file: 'front-2.jpg' }, 10)];
  assert.deepEqual(assignFaces(named, ['front', 'back']).chosen, { back: 0, front: 1 });
  assert.equal(assignFaces([shot({ file: 'background.png' }, 10), shot({ file: 'IMG_2.png' }, 10)], ['front', 'back']).undecided, true, 'a word containing a face is no face');
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
  assert.match(first.stdout, /to review[^\n]*\n {2}lone-slab: back \(plain color\); no vision models were asked/m, 'the front-only slab is listed');
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
