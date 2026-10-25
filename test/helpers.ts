// Shared by every test file: fixtures, stand-in catalogs and vision endpoints, and checks on a model's geometry.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mock, test } from 'node:test';
import { getBounds, NodeIO, type Document, type Primitive, type vec3 } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

export const fixture = (name: string) => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));

delete process.env.THICKEN_DATASET; // test photos never go into a real training set
// Tests run offline: a test that needs the web stands in for it with catalog(), and any other fetch fails, so no test
// passes or fails by what a real service answered today.
globalThis.fetch = async (url) => {
  throw new Error(`tests run offline: ${String(url)} was fetched with no stand-in (catalog() in test/helpers.ts)`);
};

export const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

// A slab lying on a brown table, photographed at 5 px a mm (900 × 1200): its parts as rectangles in mm from its top
// left; and the same rectangles' corners as the vision models see them, letterboxed into 1000 × 1000.
export const onTable = (x: number, y: number) => [250 + x * 5, 260 + y * 5];

export const quadOf = ([x0, y0, x1, y1]: number[]) => [onTable(x0, y0), onTable(x1, y0), onTable(x1, y1), onTable(x0, y1)];

export const letterboxed = (rect: number[]) => quadOf(rect).map(([x, y]) => [125 + (x * 5) / 6, (y * 5) / 6]);

export async function slabPhoto(file: string, rects: [number[], string][]) {
  const svg = `<svg width="900" height="1200">${rects.map(([rect, fill]) => `<polygon points="${quadOf(rect).map((p) => p.join(',')).join(' ')}" fill="${fill}"/>`).join('')}</svg>`;
  await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#8b5a2b' } }).composite([{ input: Buffer.from(svg) }]).png().toFile(file);
}

/**
 * Stand-in catalogs: Open Library knows one edition (and maybe its cover and catalog record), Google Books is out of
 * quota. With `vision`, also a stand-in vision endpoint at http://vision.test/api, answering for each model and photo;
 * with `bench` too, a stand-in model bench at http://bench.test, its bench/vision collection's seats those models.
 */
export function catalog(edition: object, { cover, data, search, records, loc, vision, bench }: {
  cover?: Uint8Array; data?: object; search?: object; records?: object; loc?: string;
  vision?: (request: { model: string; prompt: string; photo: Buffer; authorization: string | null }) => Promise<object | undefined>;
  bench?: string[];
} = {}) {
  return mock.method(globalThis, 'fetch', async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    if (bench && href === 'http://bench.test/v1/models') return Response.json({ data: [{ id: 'bench/core', tags: ['general'] }, { id: 'bench/vision', tags: ['vision'] }, { id: 'bench/vision:merged', tags: ['vision'] }] });
    if (bench && href === 'http://bench.test/bench/verdict') return Response.json({ ok: true });
    if (bench && vision && href === 'http://bench.test/v1/chat/completions') {
      const { model, messages, stream } = JSON.parse(String(init!.body));
      if (!stream) return new Response('', { status: 400 }); // thicken asks for the stream, which keeps the connection alive
      const photo = Buffer.from(messages[0].content[1].image_url.url.split(',')[1], 'base64');
      const seats = await Promise.all(bench.map(async (alias, k) => {
        const answer = await vision({ model: alias, prompt: messages[0].content[0].text, photo, authorization: null });
        return { call: `p1.${alias}`, seat: k < 3 ? 'member' : 'explorer', alias, status: answer ? 'ok' : 'error', seconds: 1, answer: answer ? JSON.stringify(answer) : '', error: answer ? '' : 'no answer' };
      }));
      // As the gateway streams a chat reply: chunks, keep-alive comments while seats think, the seats on the last chunk.
      const chunk = (delta: object, extra = {}) => `data: ${JSON.stringify({ object: 'chat.completion.chunk', model, choices: [{ index: 0, delta }], ...extra })}\n\n`;
      return new Response(`${chunk({ role: 'assistant', content: '' })}: keep-alive\n\n${chunk({ content: '(every seat, under its own heading)' })}${chunk({}, { bench: { collection: model, seats } })}data: [DONE]\n\n`,
        { headers: { 'Content-Type': 'text/event-stream' } });
    }
    if (vision && href === 'http://vision.test/api/chat/completions') {
      const { model, messages } = JSON.parse(String(init!.body));
      const photo = Buffer.from(messages[0].content[1].image_url.url.split(',')[1], 'base64');
      const answer = await vision({ model, prompt: messages[0].content[0].text, photo, authorization: new Headers(init!.headers).get('authorization') });
      return answer ? Response.json({ choices: [{ message: { content: JSON.stringify(answer) } }] }) : new Response('', { status: 500 });
    }
    if (href === 'https://openlibrary.org/isbn/9780140328721.json') return Response.json(edition);
    if (data && href.startsWith('https://openlibrary.org/api/books?bibkeys=ISBN:9780140328721')) return Response.json({ 'ISBN:9780140328721': data });
    if (search && href.startsWith('https://openlibrary.org/search.json?')) return Response.json(search);
    if (records && href.startsWith('https://openlibrary.org/api/books?bibkeys=')) return Response.json(records);
    if (cover && href.startsWith('https://covers.openlibrary.org/b/isbn/9780140328721-L.jpg')) return new Response(new Uint8Array(cover));
    if (href.startsWith('https://www.googleapis.com/')) return new Response('{}', { status: 429 });
    if (loc && href.startsWith('https://lx2.loc.gov/sru/lcdb?') && href.includes('bath.isbn=9780140328721')) return new Response(loc);
    return new Response('', { status: 404 });
  });
}

/**
 * The pictured primitive of the face with this outward normal: its normals, averaged (a rounded face's lean off it
 * at the edges). Plain-colored parts are passed over: a hardcover board's edges, together, can average to a cover's.
 */
export function faceOf(doc: Document, normal: number[]): Primitive | undefined {
  return doc.getRoot().listMeshes()[0].listPrimitives().find((primitive) => {
    if (!primitive.getMaterial()?.getBaseColorTexture()) return false;
    const normals = primitive.getAttribute('NORMAL')!;
    const sum = [0, 0, 0];
    for (let i = 0; i < normals.getCount(); i++) normals.getElement(i, [0, 0, 0]).forEach((c, k) => { sum[k] += c; });
    const length = Math.hypot(...sum);
    return length > 0 && sum.every((c, k) => Math.abs(c / length - normal[k]) < 0.01);
  });
}

/** The picture on the face with this outward normal. */
export function pictureOn(doc: Document, normal: number[]): Uint8Array {
  const image = faceOf(doc, normal)?.getMaterial()?.getBaseColorTexture()?.getImage();
  if (!image) throw new Error(`no picture on the face with normal ${normal}`);
  return image;
}

/** Mean color [r, g, b] (0–255) of the picture on the face with this outward normal. */
export async function colorOf(doc: Document, normal: number[]): Promise<number[]> {
  const { channels } = await sharp(pictureOn(doc, normal)).stats();
  return channels.slice(0, 3).map((channel) => channel.mean);
}

/** Within JPEG's wobble of a #rrggbb color. */
export const near = (color: number[], hex: string) => color.every((c, i) => Math.abs(c - parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16)) < 12);

export const read = (glb: Uint8Array) => new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(glb);

export const pick = (object: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((key) => [key, object[key]]));

export function assertExtents(doc: Document, meters: number[]) {
  const { min, max } = getBounds(doc.getRoot().getDefaultScene()!);
  meters.forEach((size, i) => assert.ok(Math.abs(max[i] - min[i] - size) < 1e-6, `extent ${i}: ${max[i] - min[i]} m`));
}

/**
 * Closed and wound outward everywhere: the divergence-theorem volume is the solid's. A missing, flipped or
 * inward face is off by far more than `tolerance`, the share left for rounded edges, which are polygons a
 * hair inside the true curve (on a thin slab, about 2e-4 of its volume).
 */
export function assertClosed(doc: Document, mm3: number, tolerance = 1e-4) {
  let volume = 0;
  for (const primitive of doc.getRoot().listMeshes()[0].listPrimitives()) {
    for (const [a, b, c] of triangles(primitive)) {
      volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
  }
  assert.ok(Math.abs(volume * 1e9 - mm3) < mm3 * tolerance, `volume ${volume * 1e9} mm³, expected ${mm3}`);
}

/** Closed surfaces, however many: across every primitive, each edge (by position) walked once each way. */
export function assertWatertight(doc: Document) {
  const walked = new Map<string, number>();
  const key = (p: number[]) => p.map((c) => Math.round(c * 1e6)).join(',');
  for (const primitive of doc.getRoot().listMeshes()[0].listPrimitives()) {
    for (const [a, b, c] of triangles(primitive)) {
      for (const [p, q] of [[a, b], [b, c], [c, a]]) {
        if (key(p) !== key(q)) walked.set(`${key(p)} ${key(q)}`, (walked.get(`${key(p)} ${key(q)}`) ?? 0) + 1);
      }
    }
  }
  for (const [edge, n] of walked) {
    const [p, q] = edge.split(' ');
    assert.equal(walked.get(`${q} ${p}`) ?? 0, n, `open edge ${edge}`);
  }
}

/** A W × H × D mm box's volume in mm³ with its edges and corners rounded to r: the shrunk box swept by a ball (Steiner's formula). */
export function roundedVolume([w, h, d]: number[], r: number): number {
  const [a, b, c] = [w - 2 * r, h - 2 * r, d - 2 * r];
  return a * b * c + 2 * r * (a * b + b * c + c * a) + Math.PI * r * r * (a + b + c) + (4 / 3) * Math.PI * r ** 3;
}

/** Signs of the position whose UV is (0, 0) on the textured face with this normal. */
export function cornerAt(doc: Document, normal: number[]): number[] {
  const face = faceOf(doc, normal);
  const uv = face?.getAttribute('TEXCOORD_0');
  for (let i = 0; uv && i < uv.getCount(); i++) {
    const [u, v] = uv.getElement(i, [0, 0]);
    if (u === 0 && v === 0) return face!.getAttribute('POSITION')!.getElement(i, [0, 0, 0]).map(Math.sign);
  }
  throw new Error(`no textured face with normal ${normal}`);
}

export function triangles(primitive: Primitive): vec3[][] {
  const position = primitive.getAttribute('POSITION')!;
  const index = primitive.getIndices()!.getArray()!;
  const out: vec3[][] = [];
  for (let i = 0; i < index.length; i += 3) out.push([0, 1, 2].map((k) => position.getElement(index[i + k], [0, 0, 0]) as vec3));
  return out;
}

