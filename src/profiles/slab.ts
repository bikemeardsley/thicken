// The graded-card profile: a clear acrylic holder at its real size, with the
// card and the grade label inside it, each cut from the front and back photos.
// With a vision roster (src/vision.ts) the models find the slab, the card and
// the label in each photo; without one, crop the photos to the slab's edges
// (or use a scanner app), and the card and label go where a holder usually
// has them.
import { Document } from '@gltf-transform/core';
import { assignFaces, cut, pictureRecord, shots } from '../faces.ts';
import { addPart, clearMaterial, colorMaterial, pictureMaterial, plate, roundedBox, toGlb, type Side } from '../glb.ts';
import { mapping, straighten, subjectBox, texture, type Picture } from '../image.ts';
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
  faces: { front: 'the side with the grade label', back: 'back', card: 'the card inside the holder', label: 'the grade label inside the holder' },
  note: 'The card and the label are inside the holder, on whichever side is shown: give their corners in the holder\'s own order (top-left as it stands with its label at the top), even when the card is printed sideways.',
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
const SHAPE_TOLERANCE = 0.04;
const ROUNDED_MM = 1.5; // a holder's molded edges
const CARD_MM = [63.5, 88.9]; // a standard card, 2.5 × 3.5 in
const STANDARD_TOLERANCE = 0.05; // a card measured this close to standard is standard: the rest is measurement noise
const CARD_DEPTH_MM = 0.35; // ponytail: a standard card's stock; thick patch cards are thicker
const CARD_CORNER_MM = 3.2; // a modern card's rounded corners, 1/8 in
const LABEL_DEPTH_MM = 0.3;
const GAP_MM = 0.5; // the least space kept between the label and the card
const WALL_MM = 1; // the least plastic kept around anything inside
const CARDSTOCK = '#ece8df';
const LABEL_EDGE = '#f4f4f2';

type Inside = 'card' | 'label';
/** A rectangle in the holder, in mm from its middle, y up, as seen from the front. */
interface Rect { x0: number; x1: number; y0: number; y1: number }

/**
 * Where a holder usually has its label (across the top) and card (below it), for photos with nothing else to go on.
 * ponytail: one layout for every holder, PSA's proportions by eye; measure each grader's if slabs come out off.
 */
function defaultLayout([w, h]: number[]): Record<Inside, Rect> {
  const top = h / 2 - 4.5;
  const label = { x0: -w / 2 + 4, x1: w / 2 - 4, y0: top - 0.16 * h, y1: top };
  return { label, card: { x0: -CARD_MM[0] / 2, x1: CARD_MM[0] / 2, y0: label.y0 - 6 - CARD_MM[1], y1: label.y0 - 6 } };
}

/** The axis-aligned rectangle four corners make: each edge the mean of the two corners nearest it. */
function rectOf(points: number[][]): Rect {
  const [xs, ys] = [0, 1].map((k) => points.map((p) => p[k]).sort((a, b) => a - b));
  return { x0: (xs[0] + xs[1]) / 2, x1: (xs[2] + xs[3]) / 2, y0: (ys[0] + ys[1]) / 2, y1: (ys[2] + ys[3]) / 2 };
}

/** A card measured within a few percent of standard, either way up, at exactly the standard size, where it was. */
function standardCard(r: Rect): Rect {
  const [w, h] = [r.x1 - r.x0, r.y1 - r.y0];
  const [sw, sh] = w > h ? [CARD_MM[1], CARD_MM[0]] : CARD_MM;
  if (Math.abs(w / sw - 1) > STANDARD_TOLERANCE || Math.abs(h / sh - 1) > STANDARD_TOLERANCE) return r;
  const [cx, cy] = [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2];
  return { x0: cx - sw / 2, x1: cx + sw / 2, y0: cy - sh / 2, y1: cy + sh / 2 };
}

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
  // The models' card and label in each photo, kept apart from the slab's own faces, which are what's cut out.
  const inner = (sights ?? []).map((sight) => new Map(sight.faces.filter(({ face }) => face === 'card' || face === 'label').map(({ face, corners }) => [face, corners])));
  const outer = sights?.map((sight) => ({ ...sight, faces: sight.faces.filter(({ face }) => face === 'front' || face === 'back') }));
  const proofs = codes.filter(({ use }) => use === 'grader' || use === 'cert')
    .map(({ picture, use, at = [] }) => ({ picture, face: use === 'grader' && label.grader === 'cgc' ? 'back' : 'front', at }));
  const { parts, placed, from } = cut(pictures, outer, proofs);
  const all = await shots(parts);
  const { chosen, roles, guessedFrontBack } = assignFaces(all, ['front', 'back'], { placed });
  if (guessedFrontBack) review.push('front and back (no QR code or cert barcode: told apart only by photo order, so check they are the right way round)');
  if (chosen.front === undefined) throw new Error('a slab needs a photo of its front');
  const [w, h] = size;
  // Each side's photo, and the ways between the holder and its pixels: through the slab's corners where the models
  // found them, else across the whole photo, cropped to the slab. Seen from behind, the holder's left is on the right.
  const sides = (['front', 'back'] as const).flatMap((side) => {
    const k = chosen[side];
    if (k === undefined) return [];
    const photo = all[k].texture;
    if (Math.abs(photo.width / photo.height / (w / h) - 1) > SHAPE_TOLERANCE) {
      warnings.push(`the ${side} photo isn't the shape of a ${holder} holder: crop it to the slab's edges, or name the right --holder`);
    }
    const { picture, corners } = from[k];
    const { width, height } = pictures[picture];
    const quad = corners ?? [[0, 0], [width, 0], [width, height], [0, height]];
    const mirror = side === 'back' ? -1 : 1;
    const holderQuad = [[-w / 2, h / 2], [w / 2, h / 2], [w / 2, -h / 2], [-w / 2, -h / 2]].map(([x, y]) => [mirror * x, y]);
    const found = corners ? inner[picture] ?? new Map<string, number[][]>() : new Map<string, number[][]>();
    return [{ side, picture, mirror, found, toPhoto: mapping(holderQuad, quad), toHolder: mapping(quad, holderQuad) }];
  });
  const unused = roles.filter((role) => role === 'unused').length;
  if (unused) warnings.push(`${unused} picture(s) not used: none looked like another shot of a face`);

  // Where the card and label are: where the models put them, averaged over both sides; else where a holder usually has them.
  const layout = defaultLayout(size);
  const placedBy = {} as Record<Inside, 'vision' | 'layout'>;
  const rects = {} as Record<Inside, Rect>;
  for (const part of ['card', 'label'] as const) {
    const seen = sides.filter(({ found }) => found.has(part)).map(({ found, toHolder }) => rectOf(found.get(part)!.map(toHolder)));
    placedBy[part] = seen.length ? 'vision' : 'layout';
    rects[part] = seen.length
      ? { x0: mean(seen.map((r) => r.x0)), x1: mean(seen.map((r) => r.x1)), y0: mean(seen.map((r) => r.y0)), y1: mean(seen.map((r) => r.y1)) }
      : layout[part];
  }
  rects.card = standardCard(rects.card);
  rects.label.y0 = Math.min(Math.max(rects.label.y0, rects.card.y1 + GAP_MM), rects.label.y1 - 1); // above the card, never over it
  for (const part of ['card', 'label'] as const) {
    const r = rects[part];
    rects[part] = { x0: Math.max(r.x0, -w / 2 + WALL_MM), x1: Math.min(r.x1, w / 2 - WALL_MM), y0: Math.max(r.y0, -h / 2 + WALL_MM), y1: Math.min(r.y1, h / 2 - WALL_MM) };
  }
  const missed = (['card', 'label'] as const).filter((part) => placedBy[part] === 'layout');
  if (missed.length && sights) review.push(`${missed.join(' and ')} (the vision models didn't find ${missed.length > 1 ? 'them' : 'it'}: placed where a ${holder} holder usually has ${missed.length > 1 ? 'them' : 'it'})`);
  else if (missed.length) warnings.push(`the card and label are placed where a ${holder} holder usually has them: with a vision roster they're found in the photos`);

  // Each side's card and label pictures, straightened from where the models put them, or from where they were placed.
  const pictured: Partial<Record<'front' | 'back', Record<Inside, Buffer>>> = {};
  for (const { side, picture, mirror, found, toPhoto } of sides) {
    const of = async (part: Inside) => {
      const r = rects[part];
      const [left, right] = mirror > 0 ? [r.x0, r.x1] : [r.x1, r.x0];
      const corners = found.get(part) ?? [[left, r.y1], [right, r.y1], [right, r.y0], [left, r.y0]].map(toPhoto);
      return (await texture(straighten(pictures[picture], corners))).jpeg;
    };
    pictured[side] = { card: await of('card'), label: await of('label') };
  }

  // The model: the clear shell, and the card and label inside it, halfway through its depth.
  const doc = new Document();
  const mesh = doc.createMesh('slab');
  const clear: Side = {};
  const [shell] = roundedBox(size, { front: clear, back: clear, left: clear, right: clear, top: clear, bottom: clear }, ROUNDED_MM).values();
  shell.uv.length = 0;
  addPart(doc, mesh, shell, clearMaterial(doc, 'acrylic'));
  const plates = { card: { depth: CARD_DEPTH_MM, corner: CARD_CORNER_MM, edge: CARDSTOCK }, label: { depth: LABEL_DEPTH_MM, corner: 0, edge: LABEL_EDGE } };
  for (const part of ['card', 'label'] as const) {
    const r = rects[part];
    const { depth, corner, edge: color } = plates[part];
    const { front, back, edge } = plate([r.x1 - r.x0, r.y1 - r.y0, depth], corner, [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2]);
    for (const [side, piece] of [['front', front], ['back', back]] as const) {
      const jpeg = pictured[side]?.[part];
      if (!jpeg) piece.uv.length = 0;
      addPart(doc, mesh, piece, jpeg ? pictureMaterial(doc, `${part}-${side}`, jpeg, 'image/jpeg', 0.5) : colorMaterial(doc, `${part}-${side}`, color, 0.8));
    }
    addPart(doc, mesh, edge, colorMaterial(doc, `${part}-edge`, color, 0.8));
  }
  const round = (mm: number) => Math.round(mm * 10) / 10;
  return {
    glb: await toGlb(doc, mesh),
    sidecar: {
      profile: 'slab', holder, ...label,
      widthMm: w, heightMm: h, depthMm: size[2], measuredBy: sizeMm.length ? 'measured' : 'table',
      faces: { front: 'photo', back: pictured.back ? 'photo' : 'color' } satisfies Faces,
      // The card and label inside: their size, where their middles are (mm from the holder's middle, y up), and what placed them.
      inside: Object.fromEntries((['card', 'label'] as const).map((part) => {
        const r = rects[part];
        return [part, { widthMm: round(r.x1 - r.x0), heightMm: round(r.y1 - r.y0), atMm: [round((r.x0 + r.x1) / 2), round((r.y0 + r.y1) / 2)], placedBy: placedBy[part] }];
      })),
      review, warnings, pictures: pictureRecord(all, roles),
    },
  };
}

const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
