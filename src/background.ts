// What's behind the object, learned from the photo itself, so none of it ends up in the model: the table beyond a
// photo's object, or seen through a slab's clear plastic. Each pixel is described by its neighborhood (its mean color
// and how much its brightness varies), so speckled granite reads as one texture rather than as brown, black and white
// pixels, one of which matches a silver logo. The background is a few clusters of those descriptions, from pixels
// known to be background; a part (a label) is a few more, from its own middle. A part's edges are pulled in while
// the line inside each looks more like the background than like the part: corners that overshoot, a model's or a
// person's, are caught. Measured on 497's front label (2026-10-25): its given corners ran 8–10 px past the label's
// bottom onto granite, and came in to within 2 px of it; its right edge came in 10 px too far, into the gold margin
// beside the print (no print lost).
// ponytail: tried and dropped the same day: keying a logo against this background (it lost most of the strokes)
// and scoring finished pictures' edges (it flagged clean edges); and a card's art is too like granite to trim.
import { mapping, type Picture, straighten } from './image.ts';

const AROUND = 2; // px each way: a pixel's neighborhood is 5 x 5
const CLUSTERS = 6;
const SAMPLES = 3000; // pixels sampled to learn from
const REACH = 2; // of the background's own 95th-percentile stray: further, a pixel is something else (1.5 left granite on 497, 3 began trimming 364's red border)
const REACH_FLOOR = 10; // and at least this: an even scan bed strays by its JPEG noise only
const MOST_TRIM = 0.12; // of a part's size: the most an edge is pulled in (more, and the corners were wrong, not loose)
const CLEAR_ROW = 0.5; // a line of the band more background than this is past the part's edge

/** Each pixel's neighborhood: its mean red, green and blue, and how much its brightness varies (scaled alike). */
function describe({ data, width: w, height: h }: Picture): Float32Array {
  const channels = 4; // r, g, b, brightness squared, summed over the neighborhood by integral images
  const sums = new Float64Array((w + 1) * (h + 1) * channels);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const light = (data[i] + data[i + 1] + data[i + 2]) / 3;
      const values = [data[i], data[i + 1], data[i + 2], light * light];
      for (let c = 0; c < channels; c++) {
        const at = ((y + 1) * (w + 1) + x + 1) * channels + c;
        sums[at] = values[c] + sums[at - channels] + sums[at - (w + 1) * channels] - sums[at - (w + 2) * channels];
      }
    }
  }
  const box = (x0: number, y0: number, x1: number, y1: number, c: number) =>
    sums[(y1 * (w + 1) + x1) * channels + c] - sums[(y0 * (w + 1) + x1) * channels + c] - sums[(y1 * (w + 1) + x0) * channels + c] + sums[(y0 * (w + 1) + x0) * channels + c];
  const out = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [x0, y0, x1, y1] = [Math.max(0, x - AROUND), Math.max(0, y - AROUND), Math.min(w, x + AROUND + 1), Math.min(h, y + AROUND + 1)];
      const n = (x1 - x0) * (y1 - y0);
      const [r, g, b] = [0, 1, 2].map((c) => box(x0, y0, x1, y1, c) / n);
      const light = (r + g + b) / 3;
      const spread = Math.sqrt(Math.max(0, box(x0, y0, x1, y1, 3) / n - light * light));
      out.set([r, g, b, 2 * spread], (y * w + x) * 4); // speckle counts twice: it's what tells granite from a flat color
    }
  }
  return out;
}

/** A few clusters of neighborhood descriptions (k-means, seeded evenly through the samples: no randomness). */
function clusters(samples: number[][]): number[][] {
  if (samples.length <= CLUSTERS) return samples;
  let centers = Array.from({ length: CLUSTERS }, (_, k) => samples[Math.floor((k * samples.length) / CLUSTERS)]);
  for (let round = 0; round < 10; round++) {
    const sums = centers.map(() => [0, 0, 0, 0, 0]);
    for (const s of samples) {
      const k = nearest(centers, s).k;
      for (let c = 0; c < 4; c++) sums[k][c] += s[c];
      sums[k][4]++;
    }
    centers = sums.map((sum, k) => (sum[4] ? sum.slice(0, 4).map((v) => v / sum[4]) : centers[k]));
  }
  return centers;
}
function nearest(centers: number[][], s: ArrayLike<number>) {
  let best = { k: 0, d: Infinity };
  centers.forEach((center, k) => {
    const d = Math.hypot(center[0] - s[0], center[1] - s[1], center[2] - s[2], center[3] - s[3]);
    if (d < best.d) best = { k, d };
  });
  return best;
}

/** Whether a point is inside four corners given clockwise on screen. */
export const inQuad = ([x, y]: number[], q: number[][]) => q.every((a, k) => {
  const b = q[(k + 1) % 4];
  return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) >= 0;
});
/** A quad grown (or, below 1, shrunk) about its middle. */
export const grown = (q: number[][], by: number) => {
  const [mx, my] = [0, 1].map((c) => q.reduce((sum, p) => sum + p[c], 0) / 4);
  return q.map(([x, y]) => [mx + (x - mx) * by, my + (y - my) * by]);
};

/** The background of a photo, learned from the pixels `known` says are background, sampled evenly. */
export function backgroundOf(picture: Picture, known: (point: number[]) => boolean) {
  const described = describe(picture);
  const { width: w, height: h } = picture;
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / (SAMPLES * 4))));
  const samples: number[][] = [];
  for (let y = AROUND; y < h - AROUND; y += step) {
    for (let x = AROUND; x < w - AROUND; x += step) {
      if (known([x, y])) samples.push([...described.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)]);
    }
  }
  const centers = clusters(samples);
  // How far the background strays from its own clusters: past most of that, nothing is background, whatever else it
  // is nearer to. Speckled granite strays far; a grader's dark scan bed hardly at all, so a red label border, nearer to
  // its dark than to the label's white middle, is still no background.
  const own = samples.map((s) => nearest(centers, s).d).sort((a, b) => a - b);
  return { centers, reach: Math.max(REACH_FLOOR, REACH * (own[Math.floor(0.95 * (own.length - 1))] ?? 0)), known: samples.length > 50 };
}
type Background = ReturnType<typeof backgroundOf>;

/** A part's own look: clusters of the neighborhoods in the middle half of its straightened picture. */
function ownLook(part: Picture): number[][] {
  const { width: w, height: h } = part;
  const described = describe(part);
  const own: number[][] = [];
  for (let y = Math.floor(0.25 * h); y < 0.75 * h; y += 2) for (let x = Math.floor(0.25 * w); x < 0.75 * w; x += 2) own.push([...described.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)]);
  return clusters(own);
}

/** Which pixels of a picture look more like the background than like `part` (clusters from the part's own middle). */
function backgroundIn(picture: Picture, background: Background, part: number[][]): Uint8Array {
  const described = describe(picture);
  const out = new Uint8Array(picture.width * picture.height);
  for (let i = 0; i < out.length; i++) {
    const s = described.subarray(i * 4, i * 4 + 4);
    const away = nearest(background.centers, s).d;
    out[i] = away <= background.reach && away < nearest(part, s).d ? 1 : 0;
  }
  return out;
}

/**
 * A part's corners pulled in until the line inside each edge is its own, not the background's: a strip of table
 * along a label's edge is cut off. Each edge moves at most MOST_TRIM; one that would move further is left where it
 * was and named in `off`: those corners were wrong, not loose, which is for a person to see. Returns the corners and
 * how much each edge (top, right, bottom, left) moved, as shares of the part.
 */
export function tighten(picture: Picture, quad: number[][], background: Background): { corners: number[][]; trimmed: number[]; off: string[] } {
  if (!background.known) return { corners: quad, trimmed: [0, 0, 0, 0], off: [] };
  const flat = straighten(picture, quad);
  const { width: w, height: h } = flat;
  const isBackground = backgroundIn(flat, background, ownLook(flat));
  // Share of background along a row (or column) of the part, its ends left out: the corners belong to two edges.
  const row = (y: number) => { let n = 0; for (let x = Math.floor(0.1 * w); x < 0.9 * w; x++) n += isBackground[y * w + x]; return n / (0.8 * w); };
  const column = (x: number) => { let n = 0; for (let y = Math.floor(0.1 * h); y < 0.9 * h; y++) n += isBackground[y * w + x]; return n / (0.8 * h); };
  // From each edge inward, while each line is mostly background, up to the most an edge may move. It stops at the
  // first line that isn't: print further in (a label's big grade, a card's dark photo) isn't the edge's business.
  const off: string[] = [];
  const inward = (edge: string, size: number, line: (k: number) => number, from: number, step: number) => {
    let cut = 0;
    while (cut < MOST_TRIM * size && line(from + step * cut) > CLEAR_ROW) cut++;
    if (cut < MOST_TRIM * size) return cut / size;
    off.push(edge);
    return 0;
  };
  const trimmed = [inward('top', h, row, 0, 1), inward('right', w, column, w - 1, -1), inward('bottom', h, row, h - 1, -1), inward('left', w, column, 0, 1)];
  const [top, right, bottom, left] = trimmed;
  const corners = [[left, top], [1 - right, top], [1 - right, 1 - bottom], [left, 1 - bottom]].map(mapping([[0, 0], [1, 0], [1, 1], [0, 1]], quad));
  return { corners, trimmed, off };
}

