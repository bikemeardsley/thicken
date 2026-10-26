// The edges seat: an object's outline found in a photo by its straight edges alone, with no model asked, as a
// scanner app finds a page. The photo, shrunk and blurred a little (granite and wood grain make edges of their
// own), gives each pixel its brightness step; the strongest straight lines through those steps are found (a Hough
// transform); every four of them that close into a quad of a shape the profile expects is scored by how much of
// its outline runs along a real edge; and the largest well-supported one wins, so a slab beats the card and the
// label inside it. It says where the object is, never which face or which way up: those stay the models' to say
// (src/vision.ts settle). It abstains when nothing fits, rather than guess.
// Measured against the training set's agreed outlines (2026-10-25): raw cards 7 right, 1 wrong, 2 abstained of 10;
// slabs 4 right, 12 wrong of 22 (clear plastic on granite has a faint outer edge, its card a strong one). So it
// votes only on faces whose edges a profile trusts (not `unsnapped`): a card's sides, not a slab's.
import sharp from 'sharp';
import type { Picture } from './image.ts';

const SMALL = 400; // px, the long side looked at: plenty for an outline, and quick
const ANGLES = 180; // one a degree
const LINES = 20; // the strongest lines kept
const PARALLEL = 12; // degrees: a quad's opposite sides, seen at an angle, are this near parallel
const SQUARE = 30; // degrees off a right angle its neighboring sides may be
const SAMPLES = 25; // points along each side scored
const SIDE_SUPPORT = 0.5; // the least share of each side's points on an edge
const SUPPORT = 0.65; // the least share of the whole outline's
const SHAPE_SLACK = 0.08; // how far off a shape the profile expects it may look: wider let a slab's card pass for the slab

/** A picture's brightness steps, shrunk, with ways to find its outline and to score corners against its edges. */
export async function edgesOf(picture: Picture) {
  const { data, info: { width: w, height: h } } = await sharp(picture.data, { raw: { width: picture.width, height: picture.height, channels: 4 } })
    .resize(SMALL, SMALL, { fit: 'inside' }).removeAlpha().greyscale().blur(1.2).raw().toBuffer({ resolveWithObject: true });
  const scale = w / picture.width;
  const [gx, gy, size] = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const at = (dx: number, dy: number) => data[(y + dy) * w + x + dx];
      const i = y * w + x;
      gx[i] = at(1, -1) + 2 * at(1, 0) + at(1, 1) - at(-1, -1) - 2 * at(-1, 0) - at(-1, 1);
      gy[i] = at(-1, 1) + 2 * at(0, 1) + at(1, 1) - at(-1, -1) - 2 * at(0, -1) - at(1, -1);
      size[i] = Math.hypot(gx[i], gy[i]);
    }
  }
  // An edge is a step among the strongest tenth, and never a faint one.
  const strong = Math.max(40, [...size].sort((a, b) => a - b)[Math.floor(0.9 * size.length)]);

  /** The share of points along a quad's sides (in the shrunk picture) where an edge runs along the side; and the weakest side's. */
  const along = (quad: number[][]) => {
    const sides = quad.map((a, k) => {
      const b = quad[(k + 1) % 4];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const [nx, ny] = [-(b[1] - a[1]) / length, (b[0] - a[0]) / length];
      let on = 0;
      for (let s = 0; s < SAMPLES; s++) {
        const t = (s + 0.5) / SAMPLES;
        const [px, py] = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
        // An edge within a pixel or so of the side, stepping across it, not along it.
        on += [-1.5, 0, 1.5].some((d) => {
          const [x, y] = [Math.round(px + d * nx), Math.round(py + d * ny)];
          if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return false;
          const i = y * w + x;
          return size[i] >= strong && Math.abs(gx[i] * nx + gy[i] * ny) >= 0.8 * size[i];
        }) ? 1 : 0;
      }
      return on / SAMPLES;
    });
    return { mean: sides.reduce((sum, s) => sum + s, 0) / 4, weakest: Math.min(...sides) };
  };

  return {
    /** How much of four corners' outline (in the picture's own pixels) runs along a real edge, 0 to 1. */
    support: (corners: number[][]) => along(corners.map(([x, y]) => [x * scale, y * scale])).mean,

    /** The object's outline (in the picture's own pixels, clockwise from the top left), if one is of a shape in `shapes` (width over height). */
    outline(shapes: number[]): number[][] | undefined {
      const diagonal = Math.ceil(Math.hypot(w, h));
      const votes = new Float32Array(ANGLES * (2 * diagonal + 1));
      const [cos, sin] = [0, 1].map((k) => Float32Array.from({ length: ANGLES }, (_, a) => (k ? Math.sin : Math.cos)((a * Math.PI) / ANGLES)));
      for (let i = 0; i < size.length; i++) {
        if (size[i] < strong) continue;
        const [x, y] = [i % w, Math.floor(i / w)];
        // Each step votes only for lines across its own direction, give or take a few degrees.
        const facing = Math.round((((Math.atan2(gy[i], gx[i]) + Math.PI) % Math.PI) * ANGLES) / Math.PI);
        for (let d = -3; d <= 3; d++) {
          const a = (facing + d + ANGLES) % ANGLES;
          votes[a * (2 * diagonal + 1) + Math.round(x * cos[a] + y * sin[a]) + diagonal] += size[i];
        }
      }
      // The strongest lines, each one apart from those already kept.
      const lines: { angle: number; rho: number }[] = [];
      for (const k of [...votes.keys()].filter((k) => votes[k] > 0).sort((a, b) => votes[b] - votes[a])) {
        const [angle, rho] = [Math.floor(k / (2 * diagonal + 1)), (k % (2 * diagonal + 1)) - diagonal];
        const apart = lines.every((line) => {
          const turn = Math.abs(line.angle - angle);
          return turn <= 4 ? Math.abs(line.rho - rho) > 8 : turn >= ANGLES - 4 ? Math.abs(line.rho + rho) > 8 : true;
        });
        if (apart) lines.push({ angle, rho });
        if (lines.length === LINES) break;
      }
      const between = (a: number, b: number) => { const turn = Math.abs(a - b) % ANGLES; return Math.min(turn, ANGLES - turn); };
      const meet = (p: { angle: number; rho: number }, q: { angle: number; rho: number }) => {
        const det = cos[p.angle] * sin[q.angle] - sin[p.angle] * cos[q.angle];
        return [(p.rho * sin[q.angle] - q.rho * sin[p.angle]) / det, (q.rho * cos[p.angle] - p.rho * cos[q.angle]) / det];
      };
      // Opposite sides: two lines near parallel, well apart.
      const pairs: [typeof lines[0], typeof lines[0]][] = [];
      for (let i = 0; i < lines.length; i++) {
        for (let j = i + 1; j < lines.length; j++) {
          const [p, q] = [lines[i], lines[j]];
          const flipped = Math.abs(p.angle - q.angle) > ANGLES / 2;
          if (between(p.angle, q.angle) <= PARALLEL && Math.abs(p.rho - (flipped ? -q.rho : q.rho)) > 0.15 * Math.min(w, h)) pairs.push([p, q]);
        }
      }
      let best: { quad: number[][]; area: number } | undefined;
      const want = shapes.map((shape) => Math.min(shape, 1 / shape));
      for (let i = 0; i < pairs.length; i++) {
        for (let j = i + 1; j < pairs.length; j++) {
          const [[a, b], [c, d]] = [pairs[i], pairs[j]];
          if (Math.abs(between(a.angle, c.angle) - 90) > SQUARE) continue;
          const points = [meet(a, c), meet(c, b), meet(b, d), meet(d, a)];
          if (points.some(([x, y]) => !(x > -0.02 * w && x < 1.02 * w && y > -0.02 * h && y < 1.02 * h))) continue;
          const quad = clockwiseFromTopLeft(points);
          if (!convex(quad)) continue;
          const [across, down] = [(side(quad[0], quad[1]) + side(quad[3], quad[2])) / 2, (side(quad[0], quad[3]) + side(quad[1], quad[2])) / 2];
          const look = Math.min(across / down, down / across);
          if (!want.some((shape) => Math.abs(look / shape - 1) <= SHAPE_SLACK)) continue;
          const { mean, weakest } = along(quad);
          if (mean < SUPPORT || weakest < SIDE_SUPPORT) continue;
          const area = across * down;
          if (!best || area > best.area) best = { quad, area };
        }
      }
      return best?.quad.map(([x, y]) => [x / scale, y / scale]);
    },
  };
}

const side = (a: number[], b: number[]) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Four points around their middle, clockwise on screen (y down), starting from the one nearest the top left. */
function clockwiseFromTopLeft(points: number[][]): number[][] {
  const [mx, my] = [0, 1].map((k) => points.reduce((sum, p) => sum + p[k], 0) / 4);
  const around = [...points].sort((p, q) => Math.atan2(p[1] - my, p[0] - mx) - Math.atan2(q[1] - my, q[0] - mx));
  const first = around.reduce((best, p, k) => (p[0] + p[1] < around[best][0] + around[best][1] ? k : best), 0);
  return [...around.slice(first), ...around.slice(0, first)];
}

/** Whether a quad's corners all turn the same way. */
function convex(quad: number[][]): boolean {
  const turns = quad.map((p, k) => {
    const [q, r] = [quad[(k + 1) % 4], quad[(k + 2) % 4]];
    return Math.sign((q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]));
  });
  return turns.every((t) => t === turns[0] && t !== 0);
}
