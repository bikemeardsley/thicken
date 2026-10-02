// Geometry to GLB, shared by every profile, and the textured box that books
// and slabs are made of. Units are metres (glTF's), front faces +Z, Y up.
import { ColorUtils, Document, NodeIO, type Material, type Mesh, type TypedArray, type vec4 } from '@gltf-transform/core';
import { KHRMaterialsUnlit } from '@gltf-transform/extensions';

export interface Part { position: number[]; normal: number[]; uv: number[]; index: number[] }
export const emptyPart = (): Part => ({ position: [], normal: [], uv: [], index: [] });

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

/** A material showing a picture exactly as it is (unlit: the photo or artwork already holds its light). */
export function pictureMaterial(doc: Document, name: string, image: Uint8Array, mimeType: 'image/png' | 'image/jpeg'): Material {
  return doc.createMaterial(name)
    .setBaseColorTexture(doc.createTexture(name).setImage(image).setMimeType(mimeType))
    .setExtension('KHR_materials_unlit', doc.createExtension(KHRMaterialsUnlit).createUnlit());
}

/** A plain lit material in an sRGB colour (#rrggbb); glTF wants it linear. */
export function colourMaterial(doc: Document, name: string, colour: string, roughness: number): Material {
  return doc.createMaterial(name)
    .setBaseColorFactor(ColorUtils.hexToFactor(parseInt(colour.slice(1), 16), [0, 0, 0, 1] as vec4))
    .setMetallicFactor(0)
    .setRoughnessFactor(roughness);
}

export async function toGlb(doc: Document, mesh: Mesh): Promise<Uint8Array> {
  const scene = doc.createScene().addChild(doc.createNode(mesh.getName()).setMesh(mesh));
  doc.getRoot().setDefaultScene(scene);
  return new NodeIO().registerExtensions([KHRMaterialsUnlit]).writeBinary(doc);
}

export type Face = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';
/** A face shows a JPEG picture or a plain colour. Faces given the same Side object share a draw call. */
export interface Side { picture?: Uint8Array; colour?: string; roughness?: number }

/**
 * A box W × H × D mm, centred on the origin. Every picture reads the right
 * way round from outside: the back's left edge is at +X (turn a book over
 * and the spine is on your right), and the left (-X) face's left edge is
 * at the back, so a spine photo stands upright with the front cover to its right.
 */
export async function box(name: string, [widthMm, heightMm, depthMm]: number[], sides: Record<Face, Side>): Promise<Uint8Array> {
  const [x, y, z] = [widthMm / 2000, heightMm / 2000, depthMm / 2000];
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

  const parts = new Map<Side, Part>();
  for (const [face, [corner, right, down]] of Object.entries(faces) as [Face, [V, V, V]][]) {
    const side = sides[face];
    const part = parts.get(side) ?? emptyPart();
    parts.set(side, part);
    // Outward normal: down × right, normalised.
    const n = [down[1] * right[2] - down[2] * right[1], down[2] * right[0] - down[0] * right[2], down[0] * right[1] - down[1] * right[0]];
    const length = Math.hypot(...n);
    const v = part.position.length / 3;
    for (const [u, w] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      part.position.push(...corner.map((c, i) => c + u * right[i] + w * down[i]));
      part.normal.push(...n.map((c) => c / length));
      part.uv.push(u, w);
    }
    part.index.push(v, v + 3, v + 2, v, v + 2, v + 1);
  }

  const doc = new Document();
  const mesh = doc.createMesh(name);
  let i = 0;
  for (const [side, part] of parts) {
    const material = side.picture
      ? pictureMaterial(doc, `${name}-${i++}`, side.picture, 'image/jpeg')
      : colourMaterial(doc, `${name}-${i++}`, side.colour ?? '#808080', side.roughness ?? 0.9);
    if (!side.picture) part.uv.length = 0;
    addPart(doc, mesh, part, material);
  }
  return toGlb(doc, mesh);
}
