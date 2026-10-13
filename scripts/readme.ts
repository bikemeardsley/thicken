// The README's table of profiles, made from the profiles themselves (src/profiles), so it lists every one as it is.
// `npm run readme` rewrites it between its markers; test/profiles.test.ts fails when the README's is out of date.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PROFILES } from '../src/thicken.ts';

export const README = fileURLToPath(new URL('../README.md', import.meta.url));
const [START, END] = ['<!-- profiles:start (made by npm run readme) -->', '<!-- profiles:end -->'];

const cell = (text: string) => text.replace(/\|/g, '\\|');
export const profileTable = () => [
  '| Profile | What it is | From | Makes | With vision, reads |',
  '| --- | --- | --- | --- | --- |',
  ...PROFILES.map((p) => `| \`${p.name}\` | ${cell(p.about)} | ${cell(p.input)} | ${cell(p.makes)} | ${Object.keys(p.reads ?? {}).join(', ') || '–'} |`),
].join('\n');

/** The README with its table of profiles brought up to date. */
export function withTable(readme: string): string {
  const [before, rest] = readme.split(START);
  if (rest === undefined || !rest.includes(END)) throw new Error(`README.md needs the markers ${START} and ${END}`);
  return `${before}${START}\n${profileTable()}\n${END}${rest.split(END)[1]}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) writeFileSync(README, withTable(readFileSync(README, 'utf8')));
