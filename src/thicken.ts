// Pictures in, a model out: load every input, pick the profile (or take the
// one named), build it. Two families: digital artwork made into an object
// (badge), and a real object rebuilt at its real size (book, slab).
// Barcodes are read whatever the profile, so a back cover's ISBN feeds the
// book's size lookup without being typed in.
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { badge, signedArea } from './badge.ts';
import { book } from './book.ts';
import { codes, load, subjectBox, type Picture } from './image.ts';
import { trace } from './outline.ts';
import { HOLDERS, slab } from './slab.ts';

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
  faces?: Faces;
  warnings: string[];
  [detail: string]: unknown;
}

/** Where each face's picture came from: the user's own photo, or something standing in for one. */
export type Faces = Record<string, 'photo' | 'openlibrary' | 'color' | 'plastic'>;
const STAND_IN = { openlibrary: 'Open Library\'s cover, not your copy', color: 'plain color', plastic: 'plain plastic' };

/** The faces still to photograph, e.g. "spine (plain color)": for the re-shoot list and preview captions. */
export const stillToShoot = (faces: Faces = {}) =>
  Object.entries(faces).flatMap(([face, from]) => (from === 'photo' ? [] : [`${face} (${STAND_IN[from]})`]));

// A grader's QR code points at its own verification page, which says whose holder this is.
const GRADER_SITES: Record<string, string> = { 'psacard.com': 'psa', 'beckett.com': 'bgs', 'cgccards.com': 'cgc', 'gosgc.com': 'sgc', 'taggrading.com': 'tag' };
// Cert numbers: PSA ~8 digits, BGS 10, SGC 7 (older labels 7-3), CGC 7–12, TAG a letter then digits.
const CERT = /^[A-Z]?\d{6,12}$|^\d{7}-\d{3}$/i;
const SLAB_SHAPE_TOLERANCE = 0.06;

export async function thicken(inputs: string[], options: Options = {}): Promise<{ glb: Uint8Array; sidecar: Sidecar }> {
  const { sizeMm = [] } = options;
  if (sizeMm.some((mm) => mm !== undefined && !(mm > 0))) throw new Error('sizes must be positive millimeters, e.g. 152x229x25');
  const pictures = (await Promise.all(inputs.map((input) => load(input)))).flat();

  const found: Found = options.profile === 'badge' ? {} : await lookAtCodes(pictures);
  const isbn = options.isbn ? checkIsbn(options.isbn) : found.isbn;
  const profile = options.profile
    ?? (isbn ? 'book' : found.grader || (found.cert && isSlabShaped(pictures[0])) ? 'slab' : isArtwork(pictures[0]) ? 'badge' : undefined);
  if (!profile) {
    throw new Error('can\'t tell what this is: no ISBN barcode, no grader\'s QR code or cert barcode, and not cut-out artwork. Name it: thicken book|slab|badge <pictures>');
  }

  const built = profile === 'book' ? await book(pictures, { isbn, sizeMm, backAt: found.isbnAt })
    : profile === 'slab' ? await slab(pictures, { holder: options.holder ?? found.grader, sizeMm, label: { grader: found.grader, cert: found.cert, verifyUrl: found.verifyUrl } })
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

interface Found { isbn?: string; isbnAt?: number; grader?: string; cert?: string; verifyUrl?: string }

/**
 * What the barcodes and QR codes say: a book's ISBN (EAN-13, 978/979) and
 * which picture it was on; a slab's grader, cert number and verification
 * page from a QR code to the grader's site; or, on an older label, a cert
 * number from its Code 128 barcode alone.
 */
async function lookAtCodes(pictures: Picture[]): Promise<Found> {
  const found: Found = {};
  for (const [at, picture] of pictures.entries()) {
    for (const { format, text } of await codes(picture)) {
      if (format === 'EAN13' && /^97[89]/.test(text)) {
        if (!found.isbn) Object.assign(found, { isbn: text, isbnAt: at });
        continue;
      }
      const url = URL.canParse(text) ? new URL(text) : undefined;
      const host = url?.hostname.toLowerCase() ?? '';
      const site = Object.keys(GRADER_SITES).find((s) => host === s || host.endsWith(`.${s}`));
      if (url && site && !found.grader) {
        // The cert number is the first path segment, query value or fragment segment that is one, whole.
        const cert = [...url.pathname.split('/'), ...url.searchParams.values(), ...url.hash.split(/[#/?&=]/)].find((part) => CERT.test(part));
        Object.assign(found, { grader: GRADER_SITES[site], verifyUrl: text, cert: cert?.toUpperCase() ?? found.cert });
      } else if (format === 'Code128' && CERT.test(text)) {
        found.cert ??= text.toUpperCase();
      }
    }
  }
  return found;
}

/** A picture the shape of a known slab holder, give or take a loose crop. */
function isSlabShaped(picture?: Picture): boolean {
  if (!picture) return false;
  const { width, height } = subjectBox(picture);
  return Object.values(HOLDERS).some(([w, h]) => Math.abs(width / height / (w / h) - 1) < SLAB_SHAPE_TOLERANCE);
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
