// Mike's side of contributing photos (PRIVACY.md, "Contributing photos"), run by hand from thicken's folder:
// `node relay/pull.ts`. Each run:
// - drops the copy here, and the Label Studio task, of every photo the relay no longer holds: one its contributor
//   forgot (thicken contribute forget), or one 180 days old that was never reviewed (the relay's lifecycle rule);
// - records each review submitted since the last run as a line of review.jsonl, training mode's line (src/reviews.ts)
//   with "source": "contributed", and deletes a rejected photo from the relay, from Label Studio and from here;
// - brings the relay's new photos here, each checked again with sharp, and adds each to Label Studio, in
//   `003 · <profile> faces · contributed photos`, its contributor's faces as the proposal.
// Settings, from thicken's .env: THICKEN_INBOX_URL, the relay with its /thicken (https://contribute.wendellresearch.ai/thicken);
// THICKEN_INBOX_TOKEN, its ADMIN_TOKEN; THICKEN_INBOX_DIR (C:/thicken-data/contributed-inbox); LABEL_STUDIO_URL and
// LABEL_STUDIO_API_KEY. Neither token is printed or written. Nothing here goes to THICKEN_DATASET or an exam's folder,
// and nothing here touches incidents/: it asks only for the inbox's list, its photos and their deletion.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { addTask, api, decision, project, studio, type Annotation } from '../src/reviews.ts';
import { PROFILES } from '../src/thicken.ts';

const KEPT_MS = 180 * 86_400_000; // the relay's lifecycle rule on inbox/: a kept photo gone sooner was forgotten
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/; // the relay's ids, and nothing else, name files here
const INSTRUCTIONS = `<p>Photos people contributed to help train thicken, each as their thicken sent it, its faces as their
vision models proposed them. Anyone can send any corners: trust none. Experiment 003's review guidelines (v4) apply, as for
thicken runs. <b>keep</b> once every face sits on its face; <b>reject</b> a photo that can't give a good label or shouldn't be
here. Tick <b>someone else in frame</b> for anyone but a hand or arm holding it. A reject, or anyone else in frame, is
deleted from the relay, from Label Studio and from the inbox folder at the next pull.</p>`;

type Face = { face: string; corners: number[][]; score?: number };
/** A photo here waiting for its review: its task, and what its row will need. */
type Waiting = { task: number; project: number; profile: string; at: string; consent: string; thicken: string; faces: Face[] };

/** Why a photo from the relay isn't a 1000 x 1000 JPEG that sharp decodes whole within its limits; undefined if it is. */
async function check(jpeg: Buffer) {
  try {
    const image = sharp(jpeg, { limitInputPixels: 1024 * 1024, failOn: 'warning' });
    const { format, width, height } = await image.metadata();
    await image.raw().toBuffer(); // decoded whole: a truncated or broken file fails here
    return format === 'jpeg' && width === 1000 && height === 1000 ? undefined : `a ${width} x ${height} ${format}, not a 1000 x 1000 JPEG`;
  } catch (error) {
    return `sharp refused it (${(error as Error).message})`;
  }
}

export async function pull() {
  const { THICKEN_INBOX_URL: url, THICKEN_INBOX_TOKEN: token, THICKEN_INBOX_DIR: dir, THICKEN_DATASET: dataset } = process.env;
  if (!url || !token?.trim() || !dir) throw new Error("set THICKEN_INBOX_URL, THICKEN_INBOX_TOKEN and THICKEN_INBOX_DIR (thicken's .env)");
  const root = path.resolve(dir);
  const within = (outer: string, inner: string) => {
    const relative = path.relative(outer, inner);
    return !relative.startsWith('..') && !path.isAbsolute(relative);
  };
  // Contributed photos are practice at most (AI-014), never an exam's, and never in the training set thicken pushes.
  if (root.split(/[\\/]/).some((part) => part.toLowerCase() === 'exam')) throw new Error(`THICKEN_INBOX_DIR is ${root}: contributed photos never go in an exam's folder`);
  if (dataset && (within(path.resolve(dataset), root) || within(root, path.resolve(dataset)))) throw new Error(`THICKEN_INBOX_DIR is ${root}: contributed photos never go in THICKEN_DATASET`);

  const relay = async (method: string, route: string) => {
    const response = await fetch(`${url.replace(/\/$/, '')}/v1/admin/${route}`, { method, headers: { Authorization: `Bearer ${token.trim()}` } });
    if (!response.ok) throw new Error(`the relay answered ${response.status} to ${method} ${route.split('?')[0]}`);
    return response;
  };
  const listed = new Set<string>();
  for (let cursor = ''; ;) {
    const page: { ids: string[]; cursor?: string } = await (await relay('GET', `inbox?cursor=${encodeURIComponent(cursor)}`)).json();
    for (const id of page.ids) if (ID.test(id)) listed.add(id);
    if (!page.cursor) break;
    cursor = page.cursor;
  }

  const frames = path.join(root, 'frames');
  const waiting = path.join(root, 'waiting');
  const log = path.join(root, 'review.jsonl');
  await mkdir(frames, { recursive: true });
  await mkdir(waiting, { recursive: true });
  const frame = (id: string) => path.join(frames, `${id}.jpg`);
  const unlist = (task: number) => api('DELETE', `/api/tasks/${task}`).catch(() => {}); // a task already deleted there is fine
  const drop = async (id: string, task: number) => {
    await rm(frame(id), { force: true });
    await rm(path.join(waiting, `${id}.json`), { force: true });
    await unlist(task);
  };
  const told: string[] = [];

  // Forgotten after review: its line goes too. A model already trained on it keeps what it learned.
  const rows = existsSync(log) ? (await readFile(log, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
  const idOf = (row: { group: string }) => row.group.slice('contributed:'.length);
  const forgot = rows.filter((row) => row.verdict !== 'reject' && !listed.has(idOf(row)) && Date.now() - Date.parse(row.contributedAt) < KEPT_MS);
  for (const row of forgot) {
    await rm(frame(idOf(row)), { force: true });
    await unlist(row.labelStudio.task);
  }
  if (forgot.length) await writeFile(log, rows.filter((row) => !forgot.includes(row)).map((row) => `${JSON.stringify(row)}\n`).join(''));

  const pending = new Map<string, Waiting>();
  for (const file of await readdir(waiting)) pending.set(path.basename(file, '.json'), JSON.parse(await readFile(path.join(waiting, file), 'utf8')));
  const known = new Set([...rows.map(idOf), ...pending.keys()]);
  const run = randomUUID();
  const done = { added: 0, kept: 0, rejected: 0, dropped: forgot.length };
  const open = new Set<number>(); // projects with photos waiting
  for (const [id, p] of pending) {
    if (!listed.has(id)) { // forgotten, or 180 days unreviewed
      await drop(id, p.task);
      done.dropped++;
      continue;
    }
    const annotations: Annotation[] = await api('GET', `/api/tasks/${p.task}/annotations`);
    const last = annotations.sort((a, b) => a.updated_at.localeCompare(b.updated_at)).at(-1);
    const made = last && !last.was_cancelled ? decision(last, p.faces) : undefined; // none yet, or skipped: still waiting
    if (!made || 'error' in made) {
      if (made) told.push(`Label Studio task ${p.task} can't be used yet: ${made.error}. Fix it and update.`);
      open.add(p.project);
      continue;
    }
    const { someone, ...decided } = made;
    const row = {
      group: `contributed:${id}`, ...decided, ...(someone && { verdict: 'reject', someone }), file_name: `frames/${id}.jpg`, frame: 'letterbox-1000',
      source: 'contributed', contributedAt: p.at, consent: p.consent, profile: p.profile, proposal: { model_version: 'contributed', faces: p.faces },
      thicken: p.thicken, run, labelStudio: { url: studio(), project: p.project, task: p.task, annotation: last!.id },
    };
    if (row.verdict === 'reject') await relay('DELETE', `photos/${id}`); // first: if the relay fails, the next pull decides it again
    await appendFile(log, `${JSON.stringify(row)}\n`);
    if (row.verdict === 'reject') await drop(id, p.task);
    else await rm(path.join(waiting, `${id}.json`));
    done[row.verdict === 'reject' ? 'rejected' : 'kept']++;
  }

  const projects = new Map<string, number>();
  for (const id of listed) {
    if (known.has(id)) continue;
    const jpeg = Buffer.from(await (await relay('GET', `photos/${id}.jpg`)).arrayBuffer());
    const record = await (await relay('GET', `photos/${id}.json`)).json();
    const meta = record.meta ?? record; // the contributor's meta, nested or beside the relay's own fields
    const kind = PROFILES.find((p) => p.name === meta.profile && Object.keys(p.faces).length);
    const why = kind ? await check(jpeg) : `no profile "${meta.profile}" with faces here`;
    if (why || !kind) {
      await relay('DELETE', `photos/${id}`);
      told.push(`deleted ${id} from the relay: ${why}`);
      continue;
    }
    // Only the profile's own faces, four corners each, in the frame: rounded, as Label Studio gives them back.
    const faces: Face[] = (Array.isArray(meta.faces) ? meta.faces : [])
      .filter((f: any) => typeof f?.face === 'string' && Object.hasOwn(kind.faces, f.face) && Array.isArray(f.corners) && f.corners.length === 4
        && f.corners.every((p: any) => Array.isArray(p) && p.length === 2 && p.every((v: any) => Number.isFinite(v) && v >= 0 && v <= 1000)))
      .map((f: any) => ({ face: f.face, corners: f.corners.map((p: number[]) => p.map(Math.round)), ...(Number.isFinite(f.score) && { score: f.score }) }));
    const at = String(record.at ?? '');
    const where = projects.get(kind.name) ?? await project(kind, 'contributed photos', {
      description: `Photos people contributed to help train thicken, brought here by relay/pull.ts. Decisions go to ${log}.`, instructions: INSTRUCTIONS,
    });
    projects.set(kind.name, where);
    await writeFile(frame(id), jpeg);
    const task = await addTask(where, jpeg, {
      group: `contributed:${id}`, title: `contributed ${at.slice(0, 10)} · thicken ${meta.thicken}`,
      confidence: faces.map((f) => `${f.face} ${f.score ?? 'no score'}`).join('; ') || 'no faces proposed: draw what you see, or reject',
    }, faces.map((f) => ({ ...f, score: f.score ?? 0 })), 'contributed');
    const waits: Waiting = { task, project: where, profile: kind.name, at, consent: meta.consent, thicken: meta.thicken, faces };
    await writeFile(path.join(waiting, `${id}.json`), JSON.stringify(waits));
    open.add(where);
    done.added++;
  }

  process.stderr.write([
    `pull: ${done.added} new, ${done.kept} kept, ${done.rejected} rejected and deleted, ${done.dropped} no longer on the relay and deleted here`,
    ...told, ...[...open].map((id) => `review in Label Studio, then pull again: ${studio()}/projects/${id}/data`),
  ].map((line) => `${line}\n`).join(''));
  return done;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (existsSync('.env')) process.loadEnvFile(); // thicken's .env, as the CLI reads it
  await pull().catch((error) => {
    process.stderr.write(`pull: ${(error as Error).message}\n`);
    process.exitCode = 1;
  });
}
