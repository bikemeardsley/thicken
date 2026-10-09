// The graded-card profile: a clear acrylic holder at its real size, with the
// card and the grade label inside it, each cut from the front and back photos.
// With a vision roster (src/vision.ts) the models find the slab, the card and
// the label in each photo; without one, crop the photos to the slab's edges
// (or use a scanner app), and the card and label go where a holder usually
// has them.
import { Document } from '@gltf-transform/core';
import { assignFaces, cut, pictureRecord, shots, sidesUnknown } from '../faces.ts';
import { cardFoil, foilAsk, foilKind, foilMap, PICTURE_BOX, regionIn, regionOf, rounded, type Region } from '../foil.ts';
import { addPart, clearMaterial, colorMaterial, foiled, pictureMaterial, plate, ring, toGlb } from '../glb.ts';
import { mapping, straighten, subjectBox, texture, type Picture } from '../image.ts';
import type { Faces, Profile, Scanned } from '../thicken.ts';
import { readOf, type Sight } from '../vision.ts';
import { CARD_DEPTH_MM, CARD_MM, CARD_READS, CARDSTOCK, CORNERS_ASK, cornersOf, PT_MM } from './card.ts';

// A grader's QR code points at its own verification page, which says whose holder this is.
const GRADER_SITES: Record<string, string> = { 'psacard.com': 'psa', 'beckett.com': 'bgs', 'cgccards.com': 'cgc', 'gosgc.com': 'sgc', 'taggrading.com': 'tag' };
// Cert numbers: PSA ~8 digits, BGS 10, SGC 7 (older labels 7-3), CGC 7–12, TAG a letter then digits.
const CERT = /^[A-Z]?\d{6,12}$|^\d{7}-\d{3}$/i;
const SLAB_SHAPE_TOLERANCE = 0.06; // a photo this close to a holder's shape, give or take a loose crop

export const slab: Profile = {
  name: 'slab',
  about: 'a graded trading card sealed in a clear plastic holder with a label',
  faces: {
    front: 'the side showing the grade: the label that names the card and gives its grade, and the card\'s face',
    back: 'the reverse: the back of the label (a logo, hologram or QR code, no grade) and the back of the card',
    card: 'the card inside the holder',
    label: 'the grade label insert inside the holder, front or back, to its outer edges: its whole colored border included, none of the clear plastic around it',
    art: 'the picture box on the card\'s front: the artwork\'s panel, to the edge of its frame',
    hologram: 'a shiny holographic security sticker or strip on the label, if there is one',
  },
  note: 'The card, the label, the card\'s picture box and the label\'s hologram are inside the holder, on whichever side is shown: give their corners in the holder\'s own order (top-left as it stands with its label at the top), even when the card is printed sideways.',
  // The label's words: the grade, and the card as the grader describes it.
  reads: {
    grader: 'the grading company (PSA, Beckett, CGC, SGC, TAG…)', grade: 'the grade\'s number or letter ("10", "9.5", "A" for authentic)',
    gradeName: 'the grade\'s words ("GEM MT", "MINT", "PRISTINE")', cert: 'the certification number', subgrades: 'any subgrades, as printed ("Centering 9.5, Corners 9")',
    autograph: 'an autograph or its grade, if the label notes one', ...CARD_READS,
  },
  asks: { corners: CORNERS_ASK, foil: foilAsk('the card\'s front, inside the holder') },
  unsnapped: ['label', 'art', 'hologram'],
  read: (scanned, [picture]) => {
    const { use, grader, cert, certFrom, verifyUrl } = readLabel(scanned);
    // A grader's QR code says it's a slab; a cert barcode alone only on a photo shaped like a holder.
    return { recognized: Boolean(grader || (cert && isSlabShaped(picture))), use, grader, cert, certFrom, verifyUrl };
  },
  build: async (pictures, { options, facts, sights }) => {
    const label = { grader: facts.grader as string | undefined, cert: facts.cert as string | undefined, verifyUrl: facts.verifyUrl as string | undefined };
    // With no QR code to say whose holder it is, the grader the models read off the label.
    const said = String(readOf(sights).read.grader ?? '').toLowerCase();
    const read = Object.keys(HOLDERS).find((holder) => !holder.includes('-') && said.includes(holder)) ?? (said.includes('beckett') ? 'bgs' : undefined);
    const grader = options.holder ?? label.grader ?? read;
    const { glb, sidecar } = await make(pictures, { holder: grader, holderGiven: Boolean(options.holder), sizeMm: options.sizeMm, pt: options.pt, label: { ...label, grader: label.grader ?? read }, sights });
    return { glb, sidecar: { ...sidecar, identifiedBy: { grader: options.holder ? 'given' : label.grader ? 'qr' : read ? 'vision' : 'assumed', cert: facts.certFrom } } };
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
  // ponytail: from one photo (a 1969–70 Topps, 2026-10-03), its tall-boy card (63.5 mm wide) as the ruler; measure one
  'cgc-tall': [113, 195, 7.5],
  sgc: [86.5, 138.5, 8.5],
  tag: [79.5, 133.5, 7.5], // TAG's help center: 3.125 × 5.25 in, 7.5 mm at the raised lip
};
// A grader's label is the same size on every holder: it spans about 87% of a standard holder's width and about 60%
// of a tall one's (real PSA and CGC slabs, 2026-10-03). Under this, the holder is the grader's tall one.
const TALL_LABEL = 0.75;
const SHAPE_TOLERANCE = 0.04;
// A holder's build, from real PSA and CGC slabs straightened at 10 px a mm (2026-10-03). ponytail: one build
// for every holder but its corners; measure others' as their slabs turn up.
const RIM_MM = 2.5; // the rim all round
const RIM_PROUD_MM = 0.5; // how far the rim stands above the window, each face
const FRAME_MM = 1.2; // the ridges framing the label and the card
const FRAME_GAP_MM = 1.2; // between a ridge and what it frames
const SEAM_MM = 0.1; // between pieces that would otherwise share a surface
const EDGE_OPACITY = 0.2; // the rim and ridges, denser than the window's plastic, as their edges catch the light (0.3 looked milky)
const HOLDER_CORNER_MM: Record<string, number> = { psa: 2, 'psa-thick': 2, 'psa-tall': 2, cgc: 4, 'cgc-tall': 4 }; // others 3
// A card shaped like a standard one (cards are cut more exactly than holders are measured) and near its size is one.
const STANDARD_SHAPE = 0.02;
const STANDARD_SIZE = 0.1;
const LABEL_DEPTH_MM = 0.3;
const GAP_MM = 0.5; // the least space kept between the label and the card
const WALL_MM = 1; // the least plastic kept around anything inside
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

/** A card measured with a standard card's shape and near its size, either way up, at exactly the standard size, where it was. */
function standardCard(r: Rect): Rect {
  const [w, h] = [r.x1 - r.x0, r.y1 - r.y0];
  const [sw, sh] = w > h ? [CARD_MM[1], CARD_MM[0]] : CARD_MM;
  if (Math.abs(w / h / (sw / sh) - 1) > STANDARD_SHAPE || Math.abs(w / sw - 1) > STANDARD_SIZE || Math.abs(h / sh - 1) > STANDARD_SIZE) return r;
  const [cx, cy] = [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2];
  return { x0: cx - sw / 2, x1: cx + sw / 2, y0: cy - sh / 2, y1: cy + sh / 2 };
}

/** What the label's codes said: grader, cert number, and the grader's verification page. */
export interface Label { grader?: string; cert?: string; verifyUrl?: string }

/**
 * Pictures in any number and order (src/faces.ts), with what the vision models
 * saw in each (`sights`), if asked. The models say which side each photo shows
 * (the front shows the grade); without them, a lone photo is the front, and
 * two stop the run. A label's codes say what the slab is, not which side they're on: that
 * changes with label designs over the years (current PSA and CGC labels put the QR
 * code on the back, and PSA its cert barcode on both sides). With no holder named
 * or read off a QR code, a PSA-size holder is assumed, warned; a tall one is told
 * by its label (TALL_LABEL).
 */
async function make(
  pictures: Picture[],
  { holder, holderGiven = false, sizeMm = [], pt, label = {}, sights }:
    { holder?: string; holderGiven?: boolean; sizeMm?: number[]; pt?: number; label?: Label; sights?: Sight[] } = {},
) {
  const warnings: string[] = [];
  const review: string[] = [];
  if (!holder && sizeMm.length < 3) warnings.push('a PSA-size holder is assumed (no QR code or label named the grader): --holder for another');
  holder ??= 'psa';
  // The models' card and label in each photo, kept apart from the slab's own faces, which are what's cut out.
  const inner = (sights ?? []).map((sight) => new Map(sight.faces.filter(({ face }) => face !== 'front' && face !== 'back').map(({ face, corners }) => [face, corners])));
  const outer = sights?.map((sight) => ({ ...sight, faces: sight.faces.filter(({ face }) => face === 'front' || face === 'back') }));
  const { parts, placed, from } = cut(pictures, outer);
  const all = await shots(parts);
  const { chosen, roles, undecided } = assignFaces(all, ['front', 'back'], { placed });
  if (undecided) throw sidesUnknown(Boolean(sights));
  if (chosen.front === undefined) throw new Error('a slab needs a photo of its front');
  // A tall holder, told by its label: the same size on every holder, it spans much less of a tall one.
  const front = from[chosen.front];
  const labelQuad = front.corners && inner[front.picture]?.get('label');
  const spans = labelQuad ? widthOf(labelQuad) / widthOf(front.corners!) : 1;
  if (!holderGiven && spans < TALL_LABEL && HOLDERS[`${holder}-tall`]) {
    holder = `${holder}-tall`;
    warnings.push(`taken for a tall holder (${holder}): its label spans ${Math.round(spans * 100)}% of its width, where a standard one's spans about 87%: --holder to say otherwise`);
  }
  const size = [0, 1, 2].map((i) => sizeMm[i] ?? HOLDERS[holder]?.[i]);
  if (size.some((mm) => mm === undefined)) {
    throw new Error(`no size on file for a "${holder}" holder (known: ${Object.keys(HOLDERS).join(', ')}): measure one and pass --size WxHxD in mm`);
  }
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

  // Each side's card and label pictures. The card's from where the models put it on that side (a card can sit a
  // little askew in its well); the label's, one insert printed both sides, from the one rectangle placed for it, so
  // front and back match each other and their plate.
  // A hologram the models found on the label, on either side, is placed within that side's label picture.
  const pictured: Partial<Record<'front' | 'back', Record<Inside, Buffer>>> = {};
  const holograms: Partial<Record<'front' | 'back', Region>> = {};
  for (const { side, picture, mirror, found, toPhoto } of sides) {
    const at = (part: Inside) => {
      const r = rects[part];
      const [left, right] = mirror > 0 ? [r.x0, r.x1] : [r.x1, r.x0];
      const placed = [[left, r.y1], [right, r.y1], [right, r.y0], [left, r.y0]].map(toPhoto);
      return part === 'card' ? found.get(part) ?? placed : placed;
    };
    const of = async (part: Inside) => (await texture(straighten(pictures[picture], at(part)))).jpeg;
    pictured[side] = { card: await of('card'), label: await of('label') };
    const hologram = found.get('hologram');
    if (hologram) holograms[side] = regionOf(hologram, at('label'));
  }

  // The card's foil, as the models see it through the front (src/foil.ts), its picture box placed within the card.
  const foil = foilKind(sights, 'front');
  const artBox = regionIn(sights?.filter(({ faces }) => faces.some(({ face }) => face === 'front')), 'art', 'card');
  const [cardW, cardH] = [rects.card.x1 - rects.card.x0, rects.card.y1 - rects.card.y0];
  const box = artBox ?? (cardH > cardW ? PICTURE_BOX : undefined); // the standard box is a portrait card's
  const shines = foil === 'full' || ((foil === 'holo' || foil === 'reverse') && box !== undefined);
  if ((foil === 'holo' || foil === 'reverse') && !box) review.push(`the card's foil (the models say ${foil}, but found no picture box on this sideways card: left off)`);
  const foils: Record<string, Uint8Array> = shines ? { 'card-front': await cardFoil(foil!, box ?? PICTURE_BOX, cardH / cardW) } : {};
  const labelAspect = (rects.label.y1 - rects.label.y0) / (rects.label.x1 - rects.label.x0);
  for (const [side, region] of Object.entries(holograms)) foils[`label-${side}`] = await foilMap([region], labelAspect);

  // The model, built as a holder is: a rim all round, standing proud of the window it frames, and inside, the
  // label and the card in their compartments, each framed by a ridge. All clear plastic, the rim and ridges a
  // little denser so they read as the edges they are; the card and label halfway through its depth.
  const doc = new Document();
  const mesh = doc.createMesh('slab');
  const d = size[2];
  const corner = HOLDER_CORNER_MM[holder] ?? 3;
  const windowCorner = Math.max(corner - RIM_MM, 0.5);
  const acrylic = clearMaterial(doc, 'acrylic');
  const ridges = clearMaterial(doc, 'acrylic-edges', EDGE_OPACITY);
  addPart(doc, mesh, ring([w, h, d], [w - 2 * RIM_MM, h - 2 * RIM_MM], [corner, windowCorner]), ridges);
  // The window, a hair inside the rim, so no two surfaces coincide.
  const pane = plate([w - 2 * RIM_MM - SEAM_MM, h - 2 * RIM_MM - SEAM_MM, d - 2 * RIM_PROUD_MM], windowCorner);
  for (const piece of [pane.front, pane.back, pane.edge]) {
    piece.uv.length = 0;
    addPart(doc, mesh, piece, acrylic);
  }
  const windowBox: Rect = { x0: -w / 2 + RIM_MM + SEAM_MM, x1: w / 2 - RIM_MM - SEAM_MM, y0: -h / 2 + RIM_MM + SEAM_MM, y1: h / 2 - RIM_MM - SEAM_MM };
  for (const part of ['card', 'label'] as const) {
    const r = rects[part];
    // A ridge round each, inside the window and within its depth; where it meets the rim, it stops there.
    const outer = { x0: Math.max(r.x0 - FRAME_GAP_MM - FRAME_MM, windowBox.x0), x1: Math.min(r.x1 + FRAME_GAP_MM + FRAME_MM, windowBox.x1), y0: Math.max(r.y0 - FRAME_GAP_MM - FRAME_MM, windowBox.y0), y1: Math.min(r.y1 + FRAME_GAP_MM + FRAME_MM, windowBox.y1) };
    const [ow, oh] = [outer.x1 - outer.x0, outer.y1 - outer.y0];
    addPart(doc, mesh, ring([ow, oh, d - 2 * RIM_PROUD_MM - 2 * SEAM_MM], [ow - 2 * FRAME_MM, oh - 2 * FRAME_MM], [0.6, 0.3], [(outer.x0 + outer.x1) / 2, (outer.y0 + outer.y1) / 2]), ridges);
  }
  const cardDepth = Math.min(pt ? pt * PT_MM : CARD_DEPTH_MM, size[2] - 2 * WALL_MM); // a thick card, by its points, as fits
  const { radiusMm, corners, cornersBy } = cornersOf(sights);
  const plates = { card: { depth: cardDepth, corner: radiusMm, edge: CARDSTOCK }, label: { depth: LABEL_DEPTH_MM, corner: 0, edge: LABEL_EDGE } };
  for (const part of ['card', 'label'] as const) {
    const r = rects[part];
    const { depth, corner, edge: color } = plates[part];
    const { front, back, edge } = plate([r.x1 - r.x0, r.y1 - r.y0, depth], corner, [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2]);
    for (const [side, piece] of [['front', front], ['back', back]] as const) {
      const jpeg = pictured[side]?.[part];
      if (!jpeg) piece.uv.length = 0;
      const material = jpeg ? pictureMaterial(doc, `${part}-${side}`, jpeg, 'image/jpeg', 0.5) : colorMaterial(doc, `${part}-${side}`, color, 0.8);
      const map = jpeg && foils[`${part}-${side}`];
      addPart(doc, mesh, piece, map ? foiled(doc, material, map) : material);
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
        return [part, {
          widthMm: round(r.x1 - r.x0), heightMm: round(r.y1 - r.y0), atMm: [round((r.x0 + r.x1) / 2), round((r.y0 + r.y1) / 2)], placedBy: placedBy[part],
          ...(part === 'card' && {
            corners, cornersBy, foil: foil ?? 'none', foilBy: foil ? 'vision' : 'assumed',
            ...((foil === 'holo' || foil === 'reverse') && box && { pictureBox: rounded(box), pictureBoxBy: artBox ? 'vision' : 'layout' }),
          }),
          // Where the label's hologram is, on each side it was found, in fractions of that side's label picture.
          ...(part === 'label' && Object.keys(holograms).length && { hologram: Object.fromEntries(Object.entries(holograms).map(([side, region]) => [side, rounded(region)])) }),
        }];
      })),
      review, warnings, pictures: pictureRecord(all, roles),
    },
  };
}

const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
/** A quad's width: the mean of its top and bottom sides. */
const widthOf = ([tl, tr, br, bl]: number[][]) => (Math.hypot(tr[0] - tl[0], tr[1] - tl[1]) + Math.hypot(br[0] - bl[0], br[1] - bl[1])) / 2;
