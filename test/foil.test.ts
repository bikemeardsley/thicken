import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { foilLook, foilMap, lookName } from '../src/foil.ts';
import { type Look, PATTERNS, WORDS } from '../src/patterns.ts';
import type { Sight } from '../src/vision.ts';

const raw = async (png: Uint8Array) => sharp(png).raw().toBuffer();

test('foil patterns: every look draws pieces of their own, flat ones a smooth film, a mirror base bare metal between', async () => {
  const looks = new Map<string, Look>([...Object.values(PATTERNS).map(({ look }) => look), ...Object.values(WORDS)].map((look) => [JSON.stringify(look), look]));
  for (const look of looks.values()) {
    const { map, thickness, facets } = await foilMap([{ x0: 0, x1: 1, y0: 0, y1: 1 }], 0.5, false, look);
    const [film, thick, tilts] = await Promise.all([raw(map), raw(thickness), raw(facets)]);
    const name = JSON.stringify(look);
    assert.ok(new Set(thick).size > 2, `${name}: the film's thickness varies`);
    const leaning = tilts.some((c, k) => k % 3 !== 2 && Math.abs(c - 128) > 3);
    const flat = look.pattern === 'sweep' || ['lava', 'marble', 'tiedye'].includes(look.kind ?? '');
    assert.equal(leaning, !flat, `${name}: ${flat ? 'one smooth film' : 'pieces that lean'}`);
    const bare = film.some((c, k) => k % 3 === 0 && c === 0);
    assert.equal(bare, (look.base ?? PATTERNS[look.pattern].look.base) === 'mirror', `${name}: bare metal between pieces only on a mirror base`);
  }
});

test('foil plain: one flat sheet of film, as foil was before patterns', async () => {
  const { thickness, facets } = await foilMap([{ x0: 0, x1: 1, y0: 0, y1: 1 }], 0.5);
  assert.deepEqual(new Set(await raw(thickness)), new Set([255]), 'one thickness, the top of the range');
  assert.ok((await raw(facets)).every((c, k) => c === [128, 128, 255][k % 3]), 'flat');
});

test('foil border and emboss: a ring of foil outside the frame; a ridge where the picture has an edge', async () => {
  const at = (data: Buffer, u: number, v: number) => { const k = (Math.round(v * 511) * 512 + Math.round(u * 511)) * 3; return [...data.subarray(k, k + 3)]; };
  const { map } = await foilMap([], 1, false, undefined, { frame: { x0: 0.1, x1: 0.9, y0: 0.1, y1: 0.9 } });
  const film = await raw(map);
  assert.deepEqual([at(film, 0.05, 0.5)[0], at(film, 0.5, 0.05)[0], at(film, 0.5, 0.5)[0]], [255, 255, 0], 'the border shines, the inside doesn\'t');
  // A picture dark on its left half, light on its right: one edge, down the middle.
  const relief = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#000' } })
    .composite([{ input: Buffer.from('<svg width="200" height="200"><rect x="100" width="100" height="200" fill="#fff"/></svg>') }]).jpeg().toBuffer();
  const tilts = await raw((await foilMap([], 1, false, undefined, { relief })).facets);
  assert.deepEqual(at(tilts, 0.25, 0.5), [128, 128, 255], 'flat away from the edge');
  assert.ok(at(tilts, 0.5, 0.5)[0] < 100, `the edge stands as a ridge, leaning away from the light side ${at(tilts, 0.5, 0.5)}`);
});

test('foil look: a parallel\'s name first, its maker where makers differ, then what the models saw, then plain', () => {
  // Two models answering alike: a name read once isn't trusted (the last case below).
  const sight = (asked: Record<string, string>, read: Record<string, string> = {}): Sight =>
    ({ faces: [{ face: 'front', corners: [], asSeen: [], by: ['a', 'b'], agreed: true }], answers: ['a', 'b'].map((model) => ({ model, ms: 0, asked, read })), disputed: [] });
  const of = (asked: Record<string, string>, read?: Record<string, string>) => {
    const { look, lookBy } = foilLook([sight(asked, read)], 'front');
    return `${lookName(look)} by ${lookBy}`;
  };
  assert.equal(of({}, { variant: 'Gold Wave Refractor /50' }), 'flow wave by parallel', 'the pattern word, not the plain refractor');
  assert.equal(of({}, { variant: 'Silver Prizm' }), 'sweep by parallel');
  assert.equal(of({}, { variant: 'Red Cracked Ice' }), 'shards by parallel');
  assert.equal(of({}, { variant: 'Gold X-Fractor' }), 'cells checker by parallel');
  assert.equal(of({}, { variant: 'Poké Ball Reverse Holo' }), 'motifs ball by parallel', 'two words, joined');
  assert.equal(of({}, { variant: 'Aqua RayWave', maker: 'Topps' }), 'radial rays by parallel');
  assert.equal(of({}, { variant: 'Aqua RayWave', maker: 'Panini' }), 'flow wave by parallel');
  assert.equal(of({}, { variant: 'Ray Wave', maker: 'Topps Chrome' }), 'radial rays by parallel', 'two words, the maker\'s');
  assert.equal(of({}, { variant: 'Blue-Wave' }), 'flow wave by parallel', 'a hyphen parts words');
  assert.equal(of({}, { variant: 'Mosaic Genesis' }), 'flow marble by parallel', 'the last pattern word, not the product');
  assert.equal(of({}, { variant: 'Choice Tiger' }), 'skin tiger by parallel', 'the last pattern word, not the box');
  assert.equal(of({}, { variant: 'Red Stars' }), 'points star by parallel', 'a plural');
  assert.equal(of({ pattern: 'circles' }, { variant: '12/99' }), 'circles by vision', 'no pattern in the name: the models');
  assert.equal(of({ pattern: 'none' }), 'plain by assumed', 'less foil is better than wrong foil');
  assert.equal(of({}, {}), 'plain by assumed');
  const once: Sight = { faces: [], answers: [{ model: 'a', ms: 0, read: { variant: 'Ultra Rare Gold FOIL FEAT.' } }, { model: 'b', ms: 0 }], disputed: [] };
  assert.equal(lookName(foilLook([once], 'front').look), 'plain', 'a name one model alone read decides nothing');
});
