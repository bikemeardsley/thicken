// Any picture a phone or scanner hands over, as upright RGBA pixels no
// larger than MAX_PX a side: whatever sharp reads (JPEG, PNG, WebP, AVIF,
// GIF, TIFF, SVG), HEIC (sharp's binaries leave out the HEVC decoder, so
// libheif does it), document-scan PDFs (iPhone Notes and Files scan only
// to PDF), one picture per page, and a handful of frames from a phone video.
// Also the barcodes in a picture, which is how a book or a slab announces itself.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import exifReader from 'exif-reader';
import sharp, { type Sharp } from 'sharp';
import { extractImages, getDocumentProxy } from 'unpdf';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';

const require = createRequire(import.meta.url);
const MAX_PX = 2048; // plenty for a 30 cm book, and keeps a 48 MP photo from costing a gigabyte

// The barcode reader's .wasm from node_modules, not the CDN it fetches by default.
prepareZXingModule({ overrides: { wasmBinary: readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm')) } });

/** Where a picture came from, for the sidecar: never GPS or serial numbers, as sidecars may be published. */
export interface Source {
  file: string;
  page?: number;
  format: string;
  width: number; // original pixels, before scaling to MAX_PX
  height: number;
  bytes: number;
  camera?: string;
  lens?: string;
  takenAt?: string; // the camera's own clock, with its UTC offset when it wrote one
  time?: number; // seconds into a video, for one of its frames
  face?: string; // cut from the photo as this face, where the vision models found it
  agreed?: boolean; // where two models or more (or a person) put that face, not one alone
}

export interface Picture { data: Buffer; width: number; height: number; transparent: boolean; source: Source }

/** A video, by its name: an iPhone shoots MOV, Android MP4. */
export const VIDEO = /\.(mov|mp4|m4v|3gp|mkv|webm|avi)$/i;
const FRAMES = 6; // kept from a video, spread across it: a handful of angles for the vision models
const SAMPLES = 4; // looked at for each frame kept, the sharpest kept: a moving phone blurs some
// HDR video (an iPhone's HLG, HDR10's PQ) toned down to an ordinary picture with filters every ffmpeg build has (the
// usual zscale is missing from Homebrew's): ITU-R BT.2100's curves to linear light, reference white (BT.2408) at a
// fifth of full scale; BT.2020's colors to BT.709's; then reference white just under full, highlights rolled off
// above it, and the sRGB curve.
const LINEAR: Record<string, string> = {
  'arib-std-b67': 'maxval*0.7548*if(lte(val/maxval,0.5),pow(val/maxval,2)/3,(exp((val/maxval-0.55991073)/0.17883277)+0.28466892)/12)',
  smpte2084: 'maxval*min(1,9.8522*pow(max(pow(val/maxval,0.012683313)-0.8359375,0)/(18.8515625-18.6875*pow(val/maxval,0.012683313)),6.2773946))',
};
const WHITE = 'if(lte(5*val/maxval,0.8),5*val/maxval,1-0.2*exp(4-25*val/maxval))'; // reference white 1, rolled off above 0.8
const SDR = `maxval*if(lte(${WHITE},0.0031308),12.92*${WHITE},1.055*pow(${WHITE},0.41666667)-0.055)`;
const TO_BT709 = 'colorchannelmixer=rr=1.6605:rg=-0.5876:rb=-0.0728:gr=-0.1246:gg=1.1329:gb=-0.0083:br=-0.0182:bg=-0.1006:bb=1.1187';
const lut = (curve: string) => `lutrgb=r='${curve}':g='${curve}':b='${curve}'`;

/** Every picture in a file or encoded image (`name` labels a buffer): one, one per page of a PDF, or a video's frames. */
export async function load(input: string | Buffer, name = 'picture'): Promise<Picture[]> {
  if (typeof input === 'string' && VIDEO.test(input)) return frames(input);
  const bytes = typeof input === 'string' ? await readFile(input) : input;
  const file = typeof input === 'string' ? path.basename(input) : name;
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') {
    return Promise.all((await pdfPages(bytes)).map(({ image, width, height }, i) =>
      upright(image, { file, page: i + 1, format: 'pdf', width, height, bytes: bytes.length })));
  }
  const { format = 'unknown', compression, width = 1, height = 1, density = 72, exif } = await sharp(bytes).metadata();
  const source: Source = { file, format: compression === 'hevc' ? 'heic' : format, width, height, bytes: bytes.length, ...camera(exif) };
  if (compression === 'hevc') return [await upright(await heic(bytes), source)];
  // An SVG is drawn at the size it asks for; draw it big enough to stay sharp.
  const svgDensity = format === 'svg' ? Math.min(100_000, (density * MAX_PX) / Math.max(width, height)) : undefined;
  return [await upright(sharp(bytes, { density: svgDensity }).rotate(), source)];
}

async function upright(image: Sharp, source: Source): Promise<Picture> {
  const { data, info } = await image
    .resize(MAX_PX, MAX_PX, { fit: 'inside', withoutEnlargement: true })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let transparent = false;
  for (let i = 3; i < data.length && !transparent; i += 4) transparent = data[i] < 128;
  return { data, width: info.width, height: info.height, transparent, source };
}

/**
 * A handful of a video's frames, spread across it, each the sharpest of its stretch, turned as the phone
 * was held, HDR toned down. ffmpeg decodes them: a program of its own (GPL; run, never bundled, so Thicken
 * stays MIT), found on the PATH, and needed only for video.
 */
async function frames(file: string): Promise<Picture[]> {
  const run = (program: string, args: string[]) => new Promise<string>((resolve, reject) => {
    execFile(program, ['-v', 'error', ...args], (error, stdout, stderr) => {
      if (!error) resolve(stdout);
      else if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error('reading a video needs ffmpeg installed (winget install Gyan.FFmpeg, brew install ffmpeg, or apt install ffmpeg), or leave the video out'));
      } else reject(new Error(`${program} couldn't read ${path.basename(file)}: ${stderr.trim().split('\n').pop()}`));
    });
  });
  const input = `file:${path.resolve(file)}`; // file:, so no name is ever taken for a URL or another protocol
  const probe = JSON.parse(await run('ffprobe', ['-select_streams', 'v:0', '-show_entries',
    'stream=codec_name,width,height,color_transfer:stream_side_data=rotation:format=duration', '-of', 'json', '-i', input]));
  const video = probe.streams?.[0];
  if (!video) throw new Error(`${path.basename(file)} has no video in it`);
  const turned = Math.abs(video.side_data_list?.find((d: { rotation?: number }) => d.rotation !== undefined)?.rotation ?? 0) % 180 === 90;
  const source = { file: path.basename(file), format: video.codec_name, width: turned ? video.height : video.width, height: turned ? video.width : video.height, bytes: (await stat(file)).size };
  const rate = (FRAMES * SAMPLES) / (Number(probe.format?.duration) || 10);
  const dir = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  try {
    const linear = LINEAR[video.color_transfer]; // HDR: BT.2020 colors, whether or not the frames themselves say so
    const filters = [`fps=${rate}`, `scale=w='min(${MAX_PX},iw)':h='min(${MAX_PX},ih)':force_original_aspect_ratio=decrease${linear ? ':in_color_matrix=bt2020' : ''}`,
      ...(linear ? ['format=rgb48le', lut(linear), TO_BT709, lut(SDR)] : []), 'format=rgb24'];
    // PNG, so the colors arrive as ffmpeg made them; capped at the frames wanted, whatever a broken duration says.
    await run('ffmpeg', ['-nostdin', '-i', input, '-vf', filters.join(','), '-frames:v', String(FRAMES * SAMPLES), path.join(dir, '%03d.png')]);
    const names = (await readdir(dir)).sort();
    if (!names.length) throw new Error(`no frames could be read from ${path.basename(file)}`);
    const kept: { picture: Picture; sharpness: number }[] = [];
    for (const [k, name] of names.entries()) {
      const stretch = Math.floor((k * FRAMES) / names.length);
      // Read whole, so no file is left open: Windows won't delete an open file.
      const picture = await upright(sharp(await readFile(path.join(dir, name))), { ...source, time: Math.round((k / rate) * 10) / 10 });
      const { sharpness } = await measure(picture);
      if (!kept[stretch] || sharpness > kept[stretch].sharpness) kept[stretch] = { picture, sharpness };
    }
    return kept.filter(Boolean).map(({ picture }) => picture);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {}); // a temp folder left behind costs disk, not the run
  }
}

/**
 * Camera, lens and capture time from EXIF. The time is the camera's own clock
 * plus the offset it wrote, if any, never converted: exif-reader reads the
 * local time as if it were UTC, so only its wall-clock digits are used.
 */
function camera(exif?: Buffer): Pick<Source, 'camera' | 'lens' | 'takenAt'> {
  if (!exif) return {};
  try {
    const { Image = {}, Photo = {} } = exifReader(exif) as { Image?: Record<string, unknown>; Photo?: Record<string, unknown> };
    const taken = Photo.DateTimeOriginal;
    return {
      camera: [Image.Make, Image.Model].filter(Boolean).join(' ') || undefined,
      lens: typeof Photo.LensModel === 'string' ? Photo.LensModel : undefined,
      takenAt: taken instanceof Date && !Number.isNaN(taken.getTime())
        ? taken.toISOString().slice(0, 19) + (typeof Photo.OffsetTimeOriginal === 'string' ? Photo.OffsetTimeOriginal : '')
        : undefined,
    };
  } catch {
    return {}; // unreadable EXIF costs the record, not the model
  }
}

/**
 * What the subject looks like, on a copy shrunk to 512 px so sizes compare:
 * - sharpness: the spread of a Laplacian, lightly blurred first so sensor
 *   noise and JPEG blocks don't pass for detail;
 * - color: the mean, as [r, g, b];
 * - stripes: how much more it changes across its long side than along it.
 *   Stacked page edges are fine lines running the length of the photo, so
 *   they score high; a printed spine changes both ways.
 */
export async function measure(picture: Picture): Promise<{ sharpness: number; color: number[]; stripes: number }> {
  const box = subjectBox(picture);
  // Shrunk once, not once per measure: three times faster, which a video's frames, each measured, need.
  const small = await sharp(picture.data, { raw: { width: picture.width, height: picture.height, channels: 4 } })
    .extract(box).resize(512, 512, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
  const crop = () => sharp(small.data, { raw: small.info });
  // stats() reads a pipeline's input, not its result, so each result is rendered first.
  const stats = async (image: Sharp) => {
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
    return sharp(data, { raw: info }).stats();
  };
  // Sobel, scaled down so strong edges don't clip at the 0–255 limit.
  const energy = async (kernel: number[]) =>
    (await stats(crop().grayscale().convolve({ width: 3, height: 3, kernel, scale: 8, offset: 128 }))).channels[0].stdev;
  const [edges, tones, dx, dy] = await Promise.all([
    stats(crop().grayscale().blur(1).convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], offset: 128 })),
    stats(crop()),
    energy([-1, 0, 1, -2, 0, 2, -1, 0, 1]),
    energy([-1, -2, -1, 0, 0, 0, 1, 2, 1]),
  ]);
  const [across, along] = box.width < box.height ? [dx, dy] : [dy, dx];
  return {
    sharpness: Math.round(edges.channels[0].stdev * 100) / 100,
    color: tones.channels.slice(0, 3).map((c) => Math.round(c.mean)),
    stripes: Math.round((across / Math.max(along, 0.01)) * 100) / 100,
  };
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
async function pdfPages(bytes: Buffer): Promise<{ image: Sharp; width: number; height: number }[]> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const pages: { image: Sharp; width: number; height: number }[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const images = await extractImages(pdf, n);
    if (images.length === 0) throw new Error(`PDF page ${n} has no picture on it: only scanned PDFs work`);
    const { data, width, height, channels } = images.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
    // ponytail: honors the page's /Rotate only; a scan drawn turned by its content stream would come out sideways.
    const { rotate } = await pdf.getPage(n);
    const image = sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width, height, channels } }).rotate(rotate);
    pages.push({ image, width, height });
  }
  return pages;
}

/** The barcodes and QR codes in a picture that pass their own checksums, each with where its middle is. */
export async function codes({ data, width, height }: Picture): Promise<{ format: string; text: string; at: number[] }[]> {
  const found = await readBarcodes({ data: new Uint8ClampedArray(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength), width, height, colorSpace: 'srgb' });
  return found.filter((code) => code.isValid).map(({ format, text, position: { topLeft, topRight, bottomRight, bottomLeft } }) => {
    const corners = [topLeft, topRight, bottomRight, bottomLeft];
    return { format, text, at: [corners.reduce((sum, p) => sum + p.x, 0) / 4, corners.reduce((sum, p) => sum + p.y, 0) / 4] };
  });
}

/** Four corners that make a face: convex and wound one way, not a line, a bow tie or a dent (any of which warps to nothing). */
export function isQuad(corners: number[][]): boolean {
  const turns = corners.map((p, k) => {
    const [q, r] = [corners[(k + 1) % 4], corners[(k + 2) % 4]];
    return (q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]);
  });
  return turns.every((t) => t > 0) || turns.every((t) => t < 0);
}

/** Whether a point lies within a face's four corners. */
export function inside([x, y]: number[], corners: number[][]): boolean {
  const sides = corners.map((p, k) => {
    const q = corners[(k + 1) % 4];
    return (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
  });
  return sides.every((s) => s >= 0) || sides.every((s) => s <= 0);
}

/** Average color of the opaque pixels in columns [x0, x1), as #rrggbb. */
export function columnColor({ data, width, height }: Picture, x0: number, x1: number): string {
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
 * A picture as a JPEG for a box face, with its size and the color along its
 * left edge. A lifted subject is cropped to itself, and its see-through
 * corners are filled with that edge color.
 */
export async function texture(picture: Picture): Promise<{ jpeg: Buffer; width: number; height: number; edge: string }> {
  const { left, top, width, height } = subjectBox(picture);
  const edge = columnColor(picture, left, left + 4);
  const jpeg = await sharp(picture.data, { raw: { width: picture.width, height: picture.height, channels: 4 } })
    .extract({ left, top, width, height })
    .flatten({ background: edge })
    .jpeg({ quality: 90 })
    .toBuffer();
  return { jpeg, width, height, edge };
}

/**
 * The part of a picture inside four corners (in pixels: the face's own top-left, top-right, bottom-right,
 * bottom-left), straightened into an upright rectangle the size of its sides. A perspective warp, sampled
 * bilinearly; corners past the picture's edge repeat its border.
 */
export function straighten(picture: Picture, corners: number[][]): Picture {
  const [tl, tr, br, bl] = corners;
  const side = (a: number[], b: number[]) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const width = Math.max(1, Math.round((side(tl, tr) + side(bl, br)) / 2));
  const height = Math.max(1, Math.round((side(tl, bl) + side(tr, br)) / 2));
  const [a, b, c, d, e, f, g, h] = homography([[0, 0], [width, 0], [width, height], [0, height]], corners);
  const { data: from, width: w, height: hh } = picture;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Pixel centers both ways: (x + 0.5, y + 0.5) out, minus 0.5 back to the picture's pixel grid.
      const [px, py] = [x + 0.5, y + 0.5];
      const z = g * px + h * py + 1;
      const u = Math.min(w - 1, Math.max(0, (a * px + b * py + c) / z - 0.5));
      const v = Math.min(hh - 1, Math.max(0, (d * px + e * py + f) / z - 0.5));
      const [x0, y0] = [Math.floor(u), Math.floor(v)];
      const [x1, y1] = [Math.min(w - 1, x0 + 1), Math.min(hh - 1, y0 + 1)];
      const [fx, fy] = [u - x0, v - y0];
      for (let k = 0; k < 4; k++) {
        const top = from[(y0 * w + x0) * 4 + k] * (1 - fx) + from[(y0 * w + x1) * 4 + k] * fx;
        const bottom = from[(y1 * w + x0) * 4 + k] * (1 - fx) + from[(y1 * w + x1) * 4 + k] * fx;
        data[(y * width + x) * 4 + k] = Math.round(top * (1 - fy) + bottom * fy);
      }
    }
  }
  return { data, width, height, transparent: false, source: picture.source };
}

/**
 * A face's corners moved onto its real edges: the vision models' corners are
 * about 1% off, enough to leave a sliver of table at a texture's border. At
 * points along each side, every place across a narrow band where the
 * brightness steps (a local peak) is a candidate; a candidate line is one
 * through such places at most of the points, which a tilted side still is.
 * Of those, the side takes the one nearest the models' line: print near the
 * edge, or the page block beyond it, can step harder than the outline, but the
 * models are only about 1% out. Neighboring lines meet at the new corners. A
 * side with no line along most of its length keeps its own, and corners that
 * would move further than the band keep their place.
 */
export function snap(picture: Picture, corners: number[][]): number[][] {
  const { width: w, height: h, data } = picture;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  const at = (x: number, y: number) => {
    const [cx, cy] = [Math.min(w - 1.001, Math.max(0, x)), Math.min(h - 1.001, Math.max(0, y))];
    const [x0, y0] = [Math.floor(cx), Math.floor(cy)];
    const [fx, fy] = [cx - x0, cy - y0];
    const k = y0 * w + x0;
    return (gray[k] * (1 - fx) + gray[k + 1] * fx) * (1 - fy) + (gray[k + w] * (1 - fx) + gray[k + w + 1] * fx) * fy;
  };
  const sides = corners.map((a, i) => [a, corners[(i + 1) % 4]]);
  const shortest = Math.min(...sides.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1])));
  const band = Math.max(2, Math.round(Math.min(0.02 * Math.hypot(w, h), 0.25 * shortest))); // px either side

  // Each side as a line: a point on it and its direction.
  const lines = sides.map(([a, b]) => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const d = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    const n = [-d[1], d[0]];
    const along = [...Array(SNAP_SAMPLES).keys()].map((k) => length * (0.15 + (0.7 * k) / (SNAP_SAMPLES - 1)));
    // The brightness step across the side at a point, over a few pixels, as a size.
    const step = (s: number, t: number) => {
      const [x, y] = [a[0] + s * d[0] + t * n[0], a[1] + s * d[1] + t * n[1]];
      return Math.abs(at(x + 1.5 * n[0], y + 1.5 * n[1]) - at(x - 1.5 * n[0], y - 1.5 * n[1]));
    };
    // At each point along the side, the offsets across the band where the brightness step peaks hardest.
    const peaks = along.map((s) => {
      const sizes = [...Array(2 * band + 1).keys()].map((k) => step(s, k - band));
      return sizes.flatMap((size, k) => (size >= SNAP_MIN_STEP && size >= (sizes[k - 1] ?? 0) && size > (sizes[k + 1] ?? 0) ? [[size, k - band]] : []))
        .sort((x, y) => y[0] - x[0]).slice(0, SNAP_PEAKS).map(([, t]) => t);
    });
    // Candidate lines through a peak near each end of the side; one is an edge where most points have a peak on it.
    let best: { points: number[][]; distance: number } | undefined;
    for (let i = 0; i < SNAP_ENDS; i++) {
      for (let j = SNAP_SAMPLES - SNAP_ENDS; j < SNAP_SAMPLES; j++) {
        for (const t1 of peaks[i]) {
          for (const t2 of peaks[j]) {
            const lineAt = (s: number) => t1 + ((t2 - t1) * (s - along[i])) / (along[j] - along[i]);
            const points = along.flatMap((s, k) => {
              const t = peaks[k].find((p) => Math.abs(p - lineAt(s)) <= 1.5);
              return t === undefined ? [] : [[s, t]];
            });
            if (points.length < SNAP_SAMPLES / 2) continue;
            const distance = Math.abs(lineAt(along[0])) + Math.abs(lineAt(along[SNAP_SAMPLES - 1]));
            if (!best || distance < best.distance || (distance === best.distance && points.length > best.points.length)) best = { points, distance };
          }
        }
      }
    }
    if (!best) return { a, d, snapped: false };
    // Least squares through its points, t as a line in s.
    const on = best.points;
    const [ms, mt] = [on.reduce((sum, p) => sum + p[0], 0) / on.length, on.reduce((sum, p) => sum + p[1], 0) / on.length];
    const slope = on.reduce((sum, p) => sum + (p[0] - ms) * (p[1] - mt), 0) / (on.reduce((sum, p) => sum + (p[0] - ms) ** 2, 0) || 1);
    const line = (s: number) => mt + slope * (s - ms);
    const p0 = [a[0] + line(0) * n[0], a[1] + line(0) * n[1]];
    const p1 = [a[0] + length * d[0] + line(length) * n[0], a[1] + length * d[1] + line(length) * n[1]];
    const span = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    return { a: p0, d: [(p1[0] - p0[0]) / span, (p1[1] - p0[1]) / span], snapped: true };
  });

  if (!lines.some(({ snapped }) => snapped)) return corners;
  // Each corner where its two sides' lines meet.
  const snapped = corners.map((corner, i) => {
    const [l1, l2] = [lines[(i + 3) % 4], lines[i]];
    const cross = l1.d[0] * l2.d[1] - l1.d[1] * l2.d[0];
    if (Math.abs(cross) < 1e-6) return corner;
    const u = ((l2.a[0] - l1.a[0]) * l2.d[1] - (l2.a[1] - l1.a[1]) * l2.d[0]) / cross;
    return [l1.a[0] + u * l1.d[0], l1.a[1] + u * l1.d[1]];
  });
  return snapped.every((p, i) => Math.hypot(p[0] - corners[i][0], p[1] - corners[i][1]) <= 1.5 * band) ? snapped : corners;
}

const SNAP_SAMPLES = 41; // points along each side
const SNAP_MIN_STEP = 4; // gray levels: a brightness step smaller than this is no edge
const SNAP_PEAKS = 5; // the strongest steps kept at each point (wood grain and print make many)
const SNAP_ENDS = 6; // points at each end of a side that candidate lines are drawn between

/** Points inside four corners taken to the same places inside four others, by the perspective transform between them. */
export function mapping(from: number[][], to: number[][]): (point: number[]) => number[] {
  const [a, b, c, d, e, f, g, h] = homography(from, to);
  return ([x, y]) => {
    const z = g * x + h * y + 1;
    return [(a * x + b * y + c) / z, (d * x + e * y + f) / z];
  };
}

/** The 3 × 3 perspective transform (last entry 1) taking four points to four others: eight equations, solved by elimination. */
function homography(from: number[][], to: number[][]): number[] {
  const rows = from.flatMap(([x, y], i) => {
    const [u, v] = to[i];
    return [[x, y, 1, 0, 0, 0, -x * u, -y * u, u], [0, 0, 0, x, y, 1, -x * v, -y * v, v]];
  });
  for (let col = 0; col < 8; col++) {
    const pivot = rows.slice(col).reduce((best, row, i) => (Math.abs(row[col]) > Math.abs(rows[best][col]) ? col + i : best), col);
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const factor = rows[r][col] / rows[col][col];
      for (let k = col; k < 9; k++) rows[r][k] -= factor * rows[col][k];
    }
  }
  return rows.map((row, i) => row[8] / row[i]);
}

/** A texture turned a quarter turn, clockwise unless said otherwise. */
export async function turned(t: Awaited<ReturnType<typeof texture>>, clockwise = true) {
  return { ...t, jpeg: await sharp(t.jpeg).rotate(clockwise ? 90 : -90).jpeg({ quality: 90 }).toBuffer(), width: t.height, height: t.width };
}
