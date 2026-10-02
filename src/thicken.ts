// Pictures in, a model out: load every input, pick the profile (or take the
// one named), build it. Two families: digital artwork made into an object
// (badge), and a real object rebuilt at its real size (book, slab).
// Barcodes are read whatever the profile, so a back cover's ISBN feeds the
// book's size lookup without being typed in.
import { readdir } from 'node:fs/promises';
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

  const built = profile === 'book' ? await book(pictures, { isbn, sizeMm, backAt: found.isbnAt })
    : profile === 'slab' ? await slab(pictures, { holder: options.holder ?? found.holder, sizeMm })
    : await badge(first(pictures), options);
  return { glb: built.glb, sidecar: { ...built.sidecar, profile, sources: inputs.map((input) => path.basename(input)) } };
}

const PICTURE = /\.(jpe?g|png|heic|heif|webp|avif|gif|tiff?|svg|pdf)$/i;
// Numeric (IMG_2 before IMG_10) and case-blind, with a plain tiebreak so the order is the same on every filesystem.
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0);

/**
 * A folder as the models to make from it, for a batch: each picture or PDF
 * in it is one, from that file alone, and each subfolder is one, from every
 * picture under it in name order (a phone names shots in the order taken).
 * Hidden names and `skip` (the output folder) are left out, and output
 * names are made unique, ignoring case, so no model overwrites another.
 */
export async function batchItems(folder: string, skip?: string): Promise<{ name: string; files: string[] }[]> {
  const visible = (name: string) => !name.split(/[\\/]/).some((part) => part.startsWith('.'));
  const items: { name: string; files: string[] }[] = [];
  const entries = (await readdir(folder, { withFileTypes: true })).filter((entry) => visible(entry.name)).sort((a, b) => byName(a.name, b.name));
  for (const entry of entries) {
    const full = path.join(folder, entry.name);
    if (skip && path.resolve(full) === path.resolve(skip)) continue;
    if (entry.isDirectory()) {
      const files = (await readdir(full, { recursive: true, withFileTypes: true }))
        .filter((inner) => inner.isFile())
        .map((inner) => path.join(inner.parentPath, inner.name))
        .filter((file) => visible(path.relative(full, file)) && PICTURE.test(file))
        .sort(byName);
      if (files.length) items.push({ name: entry.name, files });
    } else if (entry.isFile() && PICTURE.test(entry.name)) {
      items.push({ name: path.parse(entry.name).name, files: [full] });
    }
  }
  const taken = new Set<string>();
  for (const item of items) {
    let name = item.name;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${item.name}-${n}`;
    taken.add(name.toLowerCase());
    item.name = name;
  }
  return items;
}

/** An ISBN from a book's barcode (EAN-13, 978/979) and which picture it was on, and a grader from a QR code on a slab's label. */
async function lookAtCodes(pictures: Picture[]): Promise<{ isbn?: string; isbnAt?: number; holder?: string }> {
  const found: { isbn?: string; isbnAt?: number; holder?: string } = {};
  for (const [at, picture] of pictures.entries()) {
    for (const { format, text } of await codes(picture)) {
      if (format === 'EAN13' && /^97[89]/.test(text) && !found.isbn) Object.assign(found, { isbn: text, isbnAt: at });
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
