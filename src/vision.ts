// What a photo shows, asked of vision models: which faces of the object are in it and where their corners
// are, plus a book's title and authors. Any OpenAI-compatible chat endpoint serves: Mike's LAN bench today,
// a fine-tuned model later. THICKEN_VISION_MODELS lists the roster in order: the first two (primary and
// peer) are asked together, the rest stand in for a seat that fails, and one more is asked when two put
// the same face in different places. Two answers agreeing is the confidence. Without THICKEN_VISION_URL
// nothing is asked, and photos are used whole as before.
import sharp from 'sharp';
import type { Picture } from './image.ts';

const SIZE = 1000; // photos go out letterboxed to 1000 x 1000, so pixels and a 0-1000 scale are the same numbers
const AGREE = 0.03; // corners within 3% of the diagonal, on average, are the same face in the same place and turn
const TIMEOUT_MS = 180_000;

const FACES = {
  book: '"front" (front cover), "back" (back cover), "spine", "edge" (the page edge opposite the spine), "top", "bottom"',
  slab: '"front" (the side with the grade label), "back"',
};

/** One model's answer, corners in the picture's own pixels. */
export interface Answer { model: string; ms: number; status?: number; faces?: { face: string; corners: number[][] }[]; title?: string; authors?: string[]; error?: string }
/** A face as settled: its corners (top-left, top-right, bottom-right, bottom-left, upright), and who agreed. */
export interface Seen { face: string; corners: number[][]; by: string[]; agreed: boolean }
export interface Sight { faces: Seen[]; title?: string; authors?: string[]; answers: Answer[]; disputed: string[] }

export const visionOn = () => Boolean(process.env.THICKEN_VISION_URL && process.env.THICKEN_VISION_MODELS);

/** Every picture looked at, four at a time. */
export async function lookAll(pictures: Picture[], object: keyof typeof FACES): Promise<Sight[]> {
  const sights: Sight[] = [];
  for (let i = 0; i < pictures.length; i += 4) sights.push(...await Promise.all(pictures.slice(i, i + 4).map((p) => look(p, object))));
  return sights;
}

/**
 * For the sidecar: where the photos went (host and path only, never the key), who was asked, what each
 * answered and how long it took, and what was settled, corners rounded.
 */
export const visionRecord = (sights: Sight[]) => {
  const round = <T extends { corners: number[][] }>(f: T) => ({ ...f, corners: f.corners.map((p) => p.map(Math.round)) });
  const { host, pathname } = new URL(process.env.THICKEN_VISION_URL!);
  return {
    endpoint: `${host}${pathname.replace(/\/$/, '')}/chat/completions`,
    models: process.env.THICKEN_VISION_MODELS!.split(',').map((m) => m.trim()).filter(Boolean),
    photos: sights.map((s, picture) => ({ picture, ...s, faces: s.faces.map(round), answers: s.answers.map((a) => ({ ...a, faces: a.faces?.map(round) })) })),
  };
};

const prompt = (object: keyof typeof FACES) => `This photo shows a ${object === 'book' ? 'book' : 'graded trading-card slab (a clear plastic holder with a label)'}, on whatever it was set down on. For every face of it you can see, even partly, say which face it is and give the pixel coordinates of its four corners in this ${SIZE} x ${SIZE} image.

Faces: ${FACES[object]}.

Give each face's corners in that face's own reading order: top-left, top-right, bottom-right, bottom-left, as the face would look held upright in front of you${object === 'book' ? ' (for the spine and the page sides, as when the book stands upright on a shelf)' : ''}. A corner hidden from view goes where it would be.${object === 'book' ? '\n\nAlso read the title and authors if you can.' : ''}

Answer with JSON only, no prose:
{"faces":[{"face":"front","corners":[[x,y],[x,y],[x,y],[x,y]]}]${object === 'book' ? ',"title":"","authors":[]' : ''}}`;

/** Where the object's faces are in a picture, from the roster's answers. */
export async function look(picture: Picture, object: keyof typeof FACES): Promise<Sight> {
  const { width, height } = picture;
  const scale = SIZE / Math.max(width, height);
  const [left, top] = [(SIZE - Math.round(width * scale)) / 2, (SIZE - Math.round(height * scale)) / 2];
  const jpeg = await sharp(picture.data, { raw: { width, height, channels: 4 } })
    .resize(SIZE, SIZE, { fit: 'contain', background: '#808080' }).flatten({ background: '#808080' }).jpeg({ quality: 85 }).toBuffer();
  const toPicture = ([x, y]: number[]) => [(x - left) / scale, (y - top) / scale];

  const roster = process.env.THICKEN_VISION_MODELS!.split(',').map((m) => m.trim()).filter(Boolean);
  const answers: Answer[] = [];
  let next = 0;
  const seat = async (): Promise<void> => {
    while (next < roster.length) {
      const answer = await ask(roster[next++], jpeg, object);
      answers.push(answer);
      if (answer.faces) return;
    }
  };
  // In roster order, whichever answered first, so a dispute falls to the higher seat.
  const ranked = () => answers.sort((x, y) => roster.indexOf(x.model) - roster.indexOf(y.model));
  await Promise.all([seat(), seat()]);
  let settled = settle(ranked());
  if (settled.disputed.length && next < roster.length) {
    await seat();
    settled = settle(ranked());
  }
  const named = answers.find((a) => a.title);
  return {
    faces: settled.faces.map((f) => ({ ...f, corners: f.corners.map(toPicture) })),
    title: named?.title, authors: named?.authors,
    answers: answers.map((a) => ({ ...a, faces: a.faces?.map((f) => ({ ...f, corners: f.corners.map(toPicture) })) })),
    disputed: settled.disputed,
  };
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
    if (best) faces.push({ face: name, corners: best.corners, by: best.by, agreed: true });
    else if (each.length > 1 || usable.length === 1) {
      // Named twice in different places or turns (disputed), or by the only model that answered.
      faces.push({ face: name, corners: each[0].corners, by: [each[0].model], agreed: false });
      if (each.length > 1) disputed.push(name);
    }
    // Named by one model while another answered without it: left out.
  }
  return { faces, disputed };
}

/** Mean distance between matching corners, as a share of the image's diagonal. */
const distance = (a: number[][], b: number[][]) =>
  a.reduce((sum, p, i) => sum + Math.hypot(p[0] - b[i][0], p[1] - b[i][1]), 0) / 4 / Math.hypot(SIZE, SIZE);

async function ask(model: string, jpeg: Buffer, object: keyof typeof FACES): Promise<Answer> {
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);
  try {
    const response = await fetch(`${process.env.THICKEN_VISION_URL!.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(process.env.THICKEN_VISION_KEY && { Authorization: `Bearer ${process.env.THICKEN_VISION_KEY}` }) },
      body: JSON.stringify({
        model, temperature: 0, max_tokens: 4000, stream: false,
        messages: [{ role: 'user', content: [
          { type: 'text', text: prompt(object) },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpeg.toString('base64')}` } },
        ] }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const { status } = response;
    if (!response.ok) return { model, ms: ms(), status, error: `answered ${status}` };
    const text: string = (await response.json())?.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? 'null');
    const faces = (Array.isArray(parsed?.faces) ? parsed.faces : [])
      .filter((f: any) => typeof f?.face === 'string' && Array.isArray(f.corners) && f.corners.length === 4
        && f.corners.every((p: unknown) => Array.isArray(p) && p.length === 2 && p.every((n) => Number.isFinite(n) && n > -SIZE / 10 && n < SIZE * 1.1)))
      .map((f: any) => ({ face: f.face.toLowerCase(), corners: f.corners.map((p: number[]) => p.map(Number)) }));
    if (!faces.length) return { model, ms: ms(), status, error: 'no faces in its answer' };
    const authors = Array.isArray(parsed.authors) ? parsed.authors.filter((a: unknown) => typeof a === 'string' && a) : [];
    return { model, ms: ms(), status, faces, ...(typeof parsed.title === 'string' && parsed.title && { title: parsed.title }), ...(authors.length && { authors }) };
  } catch (error) {
    return { model, ms: ms(), error: (error as Error).name === 'TimeoutError' ? 'timed out' : (error as Error).message };
  }
}
