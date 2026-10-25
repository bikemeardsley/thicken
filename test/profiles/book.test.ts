import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { type Iridescence } from '@gltf-transform/extensions';
import sharp, { type Sharp } from 'sharp';
import { cut } from '../../src/faces.ts';
import { mapping } from '../../src/image.ts';
import { NO_VISION, thicken } from '../../src/thicken.ts';
import { fixture, letterboxed, catalog, faceOf, pictureOn, colorOf, near, read, pick, assertExtents, assertClosed, roundedVolume, cornerAt } from '../helpers.ts';

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
    review: ['spine (plain color)', NO_VISION], warnings: [], identifiedBy: { profile: 'recognized', isbn: 'barcode' },
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

test('book: an ISBN alone, no photo, is a book with Open Library\'s cover', async (t) => {
  const cover = await sharp({ create: { width: 500, height: 800, channels: 3, background: '#1d2b53' } }).jpeg().toBuffer();
  const fetch = catalog({ physical_dimensions: '8 x 5 x 1 inches' }, { cover });
  t.after(() => fetch.mock.restore());
  const { sidecar } = await thicken([], { isbn: '9780140328721' });
  assert.deepEqual([sidecar.isbn, sidecar.faces?.front, sidecar.widthMm, sidecar.heightMm], ['9780140328721', 'openlibrary', 127, 203.2]);
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
  assert.deepEqual([sidecar.review, sidecar.warnings], [[NO_VISION], ['1 picture(s) not used: none looked like another shot of a face', 'www.googleapis.com answered 429']]);
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
    [[['front', ['a', 'c'], true], ['spine', ['a', 'b', 'c'], true]], [['front', ['a', 'b'], true], ['sticker', ['a', 'b'], true]], []]);
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
  const fetch = catalog({ physical_dimensions: '8 x 5 inches', works: [{ key: '/works/OL45804W' }], languages: [{ key: '/languages/eng' }] }, {
    data: {
      title: 'Fantastic Mr Fox', authors: [{ name: 'Roald Dahl' }], publishers: [{ name: 'Puffin' }], publish_date: '1988', number_of_pages: 100,
      subject_people: [{ name: 'Mr. Fox' }], identifiers: { goodreads: ['6693'] },
      excerpts: [{ text: 'Down in the valley there were three farms.', first_sentence: true }],
    },
    search: { docs: [{ key: '/works/OL45804W', first_publish_year: 1970, edition_count: 99 }] },
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
  // Every face photographed: nothing to review but the missing vision. The thickness estimates disagreeing is only a warning.
  assert.deepEqual(sidecar.review, [NO_VISION]);
  assert.ok(sidecar.warnings.includes('the photos say 14 mm thick, the page count 7.5 mm: check the spine photo\'s crop'));
  assert.deepEqual(pick(sidecar.catalog as Record<string, unknown>, ['title', 'authors', 'publishers', 'publishDate']),
    { title: 'Fantastic Mr Fox', authors: ['Roald Dahl'], publishers: ['Puffin'], publishDate: '1988' });
  // The edition's work, when it was first published and in what language, and every id, but nobody's prose.
  assert.deepEqual(pick(sidecar.catalog as Record<string, unknown>, ['work', 'firstPublished', 'editionCount', 'languages', 'subjectPeople', 'identifiers']), {
    work: 'https://openlibrary.org/works/OL45804W', firstPublished: 1970, editionCount: 99, languages: ['eng'], subjectPeople: ['Mr. Fox'], identifiers: { goodreads: ['6693'] },
  });

  // Every code is listed, but only the one used keeps its text; GPS is never recorded.
  assert.deepEqual(sidecar.codes, [{ picture: 0, format: 'QRCode' }, { picture: 2, format: 'EAN13', use: 'isbn', text: '9780140328721' }]);
  const text = JSON.stringify(sidecar);
  assert.ok(!text.includes('hunter2') && !text.includes('GPS'), 'nothing private in the sidecar');
  assert.ok(!text.includes('three farms'), 'no excerpt of the book in the sidecar');
  assert.ok((sidecar.lookups as { host: string; status: number }[]).some(({ host, status }) => host === 'openlibrary.org' && status === 200));

  const doc = await read(glb);
  assert.ok(near(await colorOf(doc, [-1, 0, 0]), '#c62828'), 'spine photo on the spine');
  assert.ok(near(await colorOf(doc, [1, 0, 0]), '#355587'), 'page-edge photo on the page edge');
  assert.ok(near(await colorOf(doc, [0, 1, 0]), '#e8dcc0'), 'top photo on the top');
});
