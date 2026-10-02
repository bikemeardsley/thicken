#!/usr/bin/env node
// thicken [badge|book|slab] <picture or PDF>... [-o out.glb] [--preview] [options]
// thicken batch [badge|book|slab] <folder> [-o out-folder] [--preview] [--force] [options]
// thicken preview <model.glb or folder>...
// With no profile named, Thicken picks one per model (see src/thicken.ts).
// Writes each GLB and, beside it, a JSON sidecar of the same name.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { batchItems, PROFILES, thicken, type Options, type Profile, type Sidecar } from './thicken.ts';

const USAGE = `usage: thicken [badge|book|slab] <picture or PDF>... [-o out.glb] [--preview]
       thicken batch [badge|book|slab] <folder> [-o out-folder] [--preview] [--force]
       thicken preview <model.glb or folder>...
  book   front back spine (any order) [--isbn 978...] [--size WxHxD]  (mm; any left out are looked up or estimated)
  slab   front [back]  [--holder psa|psa-thick|psa-tall|bgs|cgc|sgc|tag] [--size WxHxD]
  badge  artwork       [--width mm] [--depth mm]
Pictures: JPEG, PNG, HEIC, WebP, AVIF, GIF, TIFF, SVG, or a scanner app's PDF (one picture per page).
With no profile named: an ISBN barcode or --isbn means a book, a grader's QR code (or a cert
barcode on a holder-shaped photo) a slab, cut-out artwork a badge.
Batch: each picture or PDF in the folder is one model, and each subfolder one model from the
pictures in it; models go to <folder>/thicken unless -o says otherwise. A model already made
from exactly these pictures is left alone, hand edits and all; --force remakes it. Afterwards
it lists the faces still to photograph.
--preview, or the preview command, writes <name>.preview.png beside each model (needs Chrome or Edge).`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', short: 'o' },
    isbn: { type: 'string' },
    size: { type: 'string' },
    holder: { type: 'string' },
    width: { type: 'string' },
    depth: { type: 'string' },
    preview: { type: 'boolean' },
    force: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});
const command = positionals[0] === 'batch' || positionals[0] === 'preview' ? positionals.shift() : 'make';
const profile = command !== 'preview' && (PROFILES as readonly string[]).includes(positionals[0]) ? (positionals.shift() as Profile) : undefined;
const nothingGiven = positionals.length === 0 && (command !== 'make' || !values.isbn);
if (values.help || nothingGiven) {
  console.error(USAGE);
  process.exit(values.help ? 0 : 1);
}

const mm = (value?: string) => (value === undefined ? undefined : Number(value));
const options: Options = {
  profile,
  isbn: values.isbn,
  sizeMm: values.size?.split(/x/i).map((n) => (n === '' ? undefined : Number(n))) as number[] | undefined,
  holder: values.holder,
  widthMm: mm(values.width),
  depthMm: mm(values.depth),
};

const sidecarOf = (glb: string) => glb.replace(/(\.glb)?$/i, '.json');
const readSidecar = (glb: string): Promise<Sidecar | undefined> =>
  readFile(sidecarOf(glb), 'utf8').then((text) => JSON.parse(text), () => undefined);

/** What a model was made from: each picture's name, size and time. A changed picture changes it, whatever its date. */
async function inputsKey(files: string[]) {
  const parts = await Promise.all(files.map(async (file) => {
    const { size, mtimeMs } = await stat(file);
    return [path.basename(file), size, mtimeMs];
  }));
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}

/** Make one model and write it, then its sidecar (last, so a sidecar means a finished model). */
async function build(files: string[], out?: string) {
  const { glb, sidecar } = await thicken(files, options);
  const named = files[0] ? path.join(path.dirname(files[0]), path.parse(files[0]).name) : `${sidecar.isbn}`;
  out ??= `${named}.glb`;
  await writeFile(out, glb);
  await writeFile(sidecarOf(out), `${JSON.stringify({ ...sidecar, inputsKey: await inputsKey(files) }, null, 2)}\n`);
  console.log(`${out}: ${sidecar.profile}, ${sidecar.widthMm} × ${sidecar.heightMm} × ${sidecar.depthMm} mm`);
  for (const warning of sidecar.warnings) console.warn(`  warning: ${warning}`);
  return { out, sidecar };
}

/** A model already made from exactly these pictures: a re-run leaves it, and any hand edits, alone. */
async function upToDate(out: string, files: string[]) {
  return existsSync(out) && (await readSidecar(out))?.inputsKey === await inputsKey(files);
}

/**
 * A previewer if a browser can be had; without one, models are still made and
 * the reason is said once. Loaded only when asked for: the browser driver
 * takes seconds to load, which every run would otherwise pay.
 */
async function previewer() {
  try {
    const { startPreview, previewPath } = await import('./preview.ts');
    return { ...(await startPreview()), previewPath };
  } catch (error) {
    console.warn(`  warning: no previews: ${(error as Error).message}`);
    return undefined;
  }
}

try {
  if (command === 'make') {
    const { out, sidecar } = await build(positionals, values.out);
    if (sidecar.review.length) console.log(`  to review: ${sidecar.review.join('; ')}`);
    const preview = values.preview ? await previewer() : undefined;
    if (preview) {
      await preview.render(out)
        .then((png) => console.log(`  preview: ${png}`), (error: Error) => console.warn(`  warning: no preview: ${error.message}`))
        .finally(() => preview.close());
    }
  } else if (command === 'preview') {
    const models: string[] = [];
    for (const target of positionals) {
      if ((await stat(target)).isDirectory()) {
        models.push(...(await readdir(target)).filter((name) => /\.glb$/i.test(name)).map((name) => path.join(target, name)));
      } else {
        models.push(target);
      }
    }
    const { startPreview } = await import('./preview.ts');
    const preview = await startPreview();
    try {
      for (const model of models) {
        try {
          console.log(await preview.render(model));
        } catch (error) {
          process.exitCode = 1;
          console.error(`${model}: no preview: ${(error as Error).message}`);
        }
      }
    } finally {
      await preview.close();
    }
  } else {
    if (values.isbn) throw new Error('--isbn names one book; a batch reads each book\'s own barcode');
    const [folder] = positionals;
    const outFolder = values.out ?? path.join(folder, 'thicken');
    const items = await batchItems(folder, outFolder);
    if (items.length === 0) throw new Error(`no pictures or PDFs in ${folder}`);
    await mkdir(outFolder, { recursive: true });
    const preview = values.preview ? await previewer() : undefined;
    // ponytail: one at a time, which is polite to Open Library and loses little (HEIC decoding is single-threaded wasm); a small pool if big batches drag.
    let [made, kept, failed] = [0, 0, 0];
    const toReview: string[] = [];
    for (const { name, files } of items) {
      const out = path.join(outFolder, `${name}.glb`);
      const current = !values.force && await upToDate(out, files);
      if (current) {
        kept++;
      } else {
        try {
          await build(files, out);
          made++;
        } catch (error) {
          failed++;
          console.error(`${name}: failed: ${(error as Error).message}`);
          continue;
        }
      }
      // A preview that can't be drawn is a warning: the model itself is made.
      if (preview && (!current || !existsSync(preview.previewPath(out)))) {
        await preview.render(out).catch((error: Error) => console.warn(`  ${name}: no preview: ${error.message}`));
      }
      const review = (await readSidecar(out))?.review ?? [];
      if (review.length) toReview.push(`  ${name}: ${review.join('; ')}`);
    }
    await preview?.close();
    console.log(`${made} made, ${kept} already up to date, ${failed} failed, in ${outFolder}`);
    if (toReview.length) {
      console.log(`to review (stand-ins and guesses; add photos to the item's subfolder, or --size, then re-run):\n${toReview.join('\n')}`);
    }
    process.exitCode = failed ? 1 : 0;
  }
} catch (error) {
  console.error(`thicken: ${(error as Error).message}`);
  process.exit(1);
}
