// What every profile must be, whoever wrote it: each one in src/profiles is checked here without being listed, so a
// new profile is covered by adding its file (CONTRIBUTING.md).
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PROFILES } from '../src/thicken.ts';
import { README, withTable } from '../scripts/readme.ts';
import './helpers.ts';

const files = readdirSync(new URL('../src/profiles/', import.meta.url)).filter((file) => file.endsWith('.ts'));
const words = (value: unknown) => typeof value === 'string' && value.trim().length > 0;

test('profiles: one per file, each named for its file and tested in its own test file', () => {
  assert.deepEqual(PROFILES.map((p) => `${p.name}.ts`).toSorted(), files.toSorted(), 'each file in src/profiles exports one profile, named as the file is');
  for (const { name } of PROFILES) {
    assert.match(name, /^[a-z][a-z0-9-]*$/, `"${name}": a profile's name is lowercase, as typed on the command line`);
    assert.ok(existsSync(new URL(`profiles/${name}.test.ts`, import.meta.url)), `${name}: its tests go in test/profiles/${name}.test.ts`);
  }
});

for (const profile of PROFILES) {
  test(`profiles: ${profile.name} says what it is, what it's made from and what it makes, in words the models can use`, () => {
    for (const key of ['about', 'input', 'makes'] as const) assert.ok(words(profile[key]), `${profile.name}: ${key} says it in a few words`);
    for (const [kind, entries] of Object.entries({ faces: profile.faces, reads: profile.reads ?? {}, asks: profile.asks ?? {} })) {
      for (const [key, what] of Object.entries(entries)) {
        assert.match(key, /^[a-z][A-Za-z0-9]*$/, `${profile.name}: ${kind} "${key}" is a plain JSON field name`);
        assert.ok(words(Array.isArray(what) ? what[0] : what), `${profile.name}: ${kind} "${key}" says what it is`);
      }
    }
    for (const face of profile.unsnapped ?? []) assert.ok(face in profile.faces, `${profile.name}: unsnapped "${face}" is one of its faces`);
  });
}

test('profiles: the README lists every profile as it is (npm run readme)', () => {
  const readme = readFileSync(README, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(readme, withTable(readme), 'the README\'s table of profiles is out of date: run npm run readme');
});
