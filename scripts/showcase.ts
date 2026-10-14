// A README showcase picture: the photos a model was made from, fanned like prints dropped on a table (the first on
// top), an arrow, and the model turning (scripts/turntable.ts), as one animated WebP on a transparent background. A
// dataset photo's gray letterbox bars are trimmed off.
//   node scripts/showcase.ts <out.webp> <turning.webp> <photo>... [--height 480] [--fps 20]
import { parseArgs } from 'node:util';
import sharp from 'sharp';

const { positionals: [out, turning, ...photos], values } = parseArgs({
  allowPositionals: true,
  options: { height: { type: 'string', default: '480' }, fps: { type: 'string', default: '20' } },
});
if (!out || !turning || !photos.length) throw new Error('usage: node scripts/showcase.ts <out.webp> <turning.webp> <photo>... [--height 480]');
const height = Number(values.height);
const PRINT = Math.round(height * 0.66); // each photo's height: fanned, they span about the model's
const STEP = Math.round(height * 0.175); // how far each print lies right of the one on top of it
const BLUR = Math.round(height / 40); // the soft shadow under each print
const ARROW = Math.round(height * 0.14);
const GRAY = '#8b949e'; // GitHub's muted gray: the arrow reads on its light and dark pages alike
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

/** A photo as a print, its corners rounded and turned by `angle` degrees, over its soft shadow (offset down and right). */
async function print(file: string, angle: number) {
  const trimmed = await sharp(await sharp(file).rotate().trim({ background: '#808080', threshold: 12 }).toBuffer()).resize({ height: PRINT }).png().toBuffer();
  const { width = 0 } = await sharp(trimmed).metadata();
  const round = Buffer.from(`<svg width="${width}" height="${PRINT}"><rect width="${width}" height="${PRINT}" rx="${Math.round(PRINT * 0.035)}"/></svg>`);
  const turned = await sharp(await sharp(trimmed).composite([{ input: round, blend: 'dest-in' }]).png().toBuffer()).rotate(angle, { background: CLEAR }).png().toBuffer();
  const { width: w = 0, height: h = 0 } = await sharp(turned).metadata();
  const shape = Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" fill-opacity="0.35"/></svg>`);
  const shadow = await sharp(await sharp(turned).composite([{ input: shape, blend: 'in' }]).png().toBuffer())
    .extend({ top: 2 * BLUR, bottom: 2 * BLUR, left: 2 * BLUR, right: 2 * BLUR, background: CLEAR }).blur(BLUR).png().toBuffer();
  const [dx, dy] = [Math.round(BLUR / 3), Math.round(BLUR / 1.5)];
  const pad = 2 * BLUR;
  const data = await sharp(shadow).extend({ top: dy, left: dx, background: CLEAR })
    .composite([{ input: turned, left: pad, top: pad }]).png().toBuffer();
  return { data, width: w + 2 * pad + dx, height: h + 2 * pad + dy };
}

// The prints fanned: the first (the front) on top, at the left and lowest, turned a little left; the rest each further
// right, higher and turned the other way.
const n = photos.length;
const prints = await Promise.all(photos.map((photo, i) => print(photo, n === 1 ? -4 : -5 + (12 * i) / (n - 1))));
const placed = prints.map((p, i) => ({
  ...p,
  left: i * STEP,
  top: n === 1 ? Math.round((height - p.height) / 2) : Math.round(((n - 1 - i) / (n - 1)) * (height - p.height)),
}));
const fan = Math.max(...placed.map((p) => p.left + p.width));
const arrow = Buffer.from(`<svg width="${ARROW}" height="${height}"><path d="M${ARROW * 0.12} ${height / 2} H${ARROW * 0.85} M${ARROW * 0.62} ${height / 2 - ARROW * 0.2} L${ARROW * 0.87} ${height / 2} L${ARROW * 0.62} ${height / 2 + ARROW * 0.2}" fill="none" stroke="${GRAY}" stroke-width="${Math.max(2, ARROW * 0.06)}" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
const layers = [...placed.map(({ data, left, top }) => ({ input: data, left, top: Math.max(0, top) })).reverse(), { input: arrow, left: fan, top: 0 }];

// Every frame decoded at once (one tall strip, a page per frame), then cut apart: decoding page by page decodes all
// the pages before each one again.
const { data: strip, info } = await sharp(turning, { animated: true }).raw().toBuffer({ resolveWithObject: true });
const pageHeight = info.pageHeight ?? info.height;
const bytes = info.width * pageHeight * info.channels;
const frames = await Promise.all(Array.from({ length: info.height / pageHeight }, (_, page) =>
  sharp(strip.subarray(page * bytes, (page + 1) * bytes), { raw: { width: info.width, height: pageHeight, channels: info.channels } })
    .resize({ height }).png().toBuffer({ resolveWithObject: true })));
const left = fan + ARROW;
const width = left + frames[0].info.width;
const still = await sharp({ create: { width, height, channels: 4, background: CLEAR } }).composite(layers).png().toBuffer();

const composed = await Promise.all(frames.map(({ data }) => sharp(still).composite([{ input: data, left, top: 0 }]).png().toBuffer()));
await sharp(composed, { join: { animated: true } })
  .webp({ quality: 85, alphaQuality: 100, effort: 6, loop: 0, delay: composed.map(() => Math.round(1000 / Number(values.fps))) })
  .toFile(out);
console.log(`${out}: ${width} × ${height}, ${composed.length} frames`);
