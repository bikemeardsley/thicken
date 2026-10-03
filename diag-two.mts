// TEMPORARY, to diagnose the preview on Windows CI: the real preview (two views and a caption) of the slab fixture,
// in the browser named (chrome or msedge), any further flags passed on; the picture is saved in diag/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { thicken } from './src/thicken.ts';

const [channel, ...extra] = process.argv.slice(2);
const launch = chromium.launch.bind(chromium);
chromium.launch = (options = {}) => launch({ ...options, channel, args: [...(options.args ?? []), ...extra] });
const { startPreview } = await import('./src/preview.ts');
mkdirSync('diag', { recursive: true });
const { glb, sidecar } = await thicken(['test/fixtures/slab.jpg']);
writeFileSync(`diag/two-${channel}.glb`, glb);
writeFileSync(`diag/two-${channel}.json`, JSON.stringify(sidecar));
const preview = await startPreview();
const png = await preview.render(`diag/two-${channel}.glb`);
await preview.close();
const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
const at = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
console.log(channel, JSON.stringify({ flags: extra, png, size: [info.width, info.height], frontMiddle: at(200, 300), backMiddle: at(600, 300) }));
