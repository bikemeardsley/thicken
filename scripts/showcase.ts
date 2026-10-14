// A README showcase picture: the photos a model was made from, flat, beside the model turning (scripts/turntable.ts),
// as one animated WebP on a transparent background. A dataset photo's gray letterbox bars are trimmed off.
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

const flat = await Promise.all(photos.map(async (photo) => {
  const trimmed = await sharp(photo).rotate().trim({ background: '#808080', threshold: 12 }).toBuffer();
  const { data, info } = await sharp(trimmed).resize({ height }).png().toBuffer({ resolveWithObject: true });
  return { data, width: info.width };
}));
// Every frame decoded at once (one tall strip, a page per frame), then cut apart: decoding page by page decodes all
// the pages before each one again.
const { data: strip, info } = await sharp(turning, { animated: true }).raw().toBuffer({ resolveWithObject: true });
const pageHeight = info.pageHeight ?? info.height;
const bytes = info.width * pageHeight * info.channels;
const frames = await Promise.all(Array.from({ length: info.height / pageHeight }, (_, page) =>
  sharp(strip.subarray(page * bytes, (page + 1) * bytes), { raw: { width: info.width, height: pageHeight, channels: info.channels } })
    .resize({ height }).png().toBuffer({ resolveWithObject: true })));
const left = flat.reduce((x, photo) => x + photo.width + GAP, 0);
const width = left + frames[0].info.width;

const composed = await Promise.all(frames.map(({ data }) => {
  let x = 0;
  const layers = flat.map((photo) => ({ input: photo.data, left: (x += photo.width + GAP) - photo.width - GAP, top: 0 }));
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([...layers, { input: data, left, top: 0 }]).png().toBuffer();
}));
await sharp(composed, { join: { animated: true } })
  .webp({ quality: 85, alphaQuality: 100, effort: 6, loop: 0, delay: composed.map(() => Math.round(1000 / Number(values.fps))) })
  .toFile(out);
console.log(`${out}: ${width} × ${height}, ${composed.length} frames`);
