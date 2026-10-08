// The raw-card profile: a trading card on its own, a thin plate with its front and back photos, its corners
// rounded or square as the vision models say the card's are. A standard card unless --size says otherwise;
// standard stock unless --pt gives a thick card's points (thousandths of an inch: thick patch and relic cards
// are sold as 55, 75, 100, 130 and 180 pt). The same plate sits inside a slab (src/profiles/slab.ts). With
// vision, uncropped photos are cut to the card.
import { Document } from '@gltf-transform/core';
import { assignFaces, cut, pictureRecord, shots, sidesUnknown } from '../faces.ts';
import { cardFoil, foilAsk, foilKind, PICTURE_BOX, regionIn, rounded } from '../foil.ts';
import { addPart, colorMaterial, foiled, pictureMaterial, plate, toGlb } from '../glb.ts';
import type { Faces, Profile } from '../thicken.ts';
import { pooled, type Sight } from '../vision.ts';

export const CARD_MM = [63.5, 88.9]; // a standard card, 2.5 × 3.5 in
export const CARD_DEPTH_MM = 0.35; // a standard card's stock, about 14 pt (35 pt is the holder it fits, not its own thickness)
// How a card's corners are cut is read off the card in the photo, never assumed from its year or kind (decided
// 2026-10-03). Round is 1/8 in (Pokémon's spec); ponytail: slight is an estimate, 1/16 in; measure a few cards.
const CORNER_MM: Record<string, number> = { square: 0, slight: 1.6, round: 3.2 };
export const CORNERS_ASK = 'look at this card\'s own corners in the photo: are they "square" (each corner a sharp point), "slight" (a small curve, about 2 mm across) or "round" (a clear curve, about 3 mm or more)? Judge the corners you see, not what cards of its kind usually have.';
/** A card's corners, with their radius, as every model said of every photo (src/vision.ts pooled); slight when no one said. */
export const cornersOf = (sights?: Sight[]) => {
  const most = pooled(sights, 'corners', Object.keys(CORNER_MM));
  return { radiusMm: CORNER_MM[most ?? 'slight'], corners: most ?? 'slight', cornersBy: most ? 'vision' : 'assumed' };
};
export const CARDSTOCK = '#ece8df';
export const PT_MM = 0.0254; // a point: a thousandth of an inch
const SHAPE_TOLERANCE = 0.04;

export const card: Profile = {
  name: 'card',
  about: 'a single trading card on its own, not sealed in a plastic holder',
  faces: { front: 'front', back: 'back', art: 'the picture box on the front: the artwork\'s panel, to the edge of its frame' },
  note: 'The picture box is part of the front: give its corners in the front\'s own order, top-left first.',
  asks: { corners: CORNERS_ASK, foil: foilAsk('the front') },
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
    // Foil, as the models see this card (src/foil.ts).
    const foil = foilKind(sights, 'front');
    const found = regionIn(sights, 'art', 'front');
    // The standard picture box is a portrait card's: a landscape card's, not found, is anyone's guess.
    const box = found ?? (front.height > front.width ? PICTURE_BOX : undefined);
    const shines = foil === 'full' || ((foil === 'holo' || foil === 'reverse') && box !== undefined);
    if ((foil === 'holo' || foil === 'reverse') && !box) review.push(`foil (the models say ${foil}, but found no picture box on this landscape card: left off)`);
    const face = pictureMaterial(doc, 'card-front', front.jpeg, 'image/jpeg', 0.4);
    addPart(doc, mesh, pieces.front, shines ? foiled(doc, face, await cardFoil(foil!, box ?? PICTURE_BOX, front.height / front.width)) : face);
    if (!back) pieces.back.uv.length = 0;
    addPart(doc, mesh, pieces.back, back ? pictureMaterial(doc, 'card-back', back.jpeg, 'image/jpeg', 0.4) : colorMaterial(doc, 'card-back', CARDSTOCK, 0.8));
    addPart(doc, mesh, pieces.edge, colorMaterial(doc, 'card-edge', CARDSTOCK, 0.8));
    const round = (mm: number) => Math.round(mm * 100) / 100;
    return {
      glb: await toGlb(doc, mesh),
      sidecar: {
        widthMm: width, heightMm: height, depthMm: round(depth), ...(options.pt && { pt: options.pt }), corners, cornersBy,
        foil: foil ?? 'none', foilBy: foil ? 'vision' : 'assumed',
        ...((foil === 'holo' || foil === 'reverse') && box && { pictureBox: rounded(box), pictureBoxBy: found ? 'vision' : 'layout' }),
        measuredBy: { size: given[0] !== undefined || given[1] !== undefined ? 'given' : 'standard', depth: options.pt ? 'pt' : given[2] !== undefined ? 'given' : 'standard' },
        faces: { front: 'photo', back: back ? 'photo' : 'color' } satisfies Faces, review, warnings, pictures: pictureRecord(all, roles),
      },
    };
  },
};
