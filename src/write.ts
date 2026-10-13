// A model written to disk: the GLB, then its sidecar beside it, last, so a sidecar means a finished model. Shared by
// the CLI and the MCP server (src/mcp.ts).
import { createHash } from 'node:crypto';
import { mkdir, stat, writeFile } from 'node:fs/promises';
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

/** Make one model and write it beside its first picture (or at `out`), then its sidecar. */
export async function make(files: string[], options: Options, out?: string): Promise<{ out: string; sidecar: Sidecar }> {
  const { glb, sidecar } = await thicken(files, options);
  const named = files[0] ? path.join(path.dirname(files[0]), path.parse(files[0]).name) : `${sidecar.isbn}`;
  out ??= `${named}.glb`;
  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await writeFile(out, glb);
  await writeFile(sidecarOf(out), `${JSON.stringify({ ...sidecar, inputsKey: await inputsKey(files) }, null, 2)}\n`);
  return { out, sidecar };
}
