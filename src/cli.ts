#!/usr/bin/env node
// thicken [profile] <picture, PDF or video>... [-o out.glb] [--preview] [options]
// thicken batch [profile] <folder> [-o out-folder] [--preview] [--force] [options]
// thicken preview <model.glb or folder>...
// thicken mcp    (the MCP server on stdio, for AI agents: src/mcp.ts)
// With no profile named, thicken picks one per model (see src/thicken.ts).
// Writes each GLB and, beside it, a JSON sidecar of the same name.
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { batchItems, PROFILES, type Options, type Sidecar } from './thicken.ts';
import { inputsKey, make, sidecarOf } from './write.ts';

const USAGE = `usage: thicken [${PROFILES.map((p) => p.name).join('|')}] <picture, PDF or video>... [-o out.glb] [--preview]
       thicken batch [profile] <folder> [-o out-folder] [--preview] [--force]
       thicken preview <model.glb or folder>...
       thicken mcp    (the MCP server on stdio, for AI agents)
Profiles (src/profiles), each from:
${PROFILES.map((p) => `  ${p.name.padEnd(8)} ${p.input.replace(/`/g, '')}`).join('\n')}
Options: --size WxHxD (mm; any left out are looked up or estimated), --isbn 978... (a book),
  --holder psa|psa-thick|psa-tall|bgs|cgc|cgc-tall|sgc|tag (a slab), --pt N (a thick card's points:
  55, 75, 100, 130, 180), --width and --depth (a badge, in mm).
Pictures: JPEG, PNG, HEIC, WebP, AVIF, GIF, TIFF, SVG, or a scanner app's PDF (one picture per page).
Video (MOV, MP4), with a vision roster and ffmpeg installed: a handful of its sharpest frames go
to the models as more pictures, and show any face no photo does.
With no profile named: an ISBN barcode or --isbn means a book, a grader's QR code (or a cert
barcode on a holder-shaped photo) a slab, cut-out artwork a badge; else, with vision, the
models say which it is (box for anything else box-shaped).
Batch: each picture, PDF or video in the folder is one model, and each subfolder one model from
the files in it; models go to <folder>/thicken unless -o says otherwise. A model already made
from exactly these pictures is left alone, hand edits and all; --force remakes it. Afterwards
it lists the faces still to photograph.
--preview, or the preview command, writes <name>.preview.png beside each model (needs Chrome or Edge).
Vision: with THICKEN_VISION_URL (an OpenAI-compatible endpoint), THICKEN_VISION_KEY and
THICKEN_VISION_MODELS (primary,peer,backups...) set, or in a .env file here, photos needn't be
cropped: the models find each face, and it is cut out and straightened.
Training mode (off by default): with THICKEN_DATASET=<folder> also set, every question put to
the vision models is kept there as a training example.`;

// Settings such as the vision roster can live in a .env file where thicken is run.
if (existsSync('.env')) process.loadEnvFile();

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', short: 'o' },
    isbn: { type: 'string' },
    size: { type: 'string' },
    holder: { type: 'string' },
    pt: { type: 'string' },
    width: { type: 'string' },
    depth: { type: 'string' },
    preview: { type: 'boolean' },
    force: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});
const command = ['batch', 'preview', 'mcp'].includes(positionals[0]) ? positionals.shift() : 'make';
const profile = command !== 'preview' && PROFILES.some((p) => p.name === positionals[0]) ? positionals.shift() : undefined;
const nothingGiven = positionals.length === 0 && command !== 'mcp' && (command !== 'make' || !values.isbn);
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
  pt: mm(values.pt),
  widthMm: mm(values.width),
  depthMm: mm(values.depth),
};

const readSidecar = (glb: string): Promise<Sidecar | undefined> =>
  readFile(sidecarOf(glb), 'utf8').then((text) => JSON.parse(text), () => undefined);

/** Make one model and write it (src/write.ts), and say so. */
async function build(files: string[], to?: string) {
  const { out, sidecar } = await make(files, options, to);
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
  if (command === 'mcp') {
    await (await import('./mcp.ts')).serve(); // stdio stays open: the server answers until the agent closes it
  } else if (command === 'make') {
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
    if (PROFILES.find((p) => p.name === profile)?.words) throw new Error(`${profile} is made from words, not a folder: thicken ${profile} <words>`);
    const [folder] = positionals;
    const outFolder = values.out ?? path.join(folder, 'thicken');
    const items = await batchItems(folder, outFolder);
    if (items.length === 0) throw new Error(`no pictures, PDFs or videos in ${folder}`);
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
