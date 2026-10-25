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
import sharp from 'sharp';
import { snap, type Picture } from './image.ts';
import { keep, trainingOn } from './training.ts';

const SIZE = 1000; // photos go out letterboxed to 1000 x 1000, so pixels and a 0-1000 scale are the same numbers
const AGREE = 0.03; // corners within 3% of the diagonal, on average, are the same face in the same place and turn
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
export interface Sight { faces: Seen[]; asked?: Record<string, string>; answers: Answer[]; disputed: string[] }
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
 * A short question's answer about the object itself (a card's corners, a book's binding): one fact, so every
 * model's answer on every picture counts, the one given most winning (on a tie, the first given: the primary's on
 * the first picture). Undefined when no one gave one of `values`.
 */
export function pooled(sights: Sight[] | undefined, key: string, values: string[]): string | undefined {
  const said = (sights ?? []).flatMap(({ answers }) => answers.flatMap(({ asked }) => (asked?.[key] && values.includes(asked[key]) ? [asked[key]] : [])));
  const count = (value: string) => said.filter((answer) => answer === value).length;
  return said.reduce<string | undefined>((best, value) => (best === undefined || count(value) > count(best) ? value : best), undefined);
}

/** Every picture looked at for a kind of object's faces, four at a time. */
export async function lookAll(pictures: Picture[], kind: Kind): Promise<Sight[]> {
  const sights: Sight[] = [];
  for (let i = 0; i < pictures.length; i += 4) sights.push(...await Promise.all(pictures.slice(i, i + 4).map((p) => look(p, kind))));
  return sights;
}

/** Where a kind of object's faces are in a picture, from the roster's answers. */
export async function look(picture: Picture, kind: Kind): Promise<Sight> {
  const { jpeg, toPicture, toSent } = await letterbox(picture);
  const prompt = facesPrompt(kind);
  const keys = Object.keys(kind.asks ?? {});
  // Disagreeing on a face, or on an answer, asks the next model.
  const clash = (asked: Answer[]) => settle(asked).disputed.length > 0 || keys.some((key) => new Set(asked.flatMap((a) => a.asked?.[key] ?? [])).size > 1);
  const answers = await consult(jpeg, prompt, (json) => parseFaces(json, Object.keys(kind.faces), keys, Object.keys(kind.reads ?? {})), clash);
  const settled = settle(answers);
  // A seat agreed when one of its faces lies within AGREE of a face two seats settled, not only when it was one of the two.
  judge(answers, ({ faces }) => settled.faces.some((s) => s.agreed && Boolean(faces?.some((f) => f.face === s.face && distance(f.corners, s.corners) < AGREE))), `${kind.name} faces`);
  const back =<T extends { corners: number[][] }>(faces: T[]) => faces.map((f) => ({ ...f, corners: f.corners.map(toPicture) }));
  // Each question's answer: the one most models gave, the higher seat's on a tie.
  const asked = Object.fromEntries(keys.flatMap((key) => {
    const said = answers.flatMap((a) => (a.asked?.[key] ? [a.asked[key]] : []));
    const count = (value: string) => said.filter((s) => s === value).length;
    return said.length ? [[key, said.reduce((best, value) => (count(value) > count(best) ? value : best))]] : [];
  }));
  // Snapped onto the real edges, but for faces among lines nearer than the models' slip (a slab's label: its border,
  // the frame inside it and the ridge around it), where the nearest strong edge is often the wrong one.
  const faces = back(settled.faces).map((f) => ({ ...f, corners: kind.unsnapped?.includes(f.face) ? f.corners : snap(picture, f.corners), asSeen: f.corners }));
  if (trainingOn()) {
    const { read } = readOf([{ faces, answers, disputed: [] }]);
    const label = { faces: faces.map(({ face, corners, agreed }) => ({ face, corners: corners.map((p) => toSent(p).map(Math.round)), agreed })), read, ...(keys.length && { asked }) };
    await keep(jpeg, { task: 'faces', profile: kind.name, prompt, answers, label, disputed: settled.disputed });
  }
  return {
    faces, ...(Object.keys(asked).length && { asked }),
    answers: answers.map((a) => ({ ...a, faces: a.faces && back(a.faces) })), disputed: settled.disputed,
  };
}

/**
 * What the models read off the object, over every picture: each field as given most often (the first given on a
 * tie: the primary's on the first picture), and how sure: "agreed" (given more than once, nothing else given),
 * "once" (one answer) or "disputed" (other answers differ; every model's is in the vision record).
 */
export function readOf(sights: Sight[] = []): { read: Read; readBy: Record<string, string> } {
  const said = sights.flatMap(({ answers }) => answers.flatMap(({ read }) => Object.entries(read ?? {})));
  const same = (a: string | string[], b: string | string[]) => JSON.stringify(a).toLowerCase().replace(/\s+/g, ' ') === JSON.stringify(b).toLowerCase().replace(/\s+/g, ' ');
  const read: Read = {};
  const readBy: Record<string, string> = {};
  for (const key of new Set(said.map(([key]) => key))) {
    const values = said.filter(([k]) => k === key).map(([, value]) => value);
    const count = (value: string | string[]) => values.filter((v) => same(v, value)).length;
    read[key] = values.reduce((best, value) => (count(value) > count(best) ? value : best));
    readBy[key] = count(read[key]) < values.length ? 'disputed' : values.length > 1 ? 'agreed' : 'once';
  }
  return { read, readBy };
}

/** Which kind of object a picture shows, and roughly how big, from the roster's answers: two agreeing settle it. */
export async function identify(picture: Picture, kinds: Kind[]): Promise<Identity> {
  const { jpeg } = await letterbox(picture);
  const names = new Set([...kinds.map(({ name }) => name), 'none']);
  const parse = (json: any): Partial<Answer> | undefined => {
    const object = typeof json?.object === 'string' ? json.object.toLowerCase() : undefined;
    if (!object || !names.has(object)) return undefined;
    const sizeMm = Array.isArray(json.sizeMm) && json.sizeMm.length === 3 && json.sizeMm.every((n: unknown) => Number.isFinite(n) && (n as number) > 0)
      ? json.sizeMm.map(Number) : undefined;
    return { object, ...(sizeMm && { sizeMm }) };
  };
  const clash = (asked: Answer[]) => new Set(asked.filter((a) => a.object).map((a) => a.object)).size > 1;
  const prompt = identifyPrompt(kinds);
  const answers = await consult(jpeg, prompt, parse, clash);
  const usable = answers.filter((a) => a.object);
  // Settled where two answers name the same object (the higher seats first); else the first answer's, disputed.
  const agreed = usable.find((a, i) => usable.slice(i + 1).some((b) => b.object === a.object));
  const pick = agreed ?? usable[0];
  judge(answers, ({ object }) => Boolean(agreed) && object === agreed!.object, 'what it is');
  const sizes = usable.filter((a) => a.object === pick?.object && a.sizeMm).map((a) => a.sizeMm!);
  const sizeMm = sizes.length ? [0, 1, 2].map((k) => sizes.reduce((sum, s) => sum + s[k], 0) / sizes.length) : undefined;
  const disputed = !agreed && usable.length > 1;
  if (trainingOn()) await keep(jpeg, { task: 'identify', prompt, answers, label: { object: pick?.object, sizeMm }, disputed });
  return { profile: pick?.object === 'none' ? undefined : pick?.object, sizeMm, disputed, answers };
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
    jpeg,
    toPicture: ([x, y]: number[]) => [(x - left) / scale, (y - top) / scale],
    toSent: ([x, y]: number[]) => [x * scale + left, y * scale + top],
  };
}

/**
 * The roster asked about one image: two seats at once, the rest standing in
 * for a seat that fails, and one more when `clash` says the answers disagree.
 * The answers come back in roster order, whoever answered first, so a dispute
 * falls to the higher seat.
 */
async function consult(jpeg: Buffer, prompt: string, parse: (json: any) => Partial<Answer> | undefined, clash: (answers: Answer[]) => boolean): Promise<Answer[]> {
  // The bench's seats answer all at once, so a clash needs no extra seat: the third is already in hand.
  if (bench) {
    const seats = await panel(bench, jpeg, prompt, parse);
    if (seats.some((a) => !a.error) || !rosterOn()) return seats;
  }
  const models = roster();
  const answers: Answer[] = [];
  let next = 0;
  const seat = async (): Promise<void> => {
    while (next < models.length) {
      const answer = await ask(models[next++], jpeg, prompt, parse);
      answers.push(answer);
      if (!answer.error) return;
    }
  };
  const ranked = () => answers.sort((x, y) => models.indexOf(x.model) - models.indexOf(y.model));
  await Promise.all([seat(), seat()]);
  if (clash(ranked()) && next < models.length) await seat();
  return ranked();
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

/**
 * Each face once: where two answers agree (the closest pair, averaged); else, disputed, where the first
 * answer to name it put it.
 */
/** Whether four corners run clockwise on screen (y down): twice their signed area, by the shoelace formula, is positive. */
const clockwise = (corners: number[][]) => corners.reduce((sum, p, k) => sum + p[0] * corners[(k + 1) % 4][1] - corners[(k + 1) % 4][0] * p[1], 0) > 0;

export function settle(answers: Answer[]): { faces: Seen[]; disputed: string[] } {
  const usable = answers.filter((a) => a.faces);
  const names = [...new Set(usable.flatMap((a) => a.faces!.map((f) => f.face)))];
  const faces: Seen[] = [];
  const disputed: string[] = [];
  const singles: { face: string; model: string; corners: number[][] }[] = [];
  for (const name of names) {
    const all = usable.flatMap((a) => a.faces!.filter((f) => f.face === name).slice(0, 1).map((f) => ({ model: a.model, corners: f.corners })));
    // A face as the camera saw it winds clockwise in its own reading order (y down). One wound the other way is its
    // mirror image, which no photo shows (two models agreeing on one put a spine's lettering backward): it says the
    // face is there, but its corners place nothing.
    const each = all.filter(({ corners }) => clockwise(corners));
    const named = all.length > 1 || usable.length === 1; // by more than one model, or by the only one that answered
    let best: { by: string[]; corners: number[][]; apart: number } | undefined;
    for (let i = 0; i < each.length; i++) {
      for (let j = i + 1; j < each.length; j++) {
        const apart = distance(each[i].corners, each[j].corners);
        if (apart < AGREE && (!best || apart < best.apart)) {
          best = { by: [each[i].model, each[j].model], apart, corners: each[i].corners.map((p, k) => [(p[0] + each[j].corners[k][0]) / 2, (p[1] + each[j].corners[k][1]) / 2]) };
        }
      }
    }
    if (best) faces.push({ face: name, corners: best.corners, asSeen: best.corners, by: best.by, agreed: true });
    else if (named && each.length) {
      // Named twice in different places or turns (disputed), or by the only model that answered.
      faces.push({ face: name, corners: each[0].corners, asSeen: each[0].corners, by: [each[0].model], agreed: false });
      if (all.length > 1) disputed.push(name);
    } else if (named) {
      disputed.push(name); // only mirror images: the next model is asked, and failing that it's for review
    } else if (each.length) {
      singles.push({ face: name, ...each[0] });
    }
  }
  // Named by one model while another answered without it: left out, unless the other put a face of another name in
  // the same place. Then they agree where it is but not what it is (a slab's back called its front): the higher
  // seat's name stands, disputed, so the next model is asked.
  const seat = (model: string) => usable.findIndex((a) => a.model === model);
  singles.sort((x, y) => seat(x.model) - seat(y.model));
  for (const [i, single] of singles.entries()) {
    const near = (corners: number[][]) => distance(corners, single.corners) < AGREE;
    if (faces.some((f) => near(f.corners))) continue;
    if (singles.some((other, j) => j > i && other.model !== single.model && near(other.corners))) {
      faces.push({ face: single.face, corners: single.corners, asSeen: single.corners, by: [single.model], agreed: false });
      disputed.push(single.face);
    }
  }
  return { faces, disputed };
}

/** Mean distance between matching corners, as a share of the image's diagonal. */
const distance = (a: number[][], b: number[][]) =>
  a.reduce((sum, p, i) => sum + Math.hypot(p[0] - b[i][0], p[1] - b[i][1]), 0) / 4 / Math.hypot(SIZE, SIZE);

/** The question and the photo, as an OpenAI-compatible chat request's body. */
const request = (model: string, jpeg: Buffer, prompt: string) => JSON.stringify({
  model, temperature: 0, max_tokens: 4000, stream: false,
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
 */
async function panel(on: { url: string; collection: string }, jpeg: Buffer, prompt: string, parse: (json: any) => Partial<Answer> | undefined): Promise<Answer[]> {
  const started = performance.now();
  try {
    const response = await fetch(`${on.url}/v1/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: request(on.collection, jpeg, prompt), signal: AbortSignal.timeout(BENCH_TIMEOUT_MS),
    });
    if (!response.ok) return [{ model: on.collection, ms: Math.round(performance.now() - started), status: response.status, error: `answered ${response.status}` }];
    const seats: { alias: string; call: string; status: string; seconds?: number; answer?: string; error?: string }[] = (await response.json())?.bench?.seats ?? [];
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
