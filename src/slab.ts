// The graded-card profile: a slab at its holder's size, with the front and
// back photos on its faces and clear-plastic edges. The photos are used as
// they are, so crop them to the slab's edges (or use a scanner app).
import { box, type Side } from './glb.ts';
import { texture, type Picture } from './image.ts';
import type { Faces } from './thicken.ts';

// ponytail: graders don't publish exterior holder sizes, and the figures online disagree by 1–5 mm across
// sources and holder generations. These are the best found (2026-10-01); measure real holders and correct
// them. --size overrides per model. A QR code says the grader, not the holder, so a tall boy needs --holder.
export const HOLDERS: Record<string, number[]> = { // width, height, depth in mm
  psa: [80.5, 136, 6.5], // collector caliper measurements
  'psa-thick': [80.5, 136, 10.25],
  'psa-tall': [108, 184, 6.5], // tall boys (1969–70 Topps basketball…): 4¼ × 7¼ in per Collectors Universe; depth assumed
  bgs: [83, 131, 8.5],
  cgc: [80.5, 135, 7.5],
  sgc: [86.5, 138.5, 8.5],
  tag: [79.5, 133.5, 7.5], // TAG's help center: 3.125 × 5.25 in, 7.5 mm at the raised lip
};
const PLASTIC: Side = { color: '#dfe3e6', roughness: 0.15 };
const SHAPE_TOLERANCE = 0.04;

/** What the label's codes said: grader, cert number, and the grader's verification page. */
export interface Label { grader?: string; cert?: string; verifyUrl?: string }

/** Pictures in order: front, back. With no holder named or read off a QR code, a PSA-size holder is assumed, and said so. */
export async function slab(pictures: Picture[], { holder, sizeMm = [], label = {} }: { holder?: string; sizeMm?: number[]; label?: Label } = {}) {
  const warnings: string[] = [];
  if (!holder && sizeMm.length < 3) warnings.push('the grader isn\'t identified (no QR code to its site), so it\'s a PSA-size holder: name it with --holder');
  holder ??= 'psa';
  const size = [0, 1, 2].map((i) => sizeMm[i] ?? HOLDERS[holder]?.[i]);
  if (size.some((mm) => mm === undefined)) {
    throw new Error(`no size on file for a "${holder}" holder (known: ${Object.keys(HOLDERS).join(', ')}): measure one and pass --size WxHxD in mm`);
  }
  if (pictures.length === 0) throw new Error('a slab needs a photo of its front');
  const [front, back] = await Promise.all(pictures.slice(0, 2).map(texture));
  for (const [i, photo] of [front, back].entries()) {
    if (photo && Math.abs(photo.width / photo.height / (size[0] / size[1]) - 1) > SHAPE_TOLERANCE) {
      warnings.push(`the ${i ? 'back' : 'front'} photo isn't the shape of a ${holder} holder: crop it to the slab's edges, or name the right --holder`);
    }
  }
  if (pictures.length > 2) warnings.push(`${pictures.length - 2} picture(s) not used: a slab takes a front and a back`);
  const glb = await box('slab', size, {
    front: { picture: front.jpeg },
    back: back ? { picture: back.jpeg } : PLASTIC,
    left: PLASTIC, right: PLASTIC, top: PLASTIC, bottom: PLASTIC,
  });
  return {
    glb,
    sidecar: {
      profile: 'slab', holder, ...label,
      widthMm: size[0], heightMm: size[1], depthMm: size[2], measuredBy: sizeMm.length ? 'measured' : 'table',
      faces: { front: 'photo', back: back ? 'photo' : 'plastic' } satisfies Faces, warnings,
    },
  };
}
