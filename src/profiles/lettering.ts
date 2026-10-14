// The lettering profile: words in, puffy 3D bubble letters out, in gold. No picture: the words are drawn in a round,
// heavy font that comes with thicken (Titan One, SIL Open Font License 1.1, unmodified: fonts/OFL.txt), and the
// letters are inflated like a balloon: the square root of the solution to Poisson's equation inside their outline,
// which is round in section across any stroke (a strip of half-width a rises as √(a² − x²)) with no crease down its
// middle, so the thickest strokes stand tallest. The back mirrors the front, and the two meet at the outline,
// closed. thicken's own logo is made this way: `thicken lettering thicken`.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Document, type vec4 } from '@gltf-transform/core';
import sharp from 'sharp';
import { addPart, emptyPart, type Part, type Profile, toGlb } from '../kit.ts';

// opentype.js (MIT) reads the font: the three calls used here.
interface Outline { toPathData(decimals: number): string; getBoundingBox(): { x1: number; y1: number; x2: number; y2: number } }
interface Font {
  getPath(text: string, x: number, y: number, size: number): Outline;
  getPaths(text: string, x: number, y: number, size: number): Outline[];
  charToGlyph(char: string): { index: number };
}
const opentype = createRequire(import.meta.url)('opentype.js') as { parse(buffer: ArrayBuffer): Font };

const FONT = new URL('../../fonts/TitanOne-Regular.ttf', import.meta.url); // from src/profiles, and from dist/profiles built
const EM_PX = 320; // the size the words are drawn at: capitals about 230 px tall, so the outline doesn't step
const STEP_PX = 4; // the mesh's grid over the drawing: about 15 rows across a stroke
const WIDTH_MM = 100; // unless --width says
const GOLD: vec4 = [1, 0.766, 0.336, 1]; // gold as a metal: its reflectance head-on, in linear light (glTF's base color for metals)
const GOLD_ROUGHNESS = 0.25;
const INF = 1e20;

export const lettering: Profile = {
  name: 'lettering',
  about: 'words made into puffy 3D bubble letters',
  input: 'Words, typed where pictures would go (`--width` mm across, `--depth` mm thick)',
  makes: 'Puffy gold bubble letters, round in section like a balloon, in the Titan One font',
  faces: {},
  words: true,
  build: async (_pictures, { options, words = [] }) => {
    const text = words.join(' ').trim();
    if (!text) throw new Error('lettering needs words: thicken lettering thicken');
    const bytes = readFileSync(FONT);
    const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const missing = [...new Set(text)].filter((char) => char.trim() && font.charToGlyph(char).index === 0);
    const shown = [...text].map((char) => (missing.includes(char) ? ' ' : char)).join(''); // not the font's placeholder box
    const box = font.getPath(shown, 0, 0, EM_PX).getBoundingBox();
    if (!(box.x2 > box.x1)) throw new Error(`the font has none of the letters in "${text}"`);

    // Each letter inflated on its own, where the font sets it: letters closer than the mesh's grid would otherwise
    // be webbed together, and touching balloons just touch.
    const letters = await Promise.all(font.getPaths(shown, 0, 0, EM_PX).filter((outline) => {
      const { x1, x2 } = outline.getBoundingBox();
      return x2 > x1;
    }).map(inflated));
    let radius = 0; // how high the thickest stroke's middle rises: half its width, round in section
    for (const { rise } of letters) for (const r of rise) radius = Math.max(radius, r);

    const widthMm = options.widthMm ?? WIDTH_MM;
    const mmPerPx = widthMm / (box.x2 - box.x1);
    const liftMm = options.depthMm ? options.depthMm / 2 / radius : mmPerPx; // per px of rise: round unless --depth
    const middle = [(box.x1 + box.x2) / 2, (box.y1 + box.y2) / 2];
    const part = emptyPart();
    for (const { grid, rise, origin } of letters) {
      const letter = pillow(grid, rise.map((r) => r * liftMm), ([x, y]) => [(origin[0] + x - middle[0]) * mmPerPx, (middle[1] - origin[1] - y) * mmPerPx]);
      part.index.push(...letter.index.map((k) => k + part.position.length / 3));
      part.position.push(...letter.position);
      part.normal.push(...letter.normal);
    }

    const doc = new Document();
    const mesh = doc.createMesh('lettering');
    addPart(doc, mesh, part, doc.createMaterial('gold').setBaseColorFactor(GOLD).setMetallicFactor(1).setRoughnessFactor(GOLD_ROUGHNESS));
    const round = (mm: number) => Math.round(mm * 10) / 10;
    return {
      glb: await toGlb(doc, mesh),
      sidecar: {
        text, font: 'Titan One', fontLicense: 'OFL-1.1', color: 'gold',
        widthMm: round(widthMm), heightMm: round((box.y2 - box.y1) * mmPerPx), depthMm: round(2 * radius * liftMm),
        measuredBy: { width: options.widthMm ? 'given' : 'default', depth: options.depthMm ? 'given' : 'round' },
        review: [],
        warnings: missing.length ? [`the font has no ${missing.map((char) => `"${char}"`).join(', ')}: left blank`] : [],
      },
    };
  },
};

/**
 * Each pixel's distance from the outline, in pixels: positive inside the letters, negative outside, from their
 * antialiased coverage, so it's right to a fraction of a pixel. Felzenszwalb and Huttenlocher's exact Euclidean
 * distance transform, as mapbox/tiny-sdf (BSD-2-Clause) runs it for glyphs.
 */
function signedDistance(alpha: Buffer, w: number, h: number): Float64Array {
  const outer = new Float64Array(w * h).fill(INF); // squared, to the letters, for pixels outside them
  const inner = new Float64Array(w * h); // squared, to the outside, for pixels inside
  for (let k = 0; k < w * h; k++) {
    const a = alpha[k] / 255;
    if (a === 0) continue;
    if (a === 1) {
      outer[k] = 0;
      inner[k] = INF;
      continue;
    }
    const d = 0.5 - a; // the outline crosses this pixel, this far from its middle
    outer[k] = d > 0 ? d * d : 0;
    inner[k] = d < 0 ? d * d : 0;
  }
  const n = Math.max(w, h);
  const [f, v, z] = [new Float64Array(n), new Int32Array(n), new Float64Array(n + 1)];
  for (const grid of [outer, inner]) {
    for (let x = 0; x < w; x++) edt1d(grid, x, w, h, f, v, z);
    for (let y = 0; y < h; y++) edt1d(grid, y * w, 1, w, f, v, z);
  }
  const sdf = new Float64Array(w * h);
  for (let k = 0; k < w * h; k++) sdf[k] = Math.sqrt(inner[k]) - Math.sqrt(outer[k]);
  return sdf;
}

/** One row or column of the distance transform: each cell's squared distance to the nearest zero, along the line. */
function edt1d(grid: Float64Array, offset: number, stride: number, length: number, f: Float64Array, v: Int32Array, z: Float64Array) {
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  f[0] = grid[offset];
  for (let q = 1, k = 0, s = 0; q < length; q++) {
    f[q] = grid[offset + q * stride];
    const q2 = q * q;
    do {
      const r = v[k];
      s = (f[q] - f[r] + q2 - r * r) / (q - r) / 2;
    } while (s <= z[k] && --k > -1);
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  for (let q = 0, k = 0; q < length; q++) {
    while (z[k + 1] < q) k++;
    const r = v[k];
    grid[offset + q * stride] = f[r] + (q - r) * (q - r);
  }
}

/** One letter drawn on its own, a margin round it, with how high each point of its grid rises (px) and where its drawing's top left is in the words' (px). */
async function inflated(outline: Outline): Promise<{ grid: Grid; rise: Float64Array; origin: number[] }> {
  const box = outline.getBoundingBox();
  const pad = 4 * STEP_PX;
  const [w, h] = [Math.ceil(box.x2 - box.x1) + 2 * pad, Math.ceil(box.y2 - box.y1) + 2 * pad];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><path transform="translate(${pad - box.x1} ${pad - box.y1})" d="${outline.toPathData(3)}"/></svg>`;
  const alpha = await sharp(Buffer.from(svg)).ensureAlpha().extractChannel(3).raw().toBuffer();
  const grid = { sdf: signedDistance(alpha, w, h), w, h, cols: Math.floor((w - 1) / STEP_PX) + 1, rows: Math.floor((h - 1) / STEP_PX) + 1 };
  return { grid, rise: inflate(grid), origin: [box.x1 - pad, box.y1 - pad] };
}

interface Grid { sdf: Float64Array; w: number; h: number; cols: number; rows: number }
const sdfAt = ({ sdf, w, h }: Grid, x: number, y: number) => sdf[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];

/**
 * How high each grid point inside the letters rises, in px: √u, where ∇²u = −2 inside the outline and u = 0 on it,
 * solved by successive over-relaxation. Across a strip of half-width a that's √(a² − x²): a circle. A point beside
 * the outline reaches it in less than a step, as far as the distance's change of sign says (Shortley and Weller's
 * arms), so near the edge u goes with the true distance in, and the rim follows the outline, not the grid.
 */
function inflate(grid: Grid): Float64Array {
  const { cols, rows } = grid;
  const s = new Float64Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) s[j * cols + i] = sdfAt(grid, i * STEP_PX, j * STEP_PX);
  // Each inside point's four neighbors (−1 where the outline comes first, where u is 0) and their weights.
  const points: { k: number; near: number[]; weight: number[]; total: number }[] = [];
  for (let j = 1; j + 1 < rows; j++) {
    for (let i = 1; i + 1 < cols; i++) {
      const k = j * cols + i;
      if (s[k] <= 0) continue;
      const near = [k - 1, k + 1, k - cols, k + cols];
      const arm = near.map((n) => (s[n] > 0 ? STEP_PX : STEP_PX * Math.max(0.05, s[k] / (s[k] - s[n]))));
      const weight = arm.map((a, e) => 2 / (a * (a + arm[e ^ 1]))); // e ^ 1: the arm opposite, along the same line
      points.push({ k, near: near.map((n, e) => (s[n] > 0 ? n : -1 - e)), weight, total: weight.reduce((sum, w) => sum + w, 0) });
    }
  }
  const u = new Float64Array(cols * rows);
  for (let sweep = 0, change = Infinity; sweep < 5000 && change > 1e-3; sweep++) {
    change = 0;
    for (const { k, near, weight, total } of points) {
      let sum = 2;
      for (let e = 0; e < 4; e++) if (near[e] >= 0) sum += weight[e] * u[near[e]];
      const step = sum / total - u[k];
      u[k] += 1.9 * step;
      change = Math.max(change, Math.abs(step));
    }
  }
  return u.map(Math.sqrt);
}

const EDGE_PX = STEP_PX / 4; // a point this near the outline joins it: the seam

/**
 * The letters as one closed surface: a grid over every cell the letters reach, its points risen by `rise` (mm) on the
 * front and sunk as far on the back. Points on or outside the outline move onto it, along the distance's slope, at no
 * height, shared by front and back: the seam where they close.
 */
function pillow(grid: Grid, rise: Float64Array, place: (px: number[]) => number[]): Part {
  const { cols, rows } = grid;
  const at = (x: number, y: number) => sdfAt(grid, x, y);
  const part = emptyPart();
  const [front, back] = [new Int32Array(cols * rows).fill(-1), new Int32Array(cols * rows).fill(-1)];
  const add = (x: number, y: number, z: number) => {
    const [mx, my] = place([x, y]);
    part.position.push(mx / 1000, my / 1000, z / 1000);
    return part.position.length / 3 - 1;
  };
  const point = (i: number, j: number) => {
    const k = j * cols + i;
    if (front[k] < 0) {
      let [x, y] = [i * STEP_PX, j * STEP_PX];
      const s = at(x, y);
      const [gx, gy] = [(at(x + 1, y) - at(x - 1, y)) / 2, (at(x, y + 1) - at(x, y - 1)) / 2];
      const g2 = gx * gx + gy * gy;
      if (s > EDGE_PX) {
        // The first row inside the outline, all moved to half a step in, so the steep rim rises evenly round the
        // letter instead of in a saw-tooth (the rise goes as √ of the distance in, where the grid's points don't).
        let r = rise[k];
        if (s < STEP_PX && g2 > 1e-9) {
          [x, y] = [x + ((STEP_PX / 2 - s) * gx) / g2, y + ((STEP_PX / 2 - s) * gy) / g2];
          r *= Math.sqrt(STEP_PX / 2 / s);
        }
        front[k] = add(x, y, r);
        back[k] = add(x, y, -r);
      } else {
        if (g2 > 1e-9) [x, y] = [x - (s * gx) / g2, y - (s * gy) / g2];
        front[k] = back[k] = add(x, y, 0);
      }
    }
    return k;
  };
  for (let j = 0; j + 1 < rows; j++) {
    for (let i = 0; i + 1 < cols; i++) {
      const corners = [[i, j], [i, j + 1], [i + 1, j + 1], [i + 1, j]]; // a, d, c, b: counterclockwise once y is up
      const inside = corners.map(([ci, cj]) => at(ci * STEP_PX, cj * STEP_PX) > EDGE_PX);
      if (!inside.some(Boolean)) continue;
      for (const tri of [[0, 1, 2], [0, 2, 3]]) {
        if (!tri.some((c) => inside[c])) continue; // all on the outline: front and back would coincide
        const ks = tri.map((c) => point(corners[c][0], corners[c][1]));
        part.index.push(...ks.map((k) => front[k]), ...ks.map((k) => back[k]).reverse());
      }
    }
  }
  // Smooth normals: each point's faces, weighted by their area.
  const normal = new Float64Array(part.position.length);
  const p = part.position;
  for (let t = 0; t < part.index.length; t += 3) {
    const [a, b, c] = [part.index[t] * 3, part.index[t + 1] * 3, part.index[t + 2] * 3];
    const [ux, uy, uz] = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
    const [vx, vy, vz] = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    for (const corner of [a, b, c]) for (let e = 0; e < 3; e++) normal[corner + e] += n[e];
  }
  for (let k = 0; k < normal.length; k += 3) {
    const length = Math.hypot(normal[k], normal[k + 1], normal[k + 2]) || 1;
    part.normal.push(normal[k] / length, normal[k + 1] / length, normal[k + 2] / length);
  }
  return part;
}
