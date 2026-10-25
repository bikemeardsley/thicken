// The graded-card profile: a clear acrylic holder at its real size, with the
// card and the grade label inside it, each cut from the front and back photos.
// With a vision roster (src/vision.ts) the models find the slab, the card and
// the label in each photo; without one, crop the photos to the slab's edges
// (or use a scanner app), and the card and label go where a holder usually
// has them.
import { Document } from '@gltf-transform/core';
import sharp from 'sharp';
import { addPart, assignFaces, backgroundOf, cardFoil, clearMaterial, colorMaterial, cut, borderAsk, borderFoil, grown, inQuad, tighten, type Faces, type Foil, foilAsk, FRAME, FRAME_FACE, labelFinishAsk, labelFinishOf, patternAsk, textureAsk, textureOf, unseenPattern, foiled, foilKind, foilLook, foilMap, lookName, mapping, type Picture, PICTURE_BOX, pictureMaterial, pictureRecord, plate, type Profile, readOf, type Region, regionIn, regionOf, ring, rounded, type Scanned, shots, sidesUnknown, type Sight, straighten, subjectBox, texture, toGlb } from '../kit.ts';
import { CARD_DEPTH_MM, CARD_MM, CARD_READS, CARDSTOCK, CORNERS_ASK, cornersOf, PT_MM } from './card.ts';

// A grader's QR code points at its own verification page, which says whose holder this is.
const GRADER_SITES: Record<string, string> = { 'psacard.com': 'psa', 'beckett.com': 'bgs', 'cgccards.com': 'cgc', 'gosgc.com': 'sgc', 'taggrading.com': 'tag' };
// Cert numbers: PSA ~8 digits, BGS 10, SGC 7 (older labels 7-3), CGC 7–12, TAG a letter then digits.
const CERT = /^[A-Z]?\d{6,12}$|^\d{7}-\d{3}$/i;
const SLAB_SHAPE_TOLERANCE = 0.06; // a photo this close to a holder's shape, give or take a loose crop
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
const HOLDER_SHAPES = Object.values(HOLDERS).map(([w, h]) => w / h);

export const slab: Profile = {
  name: 'slab',
  about: 'a graded trading card sealed in a clear plastic holder with a label',
  input: 'Front, and its back',
  makes: 'A clear plastic holder at its grader\'s size, with the card and the grade label inside it, each cut from the photos',
  records: {
    grader: 'who graded it: psa, bgs, cgc, sgc or tag, from its QR code or its label',
    cert: 'its certification number',
    verifyUrl: 'the grader\'s page for this cert, from its QR code',
    holder: 'the holder it was built as (psa, cgc-tall…)',
    inside: 'the card and the label inside: each one\'s size, middle and what placed it; the card\'s corners, foil and its pattern, border and texture; the label\'s finish (foil or paper) and where its hologram is; and the grader\'s logo on the insert, where it was found',
    measuredBy: 'where its size came from: the holder table, or measured',
  },
  faces: {
    front: 'the side showing the grade: the label that names the card and gives its grade, and the card\'s face',
    back: 'the reverse: the back of the label (a logo, hologram or QR code, no grade) and the back of the card',
    card: 'the card inside the holder',
    label: 'the grade label insert inside the holder, front or back, to its outer edges: its whole colored border included, none of the clear plastic around it',
    art: 'the picture box on the card\'s front: the artwork\'s panel, to the edge of its frame',
    hologram: 'a shiny holographic security sticker or strip on the label, if there is one',
    logo: 'the grader\'s logo printed on the clear plastic insert beside the label, not on the label itself (Beckett\'s "B" in its laurel), if there is one: just around it',
    frame: FRAME_FACE,
  },
  note: 'The card, the label, the card\'s picture box and the label\'s hologram are inside the holder, on whichever side is shown: give their corners in the holder\'s own order (top-left as it stands with its label at the top), even when the card is printed sideways.',
  // The label's words: the card's grade (a number and its words: 9, MINT), an autograph's own grade when the label
  // grades one apart from the card (AUTO 10; not every slab has one), and the card as the grader describes it.
  reads: {
    grader: 'the grading company (PSA, Beckett, CGC, SGC, TAG…)',
    grade: 'the card\'s own grade, its number or letter ("9", "10", "9.5", "A" for authentic): never an autograph\'s grade',
    gradeName: 'the words of the card\'s grade, beside its number ("MINT", "GEM MT", "NM-MT", "PRISTINE", "AUTHENTIC")',
    qualifier: 'any qualifier on the card\'s grade ("OC" off-center, "MK" marks, "ST" stain)',
    subgrades: 'any subgrades, as printed ("Centering 9.5, Corners 9, Edges 9.5, Surface 9")',
    autoGrade: 'the autograph\'s own grade, only when the label grades the autograph apart from the card (the 10 in "AUTO 10")',
    autoGradeName: 'the words of the autograph\'s grade (the "AUTO" in "AUTO 10")',
    autograph: 'how the label notes an autograph, if it does ("Signature Series", "Authentic Autograph")',
    signed: 'who signed it and when, if the label says ("G. ANTETOKOUNMPO, 8/2/25")',
    cert: 'the certification number', ...CARD_READS,
  },
  asks: {
    corners: CORNERS_ASK, foil: foilAsk('the card\'s front, inside the holder'), pattern: patternAsk('the card\'s front, inside the holder'),
    border: borderAsk('the card\'s front, inside the holder'), texture: textureAsk('the card\'s front, inside the holder'),
    labelFinish: labelFinishAsk,
  },
  // None snapped onto edges: each runs beside lines nearer than the models' slip. The clear rim's highlights sit
  // inside the holder's outline (one snapped the outline 11 px in, so everything inside measured 3% big), the well's
  // edge beside the card's, the frames inside and around the label beside its border.
  unsnapped: ['front', 'back', 'card', 'label', 'art', 'hologram', 'frame', 'logo'],
  // A holder's shape: an outline far off every holder's isn't the slab (a near-square box round a slab and the
  // table beside it, 2026-10-25). The front shows the grade; the back never does.
  shapes: { front: HOLDER_SHAPES, back: HOLDER_SHAPES },
  shows: { front: ['grade'] },
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
        // QR codes hold URLs in capitals (their compact alphanumeric mode): the link as a browser takes it, scheme
        // and host in lowercase, its path as printed.
        Object.assign(found, { grader: GRADER_SITES[site], verifyUrl: url?.href ?? text });
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

// A grader's label is the same size on every holder: it spans about 87% of a standard holder's width and about 60%
// of a tall one's (real PSA and CGC slabs, 2026-10-03). Under this, the holder is the grader's tall one.
const TALL_LABEL = 0.75;
const SHAPE_TOLERANCE = 0.04;
// A holder's build, from real PSA and CGC slabs straightened at 10 px a mm (2026-10-03). ponytail: one build
// for every holder but its corners; measure others' as their slabs turn up.
const RIM_MM = 2.5; // the rim all round
const RIM_PROUD_MM = 0.5; // how far the rim stands above the window, each face
const FRAME_MM = 0.6; // the ridges framing the label and the card: the edges of their wells
const FRAME_GAP_MM = 0.3; // between a ridge and what it frames
const WELL_OPACITY = 0.08; // the ridges, fainter than the rim: as dense, they looked like a sleeve round the card
const SEAM_MM = 0.1; // between pieces that would otherwise share a surface
const EDGE_OPACITY = 0.2; // the rim, denser than the window's plastic, as its edges catch the light (0.3 looked milky)
const HOLDER_CORNER_MM: Record<string, number> = { psa: 2, 'psa-thick': 2, 'psa-tall': 2, cgc: 4, 'cgc-tall': 4 }; // others 3
// A card shaped like a standard one (cards are cut more exactly than holders are measured) and near its size is one.
const STANDARD_SHAPE = 0.02;
const STANDARD_SIZE = 0.1;
const LABEL_DEPTH_MM = 0.3;
const GAP_MM = 0.5; // the least space kept between the label and the card
const CENTERED_MM = 2; // holders center the card and the label across: a middle this near the holder's is the holder's
const WALL_MM = 1; // the least plastic kept around anything inside
const LABEL_EDGE = '#f4f4f2';
// A label printed on metallic foil (BGS's gold, silver and black ones, as the models see it): mostly metal, a little rough.
const FOIL_LABEL = { metallic: 0.8, roughness: 0.3 };
const LOGO_DEPTH_MM = 0.05; // a print on the insert
// The logo's strokes: brighter than this share of the brightest in its box, and colorless (silver or white print).
const LOGO_BRIGHT = 0.85; // clearly a stroke
const LOGO_DIM = 0.65; // a stroke, if it touches one clearly and is neutral: its red, green and blue within
const LOGO_NEUTRAL = 18;
const LOGO_SPECK = 0.0015; // of the box: a piece smaller than this is a speck of table, not a letter
const LOGO_COLORLESS = 40; // most a stroke's red, green and blue differ, of 255
const LOGO_MARGIN = 0.04; // of the box, all round
// Learning what's behind the slab: a part's quad grown this much is kept out of it, and the window is the slab's
// outline shrunk this much, which leaves out its rim (bright clear plastic, neither table nor part).
const BACKGROUND_CLEAR = 1.06;
const WINDOW = 0.92;

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
    const found = corners ? new Map(inner[picture] ?? []) : new Map<string, number[][]>();
    const agreed = Boolean(sights?.[picture]?.faces.some(({ face, agreed }) => (face === 'front' || face === 'back') && agreed));
    // What's behind the slab, from this photo (src/background.ts): beyond the slab, and through its clear window,
    // away from its rim and from the parts placed inside. Then the label's and card's corners are pulled in off it.
    const parts = (['label', 'card', 'logo'] as const).flatMap((part) => (found.has(part) ? [grown(found.get(part)!, BACKGROUND_CLEAR)] : []));
    const background = found.has('label') || found.has('card')
      ? backgroundOf(pictures[picture], (point) => !inQuad(point, grown(quad, 1.02)) || (inQuad(point, grown(quad, WINDOW)) && !parts.some((q) => inQuad(point, q))))
      : undefined;
    // ponytail: the label only. A card's art (dark photos, textured foil) looks too much like granite to this model of
    // the background, which cut 9% off 497's card; the card's size is the standard one's anyway (standardCard).
    if (background && found.has('label')) {
      const { corners: tight, off } = tighten(pictures[picture], found.get('label')!, background);
      found.set('label', tight);
      // An edge that would have to move further than a loose corner does: said, never shipped quietly.
      if (off.length) review.push(`the label in the ${side} photo (its ${off.join(' and ')} edge${off.length > 1 ? 's' : ''} looked like what's behind the slab well inside the corners given: check them)`);
    }
    return [{ side, picture, mirror, found, agreed, background, toPhoto: mapping(holderQuad, quad), toHolder: mapping(quad, holderQuad) }];
  });
  const unused = roles.filter((role) => role === 'unused').length;
  if (unused) warnings.push(`${unused} picture(s) not used: none looked like another shot of a face`);

  // Where the card and label are: where the models put them, averaged over the sides whose outline two models agreed
  // on (one model's alone can be well off, and everything inside is measured against it), or over every side if
  // none; else where a holder usually has them.
  const layout = defaultLayout(size);
  const placedBy = {} as Record<Inside, 'vision' | 'layout'>;
  const rects = {} as Record<Inside, Rect>;
  const placing = sides.some(({ agreed }) => agreed) ? sides.filter(({ agreed }) => agreed) : sides;
  for (const part of ['card', 'label'] as const) {
    const seen = placing.filter(({ found }) => found.has(part)).map(({ found, toHolder }) => rectOf(found.get(part)!.map(toHolder)));
    placedBy[part] = seen.length ? 'vision' : 'layout';
    rects[part] = seen.length
      ? { x0: mean(seen.map((r) => r.x0)), x1: mean(seen.map((r) => r.x1)), y0: mean(seen.map((r) => r.y0)), y1: mean(seen.map((r) => r.y1)) }
      : layout[part];
  }
  rects.card = standardCard(rects.card);
  rects.label.y0 = Math.min(Math.max(rects.label.y0, rects.card.y1 + GAP_MM), rects.label.y1 - 1); // above the card, never over it
  for (const part of ['card', 'label'] as const) {
    const r = rects[part];
    const middle = (r.x0 + r.x1) / 2;
    if (Math.abs(middle) <= CENTERED_MM) rects[part] = { ...r, x0: r.x0 - middle, x1: r.x1 - middle };
  }
  for (const part of ['card', 'label'] as const) {
    const r = rects[part];
    rects[part] = { x0: Math.max(r.x0, -w / 2 + WALL_MM), x1: Math.min(r.x1, w / 2 - WALL_MM), y0: Math.max(r.y0, -h / 2 + WALL_MM), y1: Math.min(r.y1, h / 2 - WALL_MM) };
  }
  // The grader's logo on the clear insert (a BGS insert's Beckett "B"), where the models found it. It's printed once
  // and seen through the plastic from behind, so it's one rectangle for both sides, each pictured from its own photo.
  const logos = placing.filter(({ found }) => found.has('logo')).map(({ found, toHolder }) => rectOf(found.get('logo')!.map(toHolder)));
  const logo = logos.length ? { x0: mean(logos.map((r) => r.x0)), x1: mean(logos.map((r) => r.x1)), y0: mean(logos.map((r) => r.y0)), y1: mean(logos.map((r) => r.y1)) } : undefined;
  const missed = (['card', 'label'] as const).filter((part) => placedBy[part] === 'layout');
  if (missed.length && sights) review.push(`${missed.join(' and ')} (the vision models didn't find ${missed.length > 1 ? 'them' : 'it'}: placed where a ${holder} holder usually has ${missed.length > 1 ? 'them' : 'it'})`);
  else if (missed.length) warnings.push(`the card and label are placed where a ${holder} holder usually has them: with a vision roster they're found in the photos`);

  // Each side's card and label pictures, from where they are in that side's photo (a card can sit a little askew in
  // its well, and the average of both sides' labels crops one side's print where the two differ), else from the
  // rectangle placed for them.
  // A hologram the models found on the label, on either side, is placed within that side's label picture.
  const pictured: Partial<Record<'front' | 'back', Record<Inside, Buffer>>> = {};
  const holograms: Partial<Record<'front' | 'back', Region>> = {};
  const logoPictures: Partial<Record<'front' | 'back', Buffer>> = {};
  for (const { side, picture, mirror, found, background, toPhoto } of sides) {
    const quad = (r: Rect) => {
      const [left, right] = mirror > 0 ? [r.x0, r.x1] : [r.x1, r.x0];
      return [[left, r.y1], [right, r.y1], [right, r.y0], [left, r.y0]].map(toPhoto);
    };
    // Each side's card and label from where they are in its own photo (the label's corners pulled in off the
    // background); the rectangles placed for them only where a side didn't find them.
    const at = (part: Inside) => found.get(part) ?? quad(rects[part]);
    const of = async (part: Inside) => (await texture(straighten(pictures[picture], at(part)))).jpeg;
    pictured[side] = { card: await of('card'), label: await of('label') };
    if (logo) logoPictures[side] = await decal(pictures[picture], quad(logo));
    const hologram = found.get('hologram');
    if (hologram) holograms[side] = regionOf(hologram, at('label'));
  }

  // The card's foil, as the models see it through the front (src/foil.ts), its picture box placed within the card.
  const foil = foilKind(sights, 'front');
  const fronts = sights?.filter(({ faces }) => faces.some(({ face }) => face === 'front'));
  const artBox = regionIn(fronts, 'art', 'card');
  const [cardW, cardH] = [rects.card.x1 - rects.card.x0, rects.card.y1 - rects.card.y0];
  const box = artBox ?? (cardH > cardW ? PICTURE_BOX : undefined); // the standard box is a portrait card's
  const boxed = foil === 'full' || ((foil === 'holo' || foil === 'reverse') && box !== undefined);
  if ((foil === 'holo' || foil === 'reverse') && !box) review.push(`the card's foil (the models say ${foil}, but found no picture box on this sideways card: left off)`);
  // A foil border and an emboss, as on a raw card (src/profiles/card.ts).
  const border = borderFoil(sights, 'front');
  const frameFound = regionIn(fronts, 'frame', 'card');
  const frame = border === 'foil' ? frameFound ?? FRAME : undefined;
  const surface = textureOf(sights, 'front');
  const relief = surface === 'textured' ? pictured.front?.card : undefined;
  const shines = boxed || Boolean(frame);
  const { look, lookBy } = foilLook(sights, 'front');
  if (shines && lookBy === 'assumed') review.push(unseenPattern(pictures.some(({ source }) => source.time !== undefined)).replace('the foil\'s', 'the card\'s foil\'s'));
  const foils: Record<string, Foil> = shines || relief ? { 'card-front': await cardFoil(boxed ? foil! : 'none', box ?? PICTURE_BOX, cardH / cardW, look, { frame, relief }) } : {};
  const labelAspect = (rects.label.y1 - rects.label.y0) / (rects.label.x1 - rects.label.x0);
  for (const [side, region] of Object.entries(holograms)) foils[`label-${side}`] = await foilMap([region], labelAspect);

  // The model, built as a holder is: a rim all round, standing proud of the window it frames, and inside, the
  // label and the card in their wells, each framed by a faint ridge. All clear plastic, the rim a little denser so
  // it reads as the edge it is; the card and label halfway through its depth.
  const doc = new Document();
  const mesh = doc.createMesh('slab');
  const d = size[2];
  const corner = HOLDER_CORNER_MM[holder] ?? 3;
  const windowCorner = Math.max(corner - RIM_MM, 0.5);
  const acrylic = clearMaterial(doc, 'acrylic');
  const ridges = clearMaterial(doc, 'acrylic-edges', EDGE_OPACITY);
  const wells = clearMaterial(doc, 'acrylic-wells', WELL_OPACITY);
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
    addPart(doc, mesh, ring([ow, oh, d - 2 * RIM_PROUD_MM - 2 * SEAM_MM], [ow - 2 * FRAME_MM, oh - 2 * FRAME_MM], [0.3, 0.1], [(outer.x0 + outer.x1) / 2, (outer.y0 + outer.y1) / 2]), wells);
  }
  const cardDepth = Math.min(pt ? pt * PT_MM : CARD_DEPTH_MM, size[2] - 2 * WALL_MM); // a thick card, by its points, as fits
  const { radiusMm, corners, cornersBy } = cornersOf(sights);
  const plates = { card: { depth: cardDepth, corner: radiusMm, edge: CARDSTOCK }, label: { depth: LABEL_DEPTH_MM, corner: 0, edge: LABEL_EDGE } };
  // The label's finish as the models see it, not by grader: paper unless two of them say foil.
  const finish = labelFinishOf(sights);
  const foilLabel = finish === 'foil';
  for (const part of ['card', 'label'] as const) {
    const r = rects[part];
    const { depth, corner, edge: color } = plates[part];
    const { front, back, edge } = plate([r.x1 - r.x0, r.y1 - r.y0, depth], corner, [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2]);
    for (const [side, piece] of [['front', front], ['back', back]] as const) {
      const jpeg = pictured[side]?.[part];
      if (!jpeg) piece.uv.length = 0;
      const material = jpeg ? pictureMaterial(doc, `${part}-${side}`, jpeg, 'image/jpeg', 0.5) : colorMaterial(doc, `${part}-${side}`, color, 0.8);
      if (part === 'label' && foilLabel) material.setMetallicFactor(FOIL_LABEL.metallic).setRoughnessFactor(FOIL_LABEL.roughness);
      const map = jpeg && foils[`${part}-${side}`];
      addPart(doc, mesh, piece, map ? foiled(doc, material, map) : material);
    }
    addPart(doc, mesh, edge, colorMaterial(doc, `${part}-edge`, color, 0.8));
  }
  // The logo, a print on the insert: only its strokes show, the plastic around them as clear as the rest.
  if (logo) {
    const { front, back } = plate([logo.x1 - logo.x0, logo.y1 - logo.y0, LOGO_DEPTH_MM], 0, [(logo.x0 + logo.x1) / 2, (logo.y0 + logo.y1) / 2]);
    for (const [side, piece] of [['front', front], ['back', back]] as const) {
      const png = logoPictures[side];
      if (!png) continue;
      // Print, not metal: as metal it mirrors the room, and read dark gray where the photo shows it bright.
      addPart(doc, mesh, piece, pictureMaterial(doc, `logo-${side}`, png, 'image/png', 0.4).setAlphaMode('MASK').setAlphaCutoff(0.5));
    }
  }
  const round = (mm: number) => Math.round(mm * 10) / 10;
  return {
    glb: await toGlb(doc, mesh),
    sidecar: {
      profile: 'slab', holder, ...label,
      widthMm: w, heightMm: h, depthMm: size[2], measuredBy: sizeMm.length ? 'measured' : 'table',
      faces: { front: 'photo', back: pictured.back ? 'photo' : 'color' } satisfies Faces,
      // The card and label inside: their size, where their middles are (mm from the holder's middle, y up), and what placed them.
      inside: { ...Object.fromEntries((['card', 'label'] as const).map((part) => {
        const r = rects[part];
        return [part, {
          widthMm: round(r.x1 - r.x0), heightMm: round(r.y1 - r.y0), atMm: [round((r.x0 + r.x1) / 2), round((r.y0 + r.y1) / 2)], placedBy: placedBy[part],
          ...(part === 'card' && {
            corners, cornersBy, foil: foil ?? 'none', foilBy: foil ? 'vision' : 'assumed', ...(shines && { foilLook: lookName(look), foilLookBy: lookBy }),
            ...((foil === 'holo' || foil === 'reverse') && box && { pictureBox: rounded(box), pictureBoxBy: artBox ? 'vision' : 'layout' }),
            border: border ?? 'plain', borderBy: border ? 'vision' : 'assumed', ...(frame && { frame: rounded(frame), frameBy: frameFound ? 'vision' : 'layout' }),
            texture: surface ?? 'smooth', textureBy: surface ? 'vision' : 'assumed',
          }),
          // Its finish, by grader; and where its hologram is, on each side it was found, in fractions of that side's label picture.
          ...(part === 'label' && { finish: finish ?? 'paper', finishBy: finish ? 'vision' : 'assumed' }),
          ...(part === 'label' && Object.keys(holograms).length && { hologram: Object.fromEntries(Object.entries(holograms).map(([side, region]) => [side, rounded(region)])) }),
        }];
      })),
      // The grader's logo on the insert: its size, its middle, and the sides it was pictured from.
      ...(logo && { logo: { widthMm: round(logo.x1 - logo.x0), heightMm: round(logo.y1 - logo.y0), atMm: [round((logo.x0 + logo.x1) / 2), round((logo.y0 + logo.y1) / 2)], placedBy: 'vision', sides: Object.keys(logoPictures) } }) },
      review, warnings, pictures: pictureRecord(all, roles),
    },
  };
}

const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

/**
 * A logo printed on clear plastic, cut from a photo: its bright, colorless strokes kept, and everything behind it (the
 * table, seen through the plastic) made see-through, as a PNG. A median filter takes out the table's own bright
 * specks. ponytail: a brightness cut from the brightest strokes in the box; a logo printed dark, or a white table
 * behind it, would need another cue (the models saying its color).
 */
async function decal(picture: Picture, quad: number[][]): Promise<Buffer> {
  const { data, width, height } = straighten(picture, quad);
  const light = (i: number) => (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3;
  const lights = Array.from({ length: width * height }, (_, i) => light(i)).sort((a, b) => a - b);
  const brightest = lights[Math.floor(0.98 * (lights.length - 1))];
  // A thin margin is left out: the holder's own edges, bright and colorless too, run there when the box is loose.
  const [mx, my] = [Math.round(LOGO_MARGIN * width), Math.round(LOGO_MARGIN * height)];
  // Grown only into neutral silver: a granite's pale patches are a little warm, and silver isn't.
  const silver = (i: number, share: number, colorless = LOGO_COLORLESS) => {
    const [x, y] = [i % width, Math.floor(i / width)];
    const rgb = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
    return x >= mx && x < width - mx && y >= my && y < height - my && light(i) > share * brightest && Math.max(...rgb) - Math.min(...rgb) < colorless;
  };
  // Strokes: the clearly bright, grown into the dimmer silver touching them (a laurel's thin leaves, the letters'
  // edges), which a single cut either loses or matches in the table's specks too.
  const kept = new Uint8Array(width * height);
  const queue: number[] = [];
  for (let i = 0; i < width * height; i++) if (silver(i, LOGO_BRIGHT)) { kept[i] = 1; queue.push(i); }
  while (queue.length) {
    const i = queue.pop()!;
    const [x, y] = [i % width, Math.floor(i / width)];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const [nx, ny] = [x + dx, y + dy];
        const j = ny * width + nx;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height && !kept[j] && silver(j, LOGO_DIM, LOGO_NEUTRAL)) { kept[j] = 1; queue.push(j); }
      }
    }
  }
  // Specks of table that passed: pieces too small to be part of a letter.
  const least = LOGO_SPECK * width * height;
  const seen = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    if (!kept[i] || seen[i]) continue;
    const piece = [i];
    seen[i] = 1;
    for (let k = 0; k < piece.length; k++) {
      const [x, y] = [piece[k] % width, Math.floor(piece[k] / width)];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const [nx, ny] = [x + dx, y + dy];
          const j = ny * width + nx;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height && kept[j] && !seen[j]) { seen[j] = 1; piece.push(j); }
        }
      }
    }
    if (piece.length < least) for (const j of piece) kept[j] = 0;
  }
  const rgba = Buffer.from(data);
  for (let i = 0; i < width * height; i++) rgba[i * 4 + 3] = kept[i] ? 255 : 0;
  return sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
}
/** A quad's width: the mean of its top and bottom sides. */
const widthOf = ([tl, tr, br, bl]: number[][]) => (Math.hypot(tr[0] - tl[0], tr[1] - tl[1]) + Math.hypot(br[0] - bl[0], br[1] - bl[1])) / 2;
