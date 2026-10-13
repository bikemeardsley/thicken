// A model turning, for the README and the logo: the GLB drawn by model-viewer (as previews are), the camera swaying
// side to side and back, each frame on a transparent background, joined into an animated WebP; with --still, the
// middle frame as a PNG too. Motion lives in these pictures, never in the asset.
//   node scripts/turntable.ts <model.glb> <out.webp> [--still out.png] [--width 900] [--height 300] [--zoom 100]
//     [--sway 28] [--tilt 78] [--frames 60] [--fps 24] [--exposure 1.1] [--environment neutral|legacy]
// Every frame is cropped to the same box, the smallest holding the model in all of them, plus a margin.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { launch } from '../src/preview.ts';

const { positionals: [model, out], values } = parseArgs({
  allowPositionals: true,
  options: {
    still: { type: 'string' }, width: { type: 'string', default: '900' }, height: { type: 'string', default: '300' }, zoom: { type: 'string', default: '100' },
    sway: { type: 'string', default: '28' }, tilt: { type: 'string', default: '78' }, frames: { type: 'string', default: '60' },
    fps: { type: 'string', default: '24' }, exposure: { type: 'string', default: '1.1' }, environment: { type: 'string', default: 'neutral' },
  },
});
if (!model || !out) throw new Error('usage: node scripts/turntable.ts <model.glb> <out.webp> [--still out.png] [options]');
const [width, height, sway, tilt, frames, fps] = ['width', 'height', 'sway', 'tilt', 'frames', 'fps'].map((key) => Number(values[key as keyof typeof values]));

const VIEWER = createRequire(import.meta.url).resolve('@google/model-viewer/dist/model-viewer.min.js');
const PAGE = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:transparent}model-viewer{width:${width}px;height:${height}px;background:transparent}</style>
<script type="module" src="/model-viewer.js"></script>
<model-viewer src="/model.glb" camera-orbit="0deg ${tilt}deg ${values.zoom}%" tone-mapping="neutral" exposure="${values.exposure}"
  environment-image="${values.environment}" interaction-prompt="none" disable-zoom><div slot="progress-bar"></div></model-viewer>`;

const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  await page.route('http://thicken.local/**', (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/model-viewer.js') return route.fulfill({ path: VIEWER, contentType: 'text/javascript' });
    if (pathname === '/model.glb') return route.fulfill({ body: readFileSync(model), contentType: 'model/gltf-binary' });
    return route.fulfill({ body: PAGE, contentType: 'text/html' });
  });
  await page.goto('http://thicken.local/');
  await page.waitForFunction(() => (document.querySelector('model-viewer') as { modelIsVisible?: boolean } | null)?.modelIsVisible);
  const shots: Buffer[] = [];
  for (let f = 0; f < frames; f++) {
    // Side to side and back, easing at each end: a sway, so the front is always the side shown.
    const theta = sway * Math.sin((2 * Math.PI * f) / frames);
    await page.evaluate(async (orbit) => {
      const view = document.querySelector('model-viewer') as HTMLElement & { cameraOrbit: string; jumpCameraToGoal(): void };
      view.cameraOrbit = orbit;
      view.jumpCameraToGoal();
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    }, `${theta}deg ${tilt}deg ${values.zoom}%`);
    shots.push(await page.screenshot({ omitBackground: true }));
  }
  // The box every frame's model fits in, with a margin of 2% of the frame.
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const shot of shots) {
    const { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        if (data[(y * info.width + x) * info.channels + 3] > 8) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
      }
    }
  }
  const margin = Math.round(0.02 * width * 2);
  const box = { left: Math.max(0, x0 - margin), top: Math.max(0, y0 - margin), width: Math.min(width * 2, x1 + margin + 1) - Math.max(0, x0 - margin), height: Math.min(height * 2, y1 + margin + 1) - Math.max(0, y0 - margin) };
  const cropped = await Promise.all(shots.map((shot) => sharp(shot).extract(box).png().toBuffer()));
  if (values.still) await sharp(cropped[0]).png().toFile(values.still);
  if (cropped.length > 1) await sharp(cropped, { join: { animated: true } }).webp({ quality: 88, alphaQuality: 100, effort: 6, loop: 0, delay: cropped.map(() => Math.round(1000 / fps)) }).toFile(out);
  console.log(`${out}: ${frames} frames, ${box.width} × ${box.height}${values.still ? `; ${values.still}` : ''}`);
} finally {
  await browser.close();
}
