import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { prepare, toMine, toThicken } from '../src/profile-tools.ts';
import './helpers.ts';

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
/** thicken run as someone would, its profiles folder `mine`. */
const thicken = (args: string[], mine: string, cwd: string) =>
  spawnSync(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, THICKEN_PROFILES: mine }, encoding: 'utf8' });

test('profile tools: your own profile, from the template, works at once, is checked, and lays out as thicken\'s', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const mine = path.join(folder, 'profiles');
  const made = thicken(['profile', 'new', 'vinyl-record'], mine, folder);
  assert.equal(made.status, 0, made.stderr);
  const file = path.join(mine, 'vinyl-record.ts');
  assert.match(readFileSync(file, 'utf8'), /from 'thicken\/kit'/);

  // It works straight away, importing thicken's parts from a folder of its own.
  const front = path.join(folder, 'front.png');
  await sharp({ create: { width: 300, height: 300, channels: 3, background: '#222222' } }).png().toFile(front);
  const used = thicken(['vinyl-record', front, '--size', '315x315x5', '-o', path.join(folder, 'lp.glb')], mine, folder);
  assert.equal(used.status, 0, used.stderr);
  assert.match(used.stdout, /vinyl-record, 315 × 315 × 5 mm/);

  // Not ready to contribute while it still says TODO.
  const unready = thicken(['profile', 'check', 'vinyl-record'], mine, folder);
  assert.equal(unready.status, 1, unready.stdout);
  assert.match(unready.stdout, /about still says TODO/);
  writeFileSync(file, readFileSync(file, 'utf8').replace(/'TODO: [^']*'/g, '\'a vinyl record in its sleeve\''));
  const ready = thicken(['profile', 'check', 'vinyl-record'], mine, folder);
  assert.equal(ready.status, 0, ready.stdout + ready.stderr);

  // Laid out as in thicken's repository: its imports from '../kit.ts', and the template's test for it.
  const repo = path.join(folder, 'repo');
  prepare('vinyl-record', repo, mine);
  assert.match(readFileSync(path.join(repo, 'src/profiles/vinyl-record.ts'), 'utf8'), /from '\.\.\/kit\.ts'/);
  assert.match(readFileSync(path.join(repo, 'test/profiles/vinyl-record.test.ts'), 'utf8'), /profile: 'vinyl-record'/);
});

test('profile tools: a built-in profile to improve is yours to change, and used in its place; or the start of another', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const mine = path.join(folder, 'profiles');
  // The slab imports the card's parts: from your folder, 'thicken/profiles/card'.
  assert.equal(thicken(['profile', 'new', 'slab'], mine, folder).status, 0);
  assert.match(readFileSync(path.join(mine, 'slab.ts'), 'utf8'), /from 'thicken\/profiles\/card'/);
  const checked = thicken(['profile', 'check', 'slab'], mine, folder);
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  assert.match(checked.stderr, /your profile "slab" .* is used in place of the built-in one/);

  assert.equal(thicken(['profile', 'new', 'tray', '--from', 'box'], mine, folder).status, 0);
  const tray = readFileSync(path.join(mine, 'tray.ts'), 'utf8');
  assert.ok(tray.includes('name: \'tray\'') && tray.includes('export const tray:'), 'renamed');
  assert.notEqual(thicken(['profile', 'new', 'tray'], mine, folder).status, 0, 'never written over');
});

test('profile tools: every built-in profile, written as your own and back, is unchanged', () => {
  const dir = new URL('../src/profiles/', import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    const source = readFileSync(new URL(file, dir), 'utf8');
    assert.equal(toThicken(toMine(source)), source, file);
  }
});
