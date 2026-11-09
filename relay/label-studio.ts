// Label Studio, for reviewing contributed photos (pull.ts, beside it; neither ships on npm): your own server (LABEL_STUDIO_URL,
// LABEL_STUDIO_API_KEY), a project for each profile's photos from one source, each photo a task with its faces as an
// editable proposal, and a submitted review read back as a decision in the shape experiment 003's label_studio.py
// exports (WendellResearch-AI).
//
// Every corner and box is in the frame thicken sends (`letterbox-1000`): the photo letterboxed into 1000 x 1000
// (vision.ts letterbox). Corner 1 is the face's own top left, then clockwise.
import { setTimeout as sleep } from 'node:timers/promises';
import { clockwise, type Kind } from '../src/vision.ts';

const SIZE = 1000;
const AREA_LOST = 0.1; // label_studio.py's: how much of a polygon's area its four corners may leave out
const RETRY_MS = 2000;
const SOMEONE = 'someone else in frame';
const OBSTRUCTION = '<RectangleLabels name="obstruction" toName="image" strokeWidth="2" opacity="0.1"><Label value="hand"/><Label value="other"/></RectangleLabels>';

export const studio = () => (process.env.LABEL_STUDIO_URL || 'http://localhost:8080').replace(/\/$/, '');
let auth: string | undefined;

/** A personal access token is a refresh token, traded for a short-lived access token; a legacy token goes as it is. */
async function signIn(): Promise<string> {
  const key = process.env.LABEL_STUDIO_API_KEY?.trim(); // trimmed: a stray newline would put it in an error
  if (!key) throw new Error('set LABEL_STUDIO_API_KEY to your Label Studio access token (Account & Settings there)');
  if (key.split('.').length !== 3) return `Token ${key}`;
  const response = await fetch(`${studio()}/api/token/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh: key }) });
  if (!response.ok) throw new Error(`Label Studio refused LABEL_STUDIO_API_KEY (${response.status}): make a new one under Account & Settings`);
  return `Bearer ${(await response.json()).access}`;
}

/** Label Studio's API: the token never in an error. */
export async function api(method: string, route: string, body?: object): Promise<any> {
  for (let tries = 1; ; tries++) {
    auth ??= await signIn();
    const response = await fetch(`${studio()}${route}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: auth }, ...(body && { body: JSON.stringify(body) }),
    });
    if (response.status === 401 && tries === 1) auth = undefined; // an access token lasts minutes
    // On SQLite it sometimes answers 500 while its own page polls (label_studio.py): a read is safe to ask again.
    else if (response.status === 500 && method === 'GET' && tries < 3) await sleep(RETRY_MS);
    else if (!response.ok) throw new Error(`Label Studio answered ${response.status} to ${method} ${route.split('?')[0]}`);
    else return response.status === 204 ? undefined : response.json();
  }
}

/** One project for each profile's photos from one source, as experiment 003 names them, its faces and guidelines kept up to date. */
export async function project(kind: Kind, from: string, about: { description: string; instructions: string }): Promise<number> {
  const faces = Object.keys(kind.faces).sort().map((face) => `<Label value="${face}"/>`).join('');
  const fields = {
    title: `003 · ${kind.name} faces · ${from}`, show_instruction: true, expert_instruction: about.instructions, description: about.description,
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

/**
 * A task for a frame (1000 x 1000), its faces an editable proposal: each a polygon with its score, and a read-only dot
 * on its corner 1, which Label Studio doesn't mark. Its id.
 */
export async function addTask(project: number, jpeg: Buffer, data: { group: string; title: string; confidence: string },
  faces: { face: string; corners: number[][]; score: number }[], model_version: string): Promise<number> {
  const pct = (v: number) => (v * 100) / SIZE;
  const region = { to_name: 'image', original_width: SIZE, original_height: SIZE };
  const task = await api('POST', '/api/tasks', { project, data: { image: `data:image/jpeg;base64,${jpeg.toString('base64')}`, ...data } });
  await api('POST', '/api/predictions', { task: task.id, model_version, score: faces.length ? faces.reduce((sum, f) => sum + f.score, 0) / faces.length : 0, result: [
    ...faces.map((f, k) => ({ ...region, id: `face${k}`, from_name: 'faces', type: 'polygonlabels', score: f.score,
      value: { points: f.corners.map(([x, y]) => [pct(x), pct(y)]), closed: true, polygonlabels: [f.face] } })),
    ...faces.map((f, k) => ({ ...region, id: `corner${k}`, from_name: 'corner1', type: 'keypointlabels', readonly: true,
      value: { x: pct(f.corners[0][0]), y: pct(f.corners[0][1]), width: 0.8, keypointlabels: ['corner 1'] } })),
  ] });
  return task.id;
}
