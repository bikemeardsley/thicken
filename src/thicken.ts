// Pictures in, a model out: load every input, pick the profile (or take the
// one named), build it. Two families: digital artwork made into an object
// (badge), and a real object rebuilt at its real size (book, slab).
// Barcodes are read whatever the profile, so a back cover's ISBN feeds the
// book's size lookup without being typed in.
import path from 'node:path';
import { badge, signedArea } from './badge.ts';
import { book } from './book.ts';
import { codes, load, type Picture } from './image.ts';
import { trace } from './outline.ts';
import { slab } from './slab.ts';

export const PROFILES = ['badge', 'book', 'slab'] as const;
export type Profile = (typeof PROFILES)[number];

export interface Options {
  profile?: Profile;
  isbn?: string;
  sizeMm?: number[]; // width, height, depth; any may be missing
  holder?: string; // slab holder, e.g. psa, psa-thick, bgs
  widthMm?: number; // badge
  depthMm?: number; // badge
}

export interface Sidecar {
  profile: Profile;
  sources: string[];
  widthMm: number;
  heightMm: number;
  depthMm: number;
  warnings: string[];
  [detail: string]: unknown;
}

// A grader's QR code points at its own site, which says whose holder this is.
const GRADER_SITES: Record<string, string> = { 'psacard.com': 'psa', 'beckett.com': 'bgs', 'cgccards.com': 'cgc', 'gosgc.com': 'sgc', 'taggrading.com': 'tag' };

export async function thicken(inputs: string[], options: Options = {}): Promise<{ glb: Uint8Array; sidecar: Sidecar }> {
  const { sizeMm = [] } = options;
  if (sizeMm.some((mm) => mm !== undefined && !(mm > 0))) throw new Error('sizes must be positive millimetres, e.g. 152x229x25');
  const pictures = (await Promise.all(inputs.map((input) => load(input)))).flat();

  const found = options.profile === 'badge' ? {} : await lookAtCodes(pictures);
  const isbn = options.isbn ? checkIsbn(options.isbn) : found.isbn;
  const profile = options.profile
    ?? (isbn ? 'book' : found.holder ? 'slab' : isArtwork(pictures[0]) ? 'badge' : undefined);
  if (!profile) {
    throw new Error('can\'t tell what this is: no ISBN barcode, no grader\'s QR code, and not cut-out artwork. Name it: thicken book|slab|badge <pictures>');
  }

  const built = profile === 'book' ? await book(pictures, { isbn, sizeMm })
    : profile === 'slab' ? await slab(pictures, { holder: options.holder ?? found.holder, sizeMm })
    : await badge(first(pictures), options);
  return { glb: built.glb, sidecar: { ...built.sidecar, profile, sources: inputs.map((input) => path.basename(input)) } };
}

/** An ISBN from a book's barcode (EAN-13, 978/979), and a grader from a QR code on a slab's label. */
async function lookAtCodes(pictures: Picture[]): Promise<{ isbn?: string; holder?: string }> {
  const found: { isbn?: string; holder?: string } = {};
  for (const picture of pictures) {
    for (const { format, text } of await codes(picture)) {
      if (format === 'EAN13' && /^97[89]/.test(text)) found.isbn ??= text;
      const host = URL.canParse(text) ? new URL(text).hostname : '';
      const site = Object.keys(GRADER_SITES).find((s) => host === s || host.endsWith(`.${s}`));
      if (site) found.holder ??= GRADER_SITES[site];
    }
  }
  return found;
}

/** Cut-out artwork: see-through around a shape that isn't just a rectangle (a lifted book cover is one). */
function isArtwork(picture?: Picture): boolean {
  if (!picture?.transparent) return false;
  const { outlines } = trace(picture.data, picture.width, picture.height, 4);
  const xs = outlines.flat().map(([x]) => x);
  const ys = outlines.flat().map(([, y]) => y);
  const box = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  const area = outlines.reduce((sum, outline) => sum + Math.abs(signedArea(outline)), 0);
  return area < 0.9 * box;
}

function checkIsbn(text: string): string {
  const isbn = text.replace(/[\s-]/g, '').toUpperCase();
  if (!/^(\d{9}[\dX]|\d{13})$/.test(isbn)) throw new Error(`not an ISBN: ${text}`);
  return isbn;
}

function first(pictures: Picture[]): Picture {
  if (!pictures[0]) throw new Error('give a picture to make it from');
  return pictures[0];
}
