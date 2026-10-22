// Foil: where an object shines as it turns, drawn as film-coated metal (src/glb.ts foiled). A trading card's
// holofoil follows its picture box (a holo's box shines, a reverse holo's everything else, a full art's the whole
// front); a book's foil seal and a slab label's hologram are patches of their own. The vision models say which kind
// of foil a card has and find the picture box, seals and holograms as they find any face; this turns what they
// found into a foil map over the face it's on.
//
// Measuring foil from how a video's frames change was tried on a reverse-holo Psyduck (2026-10-03): handheld
// frames differed more by glare and slight misalignment than by foil, so the kind is asked instead. ponytail: a
// video could refine the mask once its frames are aligned to the pixel.
import sharp from 'sharp';
import type { Foil } from './glb.ts';
import { mapping } from './image.ts';
import { type Look, patterned, PATTERNS, TOPPS_RAYWAVE, WORDS } from './patterns.ts';
import { pooled, readOf, type Sight } from './vision.ts';

/** Part of a face, in fractions of it (x across, y down); a round one (a seal) is the circle in its box. */
export interface Region { x0: number; x1: number; y0: number; y1: number; round?: boolean }

export const KINDS = ['none', 'holo', 'reverse', 'full'];
/** The question for a card, `front` naming its front: "the front", or "the card's front" inside a slab. */
export const foilAsk = (front: string) => `which foil is on ${front}: "none", "holo" (only the picture box shines), "reverse" (everything but the picture box shines) or "full" (the whole front shines, as on full-art, textured and refractor cards)? Foil flashes only at some angles: if you see any shine or rainbow at all, say which kind.`;
// A standard Pokémon card's picture box, in fractions of its front (simeydotme/pokemon-cards-css places it so):
// where it goes when the models don't find it.
export const PICTURE_BOX: Region = { x0: 0.08, x1: 0.92, y0: 0.1, y1: 0.47 };
// Foil: film, roughness 0.3, 60% metal; print: no film, roughness 0.4, no metal. Tuned on the same Psyduck (2026-10-03):
// all metal buried the print in a dark mirror, as the ink over real foil doesn't; at 60% the text stays clear.
const [FOIL, PRINT] = ['rgb(255,77,153)', 'rgb(0,102,0)'];

/**
 * A card's kind of foil, from the pictures showing `face` (the side it's on): a photo of the back alone shows none.
 * Foil flashes only at some angles, so a video's frames that miss it say none: two answers naming a kind are enough
 * (the kind named most), and one alone isn't, so no single model's slip makes a plain card shine.
 */
export function foilKind(sights: Sight[] | undefined, face: string): string | undefined {
  const facing = sights?.filter(({ faces }) => faces.some((f) => f.face === face));
  const said = (facing ?? []).flatMap(({ answers }) => answers.flatMap(({ asked }) => (asked?.foil && KINDS.includes(asked.foil) ? [asked.foil] : [])));
  return said.filter((kind) => kind !== 'none').length >= 2 ? pooled(facing, 'foil', KINDS.slice(1)) : said.length ? 'none' : undefined;
}

/** Where four corners sit within four others, in fractions of the outer: each edge the mean of the two corners nearest it, kept within. */
export function regionOf(inner: number[][], outer: number[][]): Region {
  const [xs, ys] = [0, 1].map((k) => inner.map((p) => mapping(outer, [[0, 0], [1, 0], [1, 1], [0, 1]])(p)[k]).sort((a, b) => a - b));
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { x0: clamp((xs[0] + xs[1]) / 2), x1: clamp((xs[2] + xs[3]) / 2), y0: clamp((ys[0] + ys[1]) / 2), y1: clamp((ys[2] + ys[3]) / 2) };
}

/**
 * Where a region face (a card's `art`, a book's `sticker`) sits within another (its `front`), averaged over every
 * picture showing both: mapped through the outer face's corners, so one shot at an angle gives what one square on does.
 */
export function regionIn(sights: Sight[] | undefined, region: string, within: string): Region | undefined {
  const found = (sights ?? []).flatMap(({ faces }) => {
    const [outer, inner] = [within, region].map((name) => faces.find(({ face }) => face === name)?.corners);
    return outer && inner ? [regionOf(inner, outer)] : [];
  });
  if (!found.length) return undefined;
  const mean = (key: 'x0' | 'x1' | 'y0' | 'y1') => found.reduce((sum, r) => sum + r[key], 0) / found.length;
  return { x0: mean('x0'), x1: mean('x1'), y0: mean('y0'), y1: mean('y1') };
}

/**
 * A face's foil (src/glb.ts foiled), `aspect` its height over width: foil inside the regions, print elsewhere;
 * `inverted`, the other way round (a reverse holo); drawn in `look` (src/patterns.ts), cracked ice unless told.
 */
export async function foilMap(regions: Region[], aspect: number, inverted = false, look = PATTERNS.shards.look): Promise<Foil> {
  const [w, h] = [512, Math.round(512 * aspect)];
  const [ground, inside] = inverted ? [FOIL, PRINT] : [PRINT, FOIL];
  const shapes = regions.map(({ x0, x1, y0, y1, round }) => (round
    ? `<ellipse cx="${((x0 + x1) / 2) * w}" cy="${((y0 + y1) / 2) * h}" rx="${((x1 - x0) / 2) * w}" ry="${((y1 - y0) / 2) * h}" fill="${inside}"/>`
    : `<rect x="${x0 * w}" y="${y0 * h}" width="${(x1 - x0) * w}" height="${(y1 - y0) * h}" fill="${inside}"/>`)).join('');
  const map = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${ground}"/>${shapes}</svg>`)).removeAlpha().raw().toBuffer();
  return patterned(look, w, h, map);
}

/** A card front's foil map: the picture box (holo), all but it (reverse) or the whole front (full), in `look`. */
export const cardFoil = (kind: string, box: Region, aspect: number, look?: Look) =>
  foilMap([kind === 'full' ? { x0: 0, x1: 1, y0: 0, y1: 1 } : box], aspect, kind === 'reverse', look);

/** The question for a card's foil pattern (src/patterns.ts), `front` naming its front. */
export const patternAsk = (front: string) => `if ${front} has foil, which pattern is in its shine: ${Object.entries(PATTERNS).map(([name, { about }]) => `"${name}" (${about})`).join('; ')}? Say "none" if it has no foil.`;

/**
 * A card's foil look and what decided it: its parallel's name (the models' read `variant`, as "Gold Wave Refractor"),
 * when a word in it names a look; else the pattern the models saw on `face`; else cracked ice. Two words that make
 * one ("X-Fractor", "Poké Ball", "Ray Wave") count as one, and of several, the last that isn't a plain sweep wins: a
 * name ends in its pattern, after the product or box ("Mosaic Genesis", "Choice Tiger", "Cosmic Chrome Nucleus").
 */
export function foilLook(sights: Sight[] | undefined, face: string): { look: Look; lookBy: string } {
  const { read } = readOf(sights);
  const plain = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const tokens = plain(read.variant).split(/[^a-z0-9]+/).filter(Boolean);
  const lookOf = (word: string) => (word === 'raywave' && /topps|bowman/.test(plain(read.maker)) ? TOPPS_RAYWAVE : WORDS[word] ?? WORDS[word.replace(/s$/, '')]);
  const named: Look[] = [];
  for (let k = 0; k < tokens.length; k++) {
    const pair = k + 1 < tokens.length && lookOf(tokens[k] + tokens[k + 1]);
    if (pair) k++;
    const look = pair || lookOf(tokens[k]);
    if (look) named.push(look);
  }
  const look = named.findLast((l) => l.pattern !== 'sweep') ?? named[0];
  if (look) return { look, lookBy: 'parallel' };
  const seen = pooled(sights?.filter(({ faces }) => faces.some((f) => f.face === face)), 'pattern', Object.keys(PATTERNS));
  return seen ? { look: PATTERNS[seen].look, lookBy: 'vision' } : { look: PATTERNS.shards.look, lookBy: 'assumed' };
}

/** A look for the sidecar: its pattern, and its kind if it has one ("flow wave"). */
export const lookName = ({ pattern, kind }: Look) => [pattern, kind].filter(Boolean).join(' ');

/** A region for the sidecar: to a tenth of a percent. */
export const rounded = (region: Region): Region => {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return { x0: r(region.x0), x1: r(region.x1), y0: r(region.y0), y1: r(region.y1), ...(region.round && { round: true }) };
};
