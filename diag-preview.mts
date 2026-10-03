// TEMPORARY, to diagnose the preview on Windows CI: draws the slab fixture as the preview does, in the browser named,
// and saves screenshots after several waits, with the WebGL renderer, the browser's GPU status and the middle pixel.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { thicken } from './src/thicken.ts';

const require = createRequire(import.meta.url);
const VIEWER = require.resolve('@google/model-viewer/dist/model-viewer.min.js');
const channel = process.argv[2];
mkdirSync('diag', { recursive: true });
const { glb } = await thicken(['test/fixtures/slab.jpg']);
const browser = await chromium.launch({ channel, args: ['--enable-unsafe-swiftshader'] });
const status = await browser.newPage();
await status.goto('chrome://gpu').catch(() => {});
writeFileSync(`diag/${channel}-gpu.txt`, await status.evaluate(() => document.body.innerText).catch((e) => String(e)));
const page = await browser.newPage({ viewport: { width: 400, height: 540 } });
page.on('console', (m) => console.log(channel, 'console', m.type(), m.text().slice(0, 300)));
await page.route('http://thicken.local/**', (route) => {
  const { pathname } = new URL(route.request().url());
  if (pathname === '/model-viewer.js') return route.fulfill({ path: VIEWER, contentType: 'text/javascript' });
  if (pathname === '/model.glb') return route.fulfill({ body: Buffer.from(glb), contentType: 'model/gltf-binary' });
  return route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>body{margin:0;background:#9aa4ae}model-viewer{width:400px;height:540px;display:block}</style>
<script type="module" src="/model-viewer.js"></script><model-viewer camera-orbit="35deg 72deg auto" tone-mapping="neutral" shadow-intensity="1" interaction-prompt="none"></model-viewer>` });
});
await page.goto('http://thicken.local/');
await page.waitForFunction(() => customElements.get('model-viewer'));
const info = await page.evaluate(async () => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  const renderer = gl ? String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : 'no webgl2';
  const view = document.querySelector('model-viewer') as HTMLElement & { src: string; modelIsVisible: boolean };
  await new Promise((resolve, reject) => { view.addEventListener('load', resolve, { once: true }); view.addEventListener('error', reject, { once: true }); view.src = '/model.glb'; });
  const t0 = performance.now();
  while (!view.modelIsVisible && performance.now() - t0 < 30000) await new Promise(requestAnimationFrame);
  return { renderer, visible: view.modelIsVisible, waitedMs: Math.round(performance.now() - t0), dpr: devicePixelRatio };
});
console.log(channel, JSON.stringify(info));
for (const ms of [0, 500, 3000]) {
  await page.waitForTimeout(ms);
  const png = await page.screenshot();
  writeFileSync(`diag/${channel}-${ms}.png`, png);
  const { data, info: i } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  let drawn = 0;
  for (let p = 0; p < data.length; p += i.channels) if (Math.abs(data[p] - 154) + Math.abs(data[p + 1] - 164) + Math.abs(data[p + 2] - 174) > 12) drawn++;
  const k = (300 * i.width + 200) * i.channels;
  console.log(channel, `+${ms} ms`, 'middle', [...data.subarray(k, k + 3)], 'pixels not background', drawn);
}
await browser.close();
