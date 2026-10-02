import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mock, test } from 'node:test';
import { getBounds, NodeIO, type Document, type Primitive, type vec2, type vec3 } from '@gltf-transform/core';
import { KHRMaterialsUnlit } from '@gltf-transform/extensions';
import sharp, { type Sharp } from 'sharp';
import { startPreview } from '../src/preview.ts';
import { batchItems, thicken } from '../src/thicken.ts';

const fixture = (name: string) => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));

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
  const fetch = catalog({ physical_dimensions: '8 x 5 x 1 inches', number_of_pages: 320 });
  t.after(() => fetch.mock.restore());
  const { glb, sidecar } = await thicken([fixture('book-scan.pdf')]);
  assert.deepEqual(pick(sidecar, ['profile', 'sources', 'isbn', 'widthMm', 'heightMm', 'depthMm', 'measuredBy', 'pages', 'faces', 'review', 'warnings', 'identifiedBy']), {
    profile: 'book', sources: ['book-scan.pdf'], isbn: '9780140328721', widthMm: 127, heightMm: 203.2, depthMm: 25.4,
    measuredBy: { width: 'openlibrary', height: 'openlibrary', depth: 'openlibrary' }, pages: 320,
    faces: { front: 'photo', back: 'photo', spine: 'color', top: 'pages', bottom: 'pages', edge: 'pages' },
    review: ['spine (plain color)'], warnings: [], identifiedBy: { isbn: 'barcode' },
  });
  assert.deepEqual((sidecar.pictures as { file: string; page: number; role: string }[]).map(({ file, page, role }) => [file, page, role]),
    [['book-scan.pdf', 1, 'front'], ['book-scan.pdf', 2, 'back']]);
  assert.deepEqual(sidecar.codes, [{ picture: 1, format: 'EAN13', use: 'isbn', text: '9780140328721' }]);
  assert.ok(fetch.mock.calls.every((call) => !String(call.arguments[0]).includes('googleapis')), 'Open Library had every dimension, so no backup was asked');

  const doc = await read(glb);
  assertExtents(doc, [0.127, 0.2032, 0.0254]);
  assertClosed(doc, 0.127 * 0.2032 * 0.0254 * 1e9);
  // Read from outside, each cover's top-left corner (UV 0,0) is at its top left:
  // the front's at -X, the back's at +X (turn a book over and the spine is on your right).
  assert.deepEqual(cornerAt(doc, [0, 0, 1]), [-1, 1, 1]);
  assert.deepEqual(cornerAt(doc, [0, 0, -1]), [1, 1, -1]);
});

test('book: dimensions the catalog lacks fall through to the backup sources', async (t) => {
  const fetch = catalog({ physical_dimensions: '21 cm', number_of_pages: 300, physical_format: 'Hardcover' });
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
  const fetch = catalog({ physical_dimensions: '8 x 5 x 1 inches' }, { cover });
  t.after(() => fetch.mock.restore());
  const { glb, sidecar } = await thicken([fixture('book-back.jpg')]);
  assert.equal(sidecar.coverUrl, 'https://covers.openlibrary.org/b/isbn/9780140328721-L.jpg');
  assert.deepEqual([sidecar.widthMm, sidecar.heightMm, sidecar.warnings], [127, 203.2, []]);
  // The navy cover went on the front, the cream photo on the back.
  const doc = await read(glb);
  assert.ok(near(await colorOf(doc, [0, 0, 1]), '#1d2b53'), 'front is the downloaded cover');
  assert.ok(Math.min(...await colorOf(doc, [0, 0, -1])) > 180, 'back is the photo');
});

test('book: pictures are placed by what they show, whatever their names, order or which way up', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const save = async (name: string, image: Sharp) => {
    await image.png().toFile(path.join(folder, name));
    return path.join(folder, name);
  };
  const solid = (width: number, height: number, color: string) => sharp({ create: { width, height, channels: 3, background: color } });
  const fetch = catalog({ physical_dimensions: '8 x 5 inches' });
  t.after(() => fetch.mock.restore());
  // Shot lying down, as on a table: plain pages, then a printed spine with the book's top (a white band) on
  // the left, as it lies face up. Then the back twice (the barcode in both), the front, and a stray picture.
  const files = [
    await save('IMG_1.png', solid(800, 50, '#f2ead9')),
    await save('IMG_2.png', solid(800, 60, '#c62828').composite([{ input: await solid(40, 60, '#ffffff').png().toBuffer(), left: 0, top: 0 }])),
    fixture('book-back.jpg'),
    await save('IMG_4.png', sharp(fixture('book-back.jpg'))),
    await save('IMG_5.png', solid(500, 800, '#1d2b53')),
    await save('IMG_6.png', solid(500, 800, '#2e7d32')),
  ];
  const { glb, sidecar } = await thicken(files);
  assert.deepEqual((sidecar.pictures as { file: string; role: string }[]).map(({ file, role }) => [file, role]), [
    ['IMG_1.png', 'edge'], ['IMG_2.png', 'spine'], ['book-back.jpg', 'back'], ['IMG_4.png', 'alternate back'], ['IMG_5.png', 'front'], ['IMG_6.png', 'unused'],
  ]);
  assert.deepEqual([sidecar.review, sidecar.warnings], [[], ['1 picture(s) not used: none looked like another shot of a face', 'www.googleapis.com answered 429']]);
  // Stood up, the spine and page edge measure the thickness: 60/800 and 50/800 of the 203.2 mm height.
  assert.deepEqual([sidecar.depthMm, (sidecar.measuredBy as Record<string, string>).depth], [14, 'photos']);

  const doc = await read(glb);
  assert.ok(near(await colorOf(doc, [0, 0, 1]), '#1d2b53'), 'the front is the picture left over');
  assert.ok(Math.min(...await colorOf(doc, [0, 0, -1])) > 180, 'the back is the barcode picture');
  assert.ok(near(await colorOf(doc, [1, 0, 0]), '#f2ead9'), 'the page edge is the plain narrow picture');
  const { data, info } = await sharp(pictureOn(doc, [-1, 0, 0])).raw().toBuffer({ resolveWithObject: true });
  const at = (y: number) => [...data.subarray((y * info.width + (info.width >> 1)) * info.channels).subarray(0, 3)];
  assert.ok(info.height > info.width && near(at(2), '#ffffff') && near(at(info.height - 3), '#c62828'), 'the spine stands with its top up');
});

test('book: with no barcode, the front and back go by photo order, marked for review', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const files = [path.join(folder, 'IMG_1.png'), path.join(folder, 'IMG_2.png')];
  await sharp({ create: { width: 500, height: 800, channels: 3, background: '#1d2b53' } }).png().toFile(files[0]);
  await sharp({ create: { width: 500, height: 800, channels: 3, background: '#2e7d32' } }).png().toFile(files[1]);
  const { sidecar } = await thicken(files, { profile: 'book' });
  assert.deepEqual((sidecar.pictures as { role: string }[]).map(({ role }) => role), ['front', 'back']);
  assert.match(sidecar.review.join('\n'), /^front and back \(no barcode: told apart only by photo order/m);
});

test('book: any number of photos, each on its face, the sharpest kept, the thickness measured, and all of it recorded', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const { prepareZXingModule, writeBarcode } = await import('zxing-wasm/full');
  prepareZXingModule({ overrides: { wasmBinary: readFileSync(createRequire(import.meta.url).resolve('zxing-wasm/full/zxing_full.wasm')) } });
  // A sticker on the cover with a Wi-Fi password in its QR code: seen, never recorded.
  const wifi = Buffer.from(await (await writeBarcode('WIFI:T:WPA;S:home;P:hunter2;;', { format: 'QRCode', scale: 3 })).image!.arrayBuffer());
  const lines = [...Array(12).keys()].map((i) => `<text x="40" y="${80 + i * 46}" font-size="32" fill="#f4a259" font-family="Georgia">LINE ${i}</text>`).join('');
  const art = await sharp({ create: { width: 500, height: 800, channels: 3, background: '#1d2b53' } })
    .composite([{ input: Buffer.from(`<svg width="500" height="800">${lines}</svg>`) }, { input: wifi, left: 360, top: 640 }])
    .png().toBuffer();
  const save = async (name: string, image: Sharp) => {
    await image.toFile(path.join(folder, name));
    return path.join(folder, name);
  };
  const solid = (width: number, height: number, color: string) => sharp({ create: { width, height, channels: 3, background: color } }).png();
  // A sprayed page edge, blue, its page lines showing: bands of #3c5c8e and #2e4e80, averaging #355587.
  const sprayed = Buffer.alloc(50 * 800 * 3);
  for (let i = 0; i < 50 * 800; i++) sprayed.set(Math.floor((i % 50) / 5) % 2 ? [0x3c, 0x5c, 0x8e] : [0x2e, 0x4e, 0x80], i * 3);
  const files = [
    // The front, with the camera's EXIF (and GPS, which must not be recorded).
    await save('IMG_1.jpg', sharp(art).withExif({
      IFD0: { Make: 'Apple', Model: 'iPhone 15 Pro' },
      IFD2: { DateTimeOriginal: '2026:09:30 14:05:11', OffsetTimeOriginal: '-05:00' },
      IFD3: { GPSLatitudeRef: 'N' },
    }).jpeg()),
    await save('IMG_2.jpg', sharp(art).blur(6).jpeg()), // the front again, out of focus
    fixture('book-back.jpg'), // the back, barcode and all
    await save('IMG_4.png', solid(60, 800, '#c62828')), // the spine
    await save('IMG_5.png', sharp(sprayed, { raw: { width: 50, height: 800, channels: 3 } }).png()), // the page edge
    await save('IMG_6.png', solid(500, 60, '#e8dcc0')), // the top
  ];
  const fetch = catalog({ physical_dimensions: '8 x 5 inches' }, {
    data: { title: 'Fantastic Mr Fox', authors: [{ name: 'Roald Dahl' }], publishers: [{ name: 'Puffin' }], publish_date: '1988', number_of_pages: 100 },
  });
  t.after(() => fetch.mock.restore());
  const { glb, sidecar } = await thicken(files);

  const pictures = sidecar.pictures as { file: string; role: string; sharpness: number; camera?: string; takenAt?: string }[];
  assert.deepEqual(pictures.map(({ file, role }) => [file, role]), [
    ['IMG_1.jpg', 'front'], ['IMG_2.jpg', 'alternate front'], ['book-back.jpg', 'back'], ['IMG_4.png', 'spine'], ['IMG_5.png', 'edge'], ['IMG_6.png', 'top'],
  ]);
  assert.ok(pictures[0].sharpness > pictures[1].sharpness, 'the sharp shot of the front beats the blurred one');
  assert.deepEqual([pictures[0].camera, pictures[0].takenAt], ['Apple iPhone 15 Pro', '2026-09-30T14:05:11-05:00']);
  assert.deepEqual(sidecar.faces, { front: 'photo', back: 'photo', spine: 'photo', top: 'photo', bottom: 'pages', edge: 'photo' });

  // Thickness: spine 60/800 and edge 50/800 of the 203.2 mm height, median 13.97 mm; the page count says 7.5 mm.
  assert.deepEqual([sidecar.depthMm, (sidecar.measuredBy as Record<string, string>).depth, sidecar.depthEstimates], [14, 'photos', { photos: 14, pages: 7.5 }]);
  assert.deepEqual(sidecar.review, ['thickness (the photos say 14 mm, the page count 7.5 mm: check the spine photo\'s crop)']);
  assert.deepEqual(pick(sidecar.catalog as Record<string, unknown>, ['title', 'authors', 'publishers', 'publishDate']),
    { title: 'Fantastic Mr Fox', authors: ['Roald Dahl'], publishers: ['Puffin'], publishDate: '1988' });

  // Every code is listed, but only the one used keeps its text; GPS is never recorded.
  assert.deepEqual(sidecar.codes, [{ picture: 0, format: 'QRCode' }, { picture: 2, format: 'EAN13', use: 'isbn', text: '9780140328721' }]);
  const text = JSON.stringify(sidecar);
  assert.ok(!text.includes('hunter2') && !text.includes('GPS'), 'nothing private in the sidecar');
  assert.ok((sidecar.lookups as { host: string; status: number }[]).some(({ host, status }) => host === 'openlibrary.org' && status === 200));

  const doc = await read(glb);
  assert.ok(near(await colorOf(doc, [-1, 0, 0]), '#c62828'), 'spine photo on the spine');
  assert.ok(near(await colorOf(doc, [1, 0, 0]), '#355587'), 'page-edge photo on the page edge');
  assert.ok(near(await colorOf(doc, [0, 1, 0]), '#e8dcc0'), 'top photo on the top');
});

// slab.jpg: 296 × 500, a PSA holder's shape, with a QR code to a psacard.com cert on the label.
test('slab: a grader\'s QR code picks the holder, and the holder its size', async () => {
  const { glb, sidecar } = await thicken([fixture('slab.jpg')]);
  assert.deepEqual(pick(sidecar, ['profile', 'sources', 'holder', 'grader', 'cert', 'verifyUrl', 'widthMm', 'heightMm', 'depthMm', 'measuredBy', 'faces', 'review', 'warnings', 'identifiedBy']), {
    profile: 'slab', sources: ['slab.jpg'], holder: 'psa', grader: 'psa', cert: '12345678', verifyUrl: 'https://www.psacard.com/cert/12345678',
    widthMm: 80.5, heightMm: 136, depthMm: 6.5, measuredBy: 'table', faces: { front: 'photo', back: 'plastic' },
    review: ['back (plain plastic)'], warnings: [], identifiedBy: { grader: 'qr', cert: 'qr' },
  });
  assertExtents(await read(glb), [0.0805, 0.136, 0.0065]);
});

test('slab: the cert is the first whole cert number in the QR link, not a tracking number after it', async (t) => {
  const { prepareZXingModule, writeBarcode } = await import('zxing-wasm/full');
  prepareZXingModule({ overrides: { wasmBinary: readFileSync(createRequire(import.meta.url).resolve('zxing-wasm/full/zxing_full.wasm')) } });
  const written = await writeBarcode('https://www.psacard.com/cert/12345678?ref=98765432', { format: 'QRCode', scale: 2 });
  const qr = Buffer.from(await written.image!.arrayBuffer());
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const front = path.join(folder, 'front.png');
  await sharp({ create: { width: 296, height: 500, channels: 3, background: '#ffffff' } }).composite([{ input: qr, left: 20, top: 20 }]).png().toFile(front);
  const { sidecar } = await thicken([front]);
  assert.deepEqual([sidecar.grader, sidecar.cert], ['psa', '12345678']);
});

test('slab: every photo showing the label\'s QR code or cert barcode is the front, whatever the order', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const back = path.join(folder, 'IMG_1.png');
  await sharp({ create: { width: 296, height: 500, channels: 3, background: '#c8ccd0' } }).png().toFile(back);
  const roles = async (files: string[]) =>
    ((await thicken(files)).sidecar.pictures as { file: string; role: string }[]).map(({ file, role }) => [file, role]);
  for (const front of ['slab.jpg', 'slab-barcode.jpg']) {
    assert.deepEqual(await roles([back, fixture(front)]), [['IMG_1.png', 'back'], [front, 'front']]);
    assert.deepEqual(await roles([fixture(front), fixture(front), back]), [[front, 'front'], [front, 'alternate front'], ['IMG_1.png', 'back']]);
  }
  // CGC prints its QR code on the back of the label, so that photo is the back.
  const { prepareZXingModule, writeBarcode } = await import('zxing-wasm/full');
  prepareZXingModule({ overrides: { wasmBinary: readFileSync(createRequire(import.meta.url).resolve('zxing-wasm/full/zxing_full.wasm')) } });
  const qr = Buffer.from(await (await writeBarcode('https://www.cgccards.com/certlookup/4123456001/', { format: 'QRCode', scale: 3 })).image!.arrayBuffer());
  const cgc = path.join(folder, 'IMG_2.png');
  await sharp({ create: { width: 296, height: 500, channels: 3, background: '#e8eaec' } }).composite([{ input: qr, left: 40, top: 40 }]).png().toFile(cgc);
  assert.deepEqual(await roles([cgc, back]), [['IMG_2.png', 'back'], ['IMG_1.png', 'front']]);
});

// slab-barcode.jpg: the same holder shape, but an older label with only a Code 128 cert barcode (BGS-style 0017041720).
test('slab: a cert barcode on a holder-shaped photo is a slab, of a grader it says it can\'t name', async (t) => {
  const { sidecar } = await thicken([fixture('slab-barcode.jpg')]);
  assert.deepEqual([sidecar.profile, sidecar.holder, sidecar.cert, sidecar.grader], ['slab', 'psa', '0017041720', undefined]);
  assert.match(sidecar.review.join(' '), /holder \(PSA size assumed/);
  assert.deepEqual(sidecar.identifiedBy, { grader: 'assumed', cert: 'barcode' });

  // The same barcode on a square picture is no evidence of a slab.
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const square = path.join(folder, 'square.jpg');
  await sharp(fixture('slab-barcode.jpg')).extend({ right: 204, background: '#d0d4d8' }).toFile(square);
  await assert.rejects(thicken([square]), /can't tell what this is/);
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
  await copyFile(fixture('slab.jpg'), path.join(folder, 'lone-slab.jpg')); // a front with no back
  await mkdir(path.join(folder, 'slab'));
  await copyFile(fixture('slab.jpg'), path.join(folder, 'slab', 'IMG_1.jpg'));
  await sharp({ create: { width: 296, height: 500, channels: 3, background: '#c8ccd0' } }).jpeg().toFile(path.join(folder, 'slab', 'IMG_2.jpg'));
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  const batch = () => spawnSync(process.execPath, [cli, 'batch', folder], { encoding: 'utf8' });
  const first = batch();
  assert.equal(first.status, 1, 'a failed model fails the batch');
  assert.match(first.stderr, /plain: failed: can't tell what this is/);
  assert.match(first.stdout, /3 made, 0 already up to date, 1 failed/);
  assert.match(first.stdout, /to review[^\n]*\n {2}lone-slab: back \(plain plastic\)$/m, 'the front-only slab is listed');
  assert.doesNotMatch(first.stdout, /^ {2}slab:/m, 'the full one is not');
  assert.deepEqual((await readdir(path.join(folder, 'thicken'))).sort(),
    ['badge.glb', 'badge.json', 'lone-slab.glb', 'lone-slab.json', 'slab.glb', 'slab.json']);

  // Run again: made from exactly these pictures, so left alone, until a picture changes,
  // even to one dated earlier (a camera keeps its photos' capture dates).
  assert.match(batch().stdout, /0 made, 3 already up to date, 1 failed/);
  const earlier = new Date(2001, 0, 1);
  await utimes(path.join(folder, 'slab', 'IMG_2.jpg'), earlier, earlier);
  assert.match(batch().stdout, /1 made, 2 already up to date, 1 failed/);
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

/** Stand-in catalogs: Open Library knows one edition (and maybe its cover and catalog record), Google Books is out of quota. */
function catalog(edition: object, { cover, data }: { cover?: Uint8Array; data?: object } = {}) {
  return mock.method(globalThis, 'fetch', async (url: string | URL) => {
    const href = String(url);
    if (href === 'https://openlibrary.org/isbn/9780140328721.json') return Response.json(edition);
    if (data && href.startsWith('https://openlibrary.org/api/books?bibkeys=ISBN:9780140328721')) return Response.json({ 'ISBN:9780140328721': data });
    if (cover && href.startsWith('https://covers.openlibrary.org/b/isbn/9780140328721-L.jpg')) return new Response(new Uint8Array(cover));
    if (href.startsWith('https://www.googleapis.com/')) return new Response('{}', { status: 429 });
    return new Response('', { status: 404 });
  });
}

/** The picture on the face with this outward normal. */
function pictureOn(doc: Document, normal: number[]): Uint8Array {
  for (const primitive of doc.getRoot().listMeshes()[0].listPrimitives()) {
    const image = primitive.getMaterial()?.getBaseColorTexture()?.getImage();
    const facing = primitive.getAttribute('NORMAL')!.getElement(0, [0, 0, 0]);
    if (image && facing.every((c, k) => Math.abs(c - normal[k]) < 1e-6)) return image;
  }
  throw new Error(`no picture on the face with normal ${normal}`);
}

/** Mean color [r, g, b] (0–255) of the picture on the face with this outward normal. */
async function colorOf(doc: Document, normal: number[]): Promise<number[]> {
  const { channels } = await sharp(pictureOn(doc, normal)).stats();
  return channels.slice(0, 3).map((channel) => channel.mean);
}

/** Within JPEG's wobble of a #rrggbb color. */
const near = (color: number[], hex: string) => color.every((c, i) => Math.abs(c - parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16)) < 12);

const read = (glb: Uint8Array) => new NodeIO().registerExtensions([KHRMaterialsUnlit]).readBinary(glb);
const pick = (object: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((key) => [key, object[key]]));

function assertExtents(doc: Document, meters: number[]) {
  const { min, max } = getBounds(doc.getRoot().getDefaultScene()!);
  meters.forEach((size, i) => assert.ok(Math.abs(max[i] - min[i] - size) < 1e-6, `extent ${i}: ${max[i] - min[i]} m`));
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
