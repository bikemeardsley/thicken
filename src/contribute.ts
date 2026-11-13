// Contributing photos to the corner model thicken uses (off unless the user says yes). Once a model and its sidecar
// are written, each photo it was made from goes to thicken's relay as the frame the vision models see (vision.ts
// letterbox: 1000 x 1000, pixels only, no metadata), with the faces found in it in that frame's pixels, and nothing
// else of the photo, the run or the machine (PRIVACY.md#contributing-photos). The question is put once: by the CLI at
// a terminal, by an MCP client that can ask (elicitation), or at install as THICKEN_CONTRIBUTE; the answer is kept in
// ~/.thicken/config.json. Only for thicken's own book, box, card and slab profiles, never a user's own, never for
// Mike's own runs (THICKEN_DATASET: training mode), and never photos the caller says aren't the user's
// (THICKEN_PHOTOS=third-party, as an app sets it for a seller's or a grader's): the yes is for photos that are theirs.
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type { Picture } from './image.ts';
import type { Sidecar } from './thicken.ts';
import { photos } from './training.ts';
import { letterbox, type Sight } from './vision.ts';

// The relay (relay/README.md); set empty, contributing is off (the tests). Read when used, not on import: the CLI loads
// .env after its imports.
const relay = () => (process.env.THICKEN_CONTRIBUTE_URL ?? 'https://contribute.wendellresearch.ai/thicken').replace(/\/$/, '');

const PROMPT = '2026-11-08'; // the question's version, sent with each photo as `consent`
export const QUESTION = `Contribute photos to the corner model thicken uses?

That model finds the corners of books, cards, slabs and boxes
in photos, and it learns from photos like yours. No account or
name is attached; you release your rights in them as CC0;
thicken's author reviews each one before any use.
Not sent: file names, camera details, location.

You must be 16 or older and the photos must be yours.
Change it any time: thicken contribute off
Details: https://github.com/bikemeardsley/thicken/blob/main/PRIVACY.md#contributing-photos`;
export const ASK = 'Contribute photos? (yes/no): ';
const OUTBOX_MAX = 50;
const OUTBOX_DAYS = 30;

const home = (...parts: string[]) => path.join(homedir(), '.thicken', ...parts);
type Said = 'yes' | 'no' | 'ended';

const config = (): Promise<{ contribute?: { answer: Said; prompt: string; at: string; via: string } }> =>
  readFile(home('config.json'), 'utf8').then(JSON.parse).catch(() => ({}));

/** Keeps the answer, beside anything else in config.json. */
async function answer(said: Said, via: string): Promise<void> {
  const all = await config();
  await mkdir(home(), { recursive: true });
  await writeFile(home('config.json'), `${JSON.stringify({ ...all, contribute: { answer: said, prompt: PROMPT, at: new Date().toISOString(), via } }, null, 2)}\n`);
}

/**
 * The answer, the version of the question it answered, and where it came from. THICKEN_CONTRIBUTE (yes or no; ask or
 * unset leaves it to the file) outranks a yes in the file but not a no, so `thicken contribute off` stops it wherever
 * the yes was given.
 */
export async function state(): Promise<{ answer?: Said; prompt?: string; from: string }> {
  const saved = (await config()).contribute;
  const env = process.env.THICKEN_CONTRIBUTE?.trim().toLowerCase();
  if ((env === 'yes' || env === 'no') && saved?.answer !== 'no' && saved?.answer !== 'ended') {
    return { answer: env, prompt: PROMPT, from: `THICKEN_CONTRIBUTE=${env}, the plugin's or extension's setting` };
  }
  return saved ? { ...saved, from: `${saved.answer} via ${saved.via} on ${saved.at.slice(0, 10)}, in ${home('config.json')}` } : { from: 'not asked yet' };
}

/** What a run made its model from, held by its sidecar (src/thicken.ts) until the model is written. */
const held = new WeakMap<object, { profile: string; inputs: string[]; pictures: Picture[]; sights?: Sight[] }>();
const CORNERED = ['book', 'box', 'card', 'slab']; // the corner model's objects

/** Held for a run of one of thicken's own profiles (`builtIn`: from src/profiles, never one of the user's) the model learns from. */
export function hold(sidecar: object, profile: string, builtIn: boolean, inputs: string[], pictures: Picture[], sights?: Sight[]): void {
  if (relay() && builtIn && CORNERED.includes(profile) && !process.env.THICKEN_DATASET && photos() !== 'third-party') {
    held.set(sidecar, { profile, inputs, pictures, sights });
  }
}

/** The question at a terminal, until it's answered yes or no (or y or n, any case); undefined if the input ends first. */
export async function question(input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Promise<'yes' | 'no' | undefined> {
  output.write(`\n${QUESTION}\n\n${ASK}`);
  for await (const line of createInterface({ input })) {
    const said = line.trim().toLowerCase();
    if (said === 'yes' || said === 'y') return 'yes';
    if (said === 'no' || said === 'n') return 'no';
    output.write(ASK);
  }
  return undefined;
}

/**
 * Once the model is written: its photos sent, if the user said yes. Not asked yet, `ask` puts the question: a yes or
 * no it gives is kept, and anything else (an MCP client's note) is handed back. Sending is silent, refusals and
 * errors included (`thicken contribute list` shows what was sent). It never fails the build, and the relay's
 * timeouts (5 s to ask whether it's open, 15 s a photo) are all it can delay it by.
 */
export async function contribute(sidecar: Sidecar, via: 'cli' | 'mcp', ask?: () => Promise<string | undefined>): Promise<string | undefined> {
  const run = held.get(sidecar);
  if (!run) return undefined;
  try {
    let { answer: said, prompt } = await state();
    if (!said) {
      const given = await ask?.().catch(() => undefined);
      if (given !== 'yes' && given !== 'no') return given;
      await answer(given, via);
      [said, prompt] = [given, PROMPT];
    }
    if (said !== 'yes') return undefined;

    // This run's photos join the outbox, which is sent oldest first: what a busy or unreachable relay left last time.
    // A frame already sent, refused or waiting (the same photo made again) isn't sent twice.
    const outbox = home('outbox');
    await mkdir(outbox, { recursive: true });
    const log = (await readFile(home('contributed.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean);
    const known = new Set([...log.map((line) => JSON.parse(line).sha256), ...(await readdir(outbox)).map((name) => name.slice(name.indexOf('-') + 1, -5))]);
    const roles = (sidecar.pictures ?? []) as { file: string; page?: number; time?: number; role: string }[];
    for (const [i, picture] of run.pictures.entries()) {
      const { file, page, time } = picture.source;
      // A photo the build left unused (an interior page, a stray shot) isn't one the model was made from.
      if (roles.length && !roles.some((r) => r.file === file && r.page === page && r.time === time && r.role !== 'unused')) continue;
      const frame = await letterbox(picture);
      const sha256 = createHash('sha256').update(frame.jpeg).digest('hex');
      if (known.has(sha256)) continue;
      known.add(sha256);
      const sight = run.sights?.[i];
      const answered = new Set(sight?.answers.filter((a) => !a.error).map(({ model }) => model));
      const faces = (sight?.faces ?? []).map(({ face, corners, by }) => ({
        face, corners: corners.map((p) => frame.toSent(p).map((v) => Math.min(Math.max(Math.round(v), 0), 1000))),
        // The part of the seats that answered which agreed on it.
        ...(answered.size && !by.includes('given') && { score: Math.round((by.filter((m) => answered.has(m)).length / answered.size) * 100) / 100 }),
      }));
      const meta = { v: 1, thicken: (sidecar.build as { thicken: string }).thicken, consent: prompt, profile: run.profile, faces };
      const local = path.resolve(run.inputs.find((input) => path.basename(input) === file) ?? file);
      await writeFile(path.join(outbox, `${Date.now()}-${sha256}.json`), JSON.stringify({ meta, file: local, jpeg: frame.jpeg.toString('base64') }));
    }
    const names = (await readdir(outbox)).filter((name) => name.endsWith('.json')).sort();
    const kept = names.filter((name) => Date.now() - parseInt(name, 10) < OUTBOX_DAYS * 86_400_000).slice(-OUTBOX_MAX);
    for (const name of names) if (!kept.includes(name)) await rm(path.join(outbox, name), { force: true });

    const status = await fetch(`${relay()}/v1/status`, { signal: AbortSignal.timeout(5000) }).catch(() => undefined);
    if (status?.status === 410) { // contributing has ended for good
      await answer('ended', via);
      await rm(outbox, { recursive: true, force: true });
      return undefined;
    }
    if (!(status?.ok && (await status.json().catch(() => ({}))).accepting === true)) return undefined;
    for (const name of kept) {
      const { meta, file, jpeg } = JSON.parse(await readFile(path.join(outbox, name), 'utf8'));
      const body = new FormData();
      body.append('photo', new Blob([new Uint8Array(Buffer.from(jpeg, 'base64'))], { type: 'image/jpeg' }), 'photo.jpg');
      body.append('meta', JSON.stringify(meta));
      const response = await fetch(`${relay()}/v1/photos`, { method: 'POST', body, headers: { 'User-Agent': `thicken/${meta.thicken}` }, signal: AbortSignal.timeout(15_000) })
        .catch(() => undefined);
      const code = response?.status ?? 0; // 0: unreachable
      // Unreachable, busy or rate-limited: this one and the rest wait in the outbox for the next run.
      if (code !== 201 && (code < 400 || code >= 500 || code === 429)) break;
      // Sent, or refused (any other 4xx) and dropped: either way logged, where `thicken contribute list` shows it.
      const { id = null, reason } = await response!.json().catch(() => ({}));
      const sha256 = name.slice(name.indexOf('-') + 1, -5);
      const line = { id: code === 201 ? id : null, at: new Date().toISOString(), profile: meta.profile, file, sha256, ...(code !== 201 && { rejected: String(reason ?? code) }) };
      await appendFile(home('contributed.jsonl'), `${JSON.stringify(line)}\n`);
      await rm(path.join(outbox, name), { force: true });
    }
  } catch {
    // Silent, as sending is: the model is made either way, and what was left waits in the outbox.
  }
  return undefined;
}

/** thicken contribute [on|off|list|forget <id>|forget --all]: the answer, changed or said; what was contributed, listed or deleted. */
export async function contributeCommand([what, id]: string[], all?: boolean): Promise<void> {
  const log = home('contributed.jsonl');
  const lines: { id: string | null; at: string; profile: string; file: string; rejected?: string }[] = (await readFile(log, 'utf8').catch(() => ''))
    .split('\n').filter(Boolean).map((line) => JSON.parse(line));
  if (what === 'list') {
    for (const line of lines) console.log(`${line.id ?? `rejected (${line.rejected})`}  ${line.at}  ${line.profile}  ${line.file}`);
    if (!lines.length) console.log('no photos contributed');
    return;
  }
  if (what === 'forget') {
    if (!all && !/^[0-9a-f-]{36}$/i.test(id ?? '')) throw new Error('thicken contribute forget <id> (thicken contribute list gives them), or forget --all');
    if (!relay()) throw new Error('THICKEN_CONTRIBUTE_URL is empty: it names the relay to delete them from');
    const ids = all ? lines.flatMap((line) => line.id ?? []) : [id];
    const gone = new Set<string>();
    for (const one of ids) {
      // The relay answers 204 whether or not it has the photo, so it can't be asked which ids exist.
      const response = await fetch(`${relay()}/v1/photos/${one}`, { method: 'DELETE', signal: AbortSignal.timeout(15_000) }).catch(() => undefined);
      if (response?.ok) gone.add(one);
    }
    // --all forgets the refused too, which the relay never kept.
    if (lines.length) await writeFile(log, lines.filter((line) => (line.id ? !gone.has(line.id) : !all)).map((line) => `${JSON.stringify(line)}\n`).join(''));
    console.log(`forgot ${gone.size} photo${gone.size === 1 ? '' : 's'}: deleted from the relay and from ${log}`);
    if (gone.size < ids.length) {
      console.error(`thicken: the relay couldn't be reached for ${ids.length - gone.size}: run it again`);
      process.exitCode = 1;
    }
    return;
  }
  if (what === 'on' || what === 'off') await answer(what === 'on' ? 'yes' : 'no', 'cli');
  else if (what !== undefined) throw new Error('thicken contribute [on|off|list|forget <id>|forget --all]');
  const { answer: said, from } = await state();
  console.log(`contributing photos to the corner model thicken uses: ${said === 'yes' ? 'on' : said === 'ended' ? 'ended for good' : 'off'} (${from})${
    relay() ? '' : '; nothing is asked or sent until thicken\'s relay is open'}`);
  // For an agent asked to put the question: the words to pass on.
  if (!said && relay()) console.log(`\nthicken asks this once:\n\n${QUESTION}\n\n${ASK}`);
}
