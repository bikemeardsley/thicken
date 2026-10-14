// __NAME__: a profile of your own, made by `thicken profile new __NAME__`. As it is, it makes a softly rounded box at
// the size you give (--size WxHxD in mm, or the vision models' estimate), your photos on its faces: try it with
// `thicken __NAME__ front.jpg back.jpg --size 100x150x20`. Change what makes your kind of object what it is, fill in
// each TODO, then `thicken profile check __NAME__`, and `thicken profile contribute __NAME__` to offer it to thicken.
// Every field is described on the Profile type; the built-in profiles are the examples to read:
// https://github.com/bikemeardsley/thicken/tree/main/src/profiles
import { assignFaces, box, cut, type Face, type Faces, pictureRecord, type Profile, shots, type Side, sidesUnknown } from 'thicken/kit';

const FACES: Face[] = ['front', 'back', 'left', 'right', 'top', 'bottom'];
const ROUNDED_MM = 1; // TODO: how soft its edges are

export const __CAMEL__: Profile = {
  name: '__NAME__',
  // What it is, in a few words: the vision models are told this when they choose a profile for a photo.
  about: 'TODO: a __NAME__, in a few words',
  // For the README's table: what it's made from, and what it makes.
  input: 'TODO: Front, and any of its back and sides; its size (`--size`)',
  makes: 'TODO: what it makes, at its real size',
  // Each face in a few words, for the vision models to find in a photo.
  faces: { front: 'front', back: 'back', left: 'left side', right: 'right side', top: 'top', bottom: 'bottom' },
  // What's printed on it worth reading: more is better, the apps reading the sidecar take what they want.
  reads: { title: 'its name or title' },
  build: async (pictures, { options, sights, estimateMm }) => {
    // TODO: its real size: a standard one, a lookup, or what's given. Each standard size gets a comment with its source.
    const given = options.sizeMm ?? [];
    const size = [0, 1, 2].map((i) => given[i] ?? estimateMm?.[i] ?? 0);
    if (size.some((mm) => !(mm > 0))) throw new Error('a __NAME__ needs its size: --size WxHxD in mm (or a vision roster to estimate it)');
    const warnings: string[] = [];
    const round = (mm: number) => Math.round(mm * 10) / 10;
    if (given.filter((mm) => mm !== undefined).length < 3) warnings.push(`the size is partly the vision models' estimate (${size.map(round).join(' × ')} mm): --size for the real one`);

    // The photos, cut to the faces the vision models found and placed on them.
    const { parts, placed } = cut(pictures, sights);
    const all = await shots(parts);
    const { chosen, roles, undecided } = assignFaces(all, FACES, { placed });
    if (undecided) throw sidesUnknown(Boolean(sights));
    const photo = (face: Face) => (chosen[face] === undefined ? undefined : all[chosen[face]].texture);
    const front = photo('front');
    if (!front) throw new Error('a __NAME__ needs a photo of its front');

    // TODO: its shape. A box is built here; src/kit has plates, rings and rounded boxes, and you can build your own.
    const plain: Side = { color: front.edge, roughness: 0.6 };
    const sides = Object.fromEntries(FACES.map((face) => [face, photo(face) ? { picture: photo(face)!.jpeg } : plain])) as Record<Face, Side>;
    const faces: Faces = Object.fromEntries(FACES.map((face) => [face, photo(face) ? 'photo' : face === 'back' ? 'color' : 'plain']));
    return {
      glb: await box('__NAME__', size, sides, ROUNDED_MM),
      sidecar: {
        widthMm: round(size[0]), heightMm: round(size[1]), depthMm: round(size[2]),
        measuredBy: Object.fromEntries(['width', 'height', 'depth'].map((key, i) => [key, given[i] !== undefined ? 'measured' : 'vision'])),
        faces, review: [], warnings, pictures: pictureRecord(all, roles),
      },
    };
  },
};
