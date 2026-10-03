// What a photo shows, asked of vision models: what kind of object it is, when
// nothing else says (one of the profiles, and roughly how big), and which of
// its faces each photo shows, with their corners, plus any title and authors.
// Any OpenAI-compatible chat endpoint serves: Mike's LAN bench today, a
// fine-tuned model later. THICKEN_VISION_MODELS lists the roster in order: the
// first two (primary and peer) are asked together, the rest stand in for a
// seat that fails, and one more is asked when the two disagree. Two answers
// agreeing is the confidence. Without THICKEN_VISION_URL nothing is asked,
// and photos are used whole as before.
import sharp from 'sharp';
import { snap, type Picture } from './image.ts';
import { keep, trainingOn } from './training.ts';

const SIZE = 1000; // photos go out letterboxed to 1000 x 1000, so pixels and a 0-1000 scale are the same numbers
const AGREE = 0.03; // corners within 3% of the diagonal, on average, are the same face in the same place and turn
const TIMEOUT_MS = 180_000;
const MAX_FACES = 12; // twice a box's six: more is noise, and settling compares every pair

/** What the models are told about a kind of object: a profile (src/profiles). */
export interface Kind { name: string; about?: string; faces: Record<string, string>; note?: string }
/** One model's answer, corners in the picture's own pixels. */
export interface Answer {
  model: string; ms: number; status?: number; error?: string;
  faces?: { face: string; corners: number[][] }[]; title?: string; authors?: string[]; // finding faces
  object?: string; sizeMm?: number[]; // saying what it is
}
/**
 * A face as settled: its corners (top-left, top-right, bottom-right, bottom-left, upright), snapped to its
 * real edges; the corners as the models gave them; and who agreed.
 */
export interface Seen { face: string; corners: number[][]; asSeen: number[][]; by: string[]; agreed: boolean }
export interface Sight { faces: Seen[]; title?: string; authors?: string[]; answers: Answer[]; disputed: string[] }
/** What the models said the object is: a profile's name (none, if none fits), its estimated size, and whether they disagreed. */
export interface Identity { profile?: string; sizeMm?: number[]; disputed: boolean; answers: Answer[] }

export const visionOn = () => Boolean(process.env.THICKEN_VISION_URL && process.env.THICKEN_VISION_MODELS);
const roster = () => process.env.THICKEN_VISION_MODELS!.split(',').map((m) => m.trim()).filter(Boolean);

const facesPrompt = ({ name, about, faces, note }: Kind) => `This photo shows ${about ?? `a ${name}`}, on whatever it was set down on. For every face of it you can see, even partly, say which face it is and give the pixel coordinates of its four corners in this ${SIZE} x ${SIZE} image.

Faces: ${Object.entries(faces).map(([face, words]) => (words === face ? `"${face}"` : `"${face}" (${words})`)).join(', ')}.

Give each face's corners in that face's own reading order: top-left, top-right, bottom-right, bottom-left, as the face would look held upright in front of you. For a side, upright is with the object standing as it normally does; for the top, looking down on it from the front (its back edge at the top); for the bottom, with the object tipped back onto its back (its front edge at the top).${note ? ` ${note}` : ''} A corner hidden from view goes where it would be.

Also read its title, and authors if it has them.

Answer with JSON only, no prose:
{"faces":[{"face":"front","corners":[[x,y],[x,y],[x,y],[x,y]]}],"title":"","authors":[]}`;

const identifyPrompt = (kinds: Kind[]) => `This photo shows one object. Which of these is it? Pick the most specific that fits.
${kinds.map(({ name, about }) => `- "${name}": ${about}`).join('\n')}
- "none": none of these

Also estimate its real size in millimeters: the width and height of its front, and its depth.

Answer with JSON only, no prose:
{"object":"${kinds[0]?.name}","sizeMm":[width,height,depth]}`;

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
  const answers = await consult(jpeg, prompt, (json) => parseFaces(json, Object.keys(kind.faces)), (asked) => settle(asked).disputed.length > 0);
  const settled = settle(answers);
  const back = <T extends { corners: number[][] }>(faces: T[]) => faces.map((f) => ({ ...f, corners: f.corners.map(toPicture) }));
  const named = answers.find((a) => a.title);
  const faces = back(settled.faces).map((f) => ({ ...f, corners: snap(picture, f.corners), asSeen: f.corners }));
  if (trainingOn()) {
    const label = { faces: faces.map(({ face, corners, agreed }) => ({ face, corners: corners.map((p) => toSent(p).map(Math.round)), agreed })), title: named?.title, authors: named?.authors };
    await keep(jpeg, { task: 'faces', profile: kind.name, prompt, answers, label, disputed: settled.disputed });
  }
  return {
    faces, title: named?.title, authors: named?.authors,
    answers: answers.map((a) => ({ ...a, faces: a.faces && back(a.faces) })), disputed: settled.disputed,
  };
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
  const { host, pathname } = new URL(process.env.THICKEN_VISION_URL!);
  return {
    endpoint: `${host}${pathname.replace(/\/$/, '')}/chat/completions`,
    models: roster(),
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
function parseFaces(json: any, names: string[]): Partial<Answer> | undefined {
  const faces = (Array.isArray(json?.faces) ? json.faces.slice(0, MAX_FACES) : [])
    .filter((f: any) => typeof f?.face === 'string' && names.includes(f.face.toLowerCase()) && Array.isArray(f.corners) && f.corners.length === 4
      && f.corners.every((p: unknown) => Array.isArray(p) && p.length === 2 && p.every((n) => Number.isFinite(n) && n > -SIZE / 10 && n < SIZE * 1.1)))
    .map((f: any) => ({ face: f.face.toLowerCase(), corners: f.corners.map((p: number[]) => p.map(Number)) }));
  if (!faces.length) return undefined;
  const authors = Array.isArray(json.authors) ? json.authors.filter((a: unknown) => typeof a === 'string' && a) : [];
  return { faces, ...(typeof json.title === 'string' && json.title && { title: json.title }), ...(authors.length && { authors }) };
}

/**
 * Each face once: where two answers agree (the closest pair, averaged); else, disputed, where the first
 * answer to name it put it.
 */
function settle(answers: Answer[]): { faces: Seen[]; disputed: string[] } {
  const usable = answers.filter((a) => a.faces);
  const names = [...new Set(usable.flatMap((a) => a.faces!.map((f) => f.face)))];
  const faces: Seen[] = [];
  const disputed: string[] = [];
  for (const name of names) {
    const each = usable.flatMap((a) => a.faces!.filter((f) => f.face === name).slice(0, 1).map((f) => ({ model: a.model, corners: f.corners })));
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
    else if (each.length > 1 || usable.length === 1) {
      // Named twice in different places or turns (disputed), or by the only model that answered.
      faces.push({ face: name, corners: each[0].corners, asSeen: each[0].corners, by: [each[0].model], agreed: false });
      if (each.length > 1) disputed.push(name);
    }
    // Named by one model while another answered without it: left out.
  }
  return { faces, disputed };
}

/** Mean distance between matching corners, as a share of the image's diagonal. */
const distance = (a: number[][], b: number[][]) =>
  a.reduce((sum, p, i) => sum + Math.hypot(p[0] - b[i][0], p[1] - b[i][1]), 0) / 4 / Math.hypot(SIZE, SIZE);

async function ask(model: string, jpeg: Buffer, prompt: string, parse: (json: any) => Partial<Answer> | undefined): Promise<Answer> {
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);
  try {
    const response = await fetch(`${process.env.THICKEN_VISION_URL!.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(process.env.THICKEN_VISION_KEY && { Authorization: `Bearer ${process.env.THICKEN_VISION_KEY}` }) },
      body: JSON.stringify({
        model, temperature: 0, max_tokens: 4000, stream: false,
        messages: [{ role: 'user', content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpeg.toString('base64')}` } },
        ] }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const { status } = response;
    if (!response.ok) return { model, ms: ms(), status, error: `answered ${status}` };
    const text: string = (await response.json())?.choices?.[0]?.message?.content ?? '';
    const value = parse(JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? 'null'));
    return value ? { model, ms: ms(), status, ...value } : { model, ms: ms(), status, error: 'no usable answer' };
  } catch (error) {
    return { model, ms: ms(), error: (error as Error).name === 'TimeoutError' ? 'timed out' : (error as Error).message };
  }
}
