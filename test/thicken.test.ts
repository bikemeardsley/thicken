import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mock, test } from 'node:test';
import { getBounds, NodeIO, type Document, type Primitive, type vec2, type vec3 } from '@gltf-transform/core';
import { ALL_EXTENSIONS, type Iridescence } from '@gltf-transform/extensions';
import sharp, { type Sharp } from 'sharp';
import { cut } from '../src/faces.ts';
import { codes, load, mapping, snap } from '../src/image.ts';
import { startPreview } from '../src/preview.ts';
import { batchItems, thicken } from '../src/thicken.ts';
import { settle } from '../src/vision.ts';

const fixture = (name: string) => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));
delete process.env.THICKEN_DATASET; // test photos never go into a real training set

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
    review: ['spine (plain color)'], warnings: [], identifiedBy: { profile: 'recognized', isbn: 'barcode' },
  });
  assert.deepEqual((sidecar.pictures as { file: string; page: number; role: string }[]).map(({ file, page, role }) => [file, page, role]),
    [['book-scan.pdf', 1, 'front'], ['book-scan.pdf', 2, 'back']]);
  assert.deepEqual(sidecar.codes, [{ picture: 1, format: 'EAN13', use: 'isbn', text: '9780140328721' }]);
  assert.ok(fetch.mock.calls.every((call) => !String(call.arguments[0]).includes('googleapis')), 'Open Library had every dimension, so no backup was asked');

  const doc = await read(glb);
  // The full size across the faces, its edges rounded to 1 mm: some normals lean between two faces.
  assertExtents(doc, [0.127, 0.2032, 0.0254]);
  assertClosed(doc, roundedVolume([127, 203.2, 25.4], 1), 5e-4);
  const normals = doc.getRoot().listMeshes()[0].listPrimitives().flatMap((p) => {
    const accessor = p.getAttribute('NORMAL')!;
    return [...Array(accessor.getCount()).keys()].map((i) => accessor.getElement(i, [0, 0, 0]));
  });
  assert.ok(normals.some(([nx, , nz]) => Math.abs(nx) > 0.3 && Math.abs(nz) > 0.3), 'rounded edges');
  // The page edge, not photographed, is a generated stack of cream pages.
  assert.ok(near(await colorOf(doc, [1, 0, 0]), '#efe6d2'), 'cream pages');
  // Read from outside, each cover's top-left corner (UV 0,0) is at its top left:
  // the front's at -X, the back's at +X (turn a book over and the spine is on your right).
  assert.deepEqual(cornerAt(doc, [0, 0, 1]), [-1, 1, 1]);
  assert.deepEqual(cornerAt(doc, [0, 0, -1]), [1, 1, -1]);
});

test('book: dimensions the catalog lacks fall through to the backup sources', async (t) => {
  // Many Open Library editions give their page count only as catalog pagination text.
  const fetch = catalog({ physical_dimensions: '21 cm', pagination: 'xii, 300 p.', physical_format: 'Hardcover' });
  t.after(() => fetch.mock.restore());
  const { sidecar } = await thicken([fixture('book-scan.pdf')]);
  assert.deepEqual(
    [sidecar.widthMm, sidecar.heightMm, sidecar.depthMm, sidecar.measuredBy, sidecar.warnings],
    [131.3, 210, 26.5, { height: 'openlibrary', depth: 'pages', width: 'cover' }, ['www.googleapis.com answered 429']],
  ); // width from the cover's 5:8 shape; depth 300 pages × 0.075 mm + 4 mm of boards
});

test('book: a size no catalog has comes from the Library of Congress: its height, page count and binding', async (t) => {
  // The catalog's MARC record: the ISBN as its own, with the binding noted beside it as older records do; the title;
  // and the physical description, the height rounded up to the next centimeter.
  const loc = (title: string) => '<record><datafield tag="020" ind1=" " ind2=" "><subfield code="a">0140328726 (hardcover)</subfield></datafield>'
    + `<datafield tag="245" ind1="1" ind2="0"><subfield code="a">${title} /</subfield></datafield>`
    + '<datafield tag="300" ind1=" " ind2=" "><subfield code="a">xii, 177 p. ;</subfield><subfield code="c">20 cm.</subfield></datafield></record>';
  const fetch = catalog({}, { loc: loc('Fantastic Mr. Fox') });
  t.after(() => fetch.mock.restore());
  const { sidecar } = await thicken([fixture('book-scan.pdf')]);
  assert.deepEqual(
    [sidecar.heightMm, sidecar.depthMm, sidecar.pages, sidecar.measuredBy, sidecar.binding, sidecar.bindingBy],
    [195, 17.3, 177, { height: 'loc', width: 'cover', depth: 'pages' }, 'hardcover', 'catalog'],
  ); // 20 cm is anything over 19 cm: the middle, 19.5; depth 177 pages × 0.075 mm plus 4 mm of boards

  // A record carrying the ISBN by mistake, for another book (one in fifteen tried did): its title gives it away.
  fetch.mock.restore();
  const wrong = catalog({}, { data: { title: 'Fantastic Mr. Fox' }, loc: loc('Dhiki ya Mtule') });
  t.after(() => wrong.mock.restore());
  const other = await thicken([fixture('book-scan.pdf')]);
  assert.notEqual((other.sidecar.measuredBy as Record<string, string>).height, 'loc');
  assert.ok(other.sidecar.warnings.includes('the Library of Congress\'s record for ISBN 9780140328721 is another book ("Dhiki ya Mtule"): not used'));
});

test('book: a hardcover is built as one, its boards standing past the pages at the top, bottom and page edge', async (t) => {
  const fetch = catalog({ physical_dimensions: '8 x 5 x 1 inches', physical_format: 'Hardcover' });
  t.after(() => fetch.mock.restore());
  const { glb, sidecar } = await thicken([fixture('book-scan.pdf')]);
  assert.deepEqual([sidecar.binding, sidecar.bindingBy], ['hardcover', 'catalog']);
  const doc = await read(glb);
  assertExtents(doc, [0.127, 0.2032, 0.0254]); // the boards measure the book's full size
  // Four closed pieces: the spine and two boards, 2 mm thick, edges rounded 0.8 mm, and the pages, set back 3 mm.
  const [w, h, d] = [127, 203.2, 25.4];
  assertClosed(doc, roundedVolume([2, h, d], 0.8) + 2 * roundedVolume([w - 2, h, 2], 0.8) + roundedVolume([w - 2 - 3, h - 6, d - 4], 1), 5e-4);
  // The page edge, cream pages, 3 mm in from the boards' edge; the covers on the boards' outsides.
  const pages = faceOf(doc, [1, 0, 0])!.getAttribute('POSITION')!;
  const xs = [...Array(pages.getCount()).keys()].map((i) => pages.getElement(i, [0, 0, 0])[0]);
  assert.ok(Math.abs(Math.max(...xs) - (w / 2 - 3) / 1000) < 1e-6, `the page edge is at ${Math.max(...xs)} m`);
  assert.ok(near(await colorOf(doc, [1, 0, 0]), '#efe6d2'), 'cream pages');
  assert.deepEqual(cornerAt(doc, [0, 0, 1]), [-1, 1, 1]);
  assert.deepEqual(cornerAt(doc, [0, 0, -1]), [1, 1, -1]);
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
  // Shot lying down, as on a table, the book's top a white band: plain pages, the top on the right as the book
  // lies face up; then a printed spine, the top on its left. Then the back twice (the barcode in both), the front,
  // and a stray picture.
  const files = [
    await save('IMG_1.png', solid(800, 50, '#f2ead9').composite([{ input: await solid(40, 50, '#ffffff').png().toBuffer(), left: 760, top: 0 }])),
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
  // No vision roster set: nothing asked, nothing recorded.
  assert.equal(sidecar.vision, undefined);
  assert.ok(fetch.mock.calls.every((call) => !String(call.arguments[0]).includes('/chat/completions')));
  assert.deepEqual([sidecar.review, sidecar.warnings], [[], ['1 picture(s) not used: none looked like another shot of a face', 'www.googleapis.com answered 429']]);
  // Stood up, the spine and page edge measure the thickness: 60/800 and 50/800 of the 203.2 mm height.
  assert.deepEqual([sidecar.depthMm, (sidecar.measuredBy as Record<string, string>).depth], [14, 'photos']);

  const doc = await read(glb);
  assert.ok(near(await colorOf(doc, [0, 0, 1]), '#1d2b53'), 'the front is the picture left over');
  assert.ok(Math.min(...await colorOf(doc, [0, 0, -1])) > 180, 'the back is the barcode picture');
  assert.ok(near(await colorOf(doc, [1, 0, 0]), '#f2ead9'), 'the page edge is the plain narrow picture');
  // Both stood up the right way: the book's top, the white band, at the top of each picture.
  for (const [normal, body] of [[[-1, 0, 0], '#c62828'], [[1, 0, 0], '#f2ead9']] as const) {
    const { data, info } = await sharp(pictureOn(doc, [...normal])).raw().toBuffer({ resolveWithObject: true });
    const at = (y: number) => [...data.subarray((y * info.width + (info.width >> 1)) * info.channels).subarray(0, 3)];
    assert.ok(info.height > info.width && near(at(2), '#ffffff') && near(at(info.height - 3), body), `the face facing ${normal} stands with its top up`);
  }
});

test('book: vision models find the faces in uncropped photos, which are cut out and straightened, peers checking each other', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  Object.assign(process.env, { THICKEN_VISION_URL: 'http://vision.test/api', THICKEN_VISION_MODELS: 'a,b,c', THICKEN_VISION_KEY: 'secret-key-123' });
  t.after(() => { for (const key of ['THICKEN_VISION_URL', 'THICKEN_VISION_MODELS', 'THICKEN_VISION_KEY']) delete process.env[key]; });

  // Two photos on a brown table, 900 x 1200, the back first (so photo order alone would get them wrong): the back
  // square on, with the red spine beside it (a strip standing in for the angled shot that shows both); then the
  // front, a navy cover shot from low down, its far edge foreshortened (a warp without perspective misses it).
  const back = [[200, 200], [700, 200], [700, 1000], [200, 1000]];
  const spine = [[700, 200], [760, 200], [760, 1000], [700, 1000]];
  const front = [[300, 150], [600, 150], [760, 1000], [140, 1000]];
  const table = () => sharp({ create: { width: 900, height: 1200, channels: 3, background: '#8b5a2b' } });
  const quad = `<svg width="900" height="1200"><polygon points="${front.map((p) => p.join(',')).join(' ')}" fill="#1d2b53"/></svg>`;
  const files = [path.join(folder, 'IMG_1.png'), path.join(folder, 'IMG_2.png'), path.join(folder, 'IMG_3.png')];
  await table().composite([{ input: fixture('book-back.jpg'), left: 200, top: 200 }, {
    input: await sharp({ create: { width: 60, height: 800, channels: 3, background: '#c62828' } }).png().toBuffer(), left: 700, top: 200,
  }]).png().toFile(files[0]);
  await table().composite([{ input: Buffer.from(quad) }]).png().toFile(files[1]);
  // And a green photo no model can answer for (every call fails): used whole, and listed for review.
  await sharp({ create: { width: 500, height: 800, channels: 3, background: '#2e7d32' } }).png().toFile(files[2]);

  // The models see the photo letterboxed into 1000 x 1000: scaled by 5/6 and centered, 125 px in from the left.
  const seen = (corners: number[][], shift = 0) => corners.map(([x, y]) => [125 + (x * 5) / 6 + shift, (y * 5) / 6 + shift]);
  const authorizations: string[] = [];
  const fetch = catalog({ physical_dimensions: '8 x 5 inches', physical_format: 'Hardcover' }, {
    vision: async ({ model, photo, authorization }) => {
      authorizations.push(String(authorization));
      const { data, info } = await sharp(photo).raw().toBuffer({ resolveWithObject: true });
      let [red, green] = [0, 0];
      for (let y = 450; y < 550; y++) {
        for (let x = 450; x < 550; x++) [red, green] = [red + data[(y * info.width + x) * info.channels], green + data[(y * info.width + x) * info.channels + 1]];
      }
      if (green - red > 50 * 10_000) return undefined; // the green photo: every model fails
      const isFront = red / 10_000 < 100; // the middle is navy, not cream
      if (isFront) {
        // a also names a sliver of spine that b, answering, doesn't: left out. Both find a round foil seal on the cover,
        // 10–35% across and 30–45% down it, which on a 5 x 8 in cover is about as tall as it is wide.
        const seal = { face: 'sticker', corners: seen([[0.1, 0.3], [0.35, 0.3], [0.35, 0.45], [0.1, 0.45]].map(mapping([[0, 0], [1, 0], [1, 1], [0, 1]], front))) };
        return model === 'a' ? { faces: [{ face: 'front', corners: seen(front) }, { face: 'spine', corners: seen([[130, 150], [180, 150], [160, 980], [110, 980]]) }, seal], binding: 'paperback' }
          : { faces: [{ face: 'front', corners: seen(front, 1) }, seal], binding: 'paperback' };
      }
      // b has the back's outline but the wrong way up, so c is asked, and agrees with a. All see the spine. And all
      // call the back the front: its ISBN barcode says otherwise, and wins.
      const corners = seen(back, model === 'c' ? 1 : 0);
      return { faces: [{ face: 'front', corners: model === 'b' ? [corners[2], corners[3], corners[0], corners[1]] : corners }, { face: 'spine', corners: seen(spine) }], binding: 'paperback' };
    },
  });
  t.after(() => fetch.mock.restore());
  const { glb, sidecar } = await thicken(files);
  // The catalog lists a hardcover; the models see a paperback: the copy in the photos wins.
  assert.deepEqual([sidecar.binding, sidecar.bindingBy], ['paperback', 'vision']);

  assert.deepEqual((sidecar.pictures as { file: string; face: string; role: string }[]).map(({ file, face, role }) => [file, face, role]),
    [['IMG_1.png', 'back', 'back'], ['IMG_1.png', 'spine', 'spine'], ['IMG_2.png', 'front', 'front'], ['IMG_3.png', undefined, 'unused']]);
  assert.ok(sidecar.review.includes('IMG_3.png (no vision model answered, so it was used whole: run again, or crop it)'));
  const vision = sidecar.vision as { endpoint: string; photos: { faces: { face: string; by: string[]; agreed: boolean }[]; answers: { model: string }[] }[] };
  assert.equal(vision.endpoint, 'vision.test/api/chat/completions');
  // The record keeps what the models said; the barcode decided where it went.
  assert.deepEqual(vision.photos.map(({ faces }) => faces.map(({ face, by, agreed }) => [face, by, agreed])),
    [[['front', ['a', 'c'], true], ['spine', ['a', 'b'], true]], [['front', ['a', 'b'], true], ['sticker', ['a', 'b'], true]], []]);
  // The spine shares its photo with the back, so it's taken as seen at an angle: no thickness from it.
  assert.deepEqual([(sidecar.measuredBy as Record<string, string>).depth, sidecar.depthEstimates], ['default', { photos: undefined, pages: undefined }]);
  assert.deepEqual(vision.photos.map(({ answers }) => answers.map(({ model }) => model)), [['a', 'b', 'c'], ['a', 'b'], ['a', 'b', 'c']]);
  assert.ok(sidecar.review.every((item) => !item.includes('disagree')), 'the dispute was settled');
  assert.ok(authorizations.every((a) => a === 'Bearer secret-key-123') && !JSON.stringify(sidecar).includes('secret-key-123'), 'the key is sent, never recorded');

  // Straightened, the covers carry none of the table; photos are lit, to shade as they turn.
  const doc = await read(glb);
  assert.ok(doc.getRoot().listMaterials().every((material) => !material.getExtension('KHR_materials_unlit')), 'photos are lit');
  assert.ok(near(await colorOf(doc, [0, 0, 1]), '#1d2b53'), 'the front is the navy cover alone');
  assert.ok(Math.min(...await colorOf(doc, [0, 0, -1])) > 180, 'the back is the cream cover alone');
  assert.ok(near(await colorOf(doc, [-1, 0, 0]), '#c62828'), 'the spine is the red strip alone');
  // The seal, placed within the cover however it was shot, and drawn round: foil at its middle, print at its box's corner.
  const seal = sidecar.sticker as Record<string, number | boolean>;
  assert.equal(seal.round, true);
  for (const [key, want] of Object.entries({ x0: 0.1, x1: 0.35, y0: 0.3, y1: 0.45 })) assert.ok(Math.abs((seal[key] as number) - want) < 0.01, `seal ${key} ${seal[key]}`);
  const film = faceOf(doc, [0, 0, 1])!.getMaterial()!.getExtension<Iridescence>('KHR_materials_iridescence');
  const { data, info } = await sharp(film!.getIridescenceTexture()!.getImage()!).raw().toBuffer({ resolveWithObject: true });
  const pixel = (u: number, v: number) => [...data.subarray((Math.round(v * info.height) * info.width + Math.round(u * info.width)) * info.channels).subarray(0, 3)];
  assert.deepEqual([pixel(0.225, 0.375), pixel(0.11, 0.31), pixel(0.6, 0.7)], [[255, 77, 153], [0, 102, 0], [0, 102, 0]]);
});

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

test('card: a raw trading card in uncropped photos, a thin plate with rounded corners; a thick one by its points', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  Object.assign(process.env, { THICKEN_VISION_URL: 'http://vision.test/api', THICKEN_VISION_MODELS: 'a,b,c' });
  t.after(() => { for (const key of ['THICKEN_VISION_URL', 'THICKEN_VISION_MODELS']) delete process.env[key]; });
  // The card's front (green) and back (blue), each lying on a brown table, 900 × 1200 px at 6 px a mm.
  const quad = [[300, 330], [681, 330], [681, 863.4], [300, 863.4]];
  const files = [path.join(folder, 'IMG_1.png'), path.join(folder, 'IMG_2.png')];
  for (const [file, fill] of [[files[0], '#2e7d32'], [files[1], '#1d4f9e']]) {
    const svg = `<svg width="900" height="1200"><polygon points="${quad.map((p) => p.join(',')).join(' ')}" fill="${fill}"/></svg>`;
    await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#8b5a2b' } }).composite([{ input: Buffer.from(svg) }]).png().toFile(file);
  }
  const seen = quad.map(([x, y]) => [125 + (x * 5) / 6, (y * 5) / 6]); // letterboxed into 1000 × 1000
  let corners = (model: string) => 'round'; // what each model says of the card's corners
  const fetch = catalog({}, {
    vision: async ({ model, prompt, photo }) => {
      if (prompt.includes('Which of these is it?')) return { object: 'card', sizeMm: [63, 88, 0.3] };
      const { data, info } = await sharp(photo).raw().toBuffer({ resolveWithObject: true });
      const middle = (500 * info.width + 500) * info.channels; // green in the middle: the front
      return { faces: [{ face: data[middle + 1] > data[middle + 2] ? 'front' : 'back', corners: seen }], corners: corners(model) };
    },
  });
  t.after(() => fetch.mock.restore());

  // A trading-card-game card: clearly rounded corners, 3.2 mm.
  const { glb, sidecar } = await thicken(files);
  assert.deepEqual(pick(sidecar, ['profile', 'widthMm', 'heightMm', 'depthMm', 'corners', 'cornersBy', 'faces', 'review', 'identifiedBy']), {
    profile: 'card', widthMm: 63.5, heightMm: 88.9, depthMm: 0.35, corners: 'round', cornersBy: 'vision',
    faces: { front: 'photo', back: 'photo' }, review: [], identifiedBy: { profile: 'vision' },
  });
  const doc = await read(glb);
  assertExtents(doc, [0.0635, 0.0889, 0.00035]);
  assertClosed(doc, (63.5 * 88.9 - (4 - Math.PI) * 3.2 ** 2) * 0.35, 5e-4);
  // A vintage card, cut square, though b says round: c is asked, the majority says square, and they stay square.
  corners = (model) => (model === 'b' ? 'round' : 'square');
  const vintage = await thicken(files, { profile: 'card' });
  assert.deepEqual([vintage.sidecar.corners, vintage.sidecar.cornersBy], ['square', 'vision']);
  assert.deepEqual((vintage.sidecar.vision as { photos: { answers: { model: string }[] }[] }).photos[0].answers.map(({ model }) => model), ['a', 'b', 'c']);
  assertClosed(await read(vintage.glb), 63.5 * 88.9 * 0.35, 1e-4);
  // A thick patch card, sold as 130 pt: 3.3 mm.
  const thick = await thicken(files, { profile: 'card', pt: 130 });
  assert.deepEqual([thick.sidecar.depthMm, thick.sidecar.pt, (thick.sidecar.measuredBy as { depth: string }).depth], [3.3, 130, 'pt']);
});

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

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

test('card: holofoil as the models see it, a reverse holo shining everywhere but its picture box, as film-coated metal', async (t) => {
  Object.assign(process.env, { THICKEN_VISION_URL: 'http://vision.test/api', THICKEN_VISION_MODELS: 'a,b' });
  t.after(() => { for (const key of ['THICKEN_VISION_URL', 'THICKEN_VISION_MODELS']) delete process.env[key]; });
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  // The card test's card on its table; its picture box 10–90% across and 12–50% down its front.
  const quad = [[300, 330], [681, 330], [681, 863.4], [300, 863.4]];
  const at = (u: number, v: number) => [300 + u * 381, 330 + v * 533.4];
  const box = [at(0.1, 0.12), at(0.9, 0.12), at(0.9, 0.5), at(0.1, 0.5)];
  // The front where the foil caught the light; the back; then the front twice more where it didn't (a white mark on
  // the table tells those apart), as a video's frames are.
  const files = ['IMG_1.png', 'IMG_2.png', 'IMG_3.png', 'IMG_4.png'].map((name) => path.join(folder, name));
  for (const [file, fill, mark] of [[files[0], '#2e7d32', ''], [files[1], '#1d4f9e', ''], [files[2], '#2e7d32', '#fff'], [files[3], '#2e7d32', '#fff']]) {
    const svg = `<svg width="900" height="1200"><rect width="120" height="120" fill="${mark || '#8b5a2b'}"/><polygon points="${quad.map((p) => p.join(',')).join(' ')}" fill="${fill}"/></svg>`;
    await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#8b5a2b' } }).composite([{ input: Buffer.from(svg) }]).png().toFile(file);
  }
  const seen = (corners: number[][]) => corners.map(([x, y]) => [125 + (x * 5) / 6, (y * 5) / 6]);
  let flash = (model: string) => 'reverse'; // what each model says of the front where the foil caught the light
  const fetch = catalog({}, {
    vision: async ({ model, photo }) => {
      const { data, info } = await sharp(photo).raw().toBuffer({ resolveWithObject: true });
      const [middle, corner] = [(500 * info.width + 500) * info.channels, (40 * info.width + 165) * info.channels];
      // On the back, the models see no foil: that says nothing of the front, so it isn't counted.
      if (data[middle + 1] <= data[middle + 2]) return { faces: [{ face: 'back', corners: seen(quad) }], corners: 'round', foil: 'none' };
      if (data[corner + 2] > 200) return { faces: [{ face: 'front', corners: seen(quad) }], corners: 'round', foil: 'none' };
      return { faces: [{ face: 'front', corners: seen(quad) }, { face: 'art', corners: seen(box) }], corners: 'round', foil: flash(model) };
    },
  });
  t.after(() => fetch.mock.restore());
  // Two answers naming the foil outweigh four from frames that missed it.
  const { glb, sidecar } = await thicken(files, { profile: 'card' });
  assert.deepEqual([sidecar.foil, sidecar.foilBy, sidecar.pictureBoxBy, sidecar.warnings], ['reverse', 'vision', 'vision', []]);
  const found = sidecar.pictureBox as Record<string, number>;
  for (const [key, want] of Object.entries({ x0: 0.1, x1: 0.9, y0: 0.12, y1: 0.5 })) assert.ok(Math.abs(found[key] - want) < 0.01, `picture box ${key} ${found[key]}`);

  // The front is film-coated metal everywhere but the picture box; the back, print.
  const doc = await read(glb);
  const material = (name: string) => doc.getRoot().listMaterials().find((m) => m.getName() === name)!;
  const film = material('card-front').getExtension<Iridescence>('KHR_materials_iridescence');
  assert.ok(film, 'the front has a thin film');
  assert.equal(material('card-back').getExtension('KHR_materials_iridescence'), null);
  const { data, info } = await sharp(film.getIridescenceTexture()!.getImage()!).raw().toBuffer({ resolveWithObject: true });
  const pixel = (u: number, v: number) => [...data.subarray((Math.round(v * info.height) * info.width + Math.round(u * info.width)) * info.channels).subarray(0, 3)];
  assert.deepEqual(pixel(0.5, 0.3), [0, 102, 0], 'the picture box: print');
  assert.deepEqual(pixel(0.5, 0.75), [255, 77, 153], 'the rest: film, glossier, partly metal');

  // One model alone seeing foil isn't enough: a plain card stays plain.
  flash = (model) => (model === 'a' ? 'holo' : 'none');
  const plain = await thicken(files, { profile: 'card' });
  assert.deepEqual([plain.sidecar.foil, plain.sidecar.foilBy], ['none', 'vision']);
  assert.equal((await read(plain.glb)).getRoot().listMaterials().find((m) => m.getName() === 'card-front')!.getExtension('KHR_materials_iridescence'), null);
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

test('book: with no barcode, the title and authors the models read find it, with how sure the match is', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  Object.assign(process.env, { THICKEN_VISION_URL: 'http://vision.test/api', THICKEN_VISION_MODELS: 'a,b' });
  t.after(() => { for (const key of ['THICKEN_VISION_URL', 'THICKEN_VISION_MODELS']) delete process.env[key]; });
  // The front cover alone, on a table, no barcode in sight.
  const photo = path.join(folder, 'IMG_1.png');
  await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#8b5a2b' } })
    .composite([{ input: await sharp({ create: { width: 420, height: 640, channels: 3, background: '#1d2b53' } }).png().toBuffer(), left: 240, top: 280 }])
    .png().toFile(photo);
  const front = [[240, 280], [660, 280], [660, 920], [240, 920]].map(([x, y]) => [125 + (x * 5) / 6, (y * 5) / 6]);
  let title = 'THE WORLDS I SEE: CURIOSITY, EXPLORATION, AND DISCOVERY AT THE DAWN OF AI';
  const fetch = catalog({}, {
    // b says what it is, but finds no faces: the front is a's word alone.
    vision: async ({ model, prompt }) => (prompt.includes('Which of these is it?') ? { object: 'book', sizeMm: [140, 210, 25] }
      : model === 'b' ? undefined : { faces: [{ face: 'front', corners: front }], title, authors: ['Dr. Fei-Fei Li'] }),
    // Open Library files it as "Worlds I See", with three editions; only one edition's record gives its pages.
    search: { docs: [{ key: '/works/OL1W', title: 'Worlds I See', subtitle: 'Curiosity, Exploration, and Discovery at the Dawn of AI', author_name: ['Fei-Fei Li'],
      isbn: ['9781250897947', '9781250897930', '9781250898104', '1250898102'] }] },
    records: { 'ISBN:9781250897947': {}, 'ISBN:9781250897930': {}, 'ISBN:9781250898104': { pagination: '336' } },
  });
  t.after(() => fetch.mock.restore());

  const { sidecar } = await thicken([photo]);
  const query = new URL(String(fetch.mock.calls.find((call) => String(call.arguments[0]).includes('search.json'))!.arguments[0])).searchParams;
  assert.deepEqual([query.get('title'), query.get('author')], ['worlds i see', 'li'], 'searched without the article, by surname');
  const match = sidecar.match as { by: string; confidence: number; editions: string[]; isbn?: string; pages: number };
  assert.deepEqual([match.by, match.confidence, match.editions.length, match.isbn, match.pages], ['title', 1, 3, undefined, 336]);
  // Three editions, so no one ISBN; the page count still gives the thickness: 336 x 0.075 mm.
  assert.deepEqual([sidecar.isbn, sidecar.identifiedBy, sidecar.depthMm, (sidecar.measuredBy as Record<string, string>).depth],
    [undefined, { profile: 'vision', isbn: undefined }, 25.2, 'pages']);
  assert.equal((sidecar.catalog as { title: string }).title, 'Worlds I See');
  assert.ok(sidecar.review.every((item) => !item.startsWith('which book')), 'a sure match needs no checking');
  assert.ok(sidecar.review.includes('front in IMG_1.png (only a answered, so no second model checked it: check it)'));

  // A title read slightly wrong is a match to check.
  title = 'Worlds I Saw';
  const second = await thicken([photo]);
  assert.equal((second.sidecar.match as { confidence: number }).confidence, 0.67);
  assert.ok(second.sidecar.review.includes('which book this is (found by its title, 67% sure: check it, or give --isbn)'));
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

test('book: a thick book\'s spine photo still measures it', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const fetch = catalog({ physical_dimensions: '8 x 5 inches' });
  t.after(() => fetch.mock.restore());
  const [spine, front] = [path.join(folder, 'IMG_1.png'), path.join(folder, 'IMG_3.png')];
  await sharp({ create: { width: 280, height: 800, channels: 3, background: '#c62828' } }).png().toFile(spine);
  await sharp({ create: { width: 500, height: 800, channels: 3, background: '#1d2b53' } }).png().toFile(front);
  const { sidecar } = await thicken([spine, fixture('book-back.jpg'), front]);
  // 280/800 of the 203.2 mm height: 71.1 mm, more than half the 127 mm width, as a 950-page paperback is.
  assert.deepEqual([sidecar.depthMm, (sidecar.measuredBy as Record<string, string>).depth], [71.1, 'photos']);
});

test('book: with no barcode and no vision, two covers can\'t be told apart, so the run stops rather than guess; one cover still makes a book', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const files = [path.join(folder, 'IMG_1.png'), path.join(folder, 'IMG_2.png'), path.join(folder, 'IMG_3.png')];
  await sharp({ create: { width: 500, height: 800, channels: 3, background: '#1d2b53' } }).png().toFile(files[0]);
  await sharp({ create: { width: 500, height: 800, channels: 3, background: '#2e7d32' } }).png().toFile(files[1]);
  await sharp({ create: { width: 60, height: 800, channels: 3, background: '#c62828' } }).png().toFile(files[2]);
  // Photo order is no evidence of which cover is the front.
  await assert.rejects(thicken(files, { profile: 'book' }), /a vision roster tells the sides apart/);
  const { sidecar } = await thicken([files[0], files[2]], { profile: 'book' });
  assert.deepEqual((sidecar.pictures as { role: string }[]).map(({ role }) => role), ['front', 'spine']);
  // No ISBN, so the height is a trim size guessed from the cover, and the spine's thickness scales with it:
  // warned, not for review, as the model still shows the book's faces.
  assert.ok(sidecar.warnings.includes('the thickness is from the photos, scaled to a guessed height'));
  assert.ok(sidecar.review.every((item) => !item.includes('thickness') && !item.includes('size')));
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
  // Every face photographed: nothing to review. The thickness estimates disagreeing is only a warning.
  assert.deepEqual(sidecar.review, []);
  assert.ok(sidecar.warnings.includes('the photos say 14 mm thick, the page count 7.5 mm: check the spine photo\'s crop'));
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

// slab.jpg: 296 × 500, a PSA holder's shape, with a QR code to a psacard.com cert on its label.
test('slab: a grader\'s QR code picks the holder, and the holder its size', async () => {
  const { glb, sidecar } = await thicken([fixture('slab.jpg')]);
  assert.deepEqual(pick(sidecar, ['profile', 'sources', 'holder', 'grader', 'cert', 'verifyUrl', 'widthMm', 'heightMm', 'depthMm', 'measuredBy', 'faces', 'review', 'warnings', 'identifiedBy']), {
    profile: 'slab', sources: ['slab.jpg'], holder: 'psa', grader: 'psa', cert: '12345678', verifyUrl: 'https://www.psacard.com/cert/12345678',
    widthMm: 80.5, heightMm: 136, depthMm: 6.5, measuredBy: 'table', faces: { front: 'photo', back: 'color' }, review: ['back (plain color)'],
    warnings: ['the card and label are placed where a psa holder usually has them: with a vision roster they\'re found in the photos'],
    identifiedBy: { profile: 'recognized', grader: 'qr', cert: 'qr' },
  });
  const doc = await read(glb);
  assertExtents(doc, [0.0805, 0.136, 0.0065]);
  // Closed solids, built as a holder is: a rim standing proud of a recessed window, ridges framing the label and
  // the card inside, and the card and label themselves.
  const { card, label } = sidecar.inside as Record<string, { widthMm: number; heightMm: number; placedBy: string }>;
  assert.deepEqual([card.widthMm, card.heightMm, card.placedBy, label.placedBy], [63.5, 88.9, 'layout', 'layout']);
  assertWatertight(doc);
  // The holder is clear: blended, so a page shows through it; its rim and ridges denser, as their edges catch the light.
  const materials = Object.fromEntries(doc.getRoot().listMaterials().map((material) => [material.getName(), material]));
  assert.deepEqual([materials.acrylic.getAlphaMode(), materials.acrylic.getAlpha(), materials['acrylic-edges'].getAlpha()], ['BLEND', 0.12, 0.2]);
  // The window is recessed: the rim alone reaches the holder's full depth.
  const zs = (name: string) => doc.getRoot().listMeshes()[0].listPrimitives().filter((p) => p.getMaterial()?.getName() === name)
    .flatMap((p) => { const positions = p.getAttribute('POSITION')!; return [...Array(positions.getCount()).keys()].map((i) => positions.getElement(i, [0, 0, 0])[2]); });
  assert.deepEqual([Math.max(...zs('acrylic-edges')), Math.max(...zs('acrylic'))].map((z) => Math.round(z * 1e5) / 100), [3.25, 2.75]);
  // The card is cut from the photo (green there), and its back, never photographed, is plain card stock.
  const front = await sharp(materials['card-front'].getBaseColorTexture()!.getImage()!).raw().toBuffer({ resolveWithObject: true });
  const middle = (Math.floor(front.info.height / 2) * front.info.width + Math.floor(front.info.width / 2)) * front.info.channels;
  assert.ok(front.data[middle + 1] > 2 * front.data[middle], 'the card plate shows the green card');
  assert.equal(materials['card-back'].getBaseColorTexture(), null);
});

// A slab lying on a brown table, photographed at 5 px a mm (900 × 1200): its parts as rectangles in mm from its top
// left; and the same rectangles' corners as the vision models see them, letterboxed into 1000 × 1000.
const onTable = (x: number, y: number) => [250 + x * 5, 260 + y * 5];
const quadOf = ([x0, y0, x1, y1]: number[]) => [onTable(x0, y0), onTable(x1, y0), onTable(x1, y1), onTable(x0, y1)];
const letterboxed = (rect: number[]) => quadOf(rect).map(([x, y]) => [125 + (x * 5) / 6, (y * 5) / 6]);
async function slabPhoto(file: string, rects: [number[], string][]) {
  const svg = `<svg width="900" height="1200">${rects.map(([rect, fill]) => `<polygon points="${quadOf(rect).map((p) => p.join(',')).join(' ')}" fill="${fill}"/>`).join('')}</svg>`;
  await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#8b5a2b' } }).composite([{ input: Buffer.from(svg) }]).png().toFile(file);
}

test('slab: with vision, the card and label are found in uncropped photos and set inside the clear holder', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  Object.assign(process.env, { THICKEN_VISION_URL: 'http://vision.test/api', THICKEN_VISION_MODELS: 'a,b,c' });
  t.after(() => { for (const key of ['THICKEN_VISION_URL', 'THICKEN_VISION_MODELS']) delete process.env[key]; });
  // A PSA slab (80.5 × 136 mm): its label across the top, and a green card a little lower than the usual layout has it
  // (its top 33 mm down, where the layout says 32.3), measuring a little big, 64.3 × 89.6 mm: near enough standard to be
  // taken for it. Its back the same, the card's back blue.
  const [slab, label, card] = [[0, 0, 80.5, 136], [4, 4.5, 76.5, 26.3], [8.1, 33, 72.4, 122.6]];
  const hologram = [6, 8, 26, 22]; // on the back of the label, at its left as the back is seen
  const [front, back] = [path.join(folder, 'IMG_1.png'), path.join(folder, 'IMG_2.png')];
  await slabPhoto(front, [[slab, '#c8ccd0'], [label, '#f8f8f8'], [card, '#2e7d32']]);
  await slabPhoto(back, [[slab, '#c8ccd0'], [label, '#f8f8f8'], [hologram, '#d0d0d8'], [card, '#1d4f9e']]);
  const fetch = catalog({}, {
    vision: async ({ model, photo }) => {
      const { data, info } = await sharp(photo).raw().toBuffer({ resolveWithObject: true });
      const middle = (500 * info.width + 500) * info.channels; // the card's middle: green on the front
      // As with real slabs, b calls the back the front: same place, another name, so c is asked, and agrees with a.
      const green = data[middle + 1] > data[middle + 2];
      const side = green || model === 'b' ? 'front' : 'back';
      // The card shines all over (a refractor); the label's back has a hologram. b, calling the back the front, says
      // the card shines there too: that photo isn't of the front, as settled, so it isn't counted.
      const faces = [{ face: side, corners: letterboxed(slab) }, { face: 'card', corners: letterboxed(card) }, { face: 'label', corners: letterboxed(label) }];
      return { faces: green ? faces : [...faces, { face: 'hologram', corners: letterboxed(hologram) }], foil: side === 'front' ? 'full' : 'none' };
    },
  });
  t.after(() => fetch.mock.restore());

  const { glb, sidecar } = await thicken([front, back], { profile: 'slab' });
  assert.deepEqual((sidecar.pictures as { file: string; role: string }[]).map(({ file, role }) => [file, role]), [['IMG_1.png', 'front'], ['IMG_2.png', 'back']]);
  const photos = (sidecar.vision as { photos: { faces: { face: string; by: string[]; agreed: boolean }[] }[] }).photos;
  assert.deepEqual(photos[1].faces.find(({ face }) => face === 'back'), { ...photos[1].faces.find(({ face }) => face === 'back'), by: ['a', 'c'], agreed: true });
  assert.ok(sidecar.review.every((item) => !item.includes('disagree')), 'the name was settled');
  // Found, not laid out: the card where it really is, at the standard size, and the label above it.
  const inside = sidecar.inside as Record<string, { widthMm: number; heightMm: number; atMm: number[]; placedBy: string }>;
  assert.deepEqual([inside.card.placedBy, inside.card.widthMm, inside.card.heightMm, inside.label.placedBy], ['vision', 63.5, 88.9, 'vision']);
  assert.ok(Math.abs(inside.card.atMm[0]) <= 0.2 && Math.abs(inside.card.atMm[1] - (68 - 77.8)) <= 0.2, `card at ${inside.card.atMm}`);
  assert.ok(Math.abs(inside.label.widthMm - 72.5) <= 0.3 && Math.abs(inside.label.heightMm - 21.8) <= 0.3, `label ${inside.label.widthMm} × ${inside.label.heightMm}`);
  assert.ok(sidecar.review.every((item) => !item.includes('didn\'t find')), 'nothing laid out by guess');
  // Each picture is its part alone: no table, no clear border.
  const doc = await read(glb);
  const materials = Object.fromEntries(doc.getRoot().listMaterials().map((material) => [material.getName(), material]));
  const share = async (name: string, wanted: (r: number, g: number, b: number) => boolean) => {
    const { data, info } = await sharp(materials[name].getBaseColorTexture()!.getImage()!).raw().toBuffer({ resolveWithObject: true });
    let hits = 0;
    for (let i = 0; i < data.length; i += info.channels) if (wanted(data[i], data[i + 1], data[i + 2])) hits++;
    return hits / (data.length / info.channels);
  };
  assert.ok(await share('card-front', (r, g, b) => g > 100 && r < 80 && b < 80) > 0.95, 'the card alone');
  assert.ok(await share('card-back', (r, g, b) => b > 120 && r < 80 && g < 110) > 0.95, 'the card\'s back alone');
  assert.ok(await share('label-front', (r, g, b) => Math.min(r, g, b) > 230) > 0.95, 'the label alone');
  // The card's foil on its front only; the hologram on the label's back, where it was found within it.
  assert.deepEqual([(inside.card as unknown as { foil: string }).foil, (inside.card as unknown as { foilBy: string }).foilBy], ['full', 'vision']);
  const film = (name: string) => materials[name].getExtension<Iridescence>('KHR_materials_iridescence');
  assert.deepEqual(['card-front', 'card-back', 'label-front', 'label-back'].map((name) => Boolean(film(name))), [true, false, false, true]);
  const held = (inside.label as unknown as { hologram: Record<string, Record<string, number>> }).hologram.back;
  for (const [key, want] of Object.entries({ x0: 2 / 72.5, x1: 22 / 72.5, y0: 3.5 / 21.8, y1: 17.5 / 21.8 })) assert.ok(Math.abs(held[key] - want) < 0.03, `hologram ${key} ${held[key]}`);
  const { data, info } = await sharp(film('label-back')!.getIridescenceTexture()!.getImage()!).raw().toBuffer({ resolveWithObject: true });
  const pixel = (u: number, v: number) => [...data.subarray((Math.round(v * info.height) * info.width + Math.round(u * info.width)) * info.channels).subarray(0, 3)];
  assert.deepEqual([pixel(0.15, 0.5), pixel(0.7, 0.5)], [[255, 77, 153], [0, 102, 0]], 'foil on the hologram, print beside it');
  assertWatertight(doc);
});

test('slab: a tall holder is told by its label, the same size on every holder but spanning much less of a tall one', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  Object.assign(process.env, { THICKEN_VISION_URL: 'http://vision.test/api', THICKEN_VISION_MODELS: 'a,b' });
  t.after(() => { for (const key of ['THICKEN_VISION_URL', 'THICKEN_VISION_MODELS']) delete process.env[key]; });
  const [slab, label, card] = [[0, 0, 80.5, 136], [15.25, 4.5, 65.25, 20], [12, 30, 68.5, 125]]; // the label spans 62%
  const photo = path.join(folder, 'IMG_1.png');
  await slabPhoto(photo, [[slab, '#c8ccd0'], [label, '#f8f8f8'], [card, '#2e7d32']]);
  const fetch = catalog({}, {
    vision: async () => ({ faces: [{ face: 'front', corners: letterboxed(slab) }, { face: 'card', corners: letterboxed(card) }, { face: 'label', corners: letterboxed(label) }] }),
  });
  t.after(() => fetch.mock.restore());
  const { sidecar } = await thicken([photo], { profile: 'slab' });
  assert.deepEqual([sidecar.holder, sidecar.widthMm, sidecar.heightMm], ['psa-tall', 108, 184]);
  assert.ok(sidecar.warnings.some((w) => w.startsWith('taken for a tall holder (psa-tall): its label spans 62% of its width')), String(sidecar.warnings));
  // A holder named is the holder made.
  assert.equal((await thicken([photo], { profile: 'slab', holder: 'psa' })).sidecar.holder, 'psa');
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

test('slab: a label\'s codes say what it is, not which side a photo shows: without vision, two photos stop the run', async (t) => {
  // Which side a grader prints its QR code on changes with label designs (current PSA and CGC labels: the back), and
  // photo order is no evidence either: the vision models tell the sides apart.
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const plain = path.join(folder, 'IMG_1.png');
  await sharp({ create: { width: 296, height: 500, channels: 3, background: '#c8ccd0' } }).png().toFile(plain);
  await assert.rejects(thicken([fixture('slab.jpg'), plain]), /a vision roster tells the sides apart/);
  await assert.rejects(thicken([plain, fixture('slab.jpg')]), /a vision roster tells the sides apart/);
});

// slab-barcode.jpg: the same holder shape, but an older label with only a Code 128 cert barcode (BGS-style 0017041720).
test('slab: a cert barcode on a holder-shaped photo is a slab, of a grader it says it can\'t name', async (t) => {
  const { sidecar } = await thicken([fixture('slab-barcode.jpg')]);
  assert.deepEqual([sidecar.profile, sidecar.holder, sidecar.cert, sidecar.grader], ['slab', 'psa', '0017041720', undefined]);
  assert.ok(sidecar.warnings.some((warning) => warning.startsWith('a PSA-size holder is assumed')));
  assert.deepEqual(sidecar.identifiedBy, { profile: 'recognized', grader: 'assumed', cert: 'barcode' });

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

/**
 * Stand-in catalogs: Open Library knows one edition (and maybe its cover and catalog record), Google Books is out of
 * quota. With `vision`, also a stand-in vision endpoint at http://vision.test/api, answering for each model and photo.
 */
function catalog(edition: object, { cover, data, search, records, loc, vision }: {
  cover?: Uint8Array; data?: object; search?: object; records?: object; loc?: string;
  vision?: (request: { model: string; prompt: string; photo: Buffer; authorization: string | null }) => Promise<object | undefined>;
} = {}) {
  return mock.method(globalThis, 'fetch', async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    if (vision && href === 'http://vision.test/api/chat/completions') {
      const { model, messages } = JSON.parse(String(init!.body));
      const photo = Buffer.from(messages[0].content[1].image_url.url.split(',')[1], 'base64');
      const answer = await vision({ model, prompt: messages[0].content[0].text, photo, authorization: new Headers(init!.headers).get('authorization') });
      return answer ? Response.json({ choices: [{ message: { content: JSON.stringify(answer) } }] }) : new Response('', { status: 500 });
    }
    if (href === 'https://openlibrary.org/isbn/9780140328721.json') return Response.json(edition);
    if (data && href.startsWith('https://openlibrary.org/api/books?bibkeys=ISBN:9780140328721')) return Response.json({ 'ISBN:9780140328721': data });
    if (search && href.startsWith('https://openlibrary.org/search.json?')) return Response.json(search);
    if (records && href.startsWith('https://openlibrary.org/api/books?bibkeys=')) return Response.json(records);
    if (cover && href.startsWith('https://covers.openlibrary.org/b/isbn/9780140328721-L.jpg')) return new Response(new Uint8Array(cover));
    if (href.startsWith('https://www.googleapis.com/')) return new Response('{}', { status: 429 });
    if (loc && href.startsWith('https://lx2.loc.gov/sru/lcdb?') && href.includes('bath.isbn=9780140328721')) return new Response(loc);
    return new Response('', { status: 404 });
  });
}

/**
 * The pictured primitive of the face with this outward normal: its normals, averaged (a rounded face's lean off it
 * at the edges). Plain-colored parts are passed over: a hardcover board's edges, together, can average to a cover's.
 */
function faceOf(doc: Document, normal: number[]): Primitive | undefined {
  return doc.getRoot().listMeshes()[0].listPrimitives().find((primitive) => {
    if (!primitive.getMaterial()?.getBaseColorTexture()) return false;
    const normals = primitive.getAttribute('NORMAL')!;
    const sum = [0, 0, 0];
    for (let i = 0; i < normals.getCount(); i++) normals.getElement(i, [0, 0, 0]).forEach((c, k) => { sum[k] += c; });
    const length = Math.hypot(...sum);
    return length > 0 && sum.every((c, k) => Math.abs(c / length - normal[k]) < 0.01);
  });
}

/** The picture on the face with this outward normal. */
function pictureOn(doc: Document, normal: number[]): Uint8Array {
  const image = faceOf(doc, normal)?.getMaterial()?.getBaseColorTexture()?.getImage();
  if (!image) throw new Error(`no picture on the face with normal ${normal}`);
  return image;
}

/** Mean color [r, g, b] (0–255) of the picture on the face with this outward normal. */
async function colorOf(doc: Document, normal: number[]): Promise<number[]> {
  const { channels } = await sharp(pictureOn(doc, normal)).stats();
  return channels.slice(0, 3).map((channel) => channel.mean);
}

/** Within JPEG's wobble of a #rrggbb color. */
const near = (color: number[], hex: string) => color.every((c, i) => Math.abs(c - parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16)) < 12);

const read = (glb: Uint8Array) => new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(glb);
const pick = (object: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((key) => [key, object[key]]));

function assertExtents(doc: Document, meters: number[]) {
  const { min, max } = getBounds(doc.getRoot().getDefaultScene()!);
  meters.forEach((size, i) => assert.ok(Math.abs(max[i] - min[i] - size) < 1e-6, `extent ${i}: ${max[i] - min[i]} m`));
}

/**
 * Closed and wound outward everywhere: the divergence-theorem volume is the solid's. A missing, flipped or
 * inward face is off by far more than `tolerance`, the share left for rounded edges, which are polygons a
 * hair inside the true curve (on a thin slab, about 2e-4 of its volume).
 */
function assertClosed(doc: Document, mm3: number, tolerance = 1e-4) {
  let volume = 0;
  for (const primitive of doc.getRoot().listMeshes()[0].listPrimitives()) {
    for (const [a, b, c] of triangles(primitive)) {
      volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
  }
  assert.ok(Math.abs(volume * 1e9 - mm3) < mm3 * tolerance, `volume ${volume * 1e9} mm³, expected ${mm3}`);
}

/** Closed surfaces, however many: across every primitive, each edge (by position) walked once each way. */
function assertWatertight(doc: Document) {
  const walked = new Map<string, number>();
  const key = (p: number[]) => p.map((c) => Math.round(c * 1e6)).join(',');
  for (const primitive of doc.getRoot().listMeshes()[0].listPrimitives()) {
    for (const [a, b, c] of triangles(primitive)) {
      for (const [p, q] of [[a, b], [b, c], [c, a]]) {
        if (key(p) !== key(q)) walked.set(`${key(p)} ${key(q)}`, (walked.get(`${key(p)} ${key(q)}`) ?? 0) + 1);
      }
    }
  }
  for (const [edge, n] of walked) {
    const [p, q] = edge.split(' ');
    assert.equal(walked.get(`${q} ${p}`) ?? 0, n, `open edge ${edge}`);
  }
}

/** A W × H × D mm box's volume in mm³ with its edges and corners rounded to r: the shrunk box swept by a ball (Steiner's formula). */
function roundedVolume([w, h, d]: number[], r: number): number {
  const [a, b, c] = [w - 2 * r, h - 2 * r, d - 2 * r];
  return a * b * c + 2 * r * (a * b + b * c + c * a) + Math.PI * r * r * (a + b + c) + (4 / 3) * Math.PI * r ** 3;
}

/** Signs of the position whose UV is (0, 0) on the textured face with this normal. */
function cornerAt(doc: Document, normal: number[]): number[] {
  const face = faceOf(doc, normal);
  const uv = face?.getAttribute('TEXCOORD_0');
  for (let i = 0; uv && i < uv.getCount(); i++) {
    const [u, v] = uv.getElement(i, [0, 0]);
    if (u === 0 && v === 0) return face!.getAttribute('POSITION')!.getElement(i, [0, 0, 0]).map(Math.sign);
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
