// The book profile: a box at the book's real size, its six faces from any
// number of photos (src/faces.ts): front, back, spine, top, bottom and the
// page edge, with plain colors for faces not photographed. Each dimension
// comes from the first source that knows it, and the sidecar says which:
// measured (--size), Open Library, Google Books (keyless quota is shared and
// often spent; set GOOGLE_BOOKS_API_KEY), the cover's shape, a standard trim
// size, then for thickness the spine and page-edge photos and the page count.
// With an ISBN the sidecar also gets Open Library's catalog record.
import { assignFaces, pictureRecord, shots } from './faces.ts';
import { box, type Side } from './glb.ts';
import { load, texture, type Picture } from './image.ts';
import type { Faces } from './thicken.ts';

const PAGE_MM = 0.075; // per page: trade paper runs 300–400 pages to the inch
const BOARDS_MM = 4; // a hardcover's two boards
const DEFAULT_DEPTH_MM = 20;
const TRIMS_IN = [[4.25, 6.87], [5, 8], [5.5, 8.5], [6, 9], [7, 10], [8.5, 11], [8.5, 8.5]]; // width × height
const PAGE_EDGES: Side = { color: '#efe6d2', roughness: 0.9 }; // cream
const ESTIMATES_DISAGREE = 0.35; // photos against page count: beyond this, one of them is wrong
const LOOKUP_TIMEOUT_MS = 10_000;

type Dims = { width?: number; height?: number; depth?: number }; // mm
/** A network lookup, for the sidecar: host and path, never the query (it may hold an API key). */
export interface Lookup { host: string; path: string; status: number | 'unreachable'; ms: number }
interface Log { warnings: string[]; lookups: Lookup[] }

/**
 * Pictures in any number and order. The one that carried the ISBN barcode
 * (`backAt`) is the back, unless its file name says otherwise. With no front,
 * Open Library's cover stands in, so a photo of the back is enough to start.
 */
export async function book(pictures: Picture[], { isbn, sizeMm = [], backAt }: { isbn?: string; sizeMm?: number[]; backAt?: number } = {}) {
  const log: Log = { warnings: [], lookups: [] };
  const review: string[] = [];
  const all = await shots(pictures);
  const { chosen, roles } = assignFaces(all, ['front', 'back', 'spine', 'top', 'bottom', 'edge'], { backAt, byShape: true });
  const photo = (face: string) => (chosen[face] === undefined ? undefined : all[chosen[face]].texture);
  const [back, spine, top, bottom, edge] = ['back', 'spine', 'top', 'bottom', 'edge'].map(photo);
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
    pages = positive(data?.number_of_pages);
  }
  if (isbn && missing()) {
    const edition = await fetchJson(`https://openlibrary.org/isbn/${isbn}.json`, log);
    take('openlibrary', orient(parseDims(edition?.physical_dimensions), aspect));
    pages ??= positive(edition?.number_of_pages);
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
    review.push('size (a standard trim size, guessed from the cover\'s shape)');
  }

  // Thickness from the upright spine and page-edge photos (thickness per unit height, times the
  // height; a crop wider than half the book is no spine), else the page count, else a default.
  const { width = 0, height = 0 } = size;
  const fromPhotos = median([spine, edge].flatMap((t) => (t ? [height * (t.width / t.height)] : [])).filter((mm) => mm > 1 && mm < width / 2));
  const fromPages = pages ? pages * PAGE_MM + (hardcover ? BOARDS_MM : 0) : undefined;
  take('photos', { depth: fromPhotos });
  take('pages', { depth: fromPages });
  take('default', { depth: DEFAULT_DEPTH_MM });
  if (measuredBy.depth === 'default') review.push('thickness (a default 20 mm)');
  if (fromPhotos && fromPages && Math.abs(fromPhotos / fromPages - 1) > ESTIMATES_DISAGREE) {
    review.push(`thickness (the photos say ${round(fromPhotos)} mm, the page count ${round(fromPages)} mm: check the spine photo's crop)`);
  }
  const { depth = 0 } = size;

  if (measuredBy.width !== 'cover' && measuredBy.height !== 'cover' && measuredBy.width !== 'trim' && Math.abs(width / height / aspect - 1) > 0.05) {
    log.warnings.push(`the cover photo's shape (${aspect.toFixed(3)}) doesn't match the book's size (${(width / height).toFixed(3)}): is it cropped to the cover's edges, and the same edition?`);
  }

  const plain: Side = { color: front.edge, roughness: 0.6 }; // a wraparound cover carries on round the spine
  const glb = await box('book', [width, height, depth], {
    front: { picture: front.jpeg },
    back: back ? { picture: back.jpeg } : plain,
    left: spine ? { picture: spine.jpeg } : plain,
    right: edge ? { picture: edge.jpeg } : PAGE_EDGES,
    top: top ? { picture: top.jpeg } : PAGE_EDGES,
    bottom: bottom ? { picture: bottom.jpeg } : PAGE_EDGES,
  });
  return {
    glb,
    sidecar: {
      profile: 'book', isbn, ...(coverUrl && { coverUrl }),
      widthMm: round(width), heightMm: round(height), depthMm: round(depth), measuredBy,
      depthEstimates: { photos: fromPhotos && round(fromPhotos), pages: fromPages && round(fromPages) },
      pages, faces, review, warnings: log.warnings, catalog, pictures: pictureRecord(all, roles), lookups: log.lookups,
    },
  };
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
