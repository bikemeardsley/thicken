import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import './helpers.ts';

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const repo = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('mcp: every manifest launches the version package.json says, and the plugin\'s skill is the repo\'s', () => {
  const { version } = JSON.parse(repo('package.json'));
  const pinned = ['thicken', '-y', `thicken@${version}`, 'mcp'];
  const plugin = JSON.parse(repo('plugin/.claude-plugin/plugin.json'));
  assert.deepEqual([plugin.version, ...plugin.mcpServers.thicken.args], [version, ...pinned.slice(1)]);
  assert.deepEqual(JSON.parse(repo('mcp.json')).mcpServers.thicken.args, pinned.slice(1));
  // The same plugin as an Agent Plugin (GitHub Copilot and others): its manifest and MCP servers at its root.
  assert.deepEqual([JSON.parse(repo('plugin/plugin.json')).version, ...JSON.parse(repo('plugin/mcp.json')).mcpServers.thicken.args], [version, ...pinned.slice(1)]);
  const gemini = JSON.parse(repo('gemini-extension.json'));
  assert.deepEqual([gemini.version, ...gemini.mcpServers.thicken.args], [version, ...pinned.slice(1)]);
  const server = JSON.parse(repo('server.json'));
  assert.deepEqual([server.version, server.packages[0].version, server.packages[0].packageArguments[0].value], [version, version, 'mcp']);
  assert.equal(JSON.parse(repo('plugin/package.json')).dependencies.thicken, version);
  // Line endings aside: the plugin's files check out as git would leave them (CRLF on Windows, by its default).
  const lf = (text: string) => text.replace(/\r\n/g, '\n');
  assert.equal(lf(repo('plugin/skills/thicken/SKILL.md')), lf(repo('skills/thicken/SKILL.md')), 'the plugin\'s copy of the skill matches');
});
const text = (result: Awaited<ReturnType<Client['callTool']>>) => (result.content as { type: string; text: string }[])[0].text;

test('mcp: an agent lists the profiles and makes a model, over stdio, as `thicken mcp`', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'thicken-'));
  // Started where no .env is, with none of the developer's settings: lettering needs neither the web nor vision.
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [CLI, 'mcp'], cwd: folder, env: { ...getDefaultEnvironment(), THICKEN_PROFILES: '' } }));
  // The server first: Windows won't remove the folder a running process works in.
  t.after(async () => {
    await client.close();
    await rm(folder, { recursive: true, force: true, maxRetries: 10 });
  });

  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).toSorted(), ['thicken_make', 'thicken_profiles']);
  const profiles = JSON.parse(text(await client.callTool({ name: 'thicken_profiles', arguments: {} })));
  assert.ok(profiles.some((p: { name: string; reads: string[] }) => p.name === 'slab' && p.reads.includes('grade')), 'the slab, and what it reads');

  const out = path.join(folder, 'hi.glb');
  const result = await client.callTool({ name: 'thicken_make', arguments: { inputs: ['hi'], profile: 'lettering', width_mm: 30, out } });
  assert.ok(!result.isError, text(result));
  const facts = JSON.parse(text(result).split('<thicken_json>')[1].split('</thicken_json>')[0]);
  assert.deepEqual([facts.glb, facts.sidecar, facts.profile, facts.widthMm], [out, path.join(folder, 'hi.json'), 'lettering', 30]);
  assert.ok(existsSync(out) && JSON.parse(readFileSync(facts.sidecar, 'utf8')).text === 'hi', 'both files written');

  // A picture that isn't there is the agent's error to see, not a crash.
  const missing = await client.callTool({ name: 'thicken_make', arguments: { inputs: [path.join(folder, 'nowhere.jpg')], profile: 'card' } });
  assert.ok(missing.isError, 'an error result');
  // Words without the lettering profile: told how to ask.
  const words = await client.callTool({ name: 'thicken_make', arguments: { inputs: ['hello'] } });
  assert.ok(words.isError && text(words).includes('profile "lettering"'), text(words));

  // Making it again replaces its own sidecar, but never a .json that isn't one, and the model goes in a .glb.
  const again = await client.callTool({ name: 'thicken_make', arguments: { inputs: ['hi'], profile: 'lettering', out } });
  assert.ok(!again.isError, text(again));
  const notes = path.join(folder, 'notes.json');
  writeFileSync(notes, '{"mine": true}\n');
  const clash = await client.callTool({ name: 'thicken_make', arguments: { inputs: ['hi'], profile: 'lettering', out: path.join(folder, 'notes.glb') } });
  assert.ok(clash.isError && text(clash).includes('isn\'t a thicken sidecar'), text(clash));
  assert.equal(readFileSync(notes, 'utf8'), '{"mine": true}\n', 'left as it was');
  const theirs = path.join(folder, 'car.glb'); // a model of someone else's: no sidecar of ours beside it
  writeFileSync(theirs, 'glTF');
  const clobber = await client.callTool({ name: 'thicken_make', arguments: { inputs: ['hi'], profile: 'lettering', out: theirs } });
  assert.ok(clobber.isError && readFileSync(theirs, 'utf8') === 'glTF', text(clobber));
  const txt = await client.callTool({ name: 'thicken_make', arguments: { inputs: ['hi'], profile: 'lettering', out: path.join(folder, 'hi.txt') } });
  assert.ok(txt.isError && text(txt).includes('.glb'), text(txt));
});
