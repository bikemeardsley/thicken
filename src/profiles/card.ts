// The raw-card profile: a trading card on its own, a thin plate with rounded corners and its front and back
// photos. A standard card unless --size says otherwise; standard stock unless --pt gives a thick card's points
// (thousandths of an inch: thick patch and relic cards are sold as 55, 75, 100, 130 and 180 pt). The same plate
// sits inside a slab (src/profiles/slab.ts). With vision, uncropped photos are cut to the card.
import { Document } from '@gltf-transform/core';
import { assignFaces, cut, pictureRecord, shots } from '../faces.ts';
import { addPart, colorMaterial, pictureMaterial, plate, toGlb } from '../glb.ts';
import type { Faces, Profile } from '../thicken.ts';

export const CARD_MM = [63.5, 88.9]; // a standard card, 2.5 × 3.5 in
export const CARD_DEPTH_MM = 0.35; // a standard card's stock, about 14 pt (35 pt is the holder it fits, not its own thickness)
export const CARD_CORNER_MM = 3.2; // a modern card's rounded corners, 1/8 in
export const CARDSTOCK = '#ece8df';
export const PT_MM = 0.0254; // a point: a thousandth of an inch
const SHAPE_TOLERANCE = 0.04;

export const card: Profile = {
  name: 'card',
  about: 'a single trading card on its own, not sealed in a plastic holder',
  faces: { front: 'front', back: 'back' },
  build: async (pictures, { options, sights }) => {
    const warnings: string[] = [];
    const review: string[] = [];
    const given = options.sizeMm ?? [];
    const [width, height] = [given[0] ?? CARD_MM[0], given[1] ?? CARD_MM[1]];
    const depth = options.pt ? options.pt * PT_MM : given[2] ?? CARD_DEPTH_MM;

    const { parts, placed } = cut(pictures, sights);
    const all = await shots(parts);
    const { chosen, roles, guessedFrontBack } = assignFaces(all, ['front', 'back'], { placed });
    if (guessedFrontBack) review.push('front and back (told apart only by photo order: check they are the right way round)');
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
    const pieces = plate([width, height, depth], CARD_CORNER_MM);
    addPart(doc, mesh, pieces.front, pictureMaterial(doc, 'card-front', front.jpeg, 'image/jpeg', 0.4));
    if (!back) pieces.back.uv.length = 0;
    addPart(doc, mesh, pieces.back, back ? pictureMaterial(doc, 'card-back', back.jpeg, 'image/jpeg', 0.4) : colorMaterial(doc, 'card-back', CARDSTOCK, 0.8));
    addPart(doc, mesh, pieces.edge, colorMaterial(doc, 'card-edge', CARDSTOCK, 0.8));
    const round = (mm: number) => Math.round(mm * 100) / 100;
    return {
      glb: await toGlb(doc, mesh),
      sidecar: {
        widthMm: width, heightMm: height, depthMm: round(depth), ...(options.pt && { pt: options.pt }),
        measuredBy: { size: given[0] !== undefined || given[1] !== undefined ? 'given' : 'standard', depth: options.pt ? 'pt' : given[2] !== undefined ? 'given' : 'standard' },
        faces: { front: 'photo', back: back ? 'photo' : 'color' } satisfies Faces, review, warnings, pictures: pictureRecord(all, roles),
      },
    };
  },
};
