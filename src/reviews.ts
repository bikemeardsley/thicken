// Training mode, reviewed (off by default): on when THICKEN_REVIEWS names a folder. Every photo the vision models
// looked at goes to a local Label Studio (LABEL_STUDIO_URL, LABEL_STUDIO_API_KEY) as a task, the faces they settled as
// an editable proposal with each face's confidence: the share of the seats that answered which agreed on it, shown and
// kept, used for nothing. A person reviews it there (drags corners, adds or deletes faces, boxes whatever covers the
// object) and submits; thicken builds from those corners, not the proposal's, and keeps the photo, the proposal and
// the decision as a line of review.jsonl in that folder, in the shape experiment 003's label_studio.py exports
// (WendellResearch-AI). While it's on, THICKEN_DATASET keeps nothing (src/training.ts): a reviewed photo stays out of
// that folder.
//
// Every corner and box is in the frame the models were sent (`frame: letterbox-1000`): the photo letterboxed into
// 1000 x 1000 (vision.ts letterbox). Corner 1 is the face's own top left, then clockwise. `sent` maps the frame to the
// photo as kept (photos/), and `shrink` that photo to the original, which load() shrinks to 2048 px a side at most.
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import sharp from 'sharp';
import type { Picture } from './image.ts';
import { clockwise, letterbox, visionRecord, type Kind, type Sight } from './vision.ts';

const SIZE = 1000;
const AREA_LOST = 0.1; // label_studio.py's: how much of a polygon's area its four corners may leave out
const POLL_MS = 2000;
const SOMEONE = 'someone else in frame';
const OBSTRUCTION = '<RectangleLabels name="obstruction" toName="image" strokeWidth="2" opacity="0.1"><Label value="hand"/><Label value="other"/></RectangleLabels>';
const INSTRUCTIONS = `<p>Every photo thicken looked at in training mode, its faces as the vision models proposed them, each with its
confidence. Experiment 003's review guidelines (v4) apply. <b>keep</b> once every face sits on its face: drag corners, never
edges; delete a face that isn't there; draw a missing one from its corner 1, its own top left, clockwise. <b>reject</b> a photo
that can't give a good label. Box anything covering the object as <b>hand</b> or <b>other</b>. Tick <b>${SOMEONE}</b> for
anyone but a hand or arm holding it: the photo is then held, not trained on, until Mike decides. thicken builds from what
you submit; <b>Skip</b> builds from the proposal and keeps nothing.</p>`;

export const reviewsOn = () => Boolean(process.env.THICKEN_REVIEWS);

/** Opens a page in the default browser; the link is printed as well, for when none opens. */
export const browser = {
  open(url: string) {
    const [program, args]: [string, string[]] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
    execFile(program, args, () => {});
  },
};

const studio = () => (process.env.LABEL_STUDIO_URL || 'http://localhost:8080').replace(/\/$/, '');
let auth: string | undefined;

/** A personal access token is a refresh token, traded for a short-lived access token; a legacy token goes as it is. */
async function signIn(): Promise<string> {
  const key = process.env.LABEL_STUDIO_API_KEY?.trim(); // trimmed: a stray newline would put it in an error
  if (!key) throw new Error('training mode reviews in Label Studio: set LABEL_STUDIO_API_KEY to your access token (Account & Settings there)');
  if (key.split('.').length !== 3) return `Token ${key}`;
  const response = await fetch(`${studio()}/api/token/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh: key }) });
  if (!response.ok) throw new Error(`Label Studio refused LABEL_STUDIO_API_KEY (${response.status}): make a new one under Account & Settings`);
  return `Bearer ${(await response.json()).access}`;
}

/** Label Studio's API: the token never in an error. */
async function api(method: string, route: string, body?: object): Promise<any> {
  for (let tries = 1; ; tries++) {
    auth ??= await signIn();
    const response = await fetch(`${studio()}${route}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: auth }, ...(body && { body: JSON.stringify(body) }),
    });
    if (response.status === 401 && tries === 1) auth = undefined; // an access token lasts minutes, a review can take longer
    // On SQLite it sometimes answers 500 while its own page polls (label_studio.py): a read is safe to ask again.
    else if (response.status === 500 && method === 'GET' && tries < 3) await sleep(POLL_MS);
    else if (!response.ok) throw new Error(`Label Studio answered ${response.status} to ${method} ${route.split('?')[0]}`);
    else return response.status === 204 ? undefined : response.json();
  }
}

/** One project for each profile's photos, as experiment 003 names them, its faces and guidelines kept up to date. */
async function project(kind: Kind): Promise<number> {
  const faces = Object.keys(kind.faces).sort().map((face) => `<Label value="${face}"/>`).join('');
  const fields = {
    title: `003 · ${kind.name} faces · thicken runs`, show_instruction: true, expert_instruction: INSTRUCTIONS,
    description: `Photos thicken looked at in training mode, reviewed before each build. Decisions go to ${path.resolve(process.env.THICKEN_REVIEWS!, 'review.jsonl')}.`,
    label_config: `<View>
  <Header value="$title"/>
  <Text name="confidence" value="$confidence"/>
  <Choices name="verdict" toName="image" choice="single" required="true" showInline="true">
    <Choice value="keep"/><Choice value="reject"/>
  </Choices>
  <Choices name="people" toName="image" choice="multiple" showInline="true"><Choice value="${SOMEONE}"/></Choices>
  <Image name="image" value="$image" zoom="true"/>
  <PolygonLabels name="faces" toName="image" strokeWidth="2" pointSize="small" opacity="0.15">${faces}</PolygonLabels>
  ${OBSTRUCTION}
  <KeyPointLabels name="corner1" toName="image"><Label value="corner 1" background="#facc15"/></KeyPointLabels>
</View>`,
  };
  const found = await api('GET', '/api/projects?page_size=1000');
  const id = (found.results ?? found).find((p: { title: string }) => p.title === fields.title)?.id;
  if (!id) return (await api('POST', '/api/projects', { ...fields, show_collab_predictions: true })).id;
  await api('PATCH', `/api/projects/${id}`, fields); // faces added to the profile since, or new guidelines
  return id;
}

type Face = { face: string; corners: number[][] };
interface Region { from_name: string; type: string; original_width: number; original_height: number; value: any }
export interface Annotation { id: number; result: Region[]; updated_at: string; was_cancelled?: boolean }

const area = (ring: number[][]) => Math.abs(ring.reduce((sum, [x0, y0], k) => sum + x0 * ring[(k + 1) % ring.length][1] - ring[(k + 1) % ring.length][0] * y0, 0)) / 2;

/**
 * A face has four corners (label_studio.py's four_corners): a point clicked on an edge, by accident or to follow a
 * curved side, is none, so the four enclosing the most area stay, corner 1 among them. If they leave out more than
 * AREA_LOST, it isn't four corners and a bowed side: every point stays, and the face is refused.
 */
export function fourCorners(corners: number[][]): number[][] {
  let best: number[][] | undefined;
  for (let i = 1; i < corners.length; i++) for (let j = i + 1; j < corners.length; j++) for (let k = j + 1; k < corners.length; k++) {
    const four = [corners[0], corners[i], corners[j], corners[k]];
    if (!best || area(four) > area(best)) best = four;
  }
  return corners.length <= 4 || area(best!) < (1 - AREA_LOST) * area(corners) ? corners : best!;
}

/**
 * A submitted annotation as a decision, as label_studio.py's decision() makes it: keep (the proposal's faces
 * unchanged), fix (changed) or reject (rejected, or no face left), with the faces and obstructions in the frame; or
 * why it can't be one. Unlike its review lines, a keep carries its faces too.
 */
export function decision(a: Annotation, proposal: Face[]) {
  const px = (v: number, size: number) => Math.min(Math.max(Math.round((v * size) / 100), 0), SIZE);
  const of = (name: string) => a.result.filter((r) => r.from_name === name);
  const verdict: string | undefined = of('verdict')[0]?.value.choices[0];
  const someone = of('people').some((r) => r.value.choices.includes(SOMEONE));
  const obstructions = of('obstruction').map(({ value: v, original_width: w, original_height: h }) =>
    ({ what: v.rectanglelabels[0] as string, box: [px(v.x, w), px(v.y, h), px(v.x + v.width, w), px(v.y + v.height, h)] }));
  const line = (verdict: string, faces: Face[] = []) => ({ verdict, faces, ...(obstructions.length && { obstructions }), at: a.updated_at, someone });
  if (!verdict) return { error: 'neither keep nor reject is ticked' };
  if (verdict === 'reject') return line('reject');
  const faces: Face[] = a.result.filter((r) => r.type === 'polygonlabels').map(({ value: v, original_width: w, original_height: h }) =>
    ({ face: v.polygonlabels?.[0], corners: fourCorners(v.points.map(([x, y]: number[]) => [px(x, w), px(y, h)])) }));
  if (!faces.length) return line('reject');
  const same = (list: Face[]) => JSON.stringify(list.map(({ face, corners }) => JSON.stringify({ face, corners })).sort());
  if (same(faces) === same(proposal)) return line('keep', faces);
  // Corner order can't be checked beyond this: corner 1 is the face's own top left, which only a reader knows.
  if (faces.some((f) => !f.face || f.corners.length !== 4 || !clockwise(f.corners))) return { error: 'a face without a name, four corners or a clockwise order' };
  return line('fix', faces);
}

/** The task's latest submitted annotation as a decision, once there is one; undefined if it was skipped. */
async function decided(task: number, proposal: Face[]) {
  for (let told = ''; ; await sleep(POLL_MS)) {
    const annotations: Annotation[] = await api('GET', `/api/tasks/${task}/annotations`);
    const last = annotations.sort((a, b) => a.updated_at.localeCompare(b.updated_at)).at(-1);
    if (!last) continue;
    if (last.was_cancelled) return undefined;
    const made = decision(last, proposal);
    if (!('error' in made)) return { ...made, annotation: last.id };
    if (told !== last.updated_at) process.stderr.write(`thicken: Label Studio task ${task} can't be used yet: ${made.error}. Fix it and update.\n`);
    told = last.updated_at;
  }
}

/**
 * Every photo's faces as a person settled them in Label Studio, for the build: their corners in place of the
 * models' (the photo's own pixels, unsnapped), none from a photo they rejected, the models' own from one they
 * skipped. Each decision is kept as it comes (review.jsonl), under held/ when someone else is in frame.
 */
export async function reviewAll(pictures: Picture[], sights: Sight[], kind: Kind, thicken: string): Promise<Sight[]> {
  const root = path.resolve(process.env.THICKEN_REVIEWS!);
  // The models have seen these photos, so they're practice, never an exam's.
  if (root.split(/[\\/]/).some((part) => part.toLowerCase() === 'exam')) throw new Error(`THICKEN_REVIEWS is ${root}: training rows never go in an exam's folder`);
  auth = undefined; // signed in afresh each run, with the token set now
  const id = await project(kind);
  const run = randomUUID();
  const model_version = visionRecord().models.join(',');
  const asked = [];
  for (const [i, sight] of sights.entries()) {
    const frame = await letterbox(pictures[i]);
    const inFrame = (corners: number[][]) => corners.map((p) => frame.toSent(p).map(Math.round));
    const answered = new Set(sight.answers.filter((a) => !a.error).map(({ model }) => model));
    const faces = sight.faces.map(({ face, corners, asSeen, by, agreed }) => ({
      face, corners: inFrame(corners), asSeen: inFrame(asSeen), by, agreed,
      score: answered.size ? Math.round((by.filter((m) => answered.has(m)).length / answered.size) * 100) / 100 : 0,
    }));
    const proposal = {
      model_version, faces, disputed: sight.disputed,
      answers: sight.answers.map(({ faces: given, ...a }) => ({ ...a, ...(given && { faces: given.map(({ face, corners }) => ({ face, corners: inFrame(corners) })) }) })),
    };
    const name = `${createHash('sha256').update(frame.jpeg).digest('hex').slice(0, 16)}.jpg`;
    const { file, page, time } = pictures[i].source;
    const pct = (v: number) => (v * 100) / SIZE;
    const region = { to_name: 'image', original_width: SIZE, original_height: SIZE };
    const task = await api('POST', '/api/tasks', { project: id, data: {
      image: `data:image/jpeg;base64,${frame.jpeg.toString('base64')}`, group: `training-mode:${name}`,
      title: `${file}${page ? ` page ${page}` : ''}${time === undefined ? '' : ` at ${time} s`}`,
      confidence: [...faces.map((f) => `${f.face} ${f.score} (${f.agreed ? 'agreed' : 'unchecked'}: ${f.by.join(', ')})`),
        ...sight.disputed.map((face) => `${face} disputed, left out`)].join('; ') || 'nothing settled: draw what you see, or reject',
    } });
    // Each face as an editable polygon with its confidence, and a read-only dot on its corner 1, which Label Studio doesn't mark.
    await api('POST', '/api/predictions', { task: task.id, model_version, score: faces.length ? faces.reduce((sum, f) => sum + f.score, 0) / faces.length : 0, result: [
      ...faces.map((f, k) => ({ ...region, id: `face${k}`, from_name: 'faces', type: 'polygonlabels', score: f.score,
        value: { points: f.corners.map(([x, y]) => [pct(x), pct(y)]), closed: true, polygonlabels: [f.face] } })),
      ...faces.map((f, k) => ({ ...region, id: `corner${k}`, from_name: 'corner1', type: 'keypointlabels', readonly: true,
        value: { x: pct(f.corners[0][0]), y: pct(f.corners[0][1]), width: 0.8, keypointlabels: ['corner 1'] } })),
    ] });
    asked.push({ task: task.id, frame, proposal, name, picture: pictures[i] });
  }
  const link = (task: number) => `${studio()}/projects/${id}/data?task=${task}`;
  if (asked.length) browser.open(link(asked[0].task));
  process.stderr.write(`thicken: review ${asked.length === 1 ? 'the photo' : `these ${asked.length} photos`} in Label Studio and submit; thicken waits:\n${asked.map(({ task }) => `  ${link(task)}\n`).join('')}`);

  const reviewed: Sight[] = [];
  for (const [i, { task, frame, proposal, name, picture }] of asked.entries()) {
    const made = await decided(task, proposal.faces);
    if (!made) { // skipped: built from the proposal, nothing kept
      reviewed.push(sights[i]);
      continue;
    }
    const { someone, annotation, ...decision } = made;
    const dir = someone ? path.join(root, 'held') : root;
    const { width, height, source } = picture;
    // The original upright: a phone's portrait photo is stored on its side, turned by its EXIF.
    const turned = width !== height && (width > height) !== (source.width > source.height);
    const original = turned ? { width: source.height, height: source.width } : { width: source.width, height: source.height };
    await mkdir(path.join(dir, 'frames'), { recursive: true });
    await mkdir(path.join(dir, 'photos'), { recursive: true });
    // Pixels only: from raw pixels, sharp writes no EXIF (so no GPS), XMP or ICC profile.
    await writeFile(path.join(dir, 'frames', name), frame.jpeg);
    await writeFile(path.join(dir, 'photos', name), await sharp(picture.data, { raw: { width, height, channels: 4 } }).jpeg({ quality: 92 }).toBuffer());
    const row = {
      group: `training-mode:${name}`, ...decision, file_name: `frames/${name}`, photo: `photos/${name}`,
      frame: 'letterbox-1000', sent: frame.sent, photoSize: [width, height], original: [original.width, original.height], shrink: width / original.width,
      source: { file: source.file, ...(source.page && { page: source.page }), ...(source.time !== undefined && { time: source.time }) },
      profile: kind.name, proposal, thicken, run, labelStudio: { url: studio(), project: id, task, annotation }, ...(someone && { held: SOMEONE }),
    };
    await appendFile(path.join(dir, 'review.jsonl'), `${JSON.stringify(row)}\n`);
    reviewed.push({ ...sights[i], disputed: [], faces: decision.faces.map(({ face, corners }) => {
      const at = corners.map(frame.toPicture);
      return { face, corners: at, asSeen: at, by: ['given'], agreed: true };
    }) });
  }
  return reviewed;
}
