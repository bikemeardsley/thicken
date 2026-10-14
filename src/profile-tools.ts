// `thicken profile new|check|contribute <name>`: a profile of your own, in your profiles folder (src/thicken.ts loads
// it from there), made from the template or from a built-in one to improve; checked as thicken's CI will check it;
// and offered to thicken as a pull request, through the GitHub CLI.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MY_PROFILES, PROFILES, type Profile } from './thicken.ts';

const UPSTREAM = 'bikemeardsley/thicken';
const NAME = /^[a-z][a-z0-9-]*$/;
const TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url));
// The built-in profiles' sources: beside this file in a clone, under src/ in the npm package (this file built into dist/).
const BUILT_IN = fileURLToPath(existsSync(new URL('./profiles/box.ts', import.meta.url)) ? new URL('./profiles/', import.meta.url) : new URL('../src/profiles/', import.meta.url));
const camel = (name: string) => name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const fill = (template: string, name: string) => template.replaceAll('__NAME__', name).replaceAll('__CAMEL__', camel(name));

/** A built-in profile's source, as one of your own writes it, importing from 'thicken/kit'; and back. */
export const toMine = (source: string) => source.replace(/from '\.\.\/kit\.ts'/g, "from 'thicken/kit'").replace(/from '\.\/([a-z][a-z0-9-]*)\.ts'/g, "from 'thicken/profiles/$1'");
export const toThicken = (source: string) => source.replace(/from 'thicken\/kit'/g, "from '../kit.ts'").replace(/from 'thicken\/profiles\/([a-z][a-z0-9-]*)'/g, "from './$1.ts'");

/** What a profile still needs before thicken's CI would take it (test/profiles.test.ts holds every profile to these). */
export function problems(profile: Profile): string[] {
  const found: string[] = [];
  const words = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
  if (!NAME.test(profile.name)) found.push(`its name, "${profile.name}", is lowercase letters, digits and hyphens, as typed on the command line`);
  for (const key of ['about', 'input', 'makes'] as const) {
    if (!words(profile[key])) found.push(`${key} says it in a few words`);
    else if (/\bTODO\b/.test(profile[key])) found.push(`${key} still says TODO`);
  }
  if (!Object.keys(profile.records ?? {}).length) found.push('records names the sidecar fields it writes, each in a few words');
  for (const [kind, entries] of Object.entries({ records: profile.records ?? {}, faces: profile.faces, reads: profile.reads ?? {}, asks: profile.asks ?? {} })) {
    for (const [key, what] of Object.entries(entries)) {
      const text = Array.isArray(what) ? what[0] : what;
      if (!/^[a-z][A-Za-z0-9]*$/.test(key)) found.push(`${kind} "${key}" is a plain JSON field name`);
      if (!words(text)) found.push(`${kind} "${key}" says what it is`);
      else if (/\bTODO\b/.test(text)) found.push(`${kind} "${key}" still says TODO`);
    }
  }
  for (const face of profile.unsnapped ?? []) if (!(face in profile.faces)) found.push(`unsnapped "${face}" is one of its faces`);
  if (profile.read !== undefined && typeof profile.read !== 'function') found.push('read is a function');
  if (typeof profile.build !== 'function') found.push('build is a function');
  return found;
}

/** `thicken profile <action> <name> [--from <profile>]`. */
export async function profileCommand([action, name]: string[], from?: string): Promise<void> {
  if (!name || !NAME.test(name)) throw new Error('usage: thicken profile new|check|contribute <name>   (a name: lowercase letters, digits, hyphens)');
  if (action === 'new') return create(name, from);
  if (action === 'check') return void check(name);
  if (action === 'contribute') return contribute(name);
  throw new Error(`no "profile ${action}": new, check or contribute`);
}

/** Your own profile, from the template, a built-in one of the same name (to improve it), or --from another. */
function create(name: string, from?: string): void {
  if (!MY_PROFILES) throw new Error('THICKEN_PROFILES is empty: no folder for your profiles');
  const file = path.join(MY_PROFILES, `${name}.ts`);
  if (existsSync(file)) throw new Error(`${file} is there already`);
  const base = from ?? (existsSync(path.join(BUILT_IN, `${name}.ts`)) ? name : undefined);
  let source: string;
  if (base) {
    const built = path.join(BUILT_IN, `${base}.ts`);
    if (!existsSync(built)) throw new Error(`no built-in profile "${base}" (there are: ${PROFILES.map((p) => p.name).join(', ')})`);
    source = toMine(readFileSync(built, 'utf8'));
    if (base !== name) source = source.replace(`name: '${base}'`, `name: '${name}'`).replace(`export const ${camel(base)}:`, `export const ${camel(name)}:`);
  } else {
    source = fill(readFileSync(path.join(TEMPLATES, 'profile.ts'), 'utf8'), name);
  }
  mkdirSync(MY_PROFILES, { recursive: true });
  writeFileSync(file, source);
  console.log(`${file}: ${base === name ? `the built-in ${name}, yours to improve: thicken uses yours from now on` : base ? `a new profile, from ${base}` : 'a new profile, from the template'}.`);
  console.log(`Try it: thicken ${name} <photos>${base ? '' : ' --size WxHxD'}. Then: thicken profile check ${name}, and thicken profile contribute ${name}.`);
}

/** Whether your profile is ready to contribute: what CI checks of every profile, short of its tests. */
function check(name: string): boolean {
  const profile = PROFILES.find((p) => p.name === name);
  if (!profile) throw new Error(`no profile "${name}": thicken profile new ${name} makes one`);
  const found = problems(profile);
  for (const problem of found) console.log(`  ${name}: ${problem}`);
  console.log(found.length ? `${name}: ${found.length} to fix before contributing` : `${name}: ready to contribute (thicken profile contribute ${name})`);
  if (found.length) process.exitCode = 1;
  return !found.length;
}

/** The contribution, laid out as in thicken's repository: the profile, and its test (the template's, if it has none). */
export function prepare(name: string, root: string, mine = MY_PROFILES): void {
  const source = toThicken(readFileSync(path.join(mine, `${name}.ts`), 'utf8'));
  mkdirSync(path.join(root, 'src', 'profiles'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'profiles', `${name}.ts`), source);
  const myTest = path.join(mine, `${name}.test.ts`);
  const test = path.join(root, 'test', 'profiles', `${name}.test.ts`);
  mkdirSync(path.dirname(test), { recursive: true });
  if (existsSync(myTest)) writeFileSync(test, readFileSync(myTest));
  else if (!existsSync(test)) writeFileSync(test, fill(readFileSync(path.join(TEMPLATES, 'profile.test.ts'), 'utf8'), name));
}

const run = (command: string, args: string[], cwd?: string, quiet = false) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: quiet ? 'pipe' : 'inherit', shell: process.platform === 'win32' && command === 'npm' });
const has = (command: string, args: string[]) => {
  try {
    run(command, args, undefined, true);
    return true;
  } catch {
    return false;
  }
};

/**
 * Your profile, offered to thicken as a pull request: your fork brought up to date, a branch, the profile and its test
 * laid out, the README's table made, thicken's checks and the profile's tests run, then pushed and opened. An
 * improvement to a built-in profile keeps that profile's tests, which it must still pass. Without git and a signed-in
 * GitHub CLI, the contribution is laid out in a folder here, with what to do with it.
 */
async function contribute(name: string): Promise<void> {
  if (!existsSync(path.join(MY_PROFILES, `${name}.ts`))) throw new Error(`no profile of yours named ${name} in ${MY_PROFILES}: thicken profile new ${name}`);
  if (!check(name)) return;
  const improving = existsSync(path.join(BUILT_IN, `${name}.ts`));
  if (!has('git', ['--version']) || !has('gh', ['auth', 'status'])) {
    const folder = path.resolve(`thicken-${name}-contribution`);
    prepare(name, folder);
    console.log(`Laid out in ${folder}. With git and the GitHub CLI (https://cli.github.com, then gh auth login), run this again and it opens the pull request; or by hand: fork ${UPSTREAM}, copy the folder's src and test into it, run npm install, npm run readme and npm test, and open a pull request.`);
    return;
  }
  const login = run('gh', ['api', 'user', '--jq', '.login'], undefined, true).trim();
  console.log(`Your fork of ${UPSTREAM}, brought up to date…`);
  run('gh', ['repo', 'fork', UPSTREAM, '--clone=false'], undefined, true);
  run('gh', ['repo', 'sync', `${login}/thicken`, '--source', UPSTREAM]);
  const dir = mkdtempSync(path.join(tmpdir(), `thicken-${name}-`));
  const branch = `profile/${name}`;
  run('gh', ['repo', 'clone', `${login}/thicken`, dir, '--', '--depth', '1']);
  run('git', ['checkout', '-b', branch], dir);
  prepare(name, dir);
  console.log('Checking it as thicken\'s CI will (npm install, the README\'s table, types, the profile\'s tests)…');
  try {
    run('npm', ['ci', '--no-audit', '--no-fund'], dir);
    run('npm', ['run', 'readme'], dir);
    run('npm', ['run', 'check'], dir);
    run(process.execPath, ['--env-file=test/test.env', '--test', 'test/profiles.test.ts', `test/profiles/${name}.test.ts`], dir);
  } catch {
    throw new Error(`the checks failed: the contribution is in ${dir}, to fix and run again`);
  }
  const profile = PROFILES.find((p) => p.name === name)!;
  const title = improving ? `Profile: ${name}, improved` : `Profile: ${name}`;
  run('git', ['add', '-A'], dir);
  run('git', ['commit', '-q', '-m', title, '-m', `${profile.about}. Made with thicken profile contribute.`], dir);
  run('git', ['push', '-q', '-u', 'origin', branch], dir);
  const body = path.join(dir, '.pr-body.md');
  writeFileSync(body, [
    '## What it adds',
    '',
    improving ? `An improvement to the ${name} profile. <!-- what it does better, and an example -->` : `A profile: ${profile.about}. <!-- an example of one -->`,
    '',
    '## For a new profile ([CONTRIBUTING.md](../CONTRIBUTING.md))',
    '',
    `- [x] One file, \`src/profiles/${name}.ts\`, exporting one profile named as the file`,
    `- [x] Tests in \`test/profiles/${name}.test.ts\`${improving ? ' (the profile\'s own, still passing)' : ' (from the template: worth making its own)'}`,
    '- [ ] Each standard size has its source in a comment',
    '- [x] `npm run readme`, `npm run check` and the profile\'s tests pass (run by `thicken profile contribute`)',
    '- [ ] No new dependencies or command-line options',
    '- [ ] Nothing runs when the file loads; `read` claims only pictures that are certainly this kind of object',
    '- [ ] Hosts it contacts, if any, listed here and recorded in the sidecar\'s `lookups`:',
    '',
  ].join('\n'));
  const url = run('gh', ['pr', 'create', '--repo', UPSTREAM, '--head', `${login}:${branch}`, '--base', 'main', '--title', title, '--body-file', body], dir, true).trim();
  rmSync(dir, { recursive: true, force: true });
  console.log(`Opened: ${url}`);
}
