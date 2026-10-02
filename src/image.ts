// Any picture a phone or scanner hands over, as upright RGBA pixels no
// larger than MAX_PX a side: whatever sharp reads (JPEG, PNG, WebP, AVIF,
// GIF, TIFF, SVG), HEIC (sharp's binaries leave out the HEVC decoder, so
// libheif does it) and document-scan PDFs (iPhone Notes and Files scan only
// to PDF), one picture per page. Also the barcodes in a picture, which is
// how a book or a slab announces itself.
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import sharp, { type Sharp } from 'sharp';
import { extractImages, getDocumentProxy } from 'unpdf';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';

const require = createRequire(import.meta.url);
const MAX_PX = 2048; // plenty for a 30 cm book, and keeps a 48 MP photo from costing a gigabyte

// The barcode reader's .wasm from node_modules, not the CDN it fetches by default.
prepareZXingModule({ overrides: { wasmBinary: readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm')) } });

export interface Picture { data: Buffer; width: number; height: number; transparent: boolean }

/** Every picture in a file or encoded image: one, or one per page of a PDF. */
export async function load(input: string | Buffer): Promise<Picture[]> {
  const bytes = typeof input === 'string' ? await readFile(input) : input;
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return Promise.all((await pdfPages(bytes)).map(upright));
  const { format, compression, width = 1, height = 1, density = 72 } = await sharp(bytes).metadata();
  if (compression === 'hevc') return [await upright(await heic(bytes))];
  // An SVG is drawn at the size it asks for; draw it big enough to stay sharp.
  const svgDensity = format === 'svg' ? Math.min(100_000, (density * MAX_PX) / Math.max(width, height)) : undefined;
  return [await upright(sharp(bytes, { density: svgDensity }).rotate())];
}

async function upright(image: Sharp): Promise<Picture> {
  const { data, info } = await image
    .resize(MAX_PX, MAX_PX, { fit: 'inside', withoutEnlargement: true })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let transparent = false;
  for (let i = 3; i < data.length && !transparent; i += 4) transparent = data[i] < 128;
  return { data, width: info.width, height: info.height, transparent };
}

/** The primary image of a HEIC file; libheif applies its rotation and mirroring. */
async function heic(bytes: Buffer): Promise<Sharp> {
  const libheif = require('libheif-js/wasm-bundle');
  const images = new libheif.HeifDecoder().decode(bytes);
  const image = images.find((i: { is_primary(): boolean }) => i.is_primary()) ?? images[0];
  if (!image) throw new Error('no image found in this HEIC file');
  const width: number = image.get_width();
  const height: number = image.get_height();
  const rgba = await new Promise<{ data: Uint8ClampedArray }>((resolve, reject) =>
    image.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, (shown: { data: Uint8ClampedArray } | null) =>
      (shown ? resolve(shown) : reject(new Error('could not decode this HEIC file')))));
  for (const i of images) i.free();
  return sharp(Buffer.from(rgba.data.buffer), { raw: { width, height, channels: 4 } });
}

/** Each page's largest picture, turned as the page is. */
async function pdfPages(bytes: Buffer): Promise<Sharp[]> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const pages: Sharp[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const images = await extractImages(pdf, n);
    if (images.length === 0) throw new Error(`PDF page ${n} has no picture on it: only scanned PDFs work`);
    const { data, width, height, channels } = images.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
    // ponytail: honours the page's /Rotate only; a scan drawn turned by its content stream would come out sideways.
    const { rotate } = await pdf.getPage(n);
    pages.push(sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width, height, channels } }).rotate(rotate));
  }
  return pages;
}

/** The barcodes and QR codes in a picture that pass their own checksums. */
export async function codes({ data, width, height }: Picture): Promise<{ format: string; text: string }[]> {
  const found = await readBarcodes({ data: new Uint8ClampedArray(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength), width, height, colorSpace: 'srgb' });
  return found.filter((code) => code.isValid).map(({ format, text }) => ({ format, text }));
}

/** Average colour of the opaque pixels in columns [x0, x1), as #rrggbb. */
export function columnColour({ data, width, height }: Picture, x0: number, x1: number): string {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = 0; y < height; y++) {
    for (let x = Math.max(0, x0); x < Math.min(width, x1); x++) {
      const k = (y * width + x) * 4;
      if (data[k + 3] < 128) continue;
      r += data[k]; g += data[k + 1]; b += data[k + 2]; n++;
    }
  }
  const hex = (v: number) => Math.round(n ? v / n : 128).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** The part of a picture that is the subject: all of it, or for a lifted subject the box around its opaque pixels. */
export function subjectBox({ data, width, height, transparent }: Picture): { left: number; top: number; width: number; height: number } {
  if (!transparent) return { left: 0, top: 0, width, height };
  let [left, top, right, bottom] = [width, height, -1, -1];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < 128) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  if (right < 0) throw new Error('the picture is entirely see-through');
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * A picture as a JPEG for a box face, with its size and the colour along its
 * left edge. A lifted subject is cropped to itself, and its see-through
 * corners are filled with that edge colour.
 */
export async function texture(picture: Picture): Promise<{ jpeg: Buffer; width: number; height: number; edge: string }> {
  const { left, top, width, height } = subjectBox(picture);
  const edge = columnColour(picture, left, left + 4);
  const jpeg = await sharp(picture.data, { raw: { width: picture.width, height: picture.height, channels: 4 } })
    .extract({ left, top, width, height })
    .flatten({ background: edge })
    .jpeg({ quality: 90 })
    .toBuffer();
  return { jpeg, width, height, edge };
}
