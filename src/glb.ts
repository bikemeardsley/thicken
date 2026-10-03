// Geometry to GLB, shared by every profile, and the softly rounded, textured
// box that books and slabs are made of. Units are meters (glTF's), front faces
// +Z, Y up. Photos and plain materials are lit (glTF's metallic-roughness), so
// a model shades as it turns, the way the object does; artwork is unlit, its
// own colors in any viewer.
import { ColorUtils, Document, NodeIO, type Material, type Mesh, type TypedArray, type vec4 } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRMaterialsUnlit } from '@gltf-transform/extensions';

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

/** Artwork exactly as it is: unlit, so it shows its own colors whatever the viewer's lights. */
export const unlit = (doc: Document, material: Material): Material =>
  material.setExtension('KHR_materials_unlit', doc.createExtension(KHRMaterialsUnlit).createUnlit());

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
/** A face shows a JPEG picture or a plain color. Faces given the same Side object share a draw call. */
export interface Side { picture?: Uint8Array; color?: string; roughness?: number }

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
export async function box(name: string, [widthMm, heightMm, depthMm]: number[], sides: Record<Face, Side>, radiusMm = 0): Promise<Uint8Array> {
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
        part.position.push(...(length ? core.map((c, i) => c + (out[i] * r) / length) : p));
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

  const doc = new Document();
  const mesh = doc.createMesh(name);
  let i = 0;
  for (const [side, part] of parts) {
    const material = side.picture
      ? pictureMaterial(doc, `${name}-${i++}`, side.picture, 'image/jpeg', side.roughness)
      : colorMaterial(doc, `${name}-${i++}`, side.color ?? '#808080', side.roughness ?? 0.9);
    if (!side.picture) part.uv.length = 0;
    addPart(doc, mesh, part, material);
  }
  return toGlb(doc, mesh);
}
