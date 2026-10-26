// Training mode, off unless THICKEN_DATASET names a folder. Then every question put to the vision models is
// kept there as a training example, for tuning a model to take the roster's first seat: the image exactly as
// sent, and a line in metadata.jsonl with the prompt, each model's answer and the label (the settled answer, its
// corners snapped onto the real edges), all in the image's own 0-1000 pixels. Each profile's faces go in a folder
// of their own (slab/, book/), and which-object-is-it questions in identify/, each folder the layout Hugging Face's
// imagefolder loader reads, so a model can be tuned on one profile alone. Thicken only collects; the training
// happens elsewhere.
//
// Each line also says what it's a question about, for splitting a set by object and checking it by hand: the run
// and the object (its profile and what its codes said: a cert, an ISBN), the photo it came from (file, page, video
// time), where that photo sits in the image sent, what the build made of it, and the photo itself as loaded
// (upright, metadata stripped) in .originals/, which the loader skips. Lines are written when the run ends, so
// they know what came of it, a failed run included.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { Picture } from './image.ts';

export const trainingOn = () => Boolean(process.env.THICKEN_DATASET);

/** A question's example, held by the answer it settled (a Sight or an Identity) until the run knows what came of it. */
export interface Held { jpeg: Buffer; picture: Picture; sent: { left: number; top: number; scale: number }; example: object }
export const held = new WeakMap<object, Held>();

let writing = Promise.resolve();

/** One image or photo kept once, however often it's asked about, under its own hash. */
async function once(dir: string, jpeg: Buffer): Promise<string> {
  const file = path.join(dir, `${createHash('sha256').update(jpeg).digest('hex').slice(0, 16)}.jpg`);
  await mkdir(dir, { recursive: true });
  if (!existsSync(file)) await writeFile(file, jpeg);
  return path.basename(file);
}

/**
 * Every example the run held, as lines: `answered` the Sights and Identity it asked about, `run` what's known of the
 * object, `roles` what the build made of each photo (the sidecar's pictures), and `failed` why it stopped, if it did.
 */
export function keepRun(answered: (object | undefined)[], run: { thicken: string; object: object; roles?: { file: string; page?: number; time?: number; role: string }[]; failed?: string }): Promise<void> {
  const id = randomUUID();
  const at = new Date().toISOString();
  // One run at a time, so lines from runs side by side never interleave.
  const done = writing.then(async () => {
    for (const answer of answered) {
      const kept = answer && held.get(answer);
      if (!kept) continue;
      const { jpeg, picture, sent, example } = kept;
      const dir = path.join(process.env.THICKEN_DATASET!, (example as { profile?: string }).profile || 'identify');
      const { file, page, time } = picture.source;
      const file_name = await once(dir, jpeg);
      const original = `.originals/${await once(path.join(dir, '.originals'),
        await sharp(picture.data, { raw: { width: picture.width, height: picture.height, channels: 4 } }).jpeg({ quality: 92 }).toBuffer())}`;
      const used = run.roles?.filter((r) => r.file === file && r.page === page && r.time === time).map(({ role }) => role);
      const line = { file_name, ...example, run: id, at, thicken: run.thicken, object: run.object, source: picture.source, sent, original, ...(used && { used }), ...(run.failed && { failed: run.failed }) };
      await appendFile(path.join(dir, 'metadata.jsonl'), `${JSON.stringify(line)}\n`);
    }
  });
  writing = done.catch(() => {});
  return done;
}
