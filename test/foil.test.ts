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

test('foil look: a parallel\'s name first, its maker where makers differ, then what the models saw, then plain', () => {
  const sight = (asked: Record<string, string>, read: Record<string, string> = {}): Sight =>
    ({ faces: [{ face: 'front', corners: [], asSeen: [], by: ['a'], agreed: true }], answers: [{ model: 'a', ms: 0, asked, read }], disputed: [] });
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
});
