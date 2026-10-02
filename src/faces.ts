// Which photo shows which face, for any number of photos of one object, so
// more photos make a better model. In order: a face named in the file name
// ("back.jpg", "spine-2.heic"); for a book, the photo with the ISBN barcode is
// the back, and narrow photos are the spine and page edges by shape; the rest
// are the front, then the back. Extra photos join the face of the same shape
// whose color they match, and each face keeps its sharpest photo.
import { measure, texture, type Picture } from './image.ts';

export type Texture = Awaited<ReturnType<typeof texture>>;
export interface Shot { picture: Picture; texture: Texture; sharpness: number; color: number[] }

// File-name words for each face. The last one in the name wins ("back_to_the_future_front" is
// the front), and "cover" means the front only when no other face word is there ("back-cover").
const FACE_WORDS: Record<string, string> = { spine: 'spine', back: 'back', top: 'top', bottom: 'bottom', edge: 'edge', fore: 'edge', front: 'front' };
// Width per unit height: spines and page edges are under TALL (over WIDE lying down); covers sit between.
const [TALL, WIDE] = [0.45, 2.0];
const SAME_FACE_COLOR = 60; // mean-color distance (0–441) within which an extra photo can be another shot of a face

export const shots = (pictures: Picture[]): Promise<Shot[]> =>
  Promise.all(pictures.map(async (picture) => ({ picture, texture: await texture(picture), ...(await measure(picture)) })));

export const shape = (shot: Shot) => {
  const aspect = shot.texture.width / shot.texture.height;
  return aspect < TALL ? 'tall' : aspect > WIDE ? 'wide' : 'flat';
};

function namedFace(shot: Shot, faces: string[]): string | undefined {
  if (shot.picture.source.page) return undefined; // a PDF's name covers all its pages, so it names no face
  const words = shot.picture.source.file.toLowerCase().replace(/\.[a-z0-9]+$/, '').split(/[^a-z]+/);
  const named = words.map((word) => FACE_WORDS[word]).filter((face) => face && faces.includes(face));
  return named.at(-1) ?? (words.includes('cover') && faces.includes('front') ? 'front' : undefined);
}

/**
 * Each face's chosen shot, and every shot's role for the record: its face,
 * "alternate <face>" or "unused". `frontAt`/`backAt` are shots the content
 * places (a slab's QR label, a book's barcode); a file name overrides them.
 * `byShape` is for books: tall narrow shots are the spine then the page
 * edge, wide ones the top then the bottom.
 */
export function assignFaces(all: Shot[], faces: string[], { frontAt, backAt, byShape = false }: { frontAt?: number; backAt?: number; byShape?: boolean } = {}) {
  const candidates = new Map<string, number[]>();
  const add = (face: string, i: number) => candidates.set(face, [...(candidates.get(face) ?? []), i]);

  const rest: number[] = [];
  all.forEach((shot, i) => {
    const face = namedFace(shot, faces) ?? (i === frontAt ? 'front' : i === backAt ? 'back' : undefined);
    if (face && faces.includes(face)) add(face, i);
    else rest.push(i);
  });

  const extras: number[] = [];
  for (const i of rest) {
    const kind = byShape ? shape(all[i]) : 'flat';
    const slots = kind === 'tall' ? ['spine', 'edge'] : kind === 'wide' ? ['top', 'bottom'] : ['front', 'back'];
    const free = slots.find((face) => faces.includes(face) && !candidates.has(face));
    if (free) add(free, i);
    else extras.push(i);
  }

  // An extra photo joins the face of its shape whose first photo's color is nearest, if near
  // enough to be another shot of it (an interior page or a stray photo stays unused).
  const distance = (i: number, j: number) => Math.hypot(...all[i].color.map((c, k) => c - all[j].color[k]));
  for (const i of extras) {
    const near = [...candidates.entries()]
      .filter(([, list]) => (!byShape || shape(all[list[0]]) === shape(all[i])) && distance(i, list[0]) < SAME_FACE_COLOR)
      .sort(([, a], [, b]) => distance(i, a[0]) - distance(i, b[0]))[0];
    if (near) add(near[0], i);
  }

  const chosen: Record<string, number> = {};
  const roles = all.map(() => 'unused');
  for (const [face, list] of candidates) {
    const best = list.reduce((a, b) => (all[b].sharpness > all[a].sharpness ? b : a));
    chosen[face] = best;
    for (const i of list) roles[i] = i === best ? face : `alternate ${face}`;
  }
  return { chosen, roles };
}

/** The record of each photo for the sidecar: where it came from, how sharp, and what it became. */
export const pictureRecord = (all: Shot[], roles: string[]) =>
  all.map((shot, i) => ({ ...shot.picture.source, sharpness: shot.sharpness, role: roles[i] }));
