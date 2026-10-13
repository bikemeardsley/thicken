// The book profile: the book at its real size, its six faces from any number
// of photos (src/faces.ts): front, back, spine, top, bottom and the page edge,
// with plain colors for faces not photographed. A paperback is a box; a
// hardcover is built as one is, boards standing past a page block set back
// inside them. Each dimension comes from the first source that knows it, and
// the sidecar says which: measured (--size), Open Library, Google Books
// (keyless quota is shared and often spent; set GOOGLE_BOOKS_API_KEY), the
// Library of Congress (height and page count), the cover's shape, a standard
// trim size, then for thickness the spine and page-edge photos and the page
// count. With an ISBN the sidecar also gets Open Library's catalog record.
import { Document, type Material } from '@gltf-transform/core';
import sharp from 'sharp';
import { assignFaces, cut, pictureRecord, shots, sidesUnknown } from '../faces.ts';
import { foilMap, regionIn, rounded } from '../foil.ts';
import { addPart, box, roundedBox, sideMaterial, toGlb, type Face, type Side } from '../glb.ts';
import { load, texture, turned, type Picture } from '../image.ts';
import type { Code, Faces, Profile } from '../thicken.ts';
import { pooled, readOf, type Sight } from '../vision.ts';

export const book: Profile = {
  name: 'book',
  about: 'a book, hardcover or paperback',
  input: 'Front cover, back, spine and page sides, in any order and any of them; or just an ISBN',
  makes: 'The book at its real size, from its ISBN\'s catalog record: a paperback softly rounded, a hardcover with boards standing past its pages',
  faces: {
    front: 'front cover', back: 'back cover', spine: 'spine', edge: 'the page edge opposite the spine', top: 'top', bottom: 'bottom',
    sticker: 'a shiny foil sticker or seal on the front cover (gold, silver or holographic: an award seal, a signed-copy sticker), if there is one',
  },
  note: 'The book stands on its bottom edge, front cover toward you, its spine and page edge each seen from its own side with the top of the book up. A sticker is part of the front cover: give its corners in the cover\'s own order.',
  unsnapped: ['sticker'],
  reads: {
    title: 'its title', subtitle: 'its subtitle', authors: ['its authors'], series: 'the series and its number in it ("Discworld 12")',
    publisher: 'the publisher or imprint', edition: 'any edition or printing it names ("First edition", "Movie tie-in")',
  },
  asks: { binding: 'is it a "hardcover" (stiff boards that stand a little past the pages at the top, bottom and page edge, with a dust jacket or without) or a "paperback" (a soft cover flush with its pages)?' },
  // An ISBN barcode (EAN-13 starting 978 or 979) says it's a book, which, and which photos show its back.
  read: (scanned) => {
    const use = scanned.map(({ format, text }) => (format === 'EAN13' && /^97[89]/.test(text) ? 'isbn' : undefined));
    const at = use.indexOf('isbn');
    return { recognized: at >= 0, use, isbn: at >= 0 ? scanned[at].text : undefined };
  },
  build: async (pictures, { options, facts, codes, sights }) => {
    const isbn = options.isbn ? checkIsbn(options.isbn) : (facts.isbn as string | undefined);
    const { glb, sidecar } = await make(pictures, { isbn, sizeMm: options.sizeMm, codes, sights });
    const by = options.isbn ? 'given' : isbn ? 'barcode' : sidecar.match?.isbn ? 'title' : undefined;
    return { glb, sidecar: { ...sidecar, identifiedBy: { isbn: by } } };
  },
};

function checkIsbn(text: string): string {
  const isbn = text.replace(/[\s-]/g, '').toUpperCase();
  if (!/^(\d{9}[\dX]|\d{13})$/.test(isbn)) throw new Error(`not an ISBN: ${text}`);
  return isbn;
}

const PAGE_MM = 0.075; // per page: trade paper runs 300–400 pages to the inch
const BOARDS_MM = 4; // a hardcover's two boards
// ponytail: a hardcover's build, by the bookbinding rule of thumb; measure a few real books and correct it.
const BOARD_MM = BOARDS_MM / 2; // each board, with its cloth and any jacket; the spine the same
const SQUARE_MM = 3; // how far the boards stand past the pages at the top, bottom and page edge: about 1/8 in
const DEFAULT_DEPTH_MM = 20;
const TRIMS_IN = [[4.25, 6.87], [5, 8], [5.5, 8.5], [6, 9], [7, 10], [8.5, 11], [8.5, 8.5]]; // width × height
const CREAM = [0xef, 0xe6, 0xd2]; // page color
const ROUNDED_MM = 1; // a paperback's soft edges
const ESTIMATES_DISAGREE = 0.35; // photos against page count: beyond this, one of them is wrong
const LOOKUP_TIMEOUT_MS = 10_000;
const SURE = 0.8; // a title match this close, by the same author, needs no checking
const LIKELY = 0.5; // below this, a title match is no match
const ARTICLES = new Set(['the', 'a', 'an']); // catalogs file "The Worlds I See" as "Worlds I See"

type Dims = { width?: number; height?: number; depth?: number }; // mm
/** A network lookup, for the sidecar: host and path, never the query (it may hold an API key). */
export interface Lookup { host: string; path: string; status: number | 'unreachable'; ms: number }
interface Log { warnings: string[]; lookups: Lookup[] }

/**
 * Pictures in any number and order (src/faces.ts), with what the vision models
 * saw in each (`sights`), if asked. A whole photo showing the ISBN barcode is
 * the back. With no front, Open Library's cover stands in, so a photo of the
 * back is enough to start. With no ISBN, the book is looked for by the title
 * and authors the models read.
 */
async function make(
  pictures: Picture[],
  { isbn: known, sizeMm = [], codes = [], sights }: { isbn?: string; sizeMm?: number[]; codes?: Code[]; sights?: Sight[] } = {},
) {
  const log: Log = { warnings: [], lookups: [] };
  const review: string[] = [];
  // No ISBN: the book found by the title and authors the vision models read, with how sure the match is.
  const { read: printed } = readOf(sights);
  const title = [printed.title, printed.subtitle].filter(Boolean).join(': ');
  const read = title ? { title, authors: [printed.authors ?? []].flat() } : undefined;
  const match = !known && read ? await byTitle(read.title, read.authors, log) : undefined;
  if (match && match.confidence < SURE) review.push(`which book this is (found by its title, ${Math.round(match.confidence * 100)}% sure: check it, or give --isbn)`);
  if (read && !known && !match) log.warnings.push(`no book in Open Library close to the title read, "${read.title}"`);
  const isbn = known ?? match?.isbn;
  const proofs = codes.filter(({ use }) => use === 'isbn').map(({ picture, at = [] }) => ({ picture, face: 'back', at }));
  // A foil sticker is kept apart from the book's sides, which are what's cut out.
  const { parts, placed } = cut(pictures, sights?.map((sight) => ({ ...sight, faces: sight.faces.filter(({ face }) => face !== 'sticker') })), proofs);
  const all = await shots(parts);
  const { chosen, roles, undecided } = assignFaces(all, ['front', 'back', 'spine', 'top', 'bottom', 'edge'], { placed, byShape: true });
  if (undecided) throw sidesUnknown(Boolean(sights));
  const photo = (face: string) => (chosen[face] === undefined ? undefined : all[chosen[face]].texture);
  // Narrow photos turned to run along their faces, as if the book lay face up: then the book's top is at a
  // lying spine's left (turned clockwise to stand it up) and at a lying page edge's right (counterclockwise).
  const along = (face: string, tall: boolean, clockwise = true) => { const t = photo(face); return t && (t.width < t.height) !== tall ? turned(t, clockwise) : t; };
  const [spine, edge, top, bottom] = await Promise.all([along('spine', true), along('edge', true, false), along('top', false), along('bottom', false)]);
  const back = photo('back');
  let front = photo('front');
  const unused = roles.filter((role) => role === 'unused').length;
  if (unused) log.warnings.push(`${unused} picture(s) not used: none looked like another shot of a face`);
  const faces: Faces = {
    front: front ? 'photo' : 'openlibrary', back: back ? 'photo' : 'color', spine: spine ? 'photo' : 'color',
    top: top ? 'photo' : 'pages', bottom: bottom ? 'photo' : 'pages', edge: edge ? 'photo' : 'pages',
  };
  const coverUrl = !front && isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg` : undefined;
  if (!front) {
    const cover = coverUrl && await fetchBytes(`${coverUrl}?default=false`, log);
    if (!cover) throw new Error(isbn ? `no front cover: photograph it (Open Library has none for ISBN ${isbn})` : 'a book needs a cover photo or an ISBN');
    front = await texture((await load(cover, 'openlibrary-cover.jpg'))[0]);
  }
  const aspect = front.width / front.height;

  const size: Dims = {};
  const measuredBy: Record<string, string> = {};
  const take = (source: string, found: Dims) => {
    for (const key of ['width', 'height', 'depth'] as const) {
      const mm = found[key];
      if (size[key] === undefined && mm !== undefined && mm > 0) { size[key] = mm; measuredBy[key] = source; }
    }
  };
  const missing = () => !(size.width && size.height && size.depth);

  take('measured', { width: sizeMm[0], height: sizeMm[1], depth: sizeMm[2] });
  let pages: number | undefined;
  let format: string | undefined; // as the catalog lists the edition: "Hardcover", "Paperback"…
  let catalog: Record<string, unknown> | undefined;
  if (isbn) {
    // The catalog record, whatever the size sources: everything Open Library knows of the edition and its work, for
    // the sidecar, and its size and format.
    const data = (await fetchJson(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`, log))?.[`ISBN:${isbn}`];
    const edition = await fetchJson(`https://openlibrary.org/isbn/${isbn}.json`, log);
    const work = (await fetchJson(`https://openlibrary.org/search.json?q=isbn:${isbn}&fields=key,first_publish_year,edition_count&limit=1`, log))?.docs?.[0];
    catalog = data && catalogRecord(data, edition, work);
    take('openlibrary', orient(parseDims(edition?.physical_dimensions), aspect));
    pages = positive(data?.number_of_pages) ?? paginated(data?.pagination) ?? positive(edition?.number_of_pages) ?? paginated(edition?.pagination);
    format = edition?.physical_format;
  }
  pages ??= match?.pages;
  catalog ??= match && { title: match.title, authors: match.authors, openLibrary: match.openLibrary, editions: match.editions };
  if (isbn && missing()) {
    // The Library of Congress catalog: free, no key, and on 15 books tried (2026-10-03) the height for 10 where Open
    // Library had 4, so asked second. It describes a book as "177 p. ; 20 cm." (MARC field 300): the page count and
    // height, which catalogers round up to the next centimeter, so taken as the middle of that one. Its ISBN field's
    // note ("hardback", "pbk.") says the binding, and was right in all 8 that had one. A record is used only if it
    // lists the ISBN as its own (not just cites it) and, when the title is known, has it too: of the 15, one was
    // another book that carried the ISBN by mistake. ponytail: one other gave the hardcover's height for a paperback.
    const marc = (await fetchBytes(`https://lx2.loc.gov/sru/lcdb?version=1.1&operation=searchRetrieve&query=bath.isbn=${isbn}&maximumRecords=1&recordSchema=marcxml`, log))?.toString('utf8') ?? '';
    const field = (tag: string) => [...marc.matchAll(new RegExp(`<datafield tag="${tag}"[\\s\\S]*?</datafield>`, 'g'))].map(([text]) => text);
    const subfield = (text: string | undefined, code: string) => text?.match(new RegExp(`<subfield code="${code}">([^<]*)<`))?.[1];
    // The ISBN in either form: a 978 ISBN's middle nine digits are its ISBN-10's first nine.
    const core = isbn.length === 10 ? isbn.slice(0, 9) : isbn.startsWith('978') ? isbn.slice(3, 12) : isbn;
    const own = field('020').find((text) => subfield(text, 'a')?.replace(/[\s-]/g, '').includes(core));
    const title = subfield(field('245')[0], 'a')?.replace(/[\s/:;,.]+$/, '');
    const known = (catalog?.title as string | undefined) ?? read?.title;
    if (own && title && known && dice(words(title), words(known)) < LIKELY) {
      log.warnings.push(`the Library of Congress's record for ISBN ${isbn} is another book ("${title}"): not used`);
    } else if (own) {
      const extent = field('300')[0];
      // The height in centimeters ("24 x 30 cm" is height by width, for a book wider than tall); old records can give inches.
      const cm = Number(subfield(extent, 'c')?.match(/(\d+)(?:\s*x\s*\d+)?\s*cm/)?.[1]);
      take('loc', { height: cm > 1 ? (cm - 0.5) * 10 : undefined });
      pages ??= paginated(subfield(extent, 'a'));
      format ??= own.replace(/<[^>]+>/g, ' '); // the whole field: older records note the binding beside the ISBN, "(hardcover)"
    }
  }
  if (isbn && missing()) {
    const key = process.env.GOOGLE_BOOKS_API_KEY;
    const search = await fetchJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}${key ? `&key=${key}` : ''}`, log);
    const id = search?.items?.[0]?.id;
    const volume = id && await fetchJson(`https://www.googleapis.com/books/v1/volumes/${id}${key ? `?key=${key}` : ''}`, log);
    const { width, height, thickness } = volume?.volumeInfo?.dimensions ?? {};
    take('googlebooks', { width: parseDims(width)[0], height: parseDims(height)[0], depth: parseDims(thickness)[0] });
    pages ??= positive(volume?.volumeInfo?.pageCount);
  }
  // The cover's shape gives one side from the other; with neither, guess the nearest standard trim size.
  if (size.width && !size.height) take('cover', { height: size.width / aspect });
  if (size.height && !size.width) take('cover', { width: size.height * aspect });
  if (!size.width && !size.height) {
    const [width, height] = nearestTrim(aspect);
    take('trim', { width: width * 25.4, height: height * 25.4 });
    log.warnings.push('the size is a standard trim size guessed from the cover\'s shape: --size for the real one');
  }

  // Hardcover or paperback: as the models see this copy, else as the catalog lists the edition, else a paperback.
  const seen = pooled(sights, 'binding', ['hardcover', 'paperback']);
  // "paper" alone is no binding: catalogers note acid-free paper as "(alk. paper)", hardcovers included.
  const listed = /hard|hbk|cloth|library|leather|case ?(bound|wrap)/i.test(format ?? '') ? 'hardcover'
    : /paperback|pbk|soft|perfect/i.test(format ?? '') ? 'paperback' : undefined;
  const binding = seen ?? listed ?? 'paperback';
  const hardcover = binding === 'hardcover';

  // Thickness from spine and page-edge photos shot square on (thickness per unit height, times the height),
  // else the page count, else a default. A face cut from a photo that shows another is seen at an angle, so
  // foreshortened; a crop wider than the book is no spine.
  const { width = 0, height = 0 } = size;
  const squareOn = (face: string) => {
    const { file, page, time } = all[chosen[face]].picture.source;
    return all.filter(({ picture: { source } }) => source.file === file && source.page === page && source.time === time).length === 1;
  };
  const fromPhotos = median(([['spine', spine], ['edge', edge]] as const)
    .flatMap(([face, t]) => (t && squareOn(face) ? [height * (t.width / t.height)] : [])).filter((mm) => mm > 1 && mm < width));
  const fromPages = pages ? pages * PAGE_MM + (hardcover ? BOARDS_MM : 0) : undefined;
  take('photos', { depth: fromPhotos });
  take('pages', { depth: fromPages });
  take('default', { depth: DEFAULT_DEPTH_MM });
  // Guessed sizes are warnings, not review: the model still shows the book, faces and all.
  if (measuredBy.depth === 'default') log.warnings.push('the thickness is a default 20 mm');
  if (measuredBy.depth === 'photos' && measuredBy.height === 'trim') log.warnings.push('the thickness is from the photos, scaled to a guessed height');
  if (fromPhotos && fromPages && Math.abs(fromPhotos / fromPages - 1) > ESTIMATES_DISAGREE) {
    log.warnings.push(`the photos say ${round(fromPhotos)} mm thick, the page count ${round(fromPages)} mm: check the spine photo's crop`);
  }
  const { depth = 0 } = size;

  if (measuredBy.width !== 'cover' && measuredBy.height !== 'cover' && measuredBy.width !== 'trim' && Math.abs(width / height / aspect - 1) > 0.05) {
    log.warnings.push(`the cover photo's shape (${aspect.toFixed(3)}) doesn't match the book's size (${(width / height).toFixed(3)}): is it cropped to the cover's edges, and the same edition?`);
  }

  const plain: Side = { color: front.edge, roughness: 0.6 }; // a wraparound cover carries on round the spine
  const paper = await pageTextures();
  const pagesAcross: Side = { picture: paper.across, roughness: 0.9 }; // one Side for top and bottom: one draw call
  // A foil sticker on the front cover, where the models found one on a photo of it: round when its box is about
  // square on the book (a seal), else as boxed. Not on a stand-in cover: it's someone else's copy.
  const found = faces.front === 'photo' ? regionIn(sights, 'sticker', 'front') : undefined;
  const sticker = found && { ...found, round: Math.abs(((found.x1 - found.x0) * width) / ((found.y1 - found.y0) * height) - 1) < 0.2 };
  const sides: Record<Face, Side> = {
    front: { picture: front.jpeg, ...(sticker && { foil: await foilMap([sticker], front.height / front.width) }) },
    back: back ? { picture: back.jpeg } : plain,
    left: spine ? { picture: spine.jpeg } : plain,
    right: edge ? { picture: edge.jpeg } : { picture: paper.down, roughness: 0.9 },
    top: top ? { picture: top.jpeg } : pagesAcross,
    bottom: bottom ? { picture: bottom.jpeg } : pagesAcross,
  };
  // A hardcover too small to hold its own boards and squares (a size typed in wrong) is drawn as a box.
  const roomy = depth > 3 * BOARD_MM && width > 4 * SQUARE_MM && height > 4 * SQUARE_MM;
  const glb = hardcover && roomy ? await hardcoverBook([width, height, depth], sides, plain) : await box('book', [width, height, depth], sides, ROUNDED_MM);
  return {
    glb,
    sidecar: {
      profile: 'book', isbn, ...(coverUrl && { coverUrl }),
      widthMm: round(width), heightMm: round(height), depthMm: round(depth), measuredBy,
      depthEstimates: { photos: fromPhotos && round(fromPhotos), pages: fromPages && round(fromPages) },
      pages, binding, bindingBy: seen ? 'vision' : listed ? 'catalog' : 'assumed', ...(sticker && { sticker: rounded(sticker) }),
      faces, review, warnings: log.warnings, catalog,
      ...(match && { match: { by: 'title', read: { title: read!.title, authors: read!.authors }, ...match } }),
      pictures: pictureRecord(all, roles), lookups: log.lookups,
    },
  };
}

/**
 * A book in Open Library by the title and authors read off it: the closest
 * work and how sure the match is (title words in common, against the title
 * and against title and subtitle, times an author's surname matching), its
 * editions' ISBNs, the ISBN if it has only the one edition, and a page count
 * from its editions. Nothing under LIKELY is a match.
 */
async function byTitle(title: string, authors: string[], log: Log) {
  const surname = (name: string) => [...words(name)].at(-1);
  const main = title.split(':')[0]; // the models often read the subtitle in too
  const query = new URLSearchParams({ title: [...words(main)].join(' '), fields: 'key,title,subtitle,author_name,isbn,number_of_pages_median', limit: '5' });
  if (authors[0]) query.set('author', surname(authors[0]) ?? '');
  const docs: any[] = (await fetchJson(`https://openlibrary.org/search.json?${query}`, log))?.docs ?? [];
  const [best] = docs.map((doc) => {
    const titled = Math.max(dice(words(main), words(doc.title ?? '')), dice(words(title), words(`${doc.title ?? ''} ${doc.subtitle ?? ''}`)));
    const byAuthor = !authors.length ? 0.8 : authors.some((a) => (doc.author_name ?? []).some((n: string) => surname(n) === surname(a))) ? 1 : 0.5;
    return { doc, confidence: Math.round(titled * byAuthor * 100) / 100 };
  }).sort((a, b) => b.confidence - a.confidence);
  if (!best || best.confidence < LIKELY) return undefined;
  const editions: string[] = (best.doc.isbn ?? []).filter((isbn: string) => /^97[89]\d{10}$/.test(isbn));
  let pages = positive(best.doc.number_of_pages_median);
  if (!pages && editions.length) {
    const records = await fetchJson(`https://openlibrary.org/api/books?bibkeys=${editions.slice(0, 5).map((isbn) => `ISBN:${isbn}`).join(',')}&format=json&jscmd=data`, log);
    pages = Object.values(records ?? {}).map((record: any) => positive(record?.number_of_pages) ?? paginated(record?.pagination)).find(Boolean);
  }
  return {
    confidence: best.confidence, title: best.doc.title as string, authors: best.doc.author_name as string[] | undefined,
    openLibrary: best.doc.key ? `https://openlibrary.org${best.doc.key}` : undefined, editions,
    isbn: editions.length === 1 ? editions[0] : undefined, pages,
  };
}

/**
 * A hardcover as one is built: the case (the spine and the front and back boards, the photos on their outsides)
 * round a page block set back by the squares at the top, bottom and page edge, so the boards stand past the pages
 * there. The case's insides and edges are the cover's color, as its cloth or jacket is; a dust jacket wraps the
 * boards, so it changes nothing.
 */
async function hardcoverBook([width, height, depth]: number[], sides: Record<Face, Side>, plain: Side): Promise<Uint8Array> {
  const doc = new Document();
  const mesh = doc.createMesh('book');
  const materials = new Map<Side, Material>();
  const piece = (size: number[], at: number[], faces: Partial<Record<Face, Side>>) => {
    const all = { front: plain, back: plain, left: plain, right: plain, top: plain, bottom: plain, ...faces };
    for (const [side, part] of roundedBox(size, all, ROUNDED_MM, at)) {
      if (!materials.has(side)) materials.set(side, sideMaterial(doc, `book-${materials.size}`, side));
      if (!side.picture) part.uv.length = 0;
      addPart(doc, mesh, part, materials.get(side)!);
    }
  };
  const inside = width - BOARD_MM; // the boards and the pages, beside the spine
  piece([BOARD_MM, height, depth], [-inside / 2, 0, 0], { left: sides.left });
  piece([inside, height, BOARD_MM], [BOARD_MM / 2, 0, (depth - BOARD_MM) / 2], { front: sides.front });
  piece([inside, height, BOARD_MM], [BOARD_MM / 2, 0, -(depth - BOARD_MM) / 2], { back: sides.back });
  piece([inside - SQUARE_MM, height - 2 * SQUARE_MM, depth - 2 * BOARD_MM], [(BOARD_MM - SQUARE_MM) / 2, 0, 0], { right: sides.right, top: sides.top, bottom: sides.bottom });
  return toGlb(doc, mesh);
}

let made: Promise<{ down: Uint8Array; across: Uint8Array }> | undefined;
/**
 * Stacked pages for unphotographed page sides, the same for every book: each page a shade of its own,
 * neighbors drifting together as pages clump, a few darker gaps between sections, faint fibers along the
 * paper. The lines run down the page-edge texture and across the top-and-bottom one.
 */
function pageTextures(): Promise<{ down: Uint8Array; across: Uint8Array }> {
  made ??= (async () => {
    const [pages, along] = [192, 256];
    let seed = 7; // mulberry32: seeded, so the texture never changes between runs
    const random = () => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const shade: number[] = [];
    let drift = 0;
    for (let i = 0; i < pages; i++) {
      drift = drift * 0.7 + (random() - 0.5) * 0.06;
      shade.push(1 + drift + (random() - 0.5) * 0.06 - (random() < 0.04 ? 0.08 : 0));
    }
    const data = Buffer.alloc(pages * along * 3);
    for (let y = 0; y < along; y++) {
      for (let x = 0; x < pages; x++) {
        const fiber = 1 + (random() - 0.5) * 0.025;
        for (let k = 0; k < 3; k++) data[(y * pages + x) * 3 + k] = Math.min(255, Math.round(CREAM[k] * shade[x] * fiber));
      }
    }
    const image = sharp(data, { raw: { width: pages, height: along, channels: 3 } });
    const [down, across] = await Promise.all([image.clone().jpeg({ quality: 90 }).toBuffer(), image.clone().rotate(90).jpeg({ quality: 90 }).toBuffer()]);
    return { down, across };
  })();
  return made;
}

/**
 * Open Library's record of an edition (books API and edition record) and its work (search): all of it, for whatever
 * reads the sidecar to use as it likes, but for other people's prose (descriptions, excerpts, first sentences),
 * which a published sidecar mustn't carry, and ebook lending, which goes stale.
 */
function catalogRecord(data: any, edition: any, work: any): Record<string, unknown> {
  const names = (list: unknown) => (Array.isArray(list) ? list.map((item) => item?.name ?? item?.title).filter(Boolean) : undefined);
  const workKey = edition?.works?.[0]?.key ?? work?.key;
  return {
    title: data.title,
    subtitle: data.subtitle,
    byStatement: data.by_statement,
    authors: names(data.authors),
    publishers: names(data.publishers),
    publishPlaces: names(data.publish_places),
    publishDate: data.publish_date,
    copyrightDate: edition?.copyright_date,
    firstPublished: work?.first_publish_year,
    edition: edition?.edition_name,
    format: edition?.physical_format,
    series: edition?.series,
    languages: edition?.languages?.map((language: { key: string }) => language.key.split('/').pop()),
    subjects: names(data.subjects),
    subjectPlaces: names(data.subject_places),
    subjectPeople: names(data.subject_people),
    subjectTimes: names(data.subject_times),
    dewey: data.classifications?.dewey_decimal_class,
    lcc: data.classifications?.lc_classifications,
    weight: data.weight,
    notes: typeof data.notes === 'string' ? data.notes : data.notes?.value,
    tableOfContents: names(data.table_of_contents),
    identifiers: data.identifiers, // isbn_10, isbn_13, lccn, oclc, goodreads, librarything…, as Open Library lists them
    links: data.links?.map(({ title, url }: { title: string; url: string }) => ({ title, url })),
    cover: data.cover?.large,
    openLibrary: data.url,
    work: workKey && `https://openlibrary.org${workKey}`,
    editionCount: work?.edition_count,
  };
}

/** "24.2 x 16.2 x 3.9 centimeters", "8.1 x 5.5 x 1.1 inches", "24 cm": millimeters, largest first. */
export function parseDims(text: unknown): number[] {
  if (typeof text !== 'string') return [];
  const scale = /\bin(ch|ches)?\b|"/i.test(text) ? 25.4 : /\bcm\b|centimet/i.test(text) ? 10 : /\bmm\b|millimet/i.test(text) ? 1 : 0;
  return scale ? (text.match(/\d+(\.\d+)?/g) ?? []).map((n) => Number(n) * scale).sort((a, b) => b - a) : [];
}

/** Catalogs list sizes in any order: the longest side is the height, unless the cover is wider than tall. */
function orient([longest, middle, shortest]: number[], aspect: number): Dims {
  return aspect > 1 ? { width: longest, height: middle, depth: shortest } : { width: middle, height: longest, depth: shortest };
}

function nearestTrim(aspect: number): number[] {
  const portrait = Math.min(aspect, 1 / aspect);
  const [w, h] = TRIMS_IN.reduce((best, trim) => (Math.abs(trim[0] / trim[1] - portrait) < Math.abs(best[0] / best[1] - portrait) ? trim : best));
  return aspect <= 1 ? [w, h] : [h, w];
}

/** A title's words, for comparing two: lowercase, accents and punctuation gone, articles left out. */
const words = (text: string) => new Set(text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w && !ARTICLES.has(w)));
/** Words in common, 0–1. */
const dice = (a: Set<string>, b: Set<string>) => (a.size + b.size ? (2 * [...a].filter((w) => b.has(w)).length) / (a.size + b.size) : 0);
const positive = (n: unknown) => (typeof n === 'number' && n > 0 ? n : undefined);
/** A catalog's pagination ("336", "xii, 336 p."): its largest number, if a book could have that many pages ("1 v." can't). */
const paginated = (text: unknown) => {
  const most = typeof text === 'string' ? Math.max(0, ...(text.match(/\d+/g) ?? []).map(Number)) : 0;
  return most >= 16 ? most : undefined;
};
const round = (mm: number) => Math.round(mm * 10) / 10;
const median = (values: number[]) => {
  if (values.length === 0) return undefined;
  const sorted = values.toSorted((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Catalog JSON, whatever shape the catalog sends. */
async function fetchJson(url: string, log: Log): Promise<any> {
  const bytes = await fetchBytes(url, log);
  try { return bytes && JSON.parse(bytes.toString('utf8')); } catch { return undefined; }
}

/**
 * A lookup that never throws: a miss is undefined, anything worse than a 404
 * is a warning, and every attempt is logged (host and path only, so no API
 * key is printed or recorded).
 */
async function fetchBytes(url: string, log: Log): Promise<Buffer | undefined> {
  const { host, pathname: path } = new URL(url);
  const started = performance.now();
  const note = (status: Lookup['status']) => log.lookups.push({ host, path, status, ms: Math.round(performance.now() - started) });
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Thicken (3D models from photos)' }, signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
    note(response.status);
    if (response.ok) return Buffer.from(await response.arrayBuffer());
    if (response.status !== 404) log.warnings.push(`${host} answered ${response.status}`);
  } catch (error) {
    note('unreachable');
    log.warnings.push(`${host} unreachable: ${(error as Error).message}`);
  }
  return undefined;
}
