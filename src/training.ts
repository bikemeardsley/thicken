// Training mode, off unless THICKEN_DATASET names a folder. Then every question put to the vision models is
// kept there as a training example, for tuning a model to take the roster's first seat: the image exactly as
// sent, and a line in metadata.jsonl with the prompt, each model's answer and the label (the settled answer, its
// corners snapped onto the real edges), all in the image's own 0-1000 pixels. That is the layout Hugging Face's
// imagefolder loader reads. Thicken only collects; the training happens elsewhere.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const trainingOn = () => Boolean(process.env.THICKEN_DATASET);

let writing = Promise.resolve();

/** One example kept: the image under its own hash (once, however often it's asked about), the rest as a line. */
export function keep(jpeg: Buffer, example: object): Promise<void> {
  const dir = process.env.THICKEN_DATASET!;
  const file_name = `${createHash('sha256').update(jpeg).digest('hex').slice(0, 16)}.jpg`;
  // One at a time, so lines from photos looked at together never interleave.
  const done = writing.then(async () => {
    await mkdir(dir, { recursive: true });
    if (!existsSync(path.join(dir, file_name))) await writeFile(path.join(dir, file_name), jpeg);
    await appendFile(path.join(dir, 'metadata.jsonl'), `${JSON.stringify({ file_name, ...example })}\n`);
  });
  writing = done.catch(() => {});
  return done;
}
