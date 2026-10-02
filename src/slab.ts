// The graded-card profile: a slab at its holder's size, with the front and
// back photos on its faces and clear-plastic edges. Without a vision roster
// (src/vision.ts) the photos are used as they are, so crop them to the slab's
// edges (or use a scanner app).
import { assignFaces, cut, pictureRecord, shots } from './faces.ts';
import { box, type Side } from './glb.ts';
import type { Picture } from './image.ts';
import type { Code, Faces } from './thicken.ts';
import type { Sight } from './vision.ts';

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
const ROUNDED_MM = 1.5; // a holder's molded edges

/** What the label's codes said: grader, cert number, and the grader's verification page. */
export interface Label { grader?: string; cert?: string; verifyUrl?: string }

/**
 * Pictures in any number and order (src/faces.ts), with what the vision models
 * saw in each (`sights`), if asked. A whole photo showing the grader's QR code
 * is the front, or for CGC, which prints its QR code on the back of the label,
 * the back; one showing the cert barcode is the front. With no holder named or
 * read off a QR code, a PSA-size holder is assumed and the model marked for
 * review.
 */
export async function slab(
  pictures: Picture[],
  { holder, sizeMm = [], label = {}, codes = [], sights }: { holder?: string; sizeMm?: number[]; label?: Label; codes?: Code[]; sights?: Sight[] } = {},
) {
  const warnings: string[] = [];
  const review: string[] = [];
  if (!holder && sizeMm.length < 3) warnings.push('a PSA-size holder is assumed (no QR code named the grader): --holder for another');
  holder ??= 'psa';
  const size = [0, 1, 2].map((i) => sizeMm[i] ?? HOLDERS[holder]?.[i]);
  if (size.some((mm) => mm === undefined)) {
    throw new Error(`no size on file for a "${holder}" holder (known: ${Object.keys(HOLDERS).join(', ')}): measure one and pass --size WxHxD in mm`);
  }
  const byCodes: string[] = [];
  for (const { picture, use } of codes) {
    if (use === 'grader' || use === 'cert') byCodes[picture] = use === 'grader' && label.grader === 'cgc' ? 'back' : 'front';
  }
  const { parts, placed } = cut(pictures, sights, byCodes);
  const all = await shots(parts);
  const { chosen, roles, guessedFrontBack } = assignFaces(all, ['front', 'back'], { placed });
  if (guessedFrontBack) review.push('front and back (no QR code or cert barcode: told apart only by photo order, so check they are the right way round)');
  const [front, back] = [chosen.front, chosen.back].map((i) => (i === undefined ? undefined : all[i].texture));
  if (!front) throw new Error('a slab needs a photo of its front');
  for (const [i, photo] of [front, back].entries()) {
    if (photo && Math.abs(photo.width / photo.height / (size[0] / size[1]) - 1) > SHAPE_TOLERANCE) {
      warnings.push(`the ${i ? 'back' : 'front'} photo isn't the shape of a ${holder} holder: crop it to the slab's edges, or name the right --holder`);
    }
  }
  const unused = roles.filter((role) => role === 'unused').length;
  if (unused) warnings.push(`${unused} picture(s) not used: none looked like another shot of a face`);
  const glb = await box('slab', size, {
    front: { picture: front.jpeg },
    back: back ? { picture: back.jpeg } : PLASTIC,
    left: PLASTIC, right: PLASTIC, top: PLASTIC, bottom: PLASTIC,
  }, ROUNDED_MM);
  return {
    glb,
    sidecar: {
      profile: 'slab', holder, ...label,
      widthMm: size[0], heightMm: size[1], depthMm: size[2], measuredBy: sizeMm.length ? 'measured' : 'table',
      faces: { front: 'photo', back: back ? 'photo' : 'plastic' } satisfies Faces, review, warnings, pictures: pictureRecord(all, roles),
    },
  };
}
