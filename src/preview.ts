// Preview pictures of finished models, to check a batch at a glance: each GLB
// drawn from the front three-quarters and the back three-quarters, side by
// side, captioned with its real size and anything still to review (stand-in
// faces, guessed sizes). Written beside the model as <name>.preview.png, never <name>.png,
// which may be the photo it was made from. Drawn by Google's model-viewer in
// a headless browser, with the viewer and the model served from disk, so
// nothing is fetched from the network.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium, type Browser } from 'playwright-core';
import sharp from 'sharp';
import { stillToShoot, type Sidecar } from './thicken.ts';

const require = createRequire(import.meta.url);
const VIEWER = require.resolve('@google/model-viewer/dist/model-viewer.min.js');
const [VIEW_W, VIEW_H, CAPTION_H] = [400, 540, 34]; // px; portrait views, as books and slabs are
const RENDER_TIMEOUT_MS = 30_000;
const BACKGROUND = [0x9a, 0xa4, 0xae]; // the page's mid slate
// Neutral tone mapping keeps the photos' colors as they are where the light falls full on them; the
// soft shadow under the model is the preview's own, not part of the asset.
const VIEW = 'tone-mapping="neutral" shadow-intensity="1" shadow-softness="1" interaction-prompt="none"';
const PAGE = `<!doctype html><meta charset="utf-8">
<style>
  body{margin:0;width:${2 * VIEW_W}px;background:rgb(${BACKGROUND});font:14px system-ui,sans-serif;color:#1f2933} /* mid slate: light plastic, cream pages and dark covers all stand out */
  model-viewer{display:inline-block;width:${VIEW_W}px;height:${VIEW_H}px}
  p{margin:0;height:${CAPTION_H}px;line-height:${CAPTION_H}px;padding:0 12px;background:#fff;white-space:nowrap;overflow:hidden}
</style>
<script type="module" src="/model-viewer.js"></script>
<model-viewer camera-orbit="35deg 72deg auto" ${VIEW}><div slot="progress-bar"></div></model-viewer><model-viewer camera-orbit="215deg 72deg auto" ${VIEW}><div slot="progress-bar"></div></model-viewer>
<p></p>`;

export const previewPath = (glb: string) => glb.replace(/(\.glb)?$/i, '.preview.png');

/** One browser for a whole batch: render(glb) writes its preview and returns the path; close() when done. */
export async function startPreview(): Promise<{ render(glb: string): Promise<string>; close(): Promise<void> }> {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 2 * VIEW_W, height: VIEW_H + CAPTION_H } });
  let model = '';
  await page.route('http://thicken.local/**', (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/model-viewer.js') return route.fulfill({ path: VIEWER, contentType: 'text/javascript' });
    if (pathname === '/model.glb') return route.fulfill({ body: readFileSync(model), contentType: 'model/gltf-binary' });
    return route.fulfill({ body: PAGE, contentType: 'text/html' });
  });
  await page.goto('http://thicken.local/');
  await page.waitForFunction(() => customElements.get('model-viewer'));
  return {
    async render(glb) {
      model = glb;
      const deadline = performance.now() + RENDER_TIMEOUT_MS;
      await page.evaluate(async ([src, caption, timeoutMs]) => {
        const deadline = performance.now() + timeoutMs;
        const late = () => new Error('the model did not draw in time (is WebGL available?)');
        document.querySelector('p')!.textContent = caption;
        const views = [...document.querySelectorAll('model-viewer')] as (HTMLElement & { src: string; modelIsVisible: boolean })[];
        await Promise.race([
          Promise.all(views.map((view) => new Promise((resolve, reject) => {
            view.addEventListener('load', resolve, { once: true });
            view.addEventListener('error', () => reject(new Error('the model would not load')), { once: true });
            view.src = src;
          }))),
          new Promise((_, reject) => setTimeout(() => reject(late()), timeoutMs)),
        ]);
        // Drawn, not just loaded: both views visible, then one more frame.
        while (!views.every((view) => view.modelIsVisible)) {
          if (performance.now() > deadline) throw late();
          await new Promise(requestAnimationFrame);
        }
        await new Promise(requestAnimationFrame);
      }, [`/model.glb?${Date.now()}`, caption(glb), RENDER_TIMEOUT_MS] as const); // a fresh URL, so a new model loads
      // Drawn as seen, not as model-viewer reports: a software renderer (a machine with no GPU) can still be drawing
      // when it says visible, so the picture is taken again until neither view is bare background.
      const png = previewPath(glb);
      while (!(await drawn(await page.screenshot({ path: png })))) {
        if (performance.now() > deadline) throw new Error('the model did not draw in time (is WebGL available?)');
        await page.waitForTimeout(100);
      }
      return png;
    },
    close: () => browser.close(),
  };
}

/** Whether both views in a screenshot show more than the page's background: a model drawn, not just loaded. */
async function drawn(screenshot: Buffer): Promise<boolean> {
  const { data, info } = await sharp(screenshot).raw().toBuffer({ resolveWithObject: true });
  return [0, VIEW_W].every((left) => {
    let shown = 0;
    for (let y = 0; y < VIEW_H; y += 4) {
      for (let x = left; x < left + VIEW_W; x += 4) {
        const k = (y * info.width + x) * info.channels;
        if (BACKGROUND.reduce((sum, c, i) => sum + Math.abs(data[k + i] - c), 0) > 12) shown++;
      }
    }
    return shown > 100; // of 13,500 points looked at
  });
}

/** The real size, and any face that isn't the user's photo, from the sidecar beside the model. */
function caption(glb: string): string {
  const json = glb.replace(/(\.glb)?$/i, '.json');
  if (!existsSync(json)) return '';
  const sidecar = JSON.parse(readFileSync(json, 'utf8')) as Sidecar;
  const review = sidecar.review ?? stillToShoot(sidecar.faces); // older sidecars have faces but no review list
  return [`${sidecar.widthMm} × ${sidecar.heightMm} × ${sidecar.depthMm} mm`, review.length ? `to review: ${review.join('; ')}` : '']
    .filter(Boolean).join('  ·  ');
}

/** An installed Chrome or Edge (Edge is on every Windows machine), else Playwright's own Chromium if installed. */
export async function launch(): Promise<Browser> {
  for (const channel of ['chrome', 'msedge', undefined]) {
    try {
      return await chromium.launch({ channel, args: ['--enable-unsafe-swiftshader'] }); // WebGL without a GPU
    } catch {
      // not installed: try the next
    }
  }
  throw new Error('previews need Chrome or Edge installed (or: npx playwright install chromium)');
}
