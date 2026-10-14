// A README showcase picture: the photos a model was made from, flat and stacked in one column as tall as the model (so
// a second photo makes it no wider), beside the model turning (scripts/turntable.ts), as one animated WebP on a
// transparent background. A dataset photo's gray letterbox bars are trimmed off.
//   node scripts/showcase.ts <out.webp> <turning.webp> <photo>... [--height 480] [--fps 20]
import { parseArgs } from 'node:util';
import sharp from 'sharp';

const { positionals: [out, turning, ...photos], values } = parseArgs({
  allowPositionals: true,
  options: { height: { type: 'string', default: '480' }, fps: { type: 'string', default: '20' } },
});
if (!out || !turning || !photos.length) throw new Error('usage: node scripts/showcase.ts <out.webp> <turning.webp> <photo>... [--height 480]');
const height = Number(values.height);
const GAP = Math.round(height / 12);
const STACKED = Math.round(GAP / 2); // between the photos: they read as a pair
const each = Math.floor((height - STACKED * (photos.length - 1)) / photos.length);

const flat = await Promise.all(photos.map(async (photo) => {
  const trimmed = await sharp(photo).rotate().trim({ background: '#808080', threshold: 12 }).toBuffer();
  const { data, info } = await sharp(trimmed).resize({ height: each }).png().toBuffer({ resolveWithObject: true });
  return { data, width: info.width };
}));
const column = Math.max(...flat.map((photo) => photo.width));
const layers = flat.map((photo, i) => ({ input: photo.data, left: Math.round((column - photo.width) / 2), top: i * (each + STACKED) }));
// Every frame decoded at once (one tall strip, a page per frame), then cut apart: decoding page by page decodes all
// the pages before each one again.
const { data: strip, info } = await sharp(turning, { animated: true }).raw().toBuffer({ resolveWithObject: true });
const pageHeight = info.pageHeight ?? info.height;
const bytes = info.width * pageHeight * info.channels;
const frames = await Promise.all(Array.from({ length: info.height / pageHeight }, (_, page) =>
  sharp(strip.subarray(page * bytes, (page + 1) * bytes), { raw: { width: info.width, height: pageHeight, channels: info.channels } })
    .resize({ height }).png().toBuffer({ resolveWithObject: true })));
const left = column + GAP;
const width = left + frames[0].info.width;

const composed = await Promise.all(frames.map(({ data }) =>
  sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([...layers, { input: data, left, top: 0 }]).png().toBuffer()));
await sharp(composed, { join: { animated: true } })
  .webp({ quality: 85, alphaQuality: 100, effort: 6, loop: 0, delay: composed.map(() => Math.round(1000 / Number(values.fps))) })
  .toFile(out);
console.log(`${out}: ${width} × ${height}, ${composed.length} frames`);
