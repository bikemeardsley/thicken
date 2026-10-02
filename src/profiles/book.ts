// The book profile: a box at the book's real size, its six faces from any
// number of photos (src/faces.ts): front, back, spine, top, bottom and the
// page edge, with plain colors for faces not photographed. Each dimension
// comes from the first source that knows it, and the sidecar says which:
// measured (--size), Open Library, Google Books (keyless quota is shared and
// often spent; set GOOGLE_BOOKS_API_KEY), the cover's shape, a standard trim
// size, then for thickness the spine and page-edge photos and the page count.
// With an ISBN the sidecar also gets Open Library's catalog record.
import sharp from 'sharp';
import { assignFaces, cut, pictureRecord, shots } from '../faces.ts';
import { box, type Side } from '../glb.ts';
import { load, texture, turned, type Picture } from '../image.ts';
import type { Code, Faces, Profile } from '../thicken.ts';
import type { Sight } from '../vision.ts';

export const book: Profile = {
  name: 'book',
  about: 'a book, hardcover or paperback',
  faces: { front: 'front cover', back: 'back cover', spine: 'spine', edge: 'the page edge opposite the spine', top: 'top', bottom: 'bottom' },
  note: 'The book stands on its bottom edge, front cover toward you, its spine and page edge each seen from its own side with the top of the book up.',
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
  const read = sights?.find((sight) => sight.title);
  const match = !known && read?.title ? await byTitle(read.title, read.authors ?? [], log) : undefined;
  if (match && match.confidence < SURE) review.push(`which book this is (found by its title, ${Math.round(match.confidence * 100)}% sure: check it, or give --isbn)`);
  if (read?.title && !known && !match) log.warnings.push(`no book in Open Library close to the title read, "${read.title}"`);
  const isbn = known ?? match?.isbn;
  const byCodes: string[] = [];
  for (const { picture, use } of codes) if (use === 'isbn') byCodes[picture] = 'back';
  const { parts, placed } = cut(pictures, sights, byCodes);
  const all = await shots(parts);
  const { chosen, roles, guessedFrontBack } = assignFaces(all, ['front', 'back', 'spine', 'top', 'bottom', 'edge'], { placed, byShape: true });
  if (guessedFrontBack) review.push('front and back (no barcode: told apart only by photo order, so check they are the right way round)');
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
  let hardcover = false;
  let catalog: Record<string, unknown> | undefined;
  if (isbn) {
    // The catalog record, whatever the size sources: title, authors and the rest, for the sidecar.
    const data = (await fetchJson(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`, log))?.[`ISBN:${isbn}`];
    catalog = data && catalogRecord(data);
    pages = positive(data?.number_of_pages) ?? paginated(data?.pagination);
  }
  pages ??= match?.pages;
  catalog ??= match && { title: match.title, authors: match.authors, openLibrary: match.openLibrary, editions: match.editions };
  if (isbn && missing()) {
    const edition = await fetchJson(`https://openlibrary.org/isbn/${isbn}.json`, log);
    take('openlibrary', orient(parseDims(edition?.physical_dimensions), aspect));
    pages ??= positive(edition?.number_of_pages) ?? paginated(edition?.pagination);
    hardcover = /hard/i.test(edition?.physical_format ?? '');
    if (catalog && edition?.physical_format) catalog.format = edition.physical_format;
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

  // Thickness from spine and page-edge photos shot square on (thickness per unit height, times the height),
  // else the page count, else a default. A face cut from a photo that shows another is seen at an angle, so
  // foreshortened; a crop wider than the book is no spine.
  const { width = 0, height = 0 } = size;
  const squareOn = (face: string) => {
    const { file, page } = all[chosen[face]].picture.source;
    return all.filter(({ picture: { source } }) => source.file === file && source.page === page).length === 1;
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
  const glb = await box('book', [width, height, depth], {
    front: { picture: front.jpeg },
    back: back ? { picture: back.jpeg } : plain,
    left: spine ? { picture: spine.jpeg } : plain,
    right: edge ? { picture: edge.jpeg } : { picture: paper.down, roughness: 0.9 },
    top: top ? { picture: top.jpeg } : pagesAcross,
    bottom: bottom ? { picture: bottom.jpeg } : pagesAcross,
  }, ROUNDED_MM);
  return {
    glb,
    sidecar: {
      profile: 'book', isbn, ...(coverUrl && { coverUrl }),
      widthMm: round(width), heightMm: round(height), depthMm: round(depth), measuredBy,
      depthEstimates: { photos: fromPhotos && round(fromPhotos), pages: fromPages && round(fromPages) },
      pages, faces, review, warnings: log.warnings, catalog,
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
  const words = (text: string) => new Set(text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w && !ARTICLES.has(w)));
  const surname = (name: string) => [...words(name)].at(-1);
  const dice = (a: Set<string>, b: Set<string>) => (a.size + b.size ? (2 * [...a].filter((w) => b.has(w)).length) / (a.size + b.size) : 0);
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

/** The fields of Open Library's books-API record worth keeping. */
function catalogRecord(data: any): Record<string, unknown> {
  const names = (list: unknown) => (Array.isArray(list) ? list.map((item) => item?.name).filter(Boolean) : undefined);
  return {
    title: data.title,
    subtitle: data.subtitle,
    authors: names(data.authors),
    publishers: names(data.publishers),
    publishDate: data.publish_date,
    subjects: names(data.subjects)?.slice(0, 12),
    dewey: data.classifications?.dewey_decimal_class,
    lcc: data.classifications?.lc_classifications,
    weight: data.weight,
    openLibrary: data.url,
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
