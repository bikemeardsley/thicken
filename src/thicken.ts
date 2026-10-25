// Pictures in, a model out: load every input, pick the profile, build it. A
// profile (src/profiles, one file each) is a kind of object Thicken knows:
// what to tell the vision models about it, how its codes or pictures give it
// away, and how to build it. It's the one named; else the first whose codes
// or pictures give it away (an ISBN, a grader's QR code, cut-out artwork);
// else, with a vision roster, the one the models say it is, `box` covering
// anything box-shaped. Barcodes are read whatever the profile, so a back
// cover's ISBN feeds the book's size lookup without being typed in. The
// sidecar records how each fact was found, what still needs review, and how
// the model was built.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { codes, load, VIDEO, type Picture } from './image.ts';
import { keepRun, trainingOn } from './training.ts';
import { findBench, identify, lookAll, readOf, visionOn, visionRecord, type Identity, type Sight } from './vision.ts';

/** A kind of object Thicken knows. */
export interface Profile {
  name: string;
  /** What it is, in a few words: for the README, and for the vision models choosing a profile (one with faces to find). */
  about: string;
  /** For the README's table of profiles: what it's made from, and what it makes. */
  input: string;
  makes: string;
  /**
   * The sidecar's fields this profile writes, beyond those every model has (its size, faces, pictures, codes,
   * review, what was read): each in a few words. The README lists them, and agents are told them.
   */
  records: Record<string, string>;
  /** Its faces, each in a few words, for the vision models finding them in a photo. */
  faces: Record<string, string>;
  /** Anything more the vision models need to find its faces the right way up. */
  note?: string;
  /** What the vision models read off it as printed, each a JSON field (a slab's "grade"); a description in a list for a list. */
  reads?: Record<string, string | [string]>;
  /** Short questions the vision models answer along with the faces, each a JSON field (a card's "corners"). */
  asks?: Record<string, string>;
  /** Faces left where the models put them, not snapped to the nearest strong edge (it's often the wrong one). */
  unsnapped?: string[];
  /**
   * The shapes a face can have, width over height upright (a slab's front: each holder's). An answer far off every
   * one places nothing; the closer fit wins a tie; and on faces not `unsnapped`, the edges seat finds outlines of them.
   */
  shapes?: Record<string, number[]>;
  /** What a face always shows, as fields of `reads` (a slab's front: its grade): a model naming it reads one of them off it. */
  shows?: Record<string, string[]>;
  /** A generic shape (box), taking anything of its shape: tried after every specific profile. */
  generic?: boolean;
  /** Made from words, not pictures (lettering): what's given in place of files is its text, handed to build as `job.words`. */
  words?: boolean;
  /** Unaided: whether its codes or pictures give it away, each code's use, and what they say. */
  read?(scanned: Scanned[], pictures: Picture[]): Facts;
  build(pictures: Picture[], job: Job): Promise<{ glb: Uint8Array; sidecar: Built }>;
}

const isProfile = (value: any): value is Profile => typeof value?.name === 'string' && typeof value.build === 'function' && typeof value.faces === 'object';
/**
 * The kinds of object Thicken knows: every profile in src/profiles, found by itself, so a new one is one file and
 * nothing else (CONTRIBUTING.md). Alphabetical, the generic shapes last, the order they're tried unaided. From a
 * clone the files are .ts; from npm, built, .js.
 */
const folder = new URL('./profiles/', import.meta.url);
const ext = path.extname(fileURLToPath(import.meta.url));
const builtIn = (await Promise.all(readdirSync(folder).filter((file) => file.endsWith(ext) && !file.endsWith('.d.ts')).sort().map((file) => import(new URL(file, folder).href))))
  .flatMap((module) => Object.values(module).filter(isProfile));

/**
 * Your own profiles, made with `thicken profile new`: every .ts (or .js) file in THICKEN_PROFILES, else
 * ~/.thicken/profiles; an empty THICKEN_PROFILES means none. One named as a built-in replaces it, said on stderr: an
 * improvement being tried before it's contributed. One that won't load is skipped, said the same way.
 */
export const MY_PROFILES = process.env.THICKEN_PROFILES ?? path.join(homedir(), '.thicken', 'profiles');
const mine: Profile[] = [];
const myFiles = MY_PROFILES && existsSync(MY_PROFILES)
  ? readdirSync(MY_PROFILES).filter((file) => /\.(ts|js)$/.test(file) && !/\.(test|d)\.ts$/.test(file)).sort()
  : [];
if (myFiles.length) lendThicken();
for (const file of myFiles) {
  try {
    mine.push(...Object.values(await import(pathToFileURL(path.join(MY_PROFILES, file)).href)).filter(isProfile));
  } catch (error) {
    process.stderr.write(`thicken: your profile ${path.join(MY_PROFILES, file)} didn't load, so it's left out: ${(error as Error).message}\n`);
  }
}
for (const { name } of mine) {
  if (builtIn.some((p) => p.name === name)) process.stderr.write(`thicken: your profile "${name}" (${MY_PROFILES}) is used in place of the built-in one\n`);
}
export const PROFILES: Profile[] = [...builtIn.filter((p) => !mine.some((m) => m.name === p.name)), ...mine]
  .sort((a, b) => a.name.localeCompare(b.name))
  .sort((a, b) => Number(Boolean(a.generic)) - Number(Boolean(b.generic)));

/**
 * Lets your own profiles, wherever they are, import what the built-in ones do: thicken's parts ('thicken/kit'), a
 * built-in profile ('thicken/profiles/card'), and thicken's own dependencies (sharp, glTF-Transform), found from
 * thicken when not from the profile's folder.
 */
function lendThicken(): void {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'thicken/kit') return { url: new URL(`./kit${ext}`, import.meta.url).href, shortCircuit: true };
      const profile = /^thicken\/profiles\/([a-z][a-z0-9-]*)$/.exec(specifier);
      if (profile) return { url: new URL(`${profile[1]}${ext}`, folder).href, shortCircuit: true };
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        if (/^(\.|\/|[a-z]:|node:|file:)/i.test(specifier)) throw error;
        return nextResolve(specifier, { ...context, parentURL: import.meta.url });
      }
    },
  });
}

export interface Options {
  profile?: string;
  isbn?: string;
  sizeMm?: number[]; // width, height, depth; any may be missing
  holder?: string; // slab holder, e.g. psa, psa-thick, bgs
  pt?: number; // a card's thickness in points (thousandths of an inch), raw or slabbed: thick cards are sold by it
  widthMm?: number; // badge
  depthMm?: number; // badge
  cropped?: boolean; // each photo is cropped to the object's edges: the models say which face, not where
  corners?: Record<string, Record<string, number[][]>>; // a photo's faces as a person placed them: file name, face, corners in its pixels
}

/** A barcode or QR code as read off a picture. */
export interface Scanned { picture: number; format: string; text: string; at: number[] }
/**
 * A code seen on a picture, for the record. Its text is kept only when Thicken used it: a stray QR code can hold a
 * Wi-Fi password. Profiles also get where it is (`at`), to tell which face it's printed on; the sidecar doesn't.
 */
export interface Code { picture: number; format: string; use?: string; text?: string; at?: number[] }
/** What a profile read unaided: whether this is its kind of object, each code's use (by its place among those scanned), and the facts. */
export interface Facts { recognized: boolean; use: (string | undefined)[]; [fact: string]: unknown }
/** What a profile builds from: the options, what it read, the codes as recorded, and what the vision models saw and estimated. */
export interface Job { options: Options; facts: Facts; codes: Code[]; sights?: Sight[]; estimateMm?: number[]; words?: string[] }

export interface Sidecar {
  profile: string;
  sources: string[];
  widthMm: number;
  heightMm: number;
  depthMm: number;
  faces?: Faces;
  review: string[];
  warnings: string[];
  [detail: string]: unknown;
}

/** What a profile hands back, before the shared record is added. */
export interface Built { widthMm: number; heightMm: number; depthMm: number; warnings: string[]; faces?: Faces; review?: string[]; [detail: string]: unknown }

/**
 * Where each face's picture came from: the user's own photo, or something
 * standing in for one. A book's top, bottom and page edge default to
 * generated pages ("pages") and a box's sides to a plain color ("plain"),
 * which are fine as they are: extras, never to review.
 */
export type Faces = Record<string, 'photo' | 'openlibrary' | 'color' | 'pages' | 'plain'>;
const STAND_IN = { openlibrary: 'Open Library\'s cover, not your copy', color: 'plain color' };

/** The faces still to photograph, e.g. "spine (plain color)": for the review list and preview captions. */
export const stillToShoot = (faces: Faces = {}) =>
  Object.entries(faces).flatMap(([face, from]) => (from === 'photo' || from === 'pages' || from === 'plain' ? [] : [`${face} (${STAND_IN[from]})`]));

export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string;

/** The review's note on a model made without vision models. */
export const NO_VISION = 'no vision models were asked (set THICKEN_VISION_URL, THICKEN_VISION_KEY and THICKEN_VISION_MODELS, or THICKEN_BENCH_URL for a Benchwarmers gateway with a vision collection; see the README): photos were used as cropped, nothing printed was read, and sides, corners and foil were taken as the defaults';

export async function thicken(inputs: string[], options: Options = {}): Promise<{ glb: Uint8Array; sidecar: Sidecar }> {
  const started = performance.now();
  await findBench();
  const { sizeMm = [] } = options;
  if (sizeMm.some((mm) => mm !== undefined && !(mm > 0))) throw new Error('sizes must be positive millimeters, e.g. 152x229x25');
  const named = PROFILES.find((p) => p.name === (options.profile ?? (options.isbn ? 'book' : undefined)));
  if (options.profile && !named) throw new Error(`no "${options.profile}" profile (known: ${PROFILES.map((p) => p.name).join(', ')})`);
  if (!named?.words && !visionOn() && inputs.some((input) => VIDEO.test(input))) {
    throw new Error('a video is for the vision models, which find the object in its frames: set up a vision roster (see the README), or leave the video out');
  }
  const pictures = named?.words ? [] : (await Promise.all(inputs.map((input) => load(input)))).flat();
  if (!pictures.length && !options.isbn && !named?.words) throw new Error('give a picture to make it from, or a book\'s --isbn');

  // A profile with no faces is artwork (a badge), not a photo of an object: no codes to read.
  const scanned = named && !Object.keys(named.faces).length ? [] : await scan(pictures);
  let profile = named ?? PROFILES.find((p) => p.read?.(scanned, pictures).recognized);
  // Nothing gives it away: with a vision roster, the models say which it is, and roughly how big.
  const identity = profile || !visionOn() ? undefined : await identify(pictures[0], PROFILES.filter((p) => Object.keys(p.faces).length));
  profile ??= PROFILES.find((p) => p.name === identity?.profile);
  // Training mode: every question asked, kept once the run knows what came of it (src/training.ts).
  const keep = (asked: (Sight | Identity | undefined)[], object: object, extra: { roles?: { file: string; page?: number; time?: number; role: string }[]; failed?: string }) =>
    (trainingOn() ? keepRun(asked, { thicken: VERSION, object, ...extra }) : Promise.resolve());
  if (!profile) {
    const failed = `can't tell what this is: no ISBN barcode, no grader's QR code or cert barcode, not cut-out artwork${
      visionOn() ? ', and the vision models couldn\'t say' : ', and no vision roster to ask (see the README)'}. Name it: thicken ${PROFILES.map((p) => p.name).join('|')} <pictures>`;
    await keep([identity], {}, { failed });
    throw new Error(failed);
  }

  const facts = profile.read?.(scanned, pictures) ?? { recognized: false, use: [] };
  const recorded: Code[] = scanned.map(({ picture, format, text }, i) => ({ picture, format, ...(facts.use[i] && { use: facts.use[i], text }) }));
  // With a vision roster, the models find each photo's faces, which are cut out and straightened (src/vision.ts);
  // then any a person placed (--corners, --cropped) take the place of theirs.
  const looked = visionOn() && (Object.keys(profile.faces).length || profile.reads) ? await lookAll(pictures, profile) : undefined;
  const sights = options.corners || (options.cropped && looked) ? byHand(pictures, looked, options) : looked;
  // What the codes said of the object (a cert, an ISBN), for the training set's lines.
  const { recognized: _, use: __, ...said } = facts;
  const object = { profile: profile.name, ...said };
  let built: Awaited<ReturnType<Profile['build']>>;
  try {
    built = await profile.build(pictures, { options, facts, codes: recorded.map((code, i) => ({ ...code, at: scanned[i].at })), sights, estimateMm: identity?.sizeMm, ...(profile.words && { words: inputs }) });
  } catch (error) {
    await keep([identity, ...(looked ?? [])], object, { failed: (error as Error).message });
    throw error;
  }
  await keep([identity, ...(looked ?? [])], object, { roles: built.sidecar.pictures as { file: string; role: string }[] | undefined });

  const named_ = (i: number) => {
    const { file, page, time } = pictures[i].source;
    return `${file}${page ? ` page ${page}` : ''}${time === undefined ? '' : ` at ${time} s`}`;
  };
  const own = built.sidecar;
  // A video's frames are a handful of extra views: what the models doubted in one is worth a look only if it was
  // used for a face (no photo showed it), not when it's an alternate or unused.
  const usedFrames = new Set(((own.pictures ?? []) as { file: string; time?: number; role: string }[])
    .filter(({ time, role }) => time !== undefined && !role.startsWith('alternate') && role !== 'unused').map(({ file, time }) => `${file} ${time}`));
  const worth = (i: number) => pictures[i].source.time === undefined || usedFrames.has(`${pictures[i].source.file} ${pictures[i].source.time}`);
  const unsure = [
    ...(identity?.disputed ? [`what this is (the vision models disagree; made as a ${profile.name}: name the profile if that's wrong)`] : []),
    ...(sights ?? []).flatMap((sight, i) => (!worth(i) ? [] : [
      ...sight.disputed.map((face) => `${face} in ${named_(i)} (the vision models disagree where it is or which way up, and nothing settled it, so it was left out: crop the photo to it and use --cropped, or give its --corners)`),
      ...sight.faces.filter(({ face, agreed }) => !agreed && !sight.disputed.includes(face))
        .map(({ face, by }) => `${face} in ${named_(i)} (only ${by[0]} answered, so no second model checked it: check it)`),
      // A frame no model answered for is just left out (src/faces.ts): one of a handful, nothing to review.
      ...(!looked || sight.answers.some((a) => !a.error) || pictures[i].source.time !== undefined || sight.faces.some(({ by }) => by[0] === 'given') ? []
        : [`${named_(i)} (no vision model answered, so it was used whole: run again, or crop it)`]),
    ])),
    // Made without vision, every time: what the models would have added (artwork has nothing for them to find).
    ...(visionOn() || !Object.keys(profile.faces).length ? [] : [NO_VISION]),
  ];
  const printed = readOf(sights);
  return {
    glb: built.glb,
    sidecar: {
      ...own,
      profile: profile.name,
      sources: inputs.map((input) => path.basename(input)),
      review: [...stillToShoot(own.faces), ...(own.review ?? []), ...unsure],
      // How each identifying fact was found, for anyone deciding how far to trust it.
      identifiedBy: { profile: named ? 'given' : identity ? 'vision' : 'recognized', ...(own.identifiedBy as object | undefined) },
      codes: recorded,
      // What the vision models read off it (a slab's grade, a card's player and set, a book's title), and how sure.
      ...(Object.keys(printed.read).length && printed),
      ...((looked || identity) && { vision: visionRecord(sights, identity) }),
      build: { thicken: VERSION, createdAt: new Date().toISOString(), ms: Math.round(performance.now() - started), glbBytes: built.glb.length },
    },
  };
}

/**
 * Faces a person placed, in place of the models': corners given for a photo, by its file name, in its own pixels
 * (--corners); or, with --cropped, each photo's biggest face is the whole photo, named as the models named it
 * (failing that, the name most of them gave their biggest face). A video's frames are left to the models.
 */
function byHand(pictures: Picture[], sights: Sight[] | undefined, { corners = {}, cropped }: Options): Sight[] {
  const area = (q: number[][]) => Math.abs(q.reduce((sum, p, k) => sum + p[0] * q[(k + 1) % 4][1] - q[(k + 1) % 4][0] * p[1], 0)) / 2;
  return pictures.map((picture, i) => {
    const sight = sights?.[i] ?? { faces: [], answers: [], disputed: [] };
    const { width: w, height: h, source } = picture;
    if (source.time !== undefined) return sight;
    const given = corners[source.file];
    if (given) {
      const scale = Math.max(w, h) / Math.max(source.width, source.height); // loaded pictures are shrunk to at most 2048 px
      return { ...sight, disputed: [], faces: Object.entries(given).map(([face, quad]) => {
        const at = quad.map((p) => p.map((n) => n * scale));
        return { face, corners: at, asSeen: at, by: ['given'], agreed: true };
      }) };
    }
    if (!cropped) return sight;
    const whole = [[0, 0], [w, 0], [w, h], [0, h]];
    const biggest = sight.faces.reduce<Sight['faces'][0] | undefined>((a, b) => (!a || area(b.corners) > area(a.corners) ? b : a), undefined);
    if (biggest) return { ...sight, faces: sight.faces.map((f) => (f === biggest ? { ...f, corners: whole, asSeen: whole } : f)), disputed: sight.disputed.filter((f) => f !== biggest.face) };
    // Nothing settled where: what the models called the biggest face they each saw, if most called it one thing.
    const names = sight.answers.flatMap(({ faces }) => (faces?.length ? [faces.reduce((a, b) => (area(b.corners) > area(a.corners) ? b : a)).face] : []));
    const count = (face: string) => names.filter((n) => n === face).length;
    const [top, next] = [...new Set(names)].sort((a, b) => count(b) - count(a));
    if (!top || (next && count(next) === count(top))) return sight;
    return { ...sight, faces: [{ face: top, corners: whole, asSeen: whole, by: sight.answers.filter(({ faces }) => faces?.some((f) => f.face === top)).map(({ model }) => model), agreed: count(top) > 1 }], disputed: sight.disputed.filter((f) => f !== top) };
  });
}

/** Every barcode and QR code on every picture that passes its own checksum. */
async function scan(pictures: Picture[]): Promise<Scanned[]> {
  const scanned: Scanned[] = [];
  for (const [picture, image] of pictures.entries()) for (const { format, text, at } of await codes(image)) scanned.push({ picture, format, text, at });
  return scanned;
}

const PICTURE = /\.(jpe?g|png|heic|heif|webp|avif|gif|tiff?|svg|pdf)$/i;
const usable = (name: string) => PICTURE.test(name) || VIDEO.test(name);
// Numeric (IMG_2 before IMG_10) and case-blind, with a plain tiebreak so the order is the same on every filesystem.
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0);

/**
 * A folder as the models to make from it, for a batch: each picture, PDF or
 * video in it is one, from that file alone, and each subfolder is one, from
 * every one under it in name order (a phone names shots in the order taken).
 * Hidden names and `skip` (the output folder) are left out, and output
 * names are made unique, ignoring case, so no model overwrites another.
 */
export async function batchItems(folder: string, skip?: string): Promise<{ name: string; files: string[] }[]> {
  const visible = (name: string) => !name.split(/[\\/]/).some((part) => part.startsWith('.'));
  const items: { name: string; files: string[] }[] = [];
  const entries = (await readdir(folder, { withFileTypes: true })).filter((entry) => visible(entry.name)).sort((a, b) => byName(a.name, b.name));
  for (const entry of entries) {
    const full = path.join(folder, entry.name);
    if (skip && path.resolve(full) === path.resolve(skip)) continue;
    if (entry.isDirectory()) {
      const files = (await readdir(full, { recursive: true, withFileTypes: true }))
        .filter((inner) => inner.isFile())
        .map((inner) => path.join(inner.parentPath, inner.name))
        .filter((file) => visible(path.relative(full, file)) && usable(file))
        .sort(byName);
      if (files.length) items.push({ name: entry.name, files });
    } else if (entry.isFile() && usable(entry.name)) {
      items.push({ name: path.parse(entry.name).name, files: [full] });
    }
  }
  const taken = new Set<string>();
  for (const item of items) {
    let name = item.name;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${item.name}-${n}`;
    taken.add(name.toLowerCase());
    item.name = name;
  }
  return items;
}
