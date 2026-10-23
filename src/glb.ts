// Geometry to GLB, shared by every profile, and the softly rounded, textured
// box that books and slabs are made of. Units are meters (glTF's), front faces
// +Z, Y up. Photos and plain materials are lit (glTF's metallic-roughness), so
// a model shades as it turns, the way the object does; artwork is unlit, its
// own colors in any viewer.
import { ColorUtils, Document, NodeIO, type Material, type Mesh, type TypedArray, type vec4 } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRMaterialsIridescence, KHRMaterialsUnlit } from '@gltf-transform/extensions';

export interface Part { position: number[]; normal: number[]; uv: number[]; index: number[] }
export const emptyPart = (): Part => ({ position: [], normal: [], uv: [], index: [] });

const BEVEL_STEPS = 4; // rows of vertices across each face's rounded margin: enough for a smooth highlight

/** Add a part to the mesh as one primitive (one draw call). */
export function addPart(doc: Document, mesh: Mesh, part: Part, material: Material): void {
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const accessor = (type: 'SCALAR' | 'VEC2' | 'VEC3', array: TypedArray) =>
    doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const primitive = doc.createPrimitive()
    .setMaterial(material)
    .setIndices(accessor('SCALAR', new Uint32Array(part.index)))
    .setAttribute('POSITION', accessor('VEC3', new Float32Array(part.position)))
    .setAttribute('NORMAL', accessor('VEC3', new Float32Array(part.normal)));
  if (part.uv.length) primitive.setAttribute('TEXCOORD_0', accessor('VEC2', new Float32Array(part.uv)));
  mesh.addPrimitive(primitive);
}

/** A picture (photo or artwork) on a matte, non-metal surface. */
export function pictureMaterial(doc: Document, name: string, image: Uint8Array, mimeType: 'image/png' | 'image/jpeg', roughness = 0.6): Material {
  return doc.createMaterial(name)
    .setBaseColorTexture(doc.createTexture(name).setImage(image).setMimeType(mimeType))
    .setMetallicFactor(0)
    .setRoughnessFactor(roughness);
}

/**
 * Foil on a picture: where the map says so, the surface is metal under a thin film whose colors shift as it turns
 * (KHR_materials_iridescence), as holofoil flashes when a card is tilted; elsewhere it stays print. One PNG serves
 * both, in glTF's own channels: red the film, green the roughness, blue the metalness. The film's index and
 * thickness range are the extension's defaults, as Khronos's sample models use them; where in that range each piece
 * of foil lies, and which way it tilts, come from its pattern (src/foil.ts).
 */
export function foiled(doc: Document, material: Material, { map, thickness, facets, film: shines }: Foil): Material {
  const png = (name: string, image: Uint8Array) => doc.createTexture(`${material.getName()}-${name}`).setImage(image).setMimeType('image/png');
  if (!shines) return material.setNormalTexture(png('facets', facets)); // an emboss on print alone
  const texture = png('foil', map);
  const film = doc.createExtension(KHRMaterialsIridescence).createIridescence()
    .setIridescenceFactor(1).setIridescenceTexture(texture).setIridescenceIOR(1.3)
    .setIridescenceThicknessTexture(png('film', thickness))
    .setIridescenceThicknessMinimum(100).setIridescenceThicknessMaximum(400);
  return material.setMetallicFactor(1).setRoughnessFactor(1).setMetallicRoughnessTexture(texture)
    .setNormalTexture(png('facets', facets)).setExtension('KHR_materials_iridescence', film);
}

/** Artwork exactly as it is: unlit, so it shows its own colors whatever the viewer's lights. */
export const unlit = (doc: Document, material: Material): Material =>
  material.setExtension('KHR_materials_unlit', doc.createExtension(KHRMaterialsUnlit).createUnlit());

/**
 * Clear plastic: glossy and alpha-blended, so any viewer shows what's behind it, the page included. glTF's
 * transmission would refract only what's in the scene: on a page, behind a see-through canvas, the clear parts
 * came out white (model-viewer, 2026-10-03), and viewers without the extension draw it solid.
 */
export const clearMaterial = (doc: Document, name: string, opacity = 0.12): Material =>
  doc.createMaterial(name).setBaseColorFactor([1, 1, 1, opacity]).setAlphaMode('BLEND').setMetallicFactor(0).setRoughnessFactor(0.05);

/** A plain material in an sRGB color (#rrggbb); glTF wants it linear. */
export function colorMaterial(doc: Document, name: string, color: string, roughness: number): Material {
  return doc.createMaterial(name)
    .setBaseColorFactor(ColorUtils.hexToFactor(parseInt(color.slice(1), 16), [0, 0, 0, 1] as vec4))
    .setMetallicFactor(0)
    .setRoughnessFactor(roughness);
}

export async function toGlb(doc: Document, mesh: Mesh): Promise<Uint8Array> {
  const scene = doc.createScene().addChild(doc.createNode(mesh.getName()).setMesh(mesh));
  doc.getRoot().setDefaultScene(scene);
  // An extension the writer doesn't know is left out with only a console warning: register them all.
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).writeBinary(doc);
}

export type Face = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';
/** A face shows a JPEG picture or a plain color, foil where its map says (foiled). Faces given the same Side object share a draw call. */
export interface Side { picture?: Uint8Array; color?: string; roughness?: number; foil?: Foil }
/** A face's foil, as PNGs (src/foil.ts foilMap): where it is (foiled's map), each piece's film thickness (gray) and each piece's tilt and any emboss (a normal map); `film`, whether any of it shines. */
export interface Foil { map: Uint8Array; thickness: Uint8Array; facets: Uint8Array; film: boolean }

/** A Side's material. */
export function sideMaterial(doc: Document, name: string, side: Side): Material {
  const material = side.picture
    ? pictureMaterial(doc, name, side.picture, 'image/jpeg', side.roughness)
    : colorMaterial(doc, name, side.color ?? '#808080', side.roughness ?? 0.9);
  return side.foil ? foiled(doc, material, side.foil) : material;
}

/**
 * A box W × H × D mm, centered on the origin, its edges and corners rounded to
 * `radiusMm`. Every picture reads the right way round from outside: the back's
 * left edge is at +X (turn a book over and the spine is on your right), and the
 * left (-X) face's left edge is at the back, so a spine photo stands upright
 * with the front cover to its right.
 *
 * The rounding follows three's RoundedBoxGeometry: each face is a grid whose
 * rows and columns crowd its edges, every vertex moved onto the rounded hull
 * (the box shrunk by the radius, then grown back by it in every direction),
 * its normal pointing out of the shrunk box. A face's picture wraps over half
 * of each rounded edge and meets its neighbor's there, and the box still
 * measures W × H × D across its faces.
 */
export async function box(name: string, sizeMm: number[], sides: Record<Face, Side>, radiusMm = 0): Promise<Uint8Array> {
  const doc = new Document();
  const mesh = doc.createMesh(name);
  let i = 0;
  for (const [side, part] of roundedBox(sizeMm, sides, radiusMm)) {
    if (!side.picture) part.uv.length = 0;
    addPart(doc, mesh, part, sideMaterial(doc, `${name}-${i++}`, side));
  }
  return toGlb(doc, mesh);
}

/** box()'s geometry alone, its middle at `atMm`: one part per distinct Side, for putting more than a box in one model. */
export function roundedBox([widthMm, heightMm, depthMm]: number[], sides: Record<Face, Side>, radiusMm = 0, atMm = [0, 0, 0]): Map<Side, Part> {
  const [x, y, z] = [widthMm / 2000, heightMm / 2000, depthMm / 2000];
  const r = Math.min(radiusMm, 0.4 * Math.min(widthMm, heightMm, depthMm)) / 1000; // the rounded margins never meet
  const inner = [x - r, y - r, z - r];
  type V = [number, number, number];
  // Each face: its top-left corner seen from outside, then its rightward and downward edges.
  const faces: Record<Face, [V, V, V]> = {
    front: [[-x, y, z], [2 * x, 0, 0], [0, -2 * y, 0]],
    back: [[x, y, -z], [-2 * x, 0, 0], [0, -2 * y, 0]],
    left: [[-x, y, -z], [0, 0, 2 * z], [0, -2 * y, 0]],
    right: [[x, y, z], [0, 0, -2 * z], [0, -2 * y, 0]],
    top: [[-x, y, -z], [2 * x, 0, 0], [0, 0, 2 * z]],
    bottom: [[-x, -y, z], [2 * x, 0, 0], [0, 0, -2 * z]],
  };
  // Grid lines across a face side of this length: crowded into the rounded margin at each end.
  const ticks = (length: number) => {
    const margin = r / length;
    if (!margin) return [0, 1];
    const steps = [...Array(BEVEL_STEPS + 1).keys()].map((k) => (k / BEVEL_STEPS) * margin);
    return [...steps, ...steps.map((t) => 1 - t).reverse()];
  };

  const parts = new Map<Side, Part>();
  for (const [face, [corner, right, down]] of Object.entries(faces) as [Face, [V, V, V]][]) {
    const side = sides[face];
    const part = parts.get(side) ?? emptyPart();
    parts.set(side, part);
    // Outward normal: down × right, normalized.
    const n = [down[1] * right[2] - down[2] * right[1], down[2] * right[0] - down[0] * right[2], down[0] * right[1] - down[1] * right[0]];
    const flat = n.map((c) => c / Math.hypot(...n));
    const [us, ws] = [ticks(Math.hypot(...right)), ticks(Math.hypot(...down))];
    const first = part.position.length / 3;
    for (const w of ws) {
      for (const u of us) {
        const p = corner.map((c, i) => c + u * right[i] + w * down[i]);
        const core = p.map((c, i) => Math.max(-inner[i], Math.min(inner[i], c)));
        const out = p.map((c, i) => c - core[i]);
        const length = Math.hypot(...out);
        part.position.push(...(length ? core.map((c, i) => c + (out[i] * r) / length) : p).map((c, i) => c + atMm[i] / 1000));
        part.normal.push(...(length ? out.map((c) => c / length) : flat));
        part.uv.push(u, w);
      }
    }
    for (let j = 0; j + 1 < ws.length; j++) {
      for (let i = 0; i + 1 < us.length; i++) {
        const a = first + j * us.length + i;
        const [b, c, d] = [a + 1, a + us.length + 1, a + us.length];
        part.index.push(a, d, c, a, c, b);
      }
    }
  }

  return parts;
}

const CORNER_STEPS = 8; // segments in each rounded corner: smooth at a card's size

/**
 * A flat plate W × H × D mm, its corners rounded to `radiusMm` (0 for square), centered on `atMm` (x, y) and on
 * the origin in depth: a front (+Z) and a back for pictures, the back's left edge at +X as on box(), and the edge
 * all round. A rounded rectangle is convex, so each side is a fan from its middle.
 */
export function plate([widthMm, heightMm, depthMm]: number[], radiusMm = 0, atMm = [0, 0], zMm = 0): { front: Part; back: Part; edge: Part } {
  const [w, h, z] = [widthMm / 2000, heightMm / 2000, depthMm / 2000];
  const at = [...atMm, zMm].map((mm) => mm / 1000);
  const points = outline(w, h, radiusMm / 1000);
  const [front, back, edge] = [emptyPart(), emptyPart(), emptyPart()];
  for (const [side, sz, mirror] of [[front, 1, 1], [back, -1, -1]] as const) {
    for (const [x, y] of [[0, 0], ...points]) {
      side.position.push(at[0] + x, at[1] + y, at[2] + sz * z);
      side.normal.push(0, 0, sz);
      side.uv.push((1 + (mirror * x) / w) / 2, (1 - y / h) / 2); // glTF's UV origin is the picture's top left
    }
    for (let i = 1; i <= points.length; i++) {
      const next = (i % points.length) + 1;
      side.index.push(...(sz > 0 ? [0, i, next] : [0, next, i]));
    }
  }
  walls(edge, points, at, z);
  return { front, back, edge };
}

/**
 * A flat ring W × H × D mm around a hole, both rounded rectangles with their own corner radii, centered on `atMm`
 * and `zMm` in depth: a frame, closed all round (a holder's rim, the ridges framing what it holds).
 */
export function ring([widthMm, heightMm, depthMm]: number[], [holeWidthMm, holeHeightMm]: number[], [radiusMm, holeRadiusMm]: number[], atMm = [0, 0], zMm = 0): Part {
  const part = emptyPart();
  const at = [...atMm, zMm].map((mm) => mm / 1000);
  const z = depthMm / 2000;
  const outer = outline(widthMm / 2000, heightMm / 2000, radiusMm / 1000);
  const inner = outline(holeWidthMm / 2000, holeHeightMm / 2000, holeRadiusMm / 1000);
  // Front and back: a strip between the two outlines, point for point (they have as many).
  for (const sz of [1, -1]) {
    const first = part.position.length / 3;
    for (const [x, y] of [...outer, ...inner]) {
      part.position.push(at[0] + x, at[1] + y, at[2] + sz * z);
      part.normal.push(0, 0, sz);
    }
    const n = outer.length;
    for (let i = 0; i < n; i++) {
      const [o0, o1, i0, i1] = [first + i, first + ((i + 1) % n), first + n + i, first + n + ((i + 1) % n)];
      part.index.push(...(sz > 0 ? [o0, o1, i1, o0, i1, i0] : [o0, i1, o1, o0, i0, i1]));
    }
  }
  walls(part, outer, at, z);
  walls(part, inner, at, z, true);
  return part;
}

/** A rounded rectangle's outline, half-size w × h (m), counter-clockwise from its right side's top end: the same number of points whatever the radius (a square corner repeats its point). */
function outline(w: number, h: number, radius: number): number[][] {
  const r = Math.max(0, Math.min(radius, w, h));
  const points: number[][] = [];
  for (const [k, [sx, sy]] of [[1, 1], [-1, 1], [-1, -1], [1, -1]].entries()) {
    for (let s = 0; s <= CORNER_STEPS; s++) {
      const a = ((k + s / CORNER_STEPS) * Math.PI) / 2;
      points.push([sx * (w - r) + r * Math.cos(a), sy * (h - r) + r * Math.sin(a)]);
    }
  }
  return points;
}

/** The walls along an outline, ±z deep around `at`: facing out, or into the hole it bounds. */
function walls(part: Part, points: number[][], [cx, cy, cz]: number[], z: number, inward = false): void {
  points.forEach(([ax, ay], i) => {
    const [bx, by] = points[(i + 1) % points.length];
    const length = Math.hypot(bx - ax, by - ay);
    if (!length) return;
    const v = part.position.length / 3;
    part.position.push(cx + ax, cy + ay, cz + z, cx + bx, cy + by, cz + z, cx + bx, cy + by, cz - z, cx + ax, cy + ay, cz - z);
    const flip = inward ? -1 : 1;
    for (let k = 0; k < 4; k++) part.normal.push((flip * (by - ay)) / length, (flip * -(bx - ax)) / length, 0);
    part.index.push(...(inward ? [v, v + 2, v + 3, v, v + 1, v + 2] : [v, v + 3, v + 2, v, v + 2, v + 1]));
  });
}
