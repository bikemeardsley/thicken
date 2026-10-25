// The generic profile: anything box-shaped (a game case, a phone, packaging,
// a deck of cards) at its real size: --size, else the vision models'
// estimate, warned. Its faces come from the photos (src/faces.ts), wherever
// the vision models found them; without vision, one whole photo is the front.
// A side not photographed is a plain color from the front's edge, fine as it
// is; a missing back is for review.
import { assignFaces, box as cuboid, cut, type Face, type Faces, pictureRecord, pooled, type Profile, shots, type Side, sidesUnknown } from '../kit.ts';

const FACES: Face[] = ['front', 'back', 'left', 'right', 'top', 'bottom'];
// How rounded it is, as the models see it: a radius for each (a deck's barely softened edges, a phone's round ones).
const ROUNDING_MM: Record<string, number> = { sharp: 0.3, slight: 1, round: 3, very: 8 };
const ROUNDING_ASK = 'how rounded are its corners and edges: "sharp", "slight" (barely softened, as a deck of cards or a game case), "round" (clearly rounded, a few millimeters) or "very" (rounded like a phone or a remote)?';
const FINISH_ASK = 'is its surface "glossy" (it shines and reflects the light) or "matte" (a flat, dull finish)?';
const FINISH_ROUGHNESS: Record<string, number> = { glossy: 0.25, matte: 0.7 };

export const box: Profile = {
  name: 'box',
  generic: true,
  about: 'a box-shaped object (a game case, a phone, a deck of cards, packaging)',
  input: 'Front, and any of its back and sides; its size (`--size`), or the vision models\' estimate',
  makes: 'A softly rounded box with the photos on its faces',
  records: {
    barcode: 'its product barcode (UPC or EAN) and its kind, when a photo shows one',
    measuredBy: 'where each of its sizes came from: measured, photos (its proportions there, scaled by a measured size or the estimate), or the vision models\' estimate',
    rounding: 'how rounded its corners and edges are: sharp, slight, round or very', roundingBy: 'how that was found: vision or assumed',
    finish: 'its surface: glossy or matte', finishBy: 'how that was found: vision or assumed',
  },
  asks: { rounding: ROUNDING_ASK, finish: FINISH_ASK },
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
    if (!given.some((mm) => mm !== undefined) && !estimateMm) throw new Error('a box needs its size: --size WxHxD in mm (or a vision roster to estimate it)');
    const warnings: string[] = [];
    const review: string[] = [];
    const round = (mm: number) => Math.round(mm * 10) / 10;

    const { parts, placed } = cut(pictures, sights);
    const all = await shots(parts);
    const { chosen, roles, undecided } = assignFaces(all, FACES, { placed });
    if (undecided) throw sidesUnknown(Boolean(sights));
    const photo = (face: Face) => (chosen[face] === undefined ? undefined : all[chosen[face]].texture);
    const front = photo('front');
    if (!front) throw new Error('a box needs a photo of its front');
    const unused = roles.filter((role) => role === 'unused').length;
    if (unused) warnings.push(`${unused} picture(s) not used: none looked like another shot of a face`);

    // Its shape from the photos, each face straightened to its own proportions: the front's width to its height, a
    // side's depth to its height, the top's width to its depth. Only the scale comes from a measured size, else the
    // models' estimate, which is rough in millimeters but a fine scale.
    const proportion = (face: Face) => { const t = photo(face); return t && t.width / t.height; };
    const side = proportion('left') ?? proportion('right');
    const top = proportion('top') ?? proportion('bottom');
    const shape = [proportion('front')!, 1, side ?? (top ? proportion('front')! / top : undefined)]; // height 1
    const scales = [0, 1, 2].flatMap((i) => (given[i] !== undefined && shape[i] ? [given[i]! / shape[i]!] : []));
    const estimated = [0, 1, 2].flatMap((i) => (estimateMm?.[i] && shape[i] ? [estimateMm[i] / shape[i]!] : []));
    const height = scales[0] ?? (estimated.length ? Math.exp(estimated.reduce((sum, s) => sum + Math.log(s), 0) / estimated.length) : undefined);
    const size = [0, 1, 2].map((i) => given[i] ?? (height && shape[i] ? shape[i]! * height : estimateMm?.[i] ?? 0));
    if (size.some((mm) => !(mm > 0))) throw new Error('a box needs its size: --size WxHxD in mm (or a vision roster to estimate it)');
    const measuredBy = Object.fromEntries(['width', 'height', 'depth'].map((key, i) => [key, given[i] !== undefined ? 'measured' : height && shape[i] ? 'photos' : 'vision']));
    if (given.filter((mm) => mm !== undefined).length < 3) {
      warnings.push(`the size is ${scales.length ? 'scaled from the size given' : 'scaled by the vision models\' estimate'}, its proportions ${shape[2] ? 'the photos\'' : 'the front photo\'s and the estimate\'s depth'} (${size.map(round).join(' × ')} mm): --size for the real one`);
    }

    const rounding = pooled(sights, 'rounding', Object.keys(ROUNDING_MM));
    const finish = pooled(sights, 'finish', ['glossy', 'matte']);
    const radius = Math.min(ROUNDING_MM[rounding ?? 'slight'], Math.min(...size) / 3);
    const plain: Side = { color: front.edge, roughness: 0.6 }; // one Side for every unphotographed face: one draw call
    const sides = Object.fromEntries(FACES.map((face) => [face, photo(face) ? { picture: photo(face)!.jpeg, ...(finish && { roughness: FINISH_ROUGHNESS[finish] }) } : plain])) as Record<Face, Side>;
    const faces: Faces = Object.fromEntries(FACES.map((face) => [face, photo(face) ? 'photo' : face === 'back' ? 'color' : 'plain']));
    return {
      glb: await cuboid('box', size, sides, radius),
      sidecar: {
        ...(facts.barcode !== undefined && { barcode: facts.barcode }),
        widthMm: round(size[0]), heightMm: round(size[1]), depthMm: round(size[2]), measuredBy,
        rounding: rounding ?? 'slight', roundingBy: rounding ? 'vision' : 'assumed', finish: finish ?? 'matte', finishBy: finish ? 'vision' : 'assumed',
        faces, review, warnings, pictures: pictureRecord(all, roles),
      },
    };
  },
};
