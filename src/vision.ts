// What a photo shows, asked of vision models: what kind of object it is, when
// nothing else says (one of the profiles, and roughly how big), and which of
// its faces each photo shows, with their corners, plus any title and authors.
// Any OpenAI-compatible chat endpoint serves: a LAN server, a hosted API, or
// a fine-tuned model of your own. THICKEN_VISION_MODELS lists the roster in order: the
// first two (primary and peer) are asked together, the rest stand in for a
// seat that fails, and one more is asked when the two disagree. Two answers
// agreeing is the confidence. Without THICKEN_VISION_URL nothing is asked,
// and photos are used whole as before.
//
// Benchwarmers (github.com/WendellResearch-AI/benchwarmers), a model bench
// whose gateway asks a collection of models at once and learns from verdicts
// which to trust, is asked first when THICKEN_BENCH_URL names its gateway and
// it has a vision collection: every seat answers each photo, thicken settles
// their answers as it settles its own roster's, and tells the bench how each
// seat did. The roster stands in when the gateway is down or no seat answers.
//
// Where answers disagree, no seat outranks another: a face goes where the evidence puts it (other answers placing
// it there, the edges seat, its shape), more answers are asked for while it's unsettled, and a face nothing settles
// is left out for a person, never taken from whichever model was listed first (settle, below).
import sharp from 'sharp';
import { edgesOf } from './edges.ts';
import { snap, type Picture } from './image.ts';
import { held, trainingOn } from './training.ts';

const SIZE = 1000; // photos go out letterboxed to 1000 x 1000, so pixels and a 0-1000 scale are the same numbers
const AGREE = 0.03; // corners within 3% of the diagonal, on average, are the same face in the same place and turn
const OFF_SHAPE = 0.25; // a face this far off every shape it can have is no placement of it (a slab's card is 13% off its holder)
const OUTSIDE = 0.05; // corners this far past the photo (of the image) place nothing; nearer, a corner just out of frame
const BENCH_ASKS = 2; // a collection asked again while a face is unsettled: its explorer seats rotate, so new models answer
const TIMEOUT_MS = 180_000;
const MAX_FACES = 12; // twice a box's six: more is noise, and settling compares every pair

/** What the models are told about a kind of object: a profile (src/profiles). */
/**
 * A profile: its faces, a note on how it stands, what to read off it as printed (a description, or one in a list for
 * a list), and short questions to answer as well, each answer one word.
 */
export interface Kind {
  name: string; about?: string; faces: Record<string, string>; note?: string;
  reads?: Record<string, string | [string]>; asks?: Record<string, string>; unsnapped?: string[];
  shapes?: Record<string, number[]>; shows?: Record<string, string[]>;
}
type Read = Record<string, string | string[]>;
/** One model's answer, corners in the picture's own pixels. */
export interface Answer {
  model: string; ms: number; status?: number; error?: string; call?: string; // a bench seat's call, for its verdict
  faces?: { face: string; corners: number[][] }[]; read?: Read; asked?: Record<string, string>; // finding faces
  object?: string; sizeMm?: number[]; // saying what it is
}
/**
 * A face as settled: its corners (top-left, top-right, bottom-right, bottom-left, upright), snapped to its
 * real edges; the corners as the models gave them; and who agreed.
 */
export interface Seen { face: string; corners: number[][]; asSeen: number[][]; by: string[]; agreed: boolean }
export interface Sight { faces: Seen[]; asked?: Record<string, string>; answers: Answer[]; disputed: string[]; outline?: number[][] }
/** What the models said the object is: a profile's name (none, if none fits), its estimated size, and whether they disagreed. */
export interface Identity { profile?: string; sizeMm?: number[]; disputed: boolean; answers: Answer[] }

const rosterOn = () => Boolean(process.env.THICKEN_VISION_URL && process.env.THICKEN_VISION_MODELS);
export const visionOn = () => Boolean(bench || rosterOn());
const roster = () => process.env.THICKEN_VISION_MODELS!.split(',').map((m) => m.trim()).filter(Boolean);

const BENCH_TIMEOUT_MS = 450_000; // the gateway waits up to 420 s for its slowest seat
let bench: { url: string; collection: string } | undefined; // while it answers
let found: typeof bench; // as found, for the record
const looked = new Map<string, Promise<typeof bench>>();
/**
 * Whether the bench gateway THICKEN_BENCH_URL names has a vision collection (`bench/vision`, or one tagged "vision"):
 * asked once per process and gateway, quickly. Without THICKEN_BENCH_URL, nothing is asked.
 */
export async function findBench(): Promise<void> {
  const url = (process.env.THICKEN_BENCH_URL ?? '').replace(/\/$/, '');
  if (!looked.has(url)) looked.set(url, lookFor(url));
  bench = found = await looked.get(url);
}
async function lookFor(url: string): Promise<typeof bench> {
  if (!url || url === 'off') return undefined;
  try {
    const { data } = await (await fetch(`${url}/v1/models`, { signal: AbortSignal.timeout(2000) })).json() as { data?: { id: string; tags?: string[] }[] };
    const collections = (data ?? []).filter(({ id }) => id.startsWith('bench/') && !id.includes(':'));
    const vision = collections.find(({ id }) => id === 'bench/vision') ?? collections.find(({ tags }) => tags?.includes('vision'));
    return vision && { url, collection: vision.id };
  } catch {
    return undefined; // no bench on this machine
  }
}

/** The question about one picture: where its faces are, if it has any to find (artwork doesn't), and what's on it. */
const facesPrompt = ({ name, about, faces, note, reads = {}, asks = {} }: Kind) => {
  const finding = Object.keys(faces).length > 0;
  const json = [
    ...(finding ? ['"faces":[{"face":"front","corners":[[x,y],[x,y],[x,y],[x,y]]}]'] : []),
    ...Object.entries(reads).map(([key, what]) => `"${key}":${Array.isArray(what) ? '[]' : '""'}`),
    ...Object.keys(asks).map((key) => `"${key}":""`),
  ];
  return `${finding ? `This photo shows ${about ?? `a ${name}`}, on whatever it was set down on. For every face of it you can see, even partly, say which face it is and give the pixel coordinates of its four corners in this ${SIZE} x ${SIZE} image.

Faces: ${Object.entries(faces).map(([face, words]) => (words === face ? `"${face}"` : `"${face}" (${words})`)).join(', ')}.

Give each face's corners in that face's own reading order: top-left, top-right, bottom-right, bottom-left, as the face would look held upright in front of you. For a side, upright is with the object standing as it normally does; for the top, looking down on it from the front (its back edge at the top); for the bottom, with the object tipped back onto its back (its front edge at the top).${note ? ` ${note}` : ''} A corner hidden from view goes where it would be.` : `This picture shows ${about ?? `a ${name}`}.${note ? ` ${note}` : ''}`}

${Object.keys(reads).length ? `${finding ? 'Also read' : 'Read'} off it, as printed, leaving out anything it doesn't show:${Object.entries(reads).map(([key, what]) => `\n"${key}": ${what}${Array.isArray(what) ? ' (a list)' : ''}`).join('')}\n` : ''}${Object.entries(asks).map(([key, question]) => `\n"${key}": ${question}`).join('')}

Answer with JSON only, no prose:
{${json.join(',')}}`;
};

const identifyPrompt = (kinds: Kind[]) => `This photo shows one object. Which of these is it? Pick the most specific that fits.
${kinds.map(({ name, about }) => `- "${name}": ${about}`).join('\n')}
- "none": none of these

Also estimate its real size in millimeters: the width and height of its front, and its depth.

Answer with JSON only, no prose:
{"object":"${kinds[0]?.name}","sizeMm":[width,height,depth]}`;

/**
 * A short question's answer about the object itself (a card's corners, a book's binding, a slab label's finish):
 * one fact, so every model's answer on every picture counts, each model once a picture (a collection asked twice
 * seats its members twice; a model that answered two ways there has no vote). The one given most wins; a tie, or
 * no one giving one of `values`, is undefined, never the first given.
 */
export function pooled(sights: Sight[] | undefined, key: string, values: string[]): string | undefined {
  const said = (sights ?? []).flatMap(({ answers }) => votesOn(answers, key).filter((value) => values.includes(value)));
  const count = (value: string) => said.filter((answer) => answer === value).length;
  const [top, next] = [...new Set(said)].sort((a, b) => count(b) - count(a));
  return top !== undefined && (next === undefined || count(top) > count(next)) ? top : undefined;
}
/** Each model's answer to a short question about one picture, once: none from a model that answered it two ways. */
export function votesOn(answers: Answer[], key: string): string[] {
  return [...new Set(answers.map(({ model }) => model))].flatMap((model) => {
    const given = [...new Set(answers.filter((a) => a.model === model && a.asked?.[key]).map((a) => a.asked![key]))];
    return given.length === 1 ? given : [];
  });
}

/** Every picture looked at for a kind of object's faces, four at a time. */
export async function lookAll(pictures: Picture[], kind: Kind): Promise<Sight[]> {
  const sights: Sight[] = [];
  for (let i = 0; i < pictures.length; i += 4) sights.push(...await Promise.all(pictures.slice(i, i + 4).map((p) => look(p, kind))));
  return sights;
}

/** Where a kind of object's faces are in a picture, from the roster's answers. */
export async function look(picture: Picture, kind: Kind): Promise<Sight> {
  const { jpeg, toPicture, toSent, sent } = await letterbox(picture);
  const prompt = facesPrompt(kind);
  const keys = Object.keys(kind.asks ?? {});
  // The evidence beside the answers: where the photo is in the image sent, the shapes each face can have, what each
  // face always shows, and, on the faces whose edges can be trusted, the edges seat's outline and edge strength.
  const outlined = Object.keys(kind.shapes ?? {}).filter((face) => !kind.unsnapped?.includes(face));
  const edges = outlined.length ? await edgesOf(picture) : undefined;
  const outline = edges?.outline([...new Set(outlined.flatMap((face) => kind.shapes![face]))]);
  const evidence: Evidence = {
    bounds: [sent.left, sent.top, SIZE - sent.left, SIZE - sent.top], shapes: kind.shapes, shows: kind.shows, outlined,
    ...(outline && { outline: outline.map(toSent) }), ...(edges && { support: (corners: number[][]) => edges.support(corners.map(toPicture)) }),
  };
  // A face left unsettled, or an answer disagreed on, asks for more.
  const clash = (asked: Answer[]) => settle(asked, evidence).disputed.length > 0 || keys.some((key) => new Set(asked.flatMap((a) => a.asked?.[key] ?? [])).size > 1);
  const answers = await consult(jpeg, prompt, (json) => parseFaces(json, Object.keys(kind.faces), keys, Object.keys(kind.reads ?? {})), clash);
  const settled = settle(answers, evidence);
  // A seat agreed when one of its faces lies within AGREE of a face two seats settled, not only when it was one of the two.
  judge(answers, ({ faces }) => settled.faces.some((s) => s.agreed && Boolean(faces?.some((f) => f.face === s.face && distance(f.corners, s.corners) < AGREE))), `${kind.name} faces`);
  const back =<T extends { corners: number[][] }>(faces: T[]) => faces.map((f) => ({ ...f, corners: f.corners.map(toPicture) }));
  // Each question's answer: the one most models gave, each once; a tie is no answer, never the higher seat's.
  const asked = Object.fromEntries(keys.flatMap((key) => {
    const said = votesOn(answers, key);
    const count = (value: string) => said.filter((s) => s === value).length;
    const [top, next] = [...new Set(said)].sort((a, b) => count(b) - count(a));
    return top !== undefined && (next === undefined || count(top) > count(next)) ? [[key, top]] : [];
  }));
  // Snapped onto the real edges, but for faces among lines nearer than the models' slip (a slab's label: its border,
  // the frame inside it and the ridge around it), where the nearest strong edge is often the wrong one.
  const faces = back(settled.faces).map((f) => ({ ...f, corners: kind.unsnapped?.includes(f.face) ? f.corners : snap(picture, f.corners), asSeen: f.corners }));
  const sight: Sight = {
    faces, ...(Object.keys(asked).length && { asked }),
    answers: answers.map((a) => ({ ...a, faces: a.faces && back(a.faces) })), disputed: settled.disputed, ...(outline && { outline }),
  };
  if (trainingOn()) {
    const { read } = readOf([{ faces, answers, disputed: [] }]);
    const label = { faces: faces.map(({ face, corners, agreed }) => ({ face, corners: corners.map((p) => toSent(p).map(Math.round)), agreed })), read, ...(keys.length && { asked }) };
    held.set(sight, { jpeg, picture, sent, example: { task: 'faces', profile: kind.name, prompt, answers, label, disputed: settled.disputed } });
  }
  return sight;
}

/**
 * What the models read off the object, over every picture: each field as given most often (the first given on a
 * tie: the primary's on the first picture), and how sure: "agreed" (given more than once, nothing else given),
 * "once" (one answer) or "disputed" (other answers differ; every model's is in the vision record).
 */
export function readOf(sights: Sight[] = []): { read: Read; readBy: Record<string, string> } {
  const text = (v: string | string[]) => JSON.stringify(v).toLowerCase().replace(/\s+/g, ' ');
  // One vote a model a photo: a collection asked twice about a photo seats its members twice, and a model that read
  // a field two ways on one photo has no vote on it there. A value one model alone gives a photo, where two others
  // or more answered it and read no such thing, is left out ("alone"): a label prints an autograph grade or doesn't.
  const votes: Record<string, (string | string[])[]> = {};
  const alone = new Set<string>();
  for (const { answers } of sights) {
    const answered = answers.filter((a) => !a.error);
    const models = [...new Set(answered.map(({ model }) => model))];
    for (const key of new Set(answered.flatMap(({ read }) => Object.keys(read ?? {})))) {
      const given = models.flatMap((model) => {
        const own = [...new Set(answered.filter((a) => a.model === model && a.read?.[key] !== undefined).map((a) => text(a.read![key])))];
        return own.length === 1 ? [answered.find((a) => a.model === model && a.read?.[key] !== undefined)!.read![key]] : [];
      });
      if (given.length === 1 && models.length - 1 >= 2) alone.add(key);
      else votes[key] = [...(votes[key] ?? []), ...given];
    }
  }
  const read: Read = {};
  const readBy: Record<string, string> = {};
  for (const key of new Set([...Object.keys(votes), ...alone])) {
    const values = votes[key] ?? [];
    const count = (value: string | string[]) => values.filter((v) => text(v) === text(value)).length;
    // Each value once, as first spelled ("GEM MINT" and "Gem  Mint" are one value).
    const top = values.filter((v, i) => values.findIndex((w) => text(w) === text(v)) === i).sort((a, b) => count(b) - count(a));
    // The value most models gave; a tie is no value, never the first given.
    if (top.length && (top.length === 1 || count(top[0]) > count(top[1]))) read[key] = top[0];
    readBy[key] = !values.length ? 'alone' : top.length > 1 ? 'disputed' : values.length > 1 ? 'agreed' : 'once';
  }
  return { read, readBy };
}

/** Which kind of object a picture shows, and roughly how big, from the roster's answers: two agreeing settle it. */
export async function identify(picture: Picture, kinds: Kind[]): Promise<Identity> {
  const { jpeg, sent } = await letterbox(picture);
  const names = new Set([...kinds.map(({ name }) => name), 'none']);
  const parse = (json: any): Partial<Answer> | undefined => {
    const object = typeof json?.object === 'string' ? json.object.toLowerCase() : undefined;
    if (!object || !names.has(object)) return undefined;
    const sizeMm = Array.isArray(json.sizeMm) && json.sizeMm.length === 3 && json.sizeMm.every((n: unknown) => Number.isFinite(n) && (n as number) > 0)
      ? json.sizeMm.map(Number) : undefined;
    return { object, ...(sizeMm && { sizeMm }) };
  };
  // The object most answers name: none with a tie, so a tie asks for more.
  const most = (asked: Answer[]) => {
    const said = asked.flatMap((a) => (a.object ? [a.object] : []));
    const count = (object: string) => said.filter((o) => o === object).length;
    const top = [...new Set(said)].sort((a, b) => count(b) - count(a));
    return top.length && (top.length === 1 || count(top[0]) > count(top[1])) ? { object: top[0], count: count(top[0]) } : undefined;
  };
  const clash = (asked: Answer[]) => new Set(asked.filter((a) => a.object).map((a) => a.object)).size > 1 && (most(asked)?.count ?? 0) < 2;
  const prompt = identifyPrompt(kinds);
  const answers = await consult(jpeg, prompt, parse, clash);
  const usable = answers.filter((a) => a.object);
  // Settled by the most answers: a lone answer stands only when it's the only one; a tie is no answer, never the first seat's.
  const pick = most(usable);
  const agreed = (pick?.count ?? 0) >= 2;
  judge(answers, ({ object }) => agreed && object === pick!.object, 'what it is');
  const sizes = usable.filter((a) => a.object === pick?.object && a.sizeMm).map((a) => a.sizeMm!);
  const sizeMm = sizes.length ? [0, 1, 2].map((k) => sizes.reduce((sum, s) => sum + s[k], 0) / sizes.length) : undefined;
  const disputed = !agreed && usable.length > 1;
  const identity = { profile: pick?.object === 'none' ? undefined : pick?.object, sizeMm, disputed, answers };
  if (trainingOn()) held.set(identity, { jpeg, picture, sent, example: { task: 'identify', prompt, answers, label: { object: pick?.object, sizeMm }, disputed } });
  return identity;
}

/**
 * For the sidecar: where the photos went (host and path, never the key), who was asked, what each
 * answered and how long it took, and what was settled, corners rounded.
 */
export const visionRecord = (sights?: Sight[], identity?: Identity) => {
  const round = <T extends { corners: number[][]; asSeen?: number[][] }>(f: T) =>
    ({ ...f, corners: f.corners.map((p) => p.map(Math.round)), ...(f.asSeen && { asSeen: f.asSeen.map((p) => p.map(Math.round)) }) });
  const { host, pathname } = new URL(found ? `${found.url}/v1` : process.env.THICKEN_VISION_URL!);
  return {
    endpoint: `${host}${pathname.replace(/\/$/, '')}/chat/completions`,
    models: found ? [found.collection] : roster(),
    ...(found && rosterOn() && { standIns: roster() }),
    ...(identity && { identified: identity }),
    ...(sights && {
      photos: sights.map((s, picture) => ({ picture, ...s, faces: s.faces.map(round), answers: s.answers.map((a) => ({ ...a, faces: a.faces?.map(round) })) })),
    }),
  };
};

/** A picture letterboxed into SIZE x SIZE, as JPEG, and the ways between its pixels and the picture's. */
async function letterbox(picture: Picture) {
  const { width, height } = picture;
  const scale = SIZE / Math.max(width, height);
  const [left, top] = [(SIZE - Math.round(width * scale)) / 2, (SIZE - Math.round(height * scale)) / 2];
  const jpeg = await sharp(picture.data, { raw: { width, height, channels: 4 } })
    .resize(SIZE, SIZE, { fit: 'contain', background: '#808080' }).flatten({ background: '#808080' }).jpeg({ quality: 85 }).toBuffer();
  return {
    jpeg, sent: { left, top, scale },
    toPicture: ([x, y]: number[]) => [(x - left) / scale, (y - top) / scale],
    toSent: ([x, y]: number[]) => [x * scale + left, y * scale + top],
  };
}

/**
 * The models asked about one image, for as long as `clash` says the answers leave something unsettled: the bench's
 * collection (every seat at once, and again, its explorers rotated, while unsettled), then the roster, two seats at
 * once and the rest one by one, standing in for a seat that fails or adding an answer, until it's settled or every
 * model has answered. The roster's answers come back in its order, for the record; no seat outranks another.
 */
async function consult(jpeg: Buffer, prompt: string, parse: (json: any) => Partial<Answer> | undefined, clash: (answers: Answer[]) => boolean): Promise<Answer[]> {
  const answers: Answer[] = [];
  for (let asked = 0; bench && asked < BENCH_ASKS && (asked === 0 || clash(answers)); asked++) answers.push(...await panel(bench, jpeg, prompt, parse));
  const answered = answers.some((a) => !a.error);
  // The bench stopped answering earlier this run, or settled it; or there is no roster to stand in or add more.
  if (!rosterOn() || (answered && !clash(answers))) return answers;
  const models = roster();
  const own: Answer[] = [];
  let next = 0;
  const seat = async (): Promise<void> => {
    while (next < models.length) {
      const answer = await ask(models[next++], jpeg, prompt, parse);
      own.push(answer);
      if (!answer.error) return;
    }
  };
  const all = () => [...answers, ...own.sort((x, y) => models.indexOf(x.model) - models.indexOf(y.model))];
  if (!answered) await Promise.all([seat(), seat()]);
  while (clash(all()) && next < models.length) await seat();
  return all();
}

/**
 * A face list from an answer: the profile's own faces, a few at most, each four corners inside the image, give or
 * take a little. Corners that make no face (a bow tie) stay in, to lose to a peer's; cut() never warps them.
 */
function parseFaces(json: any, names: string[], keys: string[] = [], reads: string[] = []): Partial<Answer> | undefined {
  const faces = (Array.isArray(json?.faces) ? json.faces.slice(0, MAX_FACES) : [])
    .filter((f: any) => typeof f?.face === 'string' && names.includes(f.face.toLowerCase()) && Array.isArray(f.corners) && f.corners.length === 4
      && f.corners.every((p: unknown) => Array.isArray(p) && p.length === 2 && p.every((n) => Number.isFinite(n) && n > -SIZE / 10 && n < SIZE * 1.1)))
    .map((f: any) => ({ face: f.face.toLowerCase(), corners: f.corners.map((p: number[]) => p.map(Number)) }));
  if (!faces.length && names.length) return undefined;
  // What was read: a string as given, or a list of them; numbers (a year, a grade) as their text.
  const text = (value: unknown) => (typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '');
  const read = Object.fromEntries(reads.flatMap((key) => {
    const value = Array.isArray(json[key]) ? json[key].map(text).filter(Boolean) : text(json[key]);
    return value.length ? [[key, value]] : [];
  }));
  const asked = Object.fromEntries(keys.flatMap((key) => (typeof json[key] === 'string' && json[key].trim() ? [[key, json[key].trim().toLowerCase()]] : [])));
  return { ...(faces.length && { faces }), ...(Object.keys(read).length && { read }), ...(Object.keys(asked).length && { asked }) };
}

/** What settles a face beside the answers (look, above), all in the image as sent. */
export interface Evidence {
  bounds?: number[]; // the photo within the image: left, top, right, bottom
  shapes?: Record<string, number[]>; // the shapes each face can have, width over height, upright
  shows?: Record<string, string[]>; // what a face always shows: an answer naming it reads one of these off it
  outline?: number[][]; // the edges seat's outline (src/edges.ts)
  outlined?: string[]; // the faces it votes on: those whose edges can be trusted
  support?: (corners: number[][]) => number; // how much of a face's outline runs along a real edge, 0 to 1
}
const CLEARLY = 0.1; // how much better one place must fit its shape and edges to win a tie on the answers

/** Whether four corners run clockwise on screen (y down): twice their signed area, by the shoelace formula, is positive. */
const clockwise = (corners: number[][]) => corners.reduce((sum, p, k) => sum + p[0] * corners[(k + 1) % 4][1] - corners[(k + 1) % 4][0] * p[1], 0) > 0;
const side = (a: number[], b: number[]) => Math.hypot(b[0] - a[0], b[1] - a[1]);
/** A face's shape, width over height, in its own reading order. */
const shapeOf = ([tl, tr, br, bl]: number[][]) => (side(tl, tr) + side(bl, br)) / (side(tl, bl) + side(tr, br));
/** The same four corners in each order they can be given: four turns, each as itself and as its mirror image. */
const orders = (q: number[][]) => [0, 1, 2, 3].flatMap((k) => {
  const turned = [...q.slice(k), ...q.slice(0, k)];
  return [turned, [turned[0], turned[3], turned[2], turned[1]]];
});
/** How far apart two faces are, whichever way each was turned: where they are, not which way up. */
const apartAnyway = (a: number[][], b: number[][]) => Math.min(...orders(b).map((order) => distance(a, order)));

/**
 * Each face once, by evidence, never by which model was listed first:
 * - agreed where answers give the same place and turn: every one that does, averaged;
 * - else where answers put it, whichever way each turned it (a mirror image says where, never which way up), or the
 *   edges seat does: the one answer giving a turn there gives its turn. Two such places go to the one more answers
 *   put it at, then to the one clearly nearer its shape and its edges; else to neither;
 * - else where the edges seat outlines it, when the answers near it agree on its turn;
 * - else it's unsettled: disputed and left out, so more models are asked, and failing that a person looks.
 * An answer that can't be right places nothing: corners well past the photo, or a shape its face can't have. A face
 * the only model that answered placed stands on its word, which the review says.
 */
export function settle(answers: Answer[], evidence: Evidence = {}): { faces: Seen[]; disputed: string[] } {
  // Every answer counts, but a model only once in agreeing: a collection asked again seats its members again.
  const usable = answers.filter((a) => a.faces);
  type Placing = { model: string; corners: number[][] };
  const models = (list: { model: string }[]) => [...new Set(list.map(({ model }) => model))];
  /** A model's own answers for a face, as one: averaged if they agree with each other, none if they don't. */
  const consistent = (list: Placing[]) => (list.every(({ corners }) => distance(corners, list[0].corners) < AGREE) ? mean(list.map(({ corners }) => corners)) : undefined);
  const names = [...new Set(usable.flatMap((a) => a.faces!.map((f) => f.face)))];
  const { bounds, shapes = {}, shows = {}, outline, outlined = [], support } = evidence;
  const offShape = (face: string, corners: number[][]) => (shapes[face]?.length ? Math.min(...shapes[face].map((s) => Math.abs(shapeOf(corners) / s - 1))) : 0);
  const slack = OUTSIDE * SIZE;
  const possible = (face: string, corners: number[][]) => offShape(face, corners) <= OFF_SHAPE
    && (!bounds || corners.every(([x, y]) => x >= bounds[0] - slack && x <= bounds[2] + slack && y >= bounds[1] - slack && y <= bounds[3] + slack));
  const fit = (face: string, corners: number[][]) => 1 - offShape(face, corners) + (support && outlined.includes(face) ? support(corners) : 0);
  const faces: Seen[] = [];
  const disputed: string[] = [];
  const singles: { face: string; model: string; corners: number[][] }[] = [];
  for (const name of names) {
    const all: Placing[] = usable.flatMap((a) => a.faces!.filter((f) => f.face === name).slice(0, 1).map((f) => ({ model: a.model, corners: f.corners })));
    const fits = all.filter(({ corners }) => possible(name, corners));
    // A face as the camera saw it winds clockwise in its own reading order (y down). One wound the other way is its
    // mirror image, which no photo shows (two models agreeing on one put a spine's lettering backward): it says
    // where the face is, but not which way up.
    const each = fits.filter(({ corners }) => clockwise(corners));
    const edges = outline && outlined.includes(name) ? outline : undefined;
    const lone = models(usable).length === 1; // only one model answered at all
    if (models(all).length === 1 && !lone) { // named by one model while others answered without it
      const corners = each.length ? consistent(each) : undefined;
      if (corners) singles.push({ face: name, model: each[0].model, corners });
      continue;
    }
    const place = (corners: number[][], by: string[], agreed: boolean) => faces.push({ face: name, corners, asSeen: corners, by, agreed });

    // The same place and turn: each answer's group of those that agree with it. The group most models are in
    // stands, all of them averaged; two such groups in different places are a dispute, for the evidence below.
    const groups = each.map(({ corners }) => each.filter((other) => distance(other.corners, corners) < AGREE));
    const most = Math.max(0, ...groups.map((group) => models(group).length));
    const biggest = groups.filter((group) => models(group).length === most);
    const middle = most >= 2 ? mean(biggest[0].map(({ corners }) => corners)) : undefined;
    if (middle && biggest.every((group) => distance(mean(group.map(({ corners }) => corners)), middle) < AGREE)) {
      const agreeing = [...new Set(biggest.flat())];
      place(mean(agreeing.map(({ corners }) => corners)), models(agreeing), true);
      continue;
    }

    // The same place, whichever way up: who else puts it there, the edges seat included. A place another answer
    // gives a different turn has its turn in dispute.
    const backers = ({ model, corners }: Placing) => [
      ...models(fits.filter((other) => other.model !== model && apartAnyway(other.corners, corners) < AGREE)),
      ...(edges && apartAnyway(edges, corners) < AGREE ? ['edges'] : []),
    ];
    const turnedAlike = (c: Placing) => !each.some((other) => apartAnyway(other.corners, c.corners) < AGREE && distance(other.corners, c.corners) >= AGREE);
    if (lone) {
      const corners = each.length ? consistent(each) : undefined;
      if (corners) place(corners, [each[0].model, ...backers(each[0])], backers(each[0]).length > 0);
      else disputed.push(name); // only a mirror image, one that can't be right, or two that differ: more are asked
      continue;
    }
    // Each place a group of answers gives, averaged, and who puts it there; the place most do stands, then the one
    // clearly nearer its shape and edges. A place and one within AGREE of it are the same place, not rivals.
    const places = groups.map((group) => {
      const corners = mean(group.map(({ corners: c }) => c));
      const own = models(group);
      return { corners, by: [...own, ...backers({ model: own[0], corners }).filter((m) => !own.includes(m))] };
    }).filter(({ corners, by }) => by.length >= 2 && turnedAlike({ model: '', corners }))
      .sort((x, y) => y.by.length - x.by.length || fit(name, y.corners) - fit(name, x.corners));
    const [top] = places;
    const next = top && places.find(({ corners }) => distance(corners, top.corners) >= AGREE);
    if (top && (!next || top.by.length > next.by.length || fit(name, top.corners) - fit(name, next.corners) >= CLEARLY)) {
      place(top.corners, top.by, true);
      continue;
    }

    // The edges seat's outline, where the answers near it agree which way up it is.
    const near = edges ? each.filter(({ corners }) => apartAnyway(edges, corners) < 2 * AGREE) : [];
    const turns = near.map(({ corners }) => [0, 1, 2, 3].reduce((best, k) => (distance(corners, turn(edges!, k)) < distance(corners, turn(edges!, best)) ? k : best), 0));
    if (near.length && turns.every((k) => k === turns[0])) {
      place(turn(edges!, turns[0]), [...models(near), 'edges'], true);
      continue;
    }
    disputed.push(name);
  }

  // Named by one model while others answered without it: left out, unless another put a face of another name in the
  // same place. Then they agree where it is but not what it is (a slab's back called its front): the name stands
  // whose answer read what that face always shows (a front's grade) where the other's didn't; else it's unsettled.
  const readsIt = (model: string, face: string) => !shows[face] || shows[face].some((key) => Boolean(usable.find((a) => a.model === model)?.read?.[key]?.length));
  const sharing = (single: typeof singles[0]) => singles.filter((other) => other.model !== single.model && apartAnyway(other.corners, single.corners) < AGREE);
  const placedNear = (single: typeof singles[0]) => faces.some((f) => apartAnyway(f.corners, single.corners) < AGREE);
  for (const single of singles) {
    const rivals = sharing(single).filter((other) => other.face !== single.face);
    if (!placedNear(single) && rivals.length && readsIt(single.model, single.face) && rivals.every((other) => !readsIt(other.model, other.face))) {
      faces.push({ face: single.face, corners: single.corners, asSeen: single.corners, by: [single.model, ...sharing(single).map(({ model }) => model)], agreed: true });
    }
  }
  for (const single of singles) {
    if (!placedNear(single) && sharing(single).length && !disputed.includes(single.face)) disputed.push(single.face);
  }
  return { faces, disputed };
}

/** Mean distance between matching corners, as a share of the image's diagonal. */
const distance = (a: number[][], b: number[][]) =>
  a.reduce((sum, p, i) => sum + Math.hypot(p[0] - b[i][0], p[1] - b[i][1]), 0) / 4 / Math.hypot(SIZE, SIZE);
/** Corners averaged, corner by corner. */
const mean = (quads: number[][][]) => quads[0].map((_, k) => [0, 1].map((xy) => quads.reduce((sum, q) => sum + q[k][xy], 0) / quads.length));
/** Corners given from the k-th on: the same face, turned. */
const turn = (q: number[][], k: number) => [...q.slice(k), ...q.slice(0, k)];

/** The question and the photo, as an OpenAI-compatible chat request's body. */
const request = (model: string, jpeg: Buffer, prompt: string, stream = false) => JSON.stringify({
  model, temperature: 0, max_tokens: 4000, stream,
  messages: [{ role: 'user', content: [
    { type: 'text', text: prompt },
    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpeg.toString('base64')}` } },
  ] }],
});
/** The JSON in a model's reply, as `parse` takes it; undefined when there's none to take. */
function answerIn(text: string, parse: (json: any) => Partial<Answer> | undefined): Partial<Answer> | undefined {
  try { return parse(JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? 'null')); } catch { return undefined; }
}

async function ask(model: string, jpeg: Buffer, prompt: string, parse: (json: any) => Partial<Answer> | undefined): Promise<Answer> {
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);
  try {
    const response = await fetch(`${process.env.THICKEN_VISION_URL!.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(process.env.THICKEN_VISION_KEY && { Authorization: `Bearer ${process.env.THICKEN_VISION_KEY}` }) },
      body: request(model, jpeg, prompt),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const { status } = response;
    if (!response.ok) return { model, ms: ms(), status, error: `answered ${status}` };
    const value = answerIn((await response.json())?.choices?.[0]?.message?.content ?? '', parse);
    return value ? { model, ms: ms(), status, ...value } : { model, ms: ms(), status, error: 'no usable answer' };
  } catch (error) {
    return { model, ms: ms(), error: (error as Error).name === 'TimeoutError' ? 'timed out' : (error as Error).message };
  }
}

/**
 * One photo put to the bench's collection: every seat's answer, in the order the gateway gives them (its members
 * first), each with its call for the verdict. A gateway that can't be reached is let go for the rest of the run.
 * Asked as a stream: the gateway sends keep-alives while its slowest seat thinks, where a plain reply sends nothing
 * until every seat is done, and Node's fetch gives up on a reply whose headers take over 300 s.
 */
async function panel(on: { url: string; collection: string }, jpeg: Buffer, prompt: string, parse: (json: any) => Partial<Answer> | undefined): Promise<Answer[]> {
  const started = performance.now();
  try {
    const response = await fetch(`${on.url}/v1/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: request(on.collection, jpeg, prompt, true), signal: AbortSignal.timeout(BENCH_TIMEOUT_MS),
    });
    if (!response.ok) return [{ model: on.collection, ms: Math.round(performance.now() - started), status: response.status, error: `answered ${response.status}` }];
    // Server-sent events: chunks of the answer, the seats on the last chunk, or an error; keep-alives are comments.
    const events = (await response.text()).split('\n').filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]').map((line) => JSON.parse(line.slice(6)));
    const failed = events.find((event) => event.error);
    if (failed) return [{ model: on.collection, ms: Math.round(performance.now() - started), error: failed.error.message ?? 'the bench failed' }];
    const seats: { alias: string; call: string; status: string; seconds?: number; answer?: string; error?: string }[] = events.findLast((event) => event.bench)?.bench?.seats ?? [];
    return seats.map(({ alias, call, status, seconds = 0, answer = '', error }) => {
      const seat = { model: alias, ms: Math.round(seconds * 1000), call };
      if (status !== 'ok') return { ...seat, error: error || status };
      const value = answerIn(answer, parse);
      return value ? { ...seat, ...value } : { ...seat, error: 'no usable answer' };
    });
  } catch (error) {
    bench = undefined;
    return [{ model: on.collection, ms: Math.round(performance.now() - started), error: (error as Error).name === 'TimeoutError' ? 'timed out' : (error as Error).message }];
  }
}

/**
 * Tells the bench how each seat did, in the background (a verdict that doesn't arrive costs nothing): useful when
 * `agreed` says its answer matched another seat's, not useful when it failed. One that disagreed may be the one
 * that was right, so it's left for a person to judge from the sidecar.
 */
function judge(answers: Answer[], agreed: (answer: Answer) => boolean, task: string): void {
  const url = bench?.url;
  if (!url) return;
  for (const answer of answers.filter((a) => a.call)) {
    const useful = answer.error ? false : agreed(answer) || undefined;
    if (useful === undefined) continue;
    const note = useful ? `thicken ${task}: agreed with another seat` : `thicken ${task}: ${answer.error}`;
    fetch(`${url}/bench/verdict`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call: answer.call, useful, note }) }).catch(() => {});
  }
}
