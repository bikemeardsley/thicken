// Which photo shows which face, for any number of photos of one object, from
// what the photos show (file names are whatever the phone made up). With a
// vision roster (src/vision.ts), each photo is cut into the faces the models
// found, straightened and placed. Otherwise, or for a photo they found
// nothing in, the photo is used whole and, in order: codes place some (a
// book's ISBN barcode is on its back); a book's narrow photos, shot standing
// or lying down, are its spine if they show print and a page side if plain
// paper; a lone photo left is the front, and with one side proven the other
// follows. Photo order is no evidence: two photos left that nothing tells
// apart are for the vision models (sidesUnknown). Extra photos join the face
// of the same shape whose color they match, and each face keeps its sharpest
// photo, so more photos make a better model. A video's frames are for the
// models: one they found no face in is left out, and a frame shows a face only
// where no photo does.
import { inside, isQuad, measure, straighten, texture, type Picture } from './image.ts';
import type { Sight } from './vision.ts';

export type Texture = Awaited<ReturnType<typeof texture>>;
export interface Shot { picture: Picture; texture: Texture; sharpness: number; color: number[]; stripes: number }
/** A code proving which face it's printed on (a book's ISBN barcode is on its back), and where in which picture. */
export interface Proof { picture: number; face: string; at: number[] }

// Set on crops of real photos (Wikimedia Commons, 2026-10-02): 43 spines scored sharpness 8.7–39 and
// stripes 0.5–3.6; 13 page blocks 2.4–13 and 0.5–7.2, the plain modern ones calm (sharpness under 6).
// That gets every spine and 10 of the page blocks; the rest were a gilt edge and a dim, yellowed one.
const NARROW = 0.5; // short side over long: spines and page sides are under it, covers over
const STRIPES = 4; // page lines this strong are pages, whatever their color
const CALM = 7; // sharpness under which a light, unsaturated photo is plain paper, nothing printed on it
const ACROSS = 1.2; // a page photo looking this much thicker than the spine runs across the book: top or bottom
const SAME_FACE_COLOR = 60; // mean-color distance (0–441) within which an extra photo can be another shot of a face
const MIN_FACE_PX = 24; // a face seen narrower than this (a sliver of spine past a cover) is no picture of it

/**
 * The pictures to place, each with the face it's placed on, if known: every face the vision models
 * found in a photo, straightened; a photo they found none in, whole, placed by its codes if at all.
 * A code outranks the models: the face it's printed on is the face it proves, whatever they called it.
 */
export function cut(pictures: Picture[], sights: Sight[] = [], proofs: Proof[] = []) {
  const parts: Picture[] = [];
  const placed: string[] = [];
  const from: { picture: number; corners?: number[][] }[] = []; // each part's picture, and its corners there if cut out
  pictures.forEach((picture, i) => {
    const faces = (sights[i]?.faces ?? []).filter(({ corners }) => isQuad(corners) &&
      corners.every((p, k) => Math.hypot(corners[(k + 1) % 4][0] - p[0], corners[(k + 1) % 4][1] - p[1]) >= MIN_FACE_PX));
    const proven = proofs.filter((proof) => proof.picture === i);
    if (!faces.length && picture.source.time === undefined) { // a frame shows the whole scene: never a face whole
      placed[parts.length] = proven[0]?.face;
      from.push({ picture: i });
      parts.push(picture);
    }
    for (const { face, corners } of faces) {
      const named = proven.find(({ at }) => inside(at, corners))?.face ?? face;
      placed[parts.length] = named;
      from.push({ picture: i, corners });
      parts.push({ ...straighten(picture, corners), source: { ...picture.source, face: named } });
    }
  });
  return { parts, placed, from };
}

export const shots = (pictures: Picture[]): Promise<Shot[]> =>
  Promise.all(pictures.map(async (picture) => ({ picture, texture: await texture(picture), ...(await measure(picture)) })));

/** Short side over long, whichever way the photo was shot. */
const thinness = ({ texture: { width, height } }: Shot) => Math.min(width, height) / Math.max(width, height);

/** Plain pages: page lines along the photo, or calm, light, unsaturated paper. A spine has print on it; sprayed and gilt edges are taken for one. */
export function looksLikePages({ stripes, sharpness, color }: Shot): boolean {
  const [max, min] = [Math.max(...color), Math.min(...color)];
  const saturation = max ? (max - min) / max : 0;
  const lightness = (color[0] + color[1] + color[2]) / 3 / 255;
  return stripes >= STRIPES || (sharpness < CALM && saturation < 0.35 && lightness > 0.5);
}

/**
 * Each face's chosen shot, every shot's role for the record (its face,
 * "alternate <face>" or "unused"), and whether front and back are undecided:
 * nothing but photo order to tell them apart. `placed[i]` is the face the
 * models or a code put shot i on; `byShape` is for books.
 */
export function assignFaces(all: Shot[], faces: string[], { placed = [], byShape = false }: { placed?: string[]; byShape?: boolean } = {}) {
  const candidates = new Map<string, number[]>();
  const add = (face: string, i: number) => candidates.set(face, [...(candidates.get(face) ?? []), i]);
  const narrow = all.map((shot) => byShape && thinness(shot) < NARROW);
  const pages = all.map((shot) => looksLikePages(shot));
  // The page edge runs down the book, as the spine does, so it's as thin as the spine; the top and bottom run
  // across it, so look thicker. With no spine photo, the thinnest page photo is the edge.
  // ponytail: assumes a book taller than wide; on a landscape book a top or bottom photo passes for the page
  // edge. Compare with the cover's shape if landscape books with photographed tops turn up.
  const spines = all.filter((_, i) => narrow[i] && !pages[i]);
  const down = Math.min(...(spines.length ? spines : all.filter((_, i) => narrow[i])).map(thinness));

  const extras: number[] = [];
  let byOrder = 0;
  all.forEach((shot, i) => {
    if (placed[i]) add(placed[i], i);
    else if (narrow[i] && !pages[i]) add('spine', i);
    else if (narrow[i] && thinness(shot) < down * ACROSS) add('edge', i);
    else if (narrow[i] && !(candidates.has('top') && candidates.has('bottom'))) add(candidates.has('top') ? 'bottom' : 'top', i);
    else if (!narrow[i] && !candidates.has('front') && !placed.includes('front')) { add('front', i); byOrder++; }
    else if (!narrow[i] && !candidates.has('back') && !placed.includes('back')) { add('back', i); byOrder++; }
    else extras.push(i);
  });

  // An extra photo joins the face whose first photo is the same shape and nearest in color, if near
  // enough to be another shot of it (an interior page or a stray photo stays unused).
  const distance = (i: number, j: number) => Math.hypot(...all[i].color.map((c, k) => c - all[j].color[k]));
  for (const i of extras) {
    const near = [...candidates.entries()]
      .filter(([, list]) => narrow[list[0]] === narrow[i] && distance(i, list[0]) < SAME_FACE_COLOR)
      .sort(([, a], [, b]) => distance(i, a[0]) - distance(i, b[0]))[0];
    if (near) add(near[0], i);
  }

  const chosen: Record<string, number> = {};
  const roles = all.map(() => 'unused');
  for (const [face, list] of candidates) {
    if (!faces.includes(face)) continue;
    // A photo beats a video's frame, however sharp the frame scores: frames are smaller, compressed and toned down.
    const photos = list.filter((i) => all[i].picture.source.time === undefined);
    const best = (photos.length ? photos : list).reduce((a, b) => (all[b].sharpness > all[a].sharpness ? b : a));
    chosen[face] = best;
    for (const i of list) roles[i] = i === best ? face : `alternate ${face}`;
  }
  // Front and back both left to photo order: nothing in the photos said which is which.
  return { chosen, roles, undecided: byOrder === 2 };
}

/**
 * Photo order is no evidence of which side is which (decided 2026-10-03): when nothing else tells them apart, the
 * vision models must, so a run without them stops. A lone photo is the front; one side proven, the other follows.
 */
export const sidesUnknown = (vision: boolean) => new Error(vision
  ? 'the vision models didn\'t say which photo shows the front: run again'
  : 'nothing in the photos says which one shows the front: a vision roster tells the sides apart (see the README), or give just the front');

/** The record of each photo for the sidecar: where it came from, how sharp, and what it became. */
export const pictureRecord = (all: Shot[], roles: string[]) =>
  all.map((shot, i) => ({ ...shot.picture.source, sharpness: shot.sharpness, role: roles[i] }));
