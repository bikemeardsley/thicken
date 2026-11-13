// A slab's proportions checked by eye: its front photo beside its model drawn flat, at one scale, on white. The
// photo is straightened to the holder's edge as the build took it (the sidecar's outline), at the scale the model was
// built at (the card's, where the card was the ruler); the model is its holder's outline with the label's and the card's own
// pictures where its sidecar says they are. A gap, a size or a place that's off shows as a step between the two.
// thicken's preview is on gray at an angle, where neither can be judged (docs/slab-gap-and-speed.md).
//   node scripts/flat.ts <model.json> <front photo> <out.png> [--px 8]     (px: pixels a millimeter)
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { load, straighten } from '../src/image.ts';

const { positionals: [json, photo, out], values } = parseArgs({ allowPositionals: true, options: { px: { type: 'string', default: '8' } } });
if (!json || !photo || !out) throw new Error('usage: node scripts/flat.ts <model.json> <front photo> <out.png> [--px 8]');
const PX = Number(values.px);
const sidecar = JSON.parse(readFileSync(json, 'utf8'));
const { widthMm: w, heightMm: h, inside } = sidecar;
const [W, H] = [Math.round(w * PX), Math.round(h * PX)];
const white = () => sharp({ create: { width: W, height: H, channels: 3, background: '#fff' } });
/** Where a rectangle given by its size and middle (mm from the holder's middle, y up) is on the canvas. */
const box = ({ widthMm, heightMm, atMm }: { widthMm: number; heightMm: number; atMm: number[] }) => ({
  left: Math.round((w / 2 + atMm[0] - widthMm / 2) * PX), top: Math.round((h / 2 - atMm[1] - heightMm / 2) * PX),
  width: Math.round(widthMm * PX), height: Math.round(heightMm * PX),
});

// The photo: its holder, as outlined, at the model's scale about the holder's middle.
const [picture] = await load(photo);
const flat = straighten(picture, sidecar.outline.front);
const ruler = inside.card.ruler ?? 1;
const seen = box({ widthMm: w * ruler, heightMm: h * ruler, atMm: [0, 0] });
const photoSide = await white().composite([{
  input: await sharp(flat.data, { raw: { width: flat.width, height: flat.height, channels: 4 } }).resize(seen.width, seen.height, { fit: 'fill' }).png().toBuffer(),
  left: seen.left, top: seen.top,
}]).png().toBuffer();

// The model: the holder's edge, and the label's and card's pictures from the GLB.
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(readFileSync(json.replace(/\.json$/i, '.glb')));
const pictureOf = (name: string) => doc.getRoot().listMaterials().find((material) => material.getName() === name)?.getBaseColorTexture()?.getImage();
const parts = await Promise.all((['label', 'card'] as const).flatMap((part) => {
  const image = pictureOf(`${part}-front`);
  const at = box(inside[part]);
  return image ? [sharp(image).resize(at.width, at.height, { fit: 'fill' }).png().toBuffer().then((input) => ({ input, left: at.left, top: at.top }))] : [];
}));
const edge = Buffer.from(`<svg width="${W}" height="${H}"><rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="${2 * PX}" fill="#eef0f2" stroke="#8b949e"/></svg>`);
const modelSide = await white().composite([{ input: edge }, ...parts]).png().toBuffer();

await sharp({ create: { width: 2 * W + 3 * PX, height: H, channels: 3, background: '#fff' } })
  .composite([{ input: photoSide, left: 0, top: 0 }, { input: modelSide, left: W + 3 * PX, top: 0 }]).png().toFile(out);
const { card, label } = inside;
const gap = label.atMm[1] - label.heightMm / 2 - (card.atMm[1] + card.heightMm / 2);
console.log(`${out}: photo left, model right, ${PX} px a mm. Label ${label.widthMm} × ${label.heightMm} mm, card ${card.widthMm} × ${card.heightMm} mm, ${Math.round(gap * 10) / 10} mm between them${ruler === 1 ? '' : `; the card as the ruler (${ruler})`}.`);
