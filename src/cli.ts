#!/usr/bin/env node
// thicken [badge|book|slab] <picture or PDF>... [-o out.glb] [options]
// thicken batch [badge|book|slab] <folder> [-o out-folder] [options]
// With no profile named, Thicken picks one per model (see src/thicken.ts).
// Writes each GLB and, beside it, a JSON sidecar of the same name.
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { batchItems, PROFILES, thicken, type Options, type Profile } from './thicken.ts';

const USAGE = `usage: thicken [badge|book|slab] <picture or PDF>... [-o out.glb]
       thicken batch [badge|book|slab] <folder> [-o out-folder]
  book   front [back] [spine]  [--isbn 978...] [--size WxHxD]  (mm; any left out are looked up or estimated)
  slab   front [back]          [--holder psa|psa-thick|bgs|cgc|sgc] [--size WxHxD]
  badge  artwork               [--width mm] [--depth mm]
Pictures: JPEG, PNG, HEIC, WebP, AVIF, GIF, TIFF, SVG, or a scanner app's PDF (one picture per page).
With no profile named: an ISBN barcode or --isbn means a book, a grader's QR code a slab, cut-out artwork a badge.
A book's barcode picture is its back cover; with no front, the cover comes from Open Library.
Batch: each picture or PDF in the folder is one model, and each subfolder one model from the
pictures in it; models go to <folder>/thicken unless -o says otherwise. A model already newer
than its pictures is left alone, hand edits and all; --force remakes it.`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', short: 'o' },
    isbn: { type: 'string' },
    size: { type: 'string' },
    holder: { type: 'string' },
    width: { type: 'string' },
    depth: { type: 'string' },
    force: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});
const batch = positionals[0] === 'batch';
if (batch) positionals.shift();
const profile = (PROFILES as readonly string[]).includes(positionals[0]) ? (positionals.shift() as Profile) : undefined;
const nothingGiven = positionals.length === 0 && (batch || !values.isbn);
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

/** Make one model and write it, with its sidecar beside it. */
async function build(files: string[], out?: string) {
  const { glb, sidecar } = await thicken(files, options);
  const named = files[0] ? path.join(path.dirname(files[0]), path.parse(files[0]).name) : `${sidecar.isbn}`;
  out ??= `${named}.glb`;
  await writeFile(out, glb);
  await writeFile(out.replace(/(\.glb)?$/i, '.json'), `${JSON.stringify(sidecar, null, 2)}\n`);
  console.log(`${out}: ${sidecar.profile}, ${sidecar.widthMm} × ${sidecar.heightMm} × ${sidecar.depthMm} mm`);
  for (const warning of sidecar.warnings) console.warn(`  warning: ${warning}`);
}

/** A model that exists and is newer than every picture it came from: a re-run leaves it, and any hand edits, alone. */
async function upToDate(out: string, files: string[]) {
  const model = await stat(out).catch(() => undefined);
  if (!model) return false;
  for (const file of files) if ((await stat(file)).mtimeMs > model.mtimeMs) return false;
  return true;
}

try {
  if (!batch) {
    await build(positionals, values.out);
  } else {
    if (values.isbn) throw new Error('--isbn names one book; a batch reads each book\'s own barcode');
    const [folder] = positionals;
    const outFolder = values.out ?? path.join(folder, 'thicken');
    const items = await batchItems(folder, outFolder);
    if (items.length === 0) throw new Error(`no pictures or PDFs in ${folder}`);
    await mkdir(outFolder, { recursive: true });
    // ponytail: one at a time, which is polite to Open Library and loses little (HEIC decoding is single-threaded wasm); a small pool if big batches drag.
    let [made, kept, failed] = [0, 0, 0];
    for (const { name, files } of items) {
      const out = path.join(outFolder, `${name}.glb`);
      if (!values.force && await upToDate(out, files)) {
        kept++;
        continue;
      }
      try {
        await build(files, out);
        made++;
      } catch (error) {
        failed++;
        console.error(`${name}: failed: ${(error as Error).message}`);
      }
    }
    console.log(`${made} made, ${kept} already up to date, ${failed} failed, in ${outFolder}`);
    process.exitCode = failed ? 1 : 0;
  }
} catch (error) {
  console.error(`thicken: ${(error as Error).message}`);
  process.exit(1);
}
