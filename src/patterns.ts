// Foil patterns: what a foil looks like inside the part of a face that shines (src/foil.ts says where that is). About
// 150 named foils, Pokémon holos and reverses to Topps refractors and Panini prizms, come down to the eleven patterns
// below with a few settings each (docs/foil-patterns.md, sources in docs/foil-patterns-research.md). A pattern breaks
// the foil into pieces: each its own film thickness, so its own color at any angle, and its own tilt, so its own
// moment to flash; the piece-by-piece flashing is what makes foil look like foil rather than one sheet shifting at
// once (the idea came from React Bits' Holo Card, 2026-10, drawn here our own way). Between the pieces lies plain
// rainbow film or, on a mirror base, bare metal.
//
// A tint isn't drawn: a gold refractor's gold is in its printing, which the photo already carries, and metal reflects
// in the color it's printed. ponytail: shapes are sized to the face, not in mm; the symbols are simple stand-ins (a
// ball, a ring, a star, a chevron, a block) for each maker's own art.
import sharp from 'sharp';

/** A foil's look: its pattern, which kind of it, its pieces' size (a fraction of the face's width), angle, and base. */
export interface Look { pattern: string; kind?: string; size?: number; angle?: number; density?: number; base?: 'rainbow' | 'mirror' }

/** The patterns, as the vision models are asked to tell them apart, each with the look it has when nothing says more. */
export const PATTERNS: Record<string, { about: string; look: Look }> = {
  sweep: { about: 'no pieces, one smooth rainbow sweeping across as it turns: refractors, Silver Prizm, plain holo', look: { pattern: 'sweep', angle: 45 } },
  lines: { about: 'parallel stripes or streaks', look: { pattern: 'lines', angle: 90, size: 0.02 } },
  cells: { about: 'a regular grid of small squares or diamonds: X-Fractor, checkerboard, mosaic', look: { pattern: 'cells', kind: 'square', size: 0.04 } },
  motifs: { about: 'a repeated symbol: Poké Balls, energy or type symbols, logos, chevrons', look: { pattern: 'motifs', kind: 'ring', size: 0.1, base: 'mirror' } },
  points: { about: 'many tiny scattered sparkles, specks or stars', look: { pattern: 'points', kind: 'dot', size: 0.02, density: 0.5 } },
  circles: { about: 'scattered dots and rings of mixed sizes: cosmos, disco, pulsar', look: { pattern: 'circles', size: 0.06 } },
  shards: { about: 'cracked ice: irregular angular shards like broken glass', look: { pattern: 'shards', size: 0.05 } },
  flow: { about: 'flowing waves, ripples or lava-like blobs', look: { pattern: 'flow', kind: 'wave', size: 0.03, angle: 30 } },
  radial: { about: 'one big feature centered on the card: rings, a spiral or rays (superfractor, gold vinyl, scope)', look: { pattern: 'radial', kind: 'spiral', size: 0.015 } },
  skin: { about: 'an animal or camo print: zebra, tiger, snakeskin, scales, peacock, camo', look: { pattern: 'skin', kind: 'scales', size: 0.05 } },
  maze: { about: 'an etched maze or chain-link: mojo', look: { pattern: 'maze', size: 0.05 } },
};

// The words in parallel names that name a look (colors are tints, not looks). From vaultflip's PARALLEL_WORDS and the
// research; an ambiguous word goes to its commonest use, and raywave follows the maker (src/foil.ts foilLook).
const words = (list: string, look: Look) => Object.fromEntries(list.split(' ').map((word) => [word, look]));
export const WORDS: Record<string, Look> = {
  ...words('refractor fractor reflector prizm holo holographic mirror rainbow spectrum gradient glow foil foilfractor foilfactor', { pattern: 'sweep', angle: 45 }),
  ...words('tinsel', { pattern: 'lines', angle: 0, size: 0.02 }),
  ...words('velocity vapor', { pattern: 'lines', angle: 30, size: 0.012 }),
  ...words('shimmer', { pattern: 'lines', angle: 60, size: 0.015 }),
  ...words('groove', { pattern: 'lines', angle: 0, size: 0.008 }),
  ...words('laser lazer vector rayfoil', { pattern: 'lines', angle: 75, size: 0.025 }),
  ...words('shock lightning', { pattern: 'lines', kind: 'zigzag', angle: 70, size: 0.06 }),
  ...words('xfractor', { pattern: 'cells', kind: 'checker', size: 0.04 }),
  ...words('checkerboard checker', { pattern: 'cells', kind: 'checker', size: 0.06 }),
  ...words('crosshatch prism', { pattern: 'cells', kind: 'diamond', size: 0.04 }),
  ...words('mosaic', { pattern: 'cells', kind: 'square', size: 0.025 }),
  ...words('hyper', { pattern: 'cells', kind: 'square', size: 0.015 }),
  ...words('diamond diamonds minidiamond diamante', { pattern: 'cells', kind: 'diamond', size: 0.025 }),
  ...words('atomic', { pattern: 'cells', kind: 'square', size: 0.05 }),
  ...words('plaid', { pattern: 'cells', kind: 'plaid', size: 0.08 }),
  ...words('logofractor cupfractor packfractor', { pattern: 'motifs', kind: 'block', size: 0.1, base: 'rainbow' }),
  ...words('pokeball masterball', { pattern: 'motifs', kind: 'ball', size: 0.12, base: 'mirror' }),
  ...words('energy', { pattern: 'motifs', kind: 'ring', size: 0.1, base: 'mirror' }),
  ...words('chevron', { pattern: 'motifs', kind: 'chevron', size: 0.1, base: 'mirror' }),
  ...words('speckle dust scintillate', { pattern: 'points', kind: 'dot', size: 0.02, density: 0.5 }),
  ...words('glitter sandglitter', { pattern: 'points', kind: 'dot', size: 0.01, density: 0.8 }),
  ...words('sparkle starlight starfractor star',{ pattern: 'points', kind: 'star', size: 0.04, density: 0.5 }),
  ...words('confetti pixel', { pattern: 'points', kind: 'square', size: 0.025, density: 0.6 }),
  ...words('dazzle razzle', { pattern: 'points', kind: 'square', size: 0.012, density: 0.8 }),
  ...words('sequin', { pattern: 'points', kind: 'hex', size: 0.03, density: 0.8 }),
  ...words('cosmos cosmic galaxy galactic constellation interstellar', { pattern: 'circles', size: 0.07 }),
  ...words('disco bubble bubbles dots circles pulsar pulse nucleus', { pattern: 'circles', kind: 'dots', size: 0.03 }),
  ...words('lunar', { pattern: 'circles', kind: 'rings', size: 0.1 }),
  ...words('cracked ice icy crystal crystals crackle shattered shatter frozenfractor sapphire glass', { pattern: 'shards', size: 0.05 }),
  ...words('wave waves raywave riptide vibrations sonar', { pattern: 'flow', kind: 'wave', size: 0.03, angle: 30 }),
  ...words('ripple', { pattern: 'flow', kind: 'ripple', size: 0.02 }),
  ...words('lava lave molten', { pattern: 'flow', kind: 'lava', size: 0.05 }),
  ...words('swirl marble nebula genesis haze', { pattern: 'flow', kind: 'marble', size: 0.08 }),
  ...words('tiedye psychedelic', { pattern: 'flow', kind: 'tiedye', size: 0.04 }),
  ...words('superfractor vinyl', { pattern: 'radial', kind: 'spiral', size: 0.015 }),
  ...words('scope', { pattern: 'radial', kind: 'rings', size: 0.04 }),
  ...words('sunburst starburst', { pattern: 'radial', kind: 'rays', density: 48 }),
  ...words('pinwheel kaleidoscope', { pattern: 'radial', kind: 'pinwheel', density: 12 }),
  ...words('fireworks explosion xplosion', { pattern: 'radial', kind: 'bursts', size: 0.06 }),
  ...words('zebra', { pattern: 'skin', kind: 'zebra', size: 0.06 }),
  ...words('tiger', { pattern: 'skin', kind: 'tiger', size: 0.08 }),
  ...words('snake snakeskin reptilian dragon koi scale',{ pattern: 'skin', kind: 'scales', size: 0.05 }),
  ...words('elephant', { pattern: 'skin', kind: 'elephant', size: 0.06 }),
  ...words('peacock', { pattern: 'skin', kind: 'peacock', size: 0.12 }),
  ...words('camo', { pattern: 'skin', kind: 'camo', size: 0.06 }),
  ...words('blossom', { pattern: 'skin', kind: 'blossom', size: 0.08 }),
  ...words('mojo choice', { pattern: 'maze', size: 0.05 }),
};
/** Topps' RayWave radiates; Panini's waves. */
export const TOPPS_RAYWAVE: Look = { pattern: 'radial', kind: 'rays', density: 64 };

/** A number in [0, 1) for a piece and what's asked of it, the same every run. */
export function hash(x: number, y: number, k: number): number {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(k, 2246822519);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 2 ** 32;
}
const fract = (x: number) => x - Math.floor(x);
const tri = (x: number) => Math.abs(fract(x) * 2 - 1); // 0 → 1 → 0 over each whole number
const rot = (x: number, y: number, deg: number) => {
  const [c, s] = [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
  return [x * c + y * s, -x * s + y * c];
};
/** Smooth noise in [0, 1): a few octaves of hashed corners, eased between. */
function noise(x: number, y: number): number {
  const one = (x: number, y: number) => {
    const [i, j] = [Math.floor(x), Math.floor(y)];
    const [fx, fy] = [x - i, y - j].map((t) => t * t * (3 - 2 * t));
    const [a, b, c, d] = [hash(i, j, 9), hash(i + 1, j, 9), hash(i, j + 1, 9), hash(i + 1, j + 1, 9)];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  return (one(x, y) * 4 + one(x * 2 + 5.2, y * 2 + 1.3) * 2 + one(x * 4 + 1.7, y * 4 + 9.2)) / 7;
}
/** Is (x, y), in a cell's own units around its middle, inside a symbol of `kind` about `r` across? */
function inside(kind: string, x: number, y: number, r: number): boolean {
  const [d, a] = [Math.hypot(x, y), Math.atan2(y, x)];
  if (kind === 'square' || kind === 'block') return Math.max(Math.abs(x), Math.abs(y) * (kind === 'block' ? 1.6 : 1)) < r;
  if (kind === 'hex') return Math.max(Math.abs(x) * 0.866 + Math.abs(y) * 0.5, Math.abs(y)) < r;
  if (kind === 'star') return d < r * (0.42 + 0.58 * tri((a / (2 * Math.PI)) * 5) ** 2);
  if (kind === 'ring') return d < r && d > r * 0.66;
  if (kind === 'ball') return d < r && !(Math.abs(y) < r * 0.09 && d > r * 0.26) && !(d > r * 0.17 && d < r * 0.26);
  if (kind === 'chevron') return Math.abs(x) < r && y > -r * 0.5 + Math.abs(x) * 0.6 && y < Math.abs(x) * 0.6;
  if (kind === 'blossom') return d < r * (0.55 + 0.45 * Math.abs(Math.cos(2.5 * a)));
  return d < r; // a dot
}
/** The nearest of the points scattered one to a grid square (each in its square's middle half, so the 3 × 3 around always holds it), and the next nearest. */
function nearest(x: number, y: number): { i: number; j: number; d: number; second: number } {
  let [i, j, d, second] = [0, 0, Infinity, Infinity];
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const [ci, cj] = [Math.floor(x) + di, Math.floor(y) + dj];
      const e = Math.hypot(ci + 0.25 + hash(ci, cj, 0) / 2 - x, cj + 0.25 + hash(ci, cj, 1) / 2 - y);
      if (e < d) [second, i, j, d] = [d, ci, cj, e];
      else if (e < second) second = e;
    }
  }
  return { i, j, d, second };
}

/** What lies at (u, v) on a face `aspect` tall per wide (u across 0–1, v down 0–aspect): which piece, whether it's part of the pattern, and a set thickness or flatness for the patterns that aren't pieces. */
interface Spot { a: number; b: number; on: boolean; t?: number; flat?: boolean }
export function spot(look: Look, u: number, v: number, aspect: number): Spot {
  const { kind, angle = 0 } = look;
  const size = look.size ?? PATTERNS[look.pattern]?.look.size ?? 0.05;
  const [x, y] = [u / size, v / size];
  const [i, j] = [Math.floor(x), Math.floor(y)];
  const [fx, fy] = [x - i, y - j];
  const [cu, cv] = [u - 0.5, v - aspect / 2];
  const turn = fract(Math.atan2(cv, cu) / (2 * Math.PI));
  switch (look.pattern) {
    case 'sweep': return { a: 0, b: 0, on: true, t: tri(rot(u, v, angle)[0] * 1.2), flat: true };
    case 'lines': {
      const [along, across] = rot(u, v, angle);
      const s = (across + (kind === 'zigzag' ? size * 0.6 * tri(along / (size * 0.8)) : 0)) / size;
      return { a: Math.floor(s), b: 0, on: fract(s) < 0.6 };
    }
    case 'cells': {
      if (kind === 'plaid') return { a: fx < 0.35 ? i : -1, b: fy < 0.35 ? j : -1, on: fx < 0.35 || fy < 0.35 };
      const [dx, dy] = kind === 'diamond' ? rot(u, v, 45).map((c) => c / size) : [x, y];
      const [ci, cj] = [Math.floor(dx), Math.floor(dy)];
      const edge = Math.min(fract(dx), fract(dy), 1 - fract(dx), 1 - fract(dy));
      // X-Fractor and checkerboard: neighbors alternate, two thicknesses in a checker.
      return { a: ci, b: cj, on: edge > 0.06, ...(kind === 'checker' && { t: (ci + cj) & 1 ? 0.2 : 0.8 }) };
    }
    case 'motifs': return { a: i, b: j, on: inside(kind ?? 'ring', fx - 0.5, fy - 0.5, 0.38) };
    case 'points': {
      const [px, py] = [0.25 + hash(i, j, 6) / 2, 0.25 + hash(i, j, 7) / 2];
      return { a: i, b: j, on: hash(i, j, 5) < (look.density ?? 0.5) && inside(kind ?? 'dot', fx - px, fy - py, 0.12 + 0.13 * hash(i, j, 8)) };
    }
    case 'circles': {
      // Dots and rings up to almost a square across, so the squares around are looked in too.
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const [ci, cj] = [i + di, j + dj];
          const r = kind === 'dots' ? 0.2 + 0.15 * hash(ci, cj, 8) : 0.1 + 0.35 * hash(ci, cj, 8);
          const d = Math.hypot(ci + 0.25 + hash(ci, cj, 6) / 2 - x, cj + 0.25 + hash(ci, cj, 7) / 2 - y);
          const ring = kind === 'rings' || (kind !== 'dots' && hash(ci, cj, 5) < 0.5);
          if (d < r && (!ring || d > r - 0.08)) return { a: ci, b: cj, on: true };
        }
      }
      return { a: 0, b: 0, on: false };
    }
    case 'shards': { const { i: a, j: b } = nearest(x, y); return { a, b, on: true }; }
    case 'flow': {
      if (kind === 'ripple') {
        const { i: a, j: b, d } = nearest(x / 8, y / 8);
        return { a: Math.floor(d * 8) * 7919 + a, b, on: fract(d * 8) < 0.6 };
      }
      const n = noise(u / (size * 4), v / (size * 4));
      if (kind === 'lava') return { a: Math.floor(n * 8), b: 0, on: n > 0.48, t: tri(n * 3), flat: true };
      if (kind === 'marble') return { a: 0, b: 0, on: true, t: tri(n * 3 + u * 0.5), flat: true };
      if (kind === 'tiedye') return { a: 0, b: 0, on: true, t: tri(Math.hypot(cu, cv) / (size * 2) + n * 1.5 + turn), flat: true };
      const [along, across] = rot(u, v, angle);
      const s = (across + size * 1.2 * Math.sin((along / (size * 4)) * 2 * Math.PI)) / size;
      return { a: Math.floor(s), b: 0, on: fract(s) < 0.7 };
    }
    case 'radial': {
      const r = Math.hypot(cu, cv);
      if (kind === 'rings') return { a: Math.floor(r / size), b: 0, on: fract(r / size) < 0.75 };
      if (kind === 'spiral') return { a: Math.floor(r / size + turn), b: 0, on: fract(r / size + turn) < 0.75 };
      if (kind === 'rays' || kind === 'pinwheel') {
        const s = turn * (look.density ?? 48);
        return { a: Math.floor(s), b: 0, on: kind === 'pinwheel' || fract(s) < 0.55, ...(kind === 'pinwheel' && { t: fract(s) }) };
      }
      // Bursts (fireworks): rays around the nearest of scattered centers.
      const { i: a, j: b, d } = nearest(x / 6, y / 6);
      const c = [(a + 0.25 + hash(a, b, 0) / 2) * 6, (b + 0.25 + hash(a, b, 1) / 2) * 6];
      const s = fract(Math.atan2(y - c[1], x - c[0]) / (2 * Math.PI)) * 14;
      return { a, b: b * 100 + Math.floor(s), on: d < 0.4 && fract(s) < 0.35 };
    }
    case 'skin': {
      const n = noise(u * 3, v * 3);
      if (kind === 'zebra' || kind === 'tiger') {
        const s = (rot(u, v, 20)[0] + n * 0.15) / size;
        return { a: Math.floor(s), b: 0, on: fract(s) < (kind === 'tiger' ? 0.9 * noise(u * 6 + 3, v * 6) : 0.5) };
      }
      if (kind === 'scales') {
        // Rows of round scales hanging from the row's top edge, each row shifted half a scale; a row's scales lie over
        // the tops of the row below's.
        for (const row of [j, j + 1]) {
          const sx = x + (row & 1) * 0.5;
          if (Math.hypot(fract(sx) - 0.5, y - row) < 0.6) return { a: Math.floor(sx), b: row, on: true };
        }
        return { a: 0, b: 0, on: false };
      }
      if (kind === 'camo') { const m = noise(u / (size * 3), v / (size * 3)); return { a: Math.floor(m * 5), b: 1, on: true }; }
      if (kind === 'elephant') { const e = nearest(x, y); return { a: e.i, b: e.j, on: e.second - e.d < 0.08 }; }
      if (kind === 'peacock') { const d = Math.hypot(fx - 0.5, fy - 0.5); return { a: i, b: j * 10 + Math.floor(d / 0.1), on: d < 0.42 }; }
      return { a: i, b: j, on: inside('blossom', fx - 0.5, fy - 0.5, 0.42) };
    }
    case 'maze': {
      // Truchet: quarter circles joining the middles of a square's sides, turned one way or the other square by square.
      const qx = hash(i, j, 5) < 0.5 ? 1 - fx : fx;
      const [d1, d2] = [Math.abs(Math.hypot(qx, fy) - 0.5), Math.abs(Math.hypot(1 - qx, 1 - fy) - 0.5)];
      return { a: i, b: j * 2 + (d1 < d2 ? 0 : 1), on: Math.min(d1, d2) < 0.12 };
    }
    default: throw new Error(`no foil pattern "${look.pattern}"`);
  }
}

const TILT = 0.25; // the most a piece leans from flat, as a normal's sideways part: higher, the flashes spread wider

/**
 * A w × h face's foil drawn in `look`, `map` its foil map as raw RGB (red the film): each spot's film thickness (a
 * gray PNG), each piece's tilt where there's film (a normal map), and the map again, its film taken off between the
 * pieces on a mirror base.
 */
export async function patterned(look: Look, w: number, h: number, map: Buffer): Promise<{ map: Uint8Array; thickness: Uint8Array; facets: Uint8Array }> {
  const [thickness, facets] = [Buffer.alloc(w * h), Buffer.alloc(w * h * 3)];
  const mirror = (look.base ?? PATTERNS[look.pattern]?.look.base) === 'mirror';
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const film = map[p * 3] > 127;
      const s = spot(look, x / w, y / w, h / w);
      thickness[p] = Math.round(255 * (s.on ? (s.t ?? hash(s.a, s.b, 2)) : 0.5));
      if (film && !s.on && mirror) map[p * 3] = 0;
      const [tx, ty] = film && s.on && !s.flat ? [TILT * (2 * hash(s.a, s.b, 3) - 1), TILT * (2 * hash(s.a, s.b, 4) - 1)] : [0, 0];
      facets.set([tx, ty, Math.sqrt(1 - tx * tx - ty * ty)].map((c) => Math.round(127.5 + 127.5 * c)), p * 3);
    }
  }
  const png = (data: Buffer, channels: 1 | 3) => sharp(data, { raw: { width: w, height: h, channels } }).png().toBuffer();
  return { map: await png(map, 3), thickness: await png(thickness, 1), facets: await png(facets, 3) };
}
