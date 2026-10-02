// The book profile: a box at the book's real size with its cover on the
// front, the back cover and spine where given, and page edges on the other
// three sides. Each dimension comes from the first source that knows it,
// and the sidecar says which: measured (--size), Open Library, Google
// Books (keyless quota is shared and often spent; set GOOGLE_BOOKS_API_KEY),
// the page count, the cover's shape, and last a standard trim size.
import { box, type Side } from './glb.ts';
import { load, texture, type Picture } from './image.ts';
import type { Faces } from './thicken.ts';

const PAGE_MM = 0.075; // per page: trade paper runs 300–400 pages to the inch
const BOARDS_MM = 4; // a hardcover's two boards
const DEFAULT_DEPTH_MM = 20;
const TRIMS_IN = [[4.25, 6.87], [5, 8], [5.5, 8.5], [6, 9], [7, 10], [8.5, 11], [8.5, 8.5]]; // width × height
const PAGE_EDGES: Side = { color: '#efe6d2', roughness: 0.9 }; // cream
const SPINE_SHAPE = 0.4; // width per unit height: spines are well under it, covers well over
const LOOKUP_TIMEOUT_MS = 10_000;

type Dims = { width?: number; height?: number; depth?: number }; // mm

/**
 * Pictures in any order, placed by what they show: the one that carried the
 * ISBN barcode (`backAt`) is the back cover, a tall narrow one is the spine,
 * and the rest, in order, are the front and (with no barcode) the back. With
 * no front, the cover comes from Open Library, so a photo of the back is enough.
 */
export async function book(pictures: Picture[], { isbn, sizeMm = [], backAt }: { isbn?: string; sizeMm?: number[]; backAt?: number } = {}) {
  const warnings: string[] = [];
  const textures = await Promise.all(pictures.map(texture));
  const spineAt = textures.findIndex((t, i) => i !== backAt && t.width / t.height < SPINE_SHAPE);
  const rest = textures.filter((_, i) => i !== backAt && i !== spineAt);
  let front = rest.shift();
  const back = backAt === undefined ? rest.shift() : textures[backAt];
  const spine = spineAt < 0 ? undefined : textures[spineAt];
  if (rest.length) warnings.push(`${rest.length} picture(s) not used: a book takes one front, back and spine`);
  const faces: Faces = { front: front ? 'photo' : 'openlibrary', back: back ? 'photo' : 'color', spine: spine ? 'photo' : 'color' };
  const coverUrl = !front && isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg` : undefined;
  if (!front) {
    const cover = coverUrl && await fetchBytes(`${coverUrl}?default=false`, warnings);
    if (!cover) throw new Error(isbn ? `no front cover: photograph it (Open Library has none for ISBN ${isbn})` : 'a book needs a cover photo or an ISBN');
    front = await texture((await load(cover))[0]);
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
  if (isbn && missing()) {
    const edition = await fetchJson(`https://openlibrary.org/isbn/${isbn}.json`, warnings);
    take('openlibrary', orient(parseDims(edition?.physical_dimensions), aspect));
    pages = positive(edition?.number_of_pages);
    hardcover = /hard/i.test(edition?.physical_format ?? '');
  }
  if (isbn && missing()) {
    const key = process.env.GOOGLE_BOOKS_API_KEY;
    const search = await fetchJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}${key ? `&key=${key}` : ''}`, warnings);
    const id = search?.items?.[0]?.id;
    const volume = id && await fetchJson(`https://www.googleapis.com/books/v1/volumes/${id}${key ? `?key=${key}` : ''}`, warnings);
    const { width, height, thickness } = volume?.volumeInfo?.dimensions ?? {};
    take('googlebooks', { width: parseDims(width)[0], height: parseDims(height)[0], depth: parseDims(thickness)[0] });
    pages ??= positive(volume?.volumeInfo?.pageCount);
  }
  if (pages) take('pages', { depth: pages * PAGE_MM + (hardcover ? BOARDS_MM : 0) });
  // The cover's shape gives one side from the other; with neither, guess the nearest standard trim size.
  if (size.width && !size.height) take('cover', { height: size.width / aspect });
  if (size.height && !size.width) take('cover', { width: size.height * aspect });
  if (!size.width && !size.height) {
    const [width, height] = nearestTrim(aspect);
    take('trim', { width: width * 25.4, height: height * 25.4 });
    warnings.push('no size known, so it is a standard trim size guessed from the cover\'s shape: measure it (--size) or give its ISBN');
  }
  take('default', { depth: DEFAULT_DEPTH_MM });

  const { width = 0, height = 0, depth = 0 } = size;
  if (measuredBy.width !== 'cover' && measuredBy.height !== 'cover' && measuredBy.width !== 'trim' && Math.abs(width / height / aspect - 1) > 0.05) {
    warnings.push(`the cover photo's shape (${aspect.toFixed(3)}) doesn't match the book's size (${(width / height).toFixed(3)}): is it cropped to the cover's edges, and the same edition?`);
  }

  const plain: Side = { color: front.edge, roughness: 0.6 }; // a wraparound cover carries on round the spine
  const glb = await box('book', [width, height, depth], {
    front: { picture: front.jpeg },
    back: back ? { picture: back.jpeg } : plain,
    left: spine ? { picture: spine.jpeg } : plain,
    right: PAGE_EDGES, top: PAGE_EDGES, bottom: PAGE_EDGES,
  });
  const round = (mm: number) => Math.round(mm * 10) / 10;
  return {
    glb,
    sidecar: { profile: 'book', isbn, ...(coverUrl && { coverUrl }), widthMm: round(width), heightMm: round(height), depthMm: round(depth), measuredBy, pages, faces, warnings },
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

/** Catalog JSON, whatever shape the catalog sends. */
async function fetchJson(url: string, warnings: string[]): Promise<any> {
  const bytes = await fetchBytes(url, warnings);
  try { return bytes && JSON.parse(bytes.toString('utf8')); } catch { return undefined; }
}

/** A lookup that never throws: a miss is undefined, and anything worse than a 404 becomes a warning (host only, so no API key is printed). */
async function fetchBytes(url: string, warnings: string[]): Promise<Buffer | undefined> {
  const { host } = new URL(url);
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Thicken (3D models from photos)' }, signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
    if (response.ok) return Buffer.from(await response.arrayBuffer());
    if (response.status !== 404) warnings.push(`${host} answered ${response.status}`);
  } catch (error) {
    warnings.push(`${host} unreachable: ${(error as Error).message}`);
  }
  return undefined;
}
