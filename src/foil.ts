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
import { type Look, patterned, PATTERNS, PLAIN, TOPPS_RAYWAVE, WORDS } from './patterns.ts';
import { pooled, readOf, type Sight, votesOn } from './vision.ts';

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
 * What the models say of something that shows only at some angles, from the pictures showing `face` (the side it's
 * on), `kinds[0]` its absence: a video's frames that miss it say it isn't there, so two answers naming a kind are
 * enough (the kind named most), and one alone isn't, so no single model's slip makes a plain card shine.
 */
function seenOn(sights: Sight[] | undefined, face: string, key: string, kinds: string[]): string | undefined {
  const facing = sights?.filter(({ faces }) => faces.some((f) => f.face === face));
  const said = (facing ?? []).flatMap(({ answers }) => votesOn(answers, key).map(({ value }) => value).filter((kind) => kinds.includes(kind)));
  return said.filter((kind) => kind !== kinds[0]).length >= 2 ? pooled(facing, key, kinds.slice(1)) : said.length ? kinds[0] : undefined;
}
/** A card's kind of foil, as the models see `face`: a photo of the back alone shows none. */
export const foilKind = (sights: Sight[] | undefined, face: string) => seenOn(sights, face, 'foil', KINDS);

// A foil border (Pokémon-ex, LV.X and Prime cards, Reptilian refractors): the card's face outside its printed border's
// inner edge, the `frame` the models find; where they don't, a standard card's, 3 mm in from each side.
export const borderAsk = (front: string) => `does the printed border around ${front} shine like foil (silver, holo or glittering, flashing at some angles): "foil", or is it plain ink: "plain"?`;
export const FRAME: Region = { x0: 0.047, x1: 0.953, y0: 0.034, y1: 0.966 };
export const FRAME_FACE = 'the inside edge of the card\'s printed border: where the border stops and the card\'s design inside it begins';
/** Whether a card's border is foil, as the models see `face`. */
export const borderFoil = (sights: Sight[] | undefined, face: string) => seenOn(sights, face, 'border', ['plain', 'foil']);

// Emboss: a textured card's raised ridges (full arts, special illustration rares, gold and rainbow rares), a relief
// apart from the foil (the same emboss can carry different foil). The ridges follow the art's own lines, so the
// relief is taken from the photo: its edges become ridges in the normal map.
export const textureAsk = (front: string) => `is the surface of ${front} "textured" (raised ridges, fingerprint-like lines or etching that catch the light) or "smooth"?`;
/** Whether a card's front is textured, as the models see `face`. */
export const textureOf = (sights: Sight[] | undefined, face: string) => seenOn(sights, face, 'texture', ['smooth', 'textured']);
/** A graded slab's label, asked as it is: printed on metallic foil, or on paper. */
export const labelFinishAsk = 'the grade label insert itself (not the card): is it printed on "foil", a metallic sheet that shines like metal (gold, silver or black chrome, mirroring the light), or on "paper" (matte)? Judge the label you see, not what its grader usually uses.';
/**
 * Whether a slab's label is foil, as the models see it on any side showing it: two models saying so, more than say
 * paper. One model saying it of both sides is still one model.
 */
export function labelFinishOf(sights: Sight[] | undefined): string | undefined {
  const facing = sights?.filter(({ faces }) => faces.some(({ face }) => face === 'label')) ?? [];
  const saying = (kind: string) => new Set(facing.flatMap(({ answers }) => [...new Set(answers.map(({ model }) => model))]
    .filter((model) => votesOn(answers.filter((a) => a.model === model), 'labelFinish')[0]?.value === kind))).size;
  const [foil, paper] = [saying('foil'), saying('paper')];
  return foil >= 2 && foil > paper ? 'foil' : foil || paper ? 'paper' : undefined;
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
 * `inverted`, the other way round (a reverse holo); drawn in `look` (src/patterns.ts), plain unless told.
 */
export async function foilMap(regions: Region[], aspect: number, inverted = false, look = PLAIN, { frame, relief }: Extras = {}): Promise<Foil> {
  const [w, h] = [512, Math.round(512 * aspect)];
  const [ground, inside] = inverted ? [FOIL, PRINT] : [PRINT, FOIL];
  const shapes = regions.map(({ x0, x1, y0, y1, round }) => (round
    ? `<ellipse cx="${((x0 + x1) / 2) * w}" cy="${((y0 + y1) / 2) * h}" rx="${((x1 - x0) / 2) * w}" ry="${((y1 - y0) / 2) * h}" fill="${inside}"/>`
    : `<rect x="${x0 * w}" y="${y0 * h}" width="${(x1 - x0) * w}" height="${(y1 - y0) * h}" fill="${inside}"/>`)).join('');
  // A foil border: the whole face but its frame.
  const border = frame ? `<path fill-rule="evenodd" fill="${FOIL}" d="M0 0H${w}V${h}H0Z M${frame.x0 * w} ${frame.y0 * h}H${frame.x1 * w}V${frame.y1 * h}H${frame.x0 * w}Z"/>` : '';
  const map = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${ground}"/>${shapes}${border}</svg>`)).removeAlpha().raw().toBuffer();
  const heights = relief && await sharp(relief).resize(w, h, { fit: 'fill' }).greyscale().blur(1).raw().toBuffer();
  return patterned(look, w, h, map, heights);
}
/** More on a face than its foil's regions: a foil border inside `frame`, and an emboss raised from the `relief` picture's edges. */
export interface Extras { frame?: Region; relief?: Uint8Array }

/** A card front's foil map: the picture box (holo), all but it (reverse), the whole front (full) or none, in `look`, with a border or emboss. */
export const cardFoil = (kind: string, box: Region, aspect: number, look?: Look, extras?: Extras) =>
  foilMap(kind === 'full' ? [{ x0: 0, x1: 1, y0: 0, y1: 1 }] : kind === 'holo' || kind === 'reverse' ? [box] : [], aspect, kind === 'reverse', look, extras);

/** The question for a card's foil pattern (src/patterns.ts), `front` naming its front. */
export const patternAsk = (front: string) => `if ${front} has foil, which pattern is in its shine: ${Object.entries(PATTERNS).map(([name, { about }]) => `"${name}" (${about})`).join('; ')}? Say "none" if it has no foil.`;

/**
 * A card's foil look and what decided it: the pattern the models saw on `face`, refined by its parallel's name (the
 * models' read `variant`, as "Gold Wave Refractor") where a word in it names a look of that same pattern; the name's
 * look where the models saw none; else plain. Two words that make
 * one ("X-Fractor", "Poké Ball", "Ray Wave") count as one, and of several, the last that isn't a plain sweep wins: a
 * name ends in its pattern, after the product or box ("Mosaic Genesis", "Choice Tiger", "Cosmic Chrome Nucleus").
 */
export function foilLook(sights: Sight[] | undefined, face: string): { look: Look; lookBy: string } {
  const { read, readBy } = readOf(sights);
  const plain = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  // Only a name two models read alike: one model alone read a plain Psyduck as "Ultra Rare Gold FOIL FEAT." (2026-10-22).
  const tokens = readBy.variant === 'agreed' ? plain(read.variant).split(/[^a-z0-9]+/).filter(Boolean) : [];
  const lookOf = (word: string) => (word === 'raywave' && /topps|bowman/.test(plain(read.maker)) ? TOPPS_RAYWAVE : WORDS[word] ?? WORDS[word.replace(/s$/, '')]);
  const named: Look[] = [];
  for (let k = 0; k < tokens.length; k++) {
    const pair = k + 1 < tokens.length && lookOf(tokens[k] + tokens[k + 1]);
    if (pair) k++;
    const look = pair || lookOf(tokens[k]);
    if (look) named.push(look);
  }
  const look = named.findLast((l) => l.pattern !== 'sweep') ?? named[0];
  // What the models saw comes first: the name's look only where it's that same pattern (its settings are the
  // name's own: "Gold Wave" is flow wave in gold), or where the models saw none.
  const seen = pooled(sights?.filter(({ faces }) => faces.some((f) => f.face === face)), 'pattern', Object.keys(PATTERNS));
  if (look && (!seen || PATTERNS[seen].look.pattern === look.pattern)) return { look, lookBy: 'parallel' };
  return seen ? { look: PATTERNS[seen].look, lookBy: 'vision' } : { look: PLAIN, lookBy: 'assumed' };
}

/**
 * What to say when a card shines but no one named or saw its pattern, `filmed` when a video was given. A video
 * already outweighs photos (src/image.ts keeps six frames, each answered like a photo), so it needs no precedence
 * of its own: what helps is a video, or a slower one.
 */
export const unseenPattern = (filmed: boolean) => `the foil's pattern (no parallel named it and the models didn't see it${filmed ? ' in the photos or the video\'s frames' : ''}: drawn plain). ${filmed
  ? 'A slower video, tilting the front through the light of one bright lamp, gives them more frames that catch it'
  : 'A short video of the front tilting under a light shows the models the foil as it flashes'}`;

/** A look for the sidecar: its pattern, and its kind if it has one ("flow wave"). */
export const lookName = ({ pattern, kind }: Look) => [pattern, kind].filter(Boolean).join(' ');

/** A region for the sidecar: to a tenth of a percent. */
export const rounded = (region: Region): Region => {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return { x0: r(region.x0), x1: r(region.x1), y0: r(region.y0), y1: r(region.y1), ...(region.round && { round: true }) };
};
