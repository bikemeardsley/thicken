// The graded-card profile: a slab at its holder's size, with the front and
// back photos on its faces and clear-plastic edges. Without a vision roster
// (src/vision.ts) the photos are used as they are, so crop them to the slab's
// edges (or use a scanner app).
import { assignFaces, cut, pictureRecord, shots } from '../faces.ts';
import { box, type Side } from '../glb.ts';
import { subjectBox, type Picture } from '../image.ts';
import type { Code, Faces, Profile, Scanned } from '../thicken.ts';
import type { Sight } from '../vision.ts';

// A grader's QR code points at its own verification page, which says whose holder this is.
const GRADER_SITES: Record<string, string> = { 'psacard.com': 'psa', 'beckett.com': 'bgs', 'cgccards.com': 'cgc', 'gosgc.com': 'sgc', 'taggrading.com': 'tag' };
// Cert numbers: PSA ~8 digits, BGS 10, SGC 7 (older labels 7-3), CGC 7–12, TAG a letter then digits.
const CERT = /^[A-Z]?\d{6,12}$|^\d{7}-\d{3}$/i;
const SLAB_SHAPE_TOLERANCE = 0.06; // a photo this close to a holder's shape, give or take a loose crop

export const slab: Profile = {
  name: 'slab',
  about: 'a graded trading card sealed in a clear plastic holder with a label',
  faces: { front: 'the side with the grade label', back: 'back' },
  read: (scanned, [picture]) => {
    const { use, grader, cert, certFrom, verifyUrl } = readLabel(scanned);
    // A grader's QR code says it's a slab; a cert barcode alone only on a photo shaped like a holder.
    return { recognized: Boolean(grader || (cert && isSlabShaped(picture))), use, grader, cert, certFrom, verifyUrl };
  },
  build: async (pictures, { options, facts, codes, sights }) => {
    const label = { grader: facts.grader as string | undefined, cert: facts.cert as string | undefined, verifyUrl: facts.verifyUrl as string | undefined };
    const { glb, sidecar } = await make(pictures, { holder: options.holder ?? label.grader, sizeMm: options.sizeMm, label, codes, sights });
    return { glb, sidecar: { ...sidecar, identifiedBy: { grader: options.holder ? 'given' : label.grader ? 'qr' : 'assumed', cert: facts.certFrom } } };
  },
};

/**
 * What a slab's label codes say: the grader, cert number and verification
 * page from a QR code to the grader's site, or, on an older label, a cert
 * number from its Code 128 barcode alone. Every code used is marked, on
 * every picture showing it, which is how the photos showing the label are found.
 */
function readLabel(scanned: Scanned[]) {
  const use: (string | undefined)[] = [];
  const found: { grader?: string; cert?: string; certFrom?: 'qr' | 'barcode'; verifyUrl?: string } = {};
  scanned.forEach(({ format, text }, i) => {
    const url = URL.canParse(text) ? new URL(text) : undefined;
    const host = url?.hostname.toLowerCase() ?? '';
    const site = Object.keys(GRADER_SITES).find((s) => host === s || host.endsWith(`.${s}`));
    if (url && site) {
      if (!found.grader) {
        // The cert number is the first path segment, query value or fragment segment that is one, whole.
        const cert = [...url.pathname.split('/'), ...url.searchParams.values(), ...url.hash.split(/[#/?&=]/)].find((part) => CERT.test(part));
        Object.assign(found, { grader: GRADER_SITES[site], verifyUrl: text });
        if (cert) Object.assign(found, { cert: cert.toUpperCase(), certFrom: 'qr' });
      }
      use[i] = 'grader';
    } else if (format === 'Code128' && CERT.test(text) && (!found.cert || found.cert === text.toUpperCase())) {
      if (!found.cert) Object.assign(found, { cert: text.toUpperCase(), certFrom: 'barcode' });
      use[i] = 'cert';
    }
  });
  return { use, ...found };
}

/** A picture the shape of a known slab holder, give or take a loose crop. */
function isSlabShaped(picture?: Picture): boolean {
  if (!picture) return false;
  const { width, height } = subjectBox(picture);
  return Object.values(HOLDERS).some(([w, h]) => Math.abs(width / height / (w / h) - 1) < SLAB_SHAPE_TOLERANCE);
}

// ponytail: graders don't publish exterior holder sizes, and the figures online disagree by 1–5 mm across
// sources and holder generations. These are the best found (2026-10-01); measure real holders and correct
// them. --size overrides per model. A QR code says the grader, not the holder, so a tall boy needs --holder.
const HOLDERS: Record<string, number[]> = { // width, height, depth in mm
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
async function make(
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
  const proofs = codes.filter(({ use }) => use === 'grader' || use === 'cert')
    .map(({ picture, use, at = [] }) => ({ picture, face: use === 'grader' && label.grader === 'cgc' ? 'back' : 'front', at }));
  const { parts, placed } = cut(pictures, sights, proofs);
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
