// The raw-card profile: a trading card on its own, a thin plate with its front and back photos, its corners
// rounded or square as the vision models say the card's are. A standard card unless --size says otherwise;
// standard stock unless --pt gives a thick card's points (thousandths of an inch: thick patch and relic cards
// are sold as 55, 75, 100, 130 and 180 pt). The same plate sits inside a slab (src/profiles/slab.ts). With
// vision, uncropped photos are cut to the card.
import { Document } from '@gltf-transform/core';
import sharp from 'sharp';
import { assignFaces, cut, pictureRecord, shots, sidesUnknown } from '../faces.ts';
import { addPart, colorMaterial, foiled, pictureMaterial, plate, toGlb } from '../glb.ts';
import { mapping } from '../image.ts';
import type { Faces, Profile } from '../thicken.ts';
import { pooled, type Sight } from '../vision.ts';

export const CARD_MM = [63.5, 88.9]; // a standard card, 2.5 × 3.5 in
export const CARD_DEPTH_MM = 0.35; // a standard card's stock, about 14 pt (35 pt is the holder it fits, not its own thickness)
// How a card's corners are cut is read off the card in the photo, never assumed from its year or kind (Mike,
// 2026-10-03). Round is 1/8 in (Pokémon's spec); ponytail: slight is an estimate, 1/16 in; measure a few cards.
const CORNER_MM: Record<string, number> = { square: 0, slight: 1.6, round: 3.2 };
export const CORNERS_ASK = 'look at this card\'s own corners in the photo: are they "square" (each corner a sharp point), "slight" (a small curve, about 2 mm across) or "round" (a clear curve, about 3 mm or more)? Judge the corners you see, not what cards of its kind usually have.';
/**
 * The picture box, in fractions of the front (x across, y down), averaged over every picture where the models found
 * both: its corners mapped through the front's, so a card shot at an angle gives the same box as one shot square on.
 */
function pictureBox(sights?: Sight[]) {
  const boxes = (sights ?? []).flatMap(({ faces }) => {
    const [front, art] = ['front', 'art'].map((name) => faces.find(({ face }) => face === name)?.corners);
    if (!front || !art) return [];
    const [xs, ys] = [0, 1].map((k) => art.map(mapping(front, [[0, 0], [1, 0], [1, 1], [0, 1]])).map((p) => p[k]).sort((a, b) => a - b));
    // Each edge the mean of the two corners nearest it, kept on the card.
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    return [{ x0: clamp((xs[0] + xs[1]) / 2), x1: clamp((xs[2] + xs[3]) / 2), y0: clamp((ys[0] + ys[1]) / 2), y1: clamp((ys[2] + ys[3]) / 2) }];
  });
  if (!boxes.length) return undefined;
  const mean = (key: 'x0' | 'x1' | 'y0' | 'y1') => boxes.reduce((sum, b) => sum + b[key], 0) / boxes.length;
  return { x0: mean('x0'), x1: mean('x1'), y0: mean('y0'), y1: mean('y1') };
}

/** Where the front is foil, as glTF's foil map (src/glb.ts foiled): the picture box, all but it, or the whole front. */
async function foilMap(kind: string, box: { x0: number; x1: number; y0: number; y1: number }, aspect: number): Promise<Uint8Array> {
  const [w, h] = [256, Math.round(256 * aspect)];
  const [back, inBox] = kind === 'holo' ? [PRINT, FOIL] : kind === 'reverse' ? [FOIL, PRINT] : [FOIL, FOIL];
  const rect = `<rect x="${box.x0 * w}" y="${box.y0 * h}" width="${(box.x1 - box.x0) * w}" height="${(box.y1 - box.y0) * h}" fill="${inBox}"/>`;
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${back}"/>${rect}</svg>`)).png().toBuffer();
}

/** A card's corners, with their radius, as every model said of every photo (src/vision.ts pooled); slight when no one said. */
export const cornersOf = (sights?: Sight[]) => {
  const most = pooled(sights, 'corners', Object.keys(CORNER_MM));
  return { radiusMm: CORNER_MM[most ?? 'slight'], corners: most ?? 'slight', cornersBy: most ? 'vision' : 'assumed' };
};
// Foil, as the models see this card: a holo's picture box shines, a reverse holo's everything else, a full art's
// (and a textured or refractor card's) the whole front. Measuring foil from how a video's frames change was tried on
// Mike's reverse-holo Psyduck (2026-10-03): handheld frames differed more by glare and slight misalignment than by
// foil, so the kind is asked instead. ponytail: a video could refine the mask once frames are aligned to the pixel.
export const FOIL_ASK = 'which foil is on the front: "none", "holo" (only the picture box shines), "reverse" (everything but the picture box shines) or "full" (the whole front shines, as on full-art, textured and refractor cards)? Foil flashes only at some angles: if you see any shine or rainbow at all, say which kind.';
const FOILS = ['none', 'holo', 'reverse', 'full'];
// A standard Pokémon card's picture box, in fractions of its front (simeydotme/pokemon-cards-css places it so):
// where it goes when the models don't find it.
const PICTURE_BOX = { x0: 0.08, x1: 0.92, y0: 0.1, y1: 0.47 };
// Foil: film, roughness 0.3, 60% metal; print: no film, roughness 0.4, no metal. Tuned on Mike's Psyduck (2026-10-03):
// all metal buried the print in a dark mirror, as the ink over real foil doesn't; at 60% the text stays clear.
const [FOIL, PRINT] = ['rgb(255,77,153)', 'rgb(0,102,0)'];
export const CARDSTOCK = '#ece8df';
export const PT_MM = 0.0254; // a point: a thousandth of an inch
const SHAPE_TOLERANCE = 0.04;

export const card: Profile = {
  name: 'card',
  about: 'a single trading card on its own, not sealed in a plastic holder',
  faces: { front: 'front', back: 'back', art: 'the picture box on the front: the artwork\'s panel, to the edge of its frame' },
  note: 'The picture box is part of the front: give its corners in the front\'s own order, top-left first.',
  asks: { corners: CORNERS_ASK, foil: FOIL_ASK },
  unsnapped: ['art'],
  build: async (pictures, { options, sights }) => {
    const warnings: string[] = [];
    const review: string[] = [];
    const given = options.sizeMm ?? [];
    const [width, height] = [given[0] ?? CARD_MM[0], given[1] ?? CARD_MM[1]];
    const depth = options.pt ? options.pt * PT_MM : given[2] ?? CARD_DEPTH_MM;

    // The picture box is kept apart from the card's sides, which are what's cut out.
    const { parts, placed } = cut(pictures, sights?.map((sight) => ({ ...sight, faces: sight.faces.filter(({ face }) => face !== 'art') })));
    const all = await shots(parts);
    const { chosen, roles, undecided } = assignFaces(all, ['front', 'back'], { placed });
    if (undecided) throw sidesUnknown(Boolean(sights));
    const [front, back] = (['front', 'back'] as const).map((face) => (chosen[face] === undefined ? undefined : all[chosen[face]!].texture));
    if (!front) throw new Error('a card needs a photo of its front');
    for (const [face, photo] of [['front', front], ['back', back]] as const) {
      if (photo && Math.abs(photo.width / photo.height / (width / height) - 1) > SHAPE_TOLERANCE) {
        warnings.push(`the ${face} photo isn't the shape of a ${width} × ${height} mm card: crop it to the card's edges, or give --size`);
      }
    }
    const unused = roles.filter((role) => role === 'unused').length;
    if (unused) warnings.push(`${unused} picture(s) not used: none looked like another shot of a face`);

    const doc = new Document();
    const mesh = doc.createMesh('card');
    const { radiusMm, corners, cornersBy } = cornersOf(sights);
    const pieces = plate([width, height, depth], radiusMm);
    // Asked of the front, so answered only where the front was seen: a photo of the back alone shows no foil. Foil
    // flashes only at some angles, so a video's frames that miss it say none: two answers naming a kind are enough
    // (the kind named most), and one alone isn't, so no single model's slip makes a plain card shine.
    const facing = sights?.filter(({ faces }) => faces.some(({ face }) => face === 'front'));
    const said = (facing ?? []).flatMap(({ answers }) => answers.flatMap(({ asked }) => (asked?.foil && FOILS.includes(asked.foil) ? [asked.foil] : [])));
    const foil = said.filter((kind) => kind !== 'none').length >= 2 ? pooled(facing, 'foil', FOILS.slice(1)) : said.length ? 'none' : undefined;
    const found = pictureBox(sights);
    // The standard picture box is a portrait card's: a landscape card's, not found, is anyone's guess.
    const box = found ?? (front.height > front.width ? PICTURE_BOX : undefined);
    const shines = foil === 'full' || ((foil === 'holo' || foil === 'reverse') && box !== undefined);
    if ((foil === 'holo' || foil === 'reverse') && !box) review.push(`foil (the models say ${foil}, but found no picture box on this landscape card: left off)`);
    const face = pictureMaterial(doc, 'card-front', front.jpeg, 'image/jpeg', 0.4);
    addPart(doc, mesh, pieces.front, shines ? foiled(doc, face, await foilMap(foil!, box ?? PICTURE_BOX, front.height / front.width)) : face);
    if (!back) pieces.back.uv.length = 0;
    addPart(doc, mesh, pieces.back, back ? pictureMaterial(doc, 'card-back', back.jpeg, 'image/jpeg', 0.4) : colorMaterial(doc, 'card-back', CARDSTOCK, 0.8));
    addPart(doc, mesh, pieces.edge, colorMaterial(doc, 'card-edge', CARDSTOCK, 0.8));
    const round = (mm: number) => Math.round(mm * 100) / 100;
    return {
      glb: await toGlb(doc, mesh),
      sidecar: {
        widthMm: width, heightMm: height, depthMm: round(depth), ...(options.pt && { pt: options.pt }), corners, cornersBy,
        foil: foil ?? 'none', foilBy: foil ? 'vision' : 'assumed',
        ...((foil === 'holo' || foil === 'reverse') && box && { pictureBox: Object.fromEntries(Object.entries(box).map(([k, v]) => [k, Math.round(v * 1000) / 1000])), pictureBoxBy: found ? 'vision' : 'layout' }),
        measuredBy: { size: given[0] !== undefined || given[1] !== undefined ? 'given' : 'standard', depth: options.pt ? 'pt' : given[2] !== undefined ? 'given' : 'standard' },
        faces: { front: 'photo', back: back ? 'photo' : 'color' } satisfies Faces, review, warnings, pictures: pictureRecord(all, roles),
      },
    };
  },
};
