// A model in motion, for the README and the logo: the GLB drawn by model-viewer (as previews are) from a still camera
// while the model moves, each frame on a transparent background, cropped to the same box (the smallest holding the
// model in all of them, plus a margin) and joined into an animated WebP; with --still, the first frame as a PNG too.
// Motion lives in these pictures, never in the asset.
//   spin:  a full slow turn about its own axis, leaning a little, bobbing over a soft shadow: floating, back shown
//   float: a slow, uneven drift, small turns, a lean and a rise and fall, as a balloon floats (the logo)
//   node scripts/turntable.ts <model.glb> <out.webp> [--motion spin|float] [--still out.png] [--width 900]
//     [--height 300] [--zoom 100] [--tilt 75] [--frames 90] [--fps 15] [--exposure 1.0] [--environment neutral|legacy]
//     [--shadow 0.6] [--lean=-6] [--bob 0.008] [--turn=1|-1]   (spin: its lean in degrees, bob as a share of its
//     height, and which way it turns; a negative number goes after an =, or it's read as an option)
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { launch } from '../src/preview.ts';

const { positionals: [model, out], values } = parseArgs({
  allowPositionals: true,
  options: {
    motion: { type: 'string', default: 'spin' }, still: { type: 'string' },
    width: { type: 'string', default: '900' }, height: { type: 'string', default: '300' }, zoom: { type: 'string', default: '100' },
    tilt: { type: 'string', default: '75' }, frames: { type: 'string', default: '90' }, fps: { type: 'string', default: '15' },
    exposure: { type: 'string', default: '1.0' }, environment: { type: 'string', default: 'neutral' }, shadow: { type: 'string', default: '0' },
    lean: { type: 'string', default: '-6' }, bob: { type: 'string', default: '0.008' }, turn: { type: 'string', default: '1' },
  },
});
const [lean, bob, turn] = ['lean', 'bob', 'turn'].map((key) => Number(values[key as keyof typeof values]));
if (!model || !out) throw new Error('usage: node scripts/turntable.ts <model.glb> <out.webp> [--motion spin|float] [options]');
const [width, height, zoom, tilt, frames, fps] = ['width', 'height', 'zoom', 'tilt', 'frames', 'fps'].map((key) => Number(values[key as keyof typeof values]));
const FOV = 30; // degrees: a fixed lens and distance, so the model never seems to zoom as it moves

/** Where the model is at t (0 to 1, one loop): its roll, pitch and yaw in degrees, and its rise, a share of its height. */
const MOTIONS: Record<string, (t: number) => { roll: number; pitch: number; yaw: number; rise: number }> = {
  spin: (t) => ({ roll: lean, pitch: 0, yaw: 360 * turn * t, rise: bob * Math.sin(2 * Math.PI * t) }),
  float: (t) => ({
    roll: 2.5 * Math.sin(2 * Math.PI * t + 1),
    pitch: 3 * Math.sin(4 * Math.PI * t),
    yaw: 9 * Math.sin(2 * Math.PI * t),
    rise: 0.04 * Math.sin(2 * Math.PI * t + Math.PI / 2),
  }),
};
const motion = MOTIONS[values.motion];
if (!motion) throw new Error(`--motion is one of ${Object.keys(MOTIONS).join(', ')}`);

const VIEWER = createRequire(import.meta.url).resolve('@google/model-viewer/dist/model-viewer.min.js');
const PAGE = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:transparent}model-viewer{width:${width}px;height:${height}px;background:transparent}</style>
<script type="module" src="/model-viewer.js"></script>
<model-viewer src="/model.glb" field-of-view="${FOV}deg" tone-mapping="neutral" exposure="${values.exposure}"
  environment-image="${values.environment}" shadow-intensity="${values.shadow}" shadow-softness="1" interaction-prompt="none"
  disable-zoom><div slot="progress-bar"></div></model-viewer>`;

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
  // The camera's distance from the model's size: far enough for its longest diagonal to fit the lens at --zoom 100.
  const size = await page.evaluate(() => (document.querySelector('model-viewer') as unknown as { getDimensions(): { x: number; y: number; z: number } }).getDimensions());
  const diagonal = Math.hypot(size.x, size.y, size.z);
  const radius = (diagonal / 2 / Math.sin((FOV / 2) * (Math.PI / 180))) * (zoom / 100);
  const shots: Buffer[] = [];
  for (let f = 0; f < frames; f++) {
    const { roll, pitch, yaw, rise } = motion(f / frames);
    await page.evaluate(async ([orientation, target, orbit]) => {
      const view = document.querySelector('model-viewer') as HTMLElement & { orientation: string; cameraTarget: string; cameraOrbit: string; jumpCameraToGoal(): void };
      view.orientation = orientation;
      view.cameraTarget = target; // the camera follows the opposite way: the model seems to rise and fall
      view.cameraOrbit = orbit;
      view.jumpCameraToGoal();
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    }, [`${roll}deg ${pitch}deg ${yaw}deg`, `0m ${-rise * size.y}m 0m`, `0deg ${tilt}deg ${radius}m`] as const);
    shots.push(await page.screenshot({ omitBackground: true }));
  }
  // The box every frame's model (and its shadow) fits in, with a margin of 2% of the frame.
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
  if (cropped.length > 1) await sharp(cropped, { join: { animated: true } }).webp({ quality: 85, alphaQuality: 100, effort: 6, loop: 0, delay: cropped.map(() => Math.round(1000 / fps)) }).toFile(out);
  console.log(`${out}: ${values.motion}, ${frames} frames at ${fps} fps, ${box.width} × ${box.height}${values.still ? `; ${values.still}` : ''}`);
} finally {
  await browser.close();
}
