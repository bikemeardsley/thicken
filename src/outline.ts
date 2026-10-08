// The outline of a badge image, traced from its transparency: one outer
// boundary per separate opaque region (a medal and a ribbon that doesn't
// touch it are two), in pixel coordinates (y down), plus the color just
// inside the edge for the badge's sides. Holes inside a region are left to
// the front face's alpha mask.

export type Point = [number, number];

const ALPHA_CUTOFF = 128; // pixels at least half opaque are part of the badge
const MIN_REGION = 0.01; // regions smaller than this share of the opaque area are specks, not parts
const SIMPLIFY_PX = 1.25; // Douglas–Peucker tolerance, in source pixels
const EDGE_INSET_PX = 4; // where to sample the edge color, inside the outline

/** Trace raw image data (sharp's .raw() output, with alpha). */
export function trace(data: Buffer, width: number, height: number, channels: number): { outlines: Point[][]; edge: string } {
  const opaque = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && data[(y * width + x) * channels + 3] >= ALPHA_CUTOFF;

  const regions = labelRegions(opaque, width, height);
  const total = regions.reduce((sum, r) => sum + r.area, 0);
  const outlines = regions
    .filter((r) => r.area >= total * MIN_REGION)
    .map(({ label, start }) => {
      const inRegion = (x: number, y: number) => opaque(x, y) && regions.labels[y * width + x] === label;
      return simpleOutline(outerBoundary(inRegion, start));
    })
    .filter((points) => points.length >= 3); // a region one or two pixels across has no area to extrude
  if (outlines.length === 0) throw new Error('no opaque shape found to trace');

  return { outlines, edge: edgeColor(data, width, channels, outlines, opaque) };
}

/**
 * The boundary simplified as far as it can be without crossing itself — a
 * crossed outline triangulates into garbage. Simplifying a narrow neck can
 * pull its two sides across each other, so tighten until it doesn't.
 */
function simpleOutline(boundary: Point[]): Point[] {
  for (let tolerance = SIMPLIFY_PX; tolerance >= 0.25; tolerance /= 2) {
    const points = simplify(boundary, tolerance);
    if (!crossesItself(points)) return points;
  }
  return boundary;
}

/** Whether any two non-adjacent edges of a closed outline properly cross. */
function crossesItself(points: Point[]): boolean {
  const n = points.length;
  const side = ([ax, ay]: Point, [bx, by]: Point, [cx, cy]: Point) => Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // the closing edge touches the first
      const c = points[j];
      const d = points[(j + 1) % n];
      if (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) return true;
    }
  }
  return false;
}

/** Separate opaque regions (8-connected), each with its area and first pixel in raster order. */
function labelRegions(opaque: (x: number, y: number) => boolean, width: number, height: number) {
  const labels = new Int32Array(width * height);
  const found: { label: number; area: number; start: Point }[] = [];
  const stack: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!opaque(x, y) || labels[y * width + x]) continue;
      const label = found.length + 1;
      let area = 0;
      labels[y * width + x] = label;
      stack.push(y * width + x);
      while (stack.length > 0) {
        const i = stack.pop()!;
        area++;
        const px = i % width;
        const py = (i - px) / width;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = px + dx;
            const ny = py + dy;
            if ((dx || dy) && opaque(nx, ny) && !labels[ny * width + nx]) {
              labels[ny * width + nx] = label;
              stack.push(ny * width + nx);
            }
          }
        }
      }
      found.push({ label, area, start: [x, y] });
    }
  }
  return Object.assign(found, { labels });
}

/**
 * Moore-neighbor tracing of a region's outer boundary from its first pixel
 * in raster order, with Jacob's stopping criterion — stop on re-entering the
 * start the way we first left it — so a one-pixel spike or bridge at the
 * start can't end the trace early.
 */
function outerBoundary(inRegion: (x: number, y: number) => boolean, start: Point): Point[] {
  // Clockwise neighbors, starting west.
  const around: Point[] = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];
  const next = (x: number, y: number, from: number): { x: number; y: number; from: number } | undefined => {
    for (let i = 0; i < 8; i++) {
      const dir = (from + i) % 8;
      const [dx, dy] = around[dir];
      if (inRegion(x + dx, y + dy)) {
        // Resume from the last empty neighbor checked, seen from the new
        // pixel: two steps back after a straight move, three after a diagonal.
        return { x: x + dx, y: y + dy, from: (dir + (dir % 2 === 0 ? 6 : 5)) % 8 };
      }
    }
    return undefined; // an isolated pixel
  };

  const [sx, sy] = start;
  const first = next(sx, sy, 0); // the pixel west of the first one in raster order is empty
  if (!first) return [start];
  const out: Point[] = [start];
  let current = first;
  for (let guard = 0; guard < 4_000_000; guard++) {
    if (current.x === sx && current.y === sy) {
      const again = next(sx, sy, current.from);
      if (again && again.x === first.x && again.y === first.y) break;
    }
    out.push([current.x, current.y]);
    const step = next(current.x, current.y, current.from);
    if (!step) break;
    current = step;
  }
  return out;
}

/** Ramer–Douglas–Peucker on a closed outline. */
function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length < 4) return points;
  // Split the loop at its farthest point from the start so both halves are open paths.
  const [sx, sy] = points[0];
  let far = 0;
  let farDist = -1;
  points.forEach(([x, y], i) => {
    const d = (x - sx) ** 2 + (y - sy) ** 2;
    if (d > farDist) { farDist = d; far = i; }
  });
  const a = rdp(points.slice(0, far + 1), tolerance);
  const b = rdp([...points.slice(far), points[0]], tolerance);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

function rdp(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  const [ax, ay] = points[0];
  const [bx, by] = points[points.length - 1];
  const len = Math.hypot(bx - ax, by - ay) || 1;
  let index = 0;
  let max = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    const d = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
    if (d > max) { max = d; index = i; }
  }
  if (max <= tolerance) return [points[0], points[points.length - 1]];
  return [...rdp(points.slice(0, index + 1), tolerance).slice(0, -1), ...rdp(points.slice(index), tolerance)];
}

/**
 * Average color just inside the outlines. Each vertex is sampled along its
 * own inward normal — not towards the image center, which points *out* of a
 * concave badge — stepping closer to the edge for thin parts.
 */
function edgeColor(
  data: Buffer, width: number, channels: number,
  outlines: Point[][], opaque: (x: number, y: number) => boolean,
): string {
  let r = 0, g = 0, b = 0, n = 0;
  for (const points of outlines) {
    // Which side is inside: the outline's winding, from its signed area (y down).
    const area = points.reduce((sum, [x, y], i) => {
      const [nx, ny] = points[(i + 1) % points.length];
      return sum + x * ny - nx * y;
    }, 0);
    const inward = area > 0 ? 1 : -1;
    points.forEach(([px, py], i) => {
      const [ax, ay] = points[(i - 1 + points.length) % points.length];
      const [bx, by] = points[(i + 1) % points.length];
      const length = Math.hypot(bx - ax, by - ay) || 1;
      const nx = (-(by - ay) / length) * inward;
      const ny = ((bx - ax) / length) * inward;
      for (const inset of [EDGE_INSET_PX, EDGE_INSET_PX / 2, 1]) {
        const x = Math.round(px + nx * inset);
        const y = Math.round(py + ny * inset);
        if (!opaque(x, y)) continue;
        const k = (y * width + x) * channels;
        r += data[k]; g += data[k + 1]; b += data[k + 2]; n++;
        break;
      }
    });
  }
  if (n === 0) return '#808080';
  const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
