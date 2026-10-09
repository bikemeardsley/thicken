// The badge profile: digital artwork made into an object. The picture's own
// outline (src/outline.ts) is extruded to a solid at real-world size; the
// front shows the picture (its see-through parts cut out by an alpha mask)
// and the sides and back are the color just inside the outline. `widthMm` is the traced shape's width; its height follows.
import { Document } from '@gltf-transform/core';
import earcut from 'earcut';
import sharp from 'sharp';
import { addPart, colorMaterial, emptyPart, pictureMaterial, toGlb, unlit } from '../glb.ts';
import type { Picture } from '../image.ts';
import { trace, type Point } from '../outline.ts';
import type { Profile } from '../thicken.ts';

export const badge: Profile = {
  name: 'badge',
  faces: {}, // artwork, not a photo of an object: nothing for the vision models to find, only to read
  reads: {
    name: 'what it names: the certification, award, achievement, rank or title', issuer: 'who issued or awards it',
    level: 'any level, tier or grade ("Associate", "Professional", "Gold", "Level 2")', subject: 'the field, skill, product or event it is for',
    date: 'any year or date it gives', id: 'any credential, serial or badge number', text: ['every other word or number on it'],
  },
  read: (_scanned, [picture]) => ({ recognized: isArtwork(picture), use: [] }),
  build: ([picture], { options }) => make(picture, options),
};

/** Cut-out artwork: see-through around a shape that isn't just a rectangle (a lifted book cover is one). */
function isArtwork(picture?: Picture): boolean {
  if (!picture?.transparent) return false;
  const { outlines } = trace(picture.data, picture.width, picture.height, 4);
  const xs = outlines.flat().map(([x]) => x);
  const ys = outlines.flat().map(([, y]) => y);
  const box = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  const area = outlines.reduce((sum, outline) => sum + Math.abs(signedArea(outline)), 0);
  return area < 0.9 * box;
}

async function make({ data, width, height, transparent }: Picture, { widthMm = 50, depthMm = 3.5 } = {}) {
  if (!(widthMm > 0 && depthMm > 0)) throw new Error('width and depth must be positive millimeters');
  const { outlines, edge } = trace(data, width, height, 4);
  const png = await sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();

  // Sized and centered on the traced shape: transparent padding isn't part of the badge.
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of outlines.flat()) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  if (!(maxX > minX && maxY > minY)) throw new Error('the traced shape is a line, not an area');
  const meters = widthMm / (maxX - minX) / 1000; // per pixel
  const z = depthMm / 2000;
  const toModel = ([x, y]: Point): Point => [(x - (minX + maxX) / 2) * meters, ((minY + maxY) / 2 - y) * meters];

  const face = emptyPart();
  const rim = emptyPart(); // back and walls
  for (const outline of outlines) {
    // Counter-clockwise in model space (y up), so each wall's outward side is to its right.
    const ring = signedArea(outline.map(toModel)) < 0 ? outline.toReversed() : outline;
    const points = ring.map(toModel);

    // Caps: the front faces +Z with the picture on it, the back the same triangles turned over.
    const front = face.position.length / 3;
    const back = rim.position.length / 3;
    ring.forEach(([px, py], i) => {
      const [x, y] = points[i];
      face.position.push(x, y, z);
      face.normal.push(0, 0, 1);
      face.uv.push((px + 0.5) / width, (py + 0.5) / height); // pixel centers; glTF's UV origin is the image's top left
      rim.position.push(x, y, -z);
      rim.normal.push(0, 0, -1);
    });
    const triangles = earcut(points.flat());
    for (let i = 0; i < triangles.length; i += 3) {
      let [a, b, c] = triangles.slice(i, i + 3);
      if (cross(points[a], points[b], points[c]) < 0) [b, c] = [c, b];
      face.index.push(front + a, front + b, front + c);
      rim.index.push(back + a, back + c, back + b);
    }

    // Walls: one flat quad per edge, its own vertices so its normal stays flat.
    points.forEach(([ax, ay], i) => {
      const [bx, by] = points[(i + 1) % points.length];
      const length = Math.hypot(bx - ax, by - ay);
      if (length === 0) return;
      const v = rim.position.length / 3;
      rim.position.push(ax, ay, z, bx, by, z, bx, by, -z, ax, ay, -z);
      for (let k = 0; k < 4; k++) rim.normal.push((by - ay) / length, -(bx - ax) / length, 0);
      rim.index.push(v, v + 3, v + 2, v, v + 2, v + 1);
    });
  }

  const doc = new Document();
  const mesh = doc.createMesh('badge');
  addPart(doc, mesh, face, unlit(doc, pictureMaterial(doc, 'face', png, 'image/png').setAlphaMode('MASK').setAlphaCutoff(0.5)));
  addPart(doc, mesh, rim, colorMaterial(doc, 'rim', edge, 0.6));

  const round = (mm: number) => Math.round(mm * 100) / 100;
  return {
    glb: await toGlb(doc, mesh),
    sidecar: {
      profile: 'badge',
      widthMm: round(widthMm),
      heightMm: round((maxY - minY) * meters * 1000),
      depthMm: round(depthMm),
      edge,
      regions: outlines.length,
      warnings: transparent ? [] : ['the picture has no transparency, so the badge is its whole rectangle: lift the subject out on your phone first'],
    },
  };
}

const cross = ([ax, ay]: Point, [bx, by]: Point, [cx, cy]: Point) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

const signedArea = (points: Point[]) =>
  points.reduce((sum, [x, y], i) => {
    const [nx, ny] = points[(i + 1) % points.length];
    return sum + x * ny - nx * y;
  }, 0) / 2;
