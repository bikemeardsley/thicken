#!/usr/bin/env node
// thicken [badge|book|slab] <picture or PDF>... [-o out.glb] [options]
// With no profile named, Thicken picks one (see src/thicken.ts). Writes the
// GLB and, beside it, a JSON sidecar of the same name.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { PROFILES, thicken, type Profile } from './thicken.ts';

const USAGE = `usage: thicken [badge|book|slab] <picture or PDF>... [-o out.glb]
  book   front [back] [spine]  [--isbn 978...] [--size WxHxD]  (mm; any left out are looked up or estimated)
  slab   front [back]          [--holder psa|psa-thick|bgs|cgc|sgc] [--size WxHxD]
  badge  artwork               [--width mm] [--depth mm]
Pictures: JPEG, PNG, HEIC, WebP, AVIF, GIF, TIFF, SVG, or a scanner app's PDF (one picture per page).
With no profile named: an ISBN barcode or --isbn means a book, a grader's QR code a slab, cut-out artwork a badge.`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', short: 'o' },
    isbn: { type: 'string' },
    size: { type: 'string' },
    holder: { type: 'string' },
    width: { type: 'string' },
    depth: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});
const profile = (PROFILES as readonly string[]).includes(positionals[0]) ? (positionals.shift() as Profile) : undefined;
if (values.help || (positionals.length === 0 && !values.isbn)) {
  console.error(USAGE);
  process.exit(values.help ? 0 : 1);
}

const mm = (value?: string) => (value === undefined ? undefined : Number(value));
try {
  const { glb, sidecar } = await thicken(positionals, {
    profile,
    isbn: values.isbn,
    sizeMm: values.size?.split(/x/i).map((n) => (n === '' ? undefined : Number(n))) as number[] | undefined,
    holder: values.holder,
    widthMm: mm(values.width),
    depthMm: mm(values.depth),
  });
  const named = positionals[0] ? path.join(path.dirname(positionals[0]), path.parse(positionals[0]).name) : `${sidecar.isbn}`;
  const out = values.out ?? `${named}.glb`;
  await writeFile(out, glb);
  await writeFile(out.replace(/(\.glb)?$/i, '.json'), `${JSON.stringify(sidecar, null, 2)}\n`);
  console.log(`${out}: ${sidecar.profile}, ${sidecar.widthMm} × ${sidecar.heightMm} × ${sidecar.depthMm} mm`);
  for (const warning of sidecar.warnings) console.warn(`warning: ${warning}`);
} catch (error) {
  console.error(`thicken: ${(error as Error).message}`);
  process.exit(1);
}
