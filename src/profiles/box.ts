// The generic profile: anything box-shaped (a game case, a phone, packaging,
// a deck of cards) at its real size: --size, else the vision models'
// estimate, warned. Its faces come from the photos (src/faces.ts), wherever
// the vision models found them; without vision, one whole photo is the front.
// A side not photographed is a plain color from the front's edge, fine as it
// is; a missing back is for review.
import { assignFaces, box as cuboid, cut, type Face, type Faces, pictureRecord, type Profile, shots, type Side, sidesUnknown } from '../kit.ts';

const ROUNDED_MM = 1;
const FACES: Face[] = ['front', 'back', 'left', 'right', 'top', 'bottom'];

export const box: Profile = {
  name: 'box',
  generic: true,
  about: 'a box-shaped object (a game case, a phone, a deck of cards, packaging)',
  input: 'Front, and any of its back and sides; its size (`--size`), or the vision models\' estimate',
  makes: 'A softly rounded box with the photos on its faces',
  records: {
    barcode: 'its product barcode (UPC or EAN) and its kind, when a photo shows one',
    measuredBy: 'where each of its sizes came from: measured, or the vision models\' estimate',
  },
  faces: { front: 'front', back: 'back', left: 'left side', right: 'right side', top: 'top', bottom: 'bottom' },
  reads: {
    title: 'its name: the product, game, film or model', brand: 'the brand or maker', edition: 'any edition, version, platform or model number',
    rating: 'any age or content rating (ESRB "T", PEGI 12)', year: 'a year it gives',
  },
  // A product barcode (UPC or EAN; not a book's 978/979) is kept as what it is; it never says, alone, that a photo is a
  // box: packaging of every kind carries one.
  read: (scanned) => {
    const use = scanned.map(({ format, text }) => (/^(UPCA|UPCE|EAN8)$/.test(format) || (format === 'EAN13' && !/^97[89]/.test(text)) ? 'barcode' : undefined));
    const at = use.indexOf('barcode');
    return { recognized: false, use, ...(at >= 0 && { barcode: { text: scanned[at].text, format: scanned[at].format } }) };
  },
  build: async (pictures, { options, facts, sights, estimateMm }) => {
    const given = options.sizeMm ?? [];
    const size = [0, 1, 2].map((i) => given[i] ?? estimateMm?.[i] ?? 0);
    if (size.some((mm) => !(mm > 0))) throw new Error('a box needs its size: --size WxHxD in mm (or a vision roster to estimate it)');
    const warnings: string[] = [];
    const review: string[] = [];
    const round = (mm: number) => Math.round(mm * 10) / 10;
    if (given.filter((mm) => mm !== undefined).length < 3) {
      warnings.push(`the size is partly the vision models' estimate (${size.map(round).join(' × ')} mm): --size for the real one`);
    }

    const { parts, placed } = cut(pictures, sights);
    const all = await shots(parts);
    const { chosen, roles, undecided } = assignFaces(all, FACES, { placed });
    if (undecided) throw sidesUnknown(Boolean(sights));
    const photo = (face: Face) => (chosen[face] === undefined ? undefined : all[chosen[face]].texture);
    const front = photo('front');
    if (!front) throw new Error('a box needs a photo of its front');
    const unused = roles.filter((role) => role === 'unused').length;
    if (unused) warnings.push(`${unused} picture(s) not used: none looked like another shot of a face`);

    const plain: Side = { color: front.edge, roughness: 0.6 }; // one Side for every unphotographed face: one draw call
    const sides = Object.fromEntries(FACES.map((face) => [face, photo(face) ? { picture: photo(face)!.jpeg } : plain])) as Record<Face, Side>;
    const faces: Faces = Object.fromEntries(FACES.map((face) => [face, photo(face) ? 'photo' : face === 'back' ? 'color' : 'plain']));
    return {
      glb: await cuboid('box', size, sides, ROUNDED_MM),
      sidecar: {
        ...(facts.barcode !== undefined && { barcode: facts.barcode }),
        widthMm: round(size[0]), heightMm: round(size[1]), depthMm: round(size[2]),
        measuredBy: Object.fromEntries(['width', 'height', 'depth'].map((key, i) => [key, given[i] !== undefined ? 'measured' : 'vision'])),
        faces, review, warnings, pictures: pictureRecord(all, roles),
      },
    };
  },
};
