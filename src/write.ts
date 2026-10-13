// A model written to disk: the GLB, then its sidecar beside it, last, so a sidecar means a finished model. Shared by
// the CLI and the MCP server (src/mcp.ts).
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { thicken, type Options, type Sidecar } from './thicken.ts';

export const sidecarOf = (glb: string) => glb.replace(/(\.glb)?$/i, '.json');

/** What a model was made from: each picture's name, size and time (words, for lettering, as they are). A changed picture changes it, whatever its date. */
export async function inputsKey(files: string[]) {
  const parts = await Promise.all(files.map(async (file) => {
    const { size, mtimeMs } = await stat(file).catch(() => ({ size: 0, mtimeMs: 0 }));
    return [path.basename(file), size, mtimeMs];
  }));
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}

/** A thicken sidecar, safe to replace: one that says which profile made it, and which thicken. */
const isSidecar = (text: string) => {
  try {
    const json = JSON.parse(text);
    return typeof json?.profile === 'string' && typeof json?.build?.thicken === 'string';
  } catch {
    return false;
  }
};

/**
 * Make one model and write it beside its first picture (or at `out`), then its sidecar. The model is a .glb, and only
 * a model of ours is ever replaced: "package.glb" or a photo named "notes.jpg" would otherwise write over package.json
 * or notes.json, and an existing model with no sidecar of ours beside it is someone else's.
 */
export async function make(files: string[], options: Options, out?: string): Promise<{ out: string; sidecar: Sidecar }> {
  if (out !== undefined && !/\.glb$/i.test(out)) throw new Error(`the model goes in a .glb file, not ${out}`);
  const { glb, sidecar } = await thicken(files, options);
  const named = files[0] ? path.join(path.dirname(files[0]), path.parse(files[0]).name) : `${sidecar.isbn}`;
  out ??= `${named}.glb`;
  const json = sidecarOf(out);
  const ours = existsSync(json) && isSidecar(await readFile(json, 'utf8'));
  if (existsSync(json) && !ours) throw new Error(`${json} is there already and isn't a thicken sidecar: name the model something else`);
  if (existsSync(out) && !ours) throw new Error(`${out} is there already and isn't a thicken model (no sidecar of ours beside it): name the model something else`);
  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await writeFile(out, glb);
  await writeFile(sidecarOf(out), `${JSON.stringify({ ...sidecar, inputsKey: await inputsKey(files) }, null, 2)}\n`);
  return { out, sidecar };
}
