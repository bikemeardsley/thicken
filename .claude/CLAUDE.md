# thicken

Photos in, 3D models (GLB) out, at their real size: books, slabs, raw cards,
boxes, badges, lettering. **Start with [README.md](../README.md)**, then
[USAGE.md](../USAGE.md) for the detail.

## Conventions

- **Ponytail on, full intensity.** Shortest correct diff; no abstractions,
  config or scaffolding nobody asked for.
- **TypeScript**, Node 22.18+, `sharp` for images. Dependencies pinned to
  exact versions; never auto-upgrade.
- **The asset is the product.** thicken outputs a GLB plus a JSON sidecar at
  real-world millimeters. Motion and viewers belong to whatever page shows
  the model, not here.
- **"thicken", lowercase,** wherever the product is named.
- **Git:** one `main` branch, short-lived feature branches. Tests are
  committed and run offline (a fetch with no stand-in fails) on small
  fixture images.
- **Profiles are plug-ins.** Every file in `src/profiles` loads by itself
  (no list to edit), each tested in `test/profiles/<name>.test.ts` and by
  `test/profiles.test.ts`. The README's table of profiles is generated:
  `npm run readme` after changing a profile's `about`, `input`, `makes` or
  `reads`. Profiles import thicken's parts from `src/kit.ts` (`../kit.ts`);
  users' own, in `~/.thicken/profiles`, from `thicken/kit`, resolved by the
  hook in src/thicken.ts. `thicken profile new|check|contribute`
  (src/profile-tools.ts, templates/) makes, checks and offers them. Outside
  contributors add or improve profiles only (CONTRIBUTING.md); CI fails a
  fork's pull request that touches anything else.
- **Agents:** `thicken mcp` (src/mcp.ts, stdio only) and the skill in
  `skills/thicken/SKILL.md`, copied to `plugin/skills/` (a test keeps them
  equal). The Claude plugin lives in `plugin/`.
- Don't add anything (images, fonts, copied code) that can't be published.
  `pokemon-cards-css` is GPL-3.0: read it, don't copy it.

## A release

Bump the version in `package.json`, `server.json` (twice),
`plugin/.claude-plugin/plugin.json` (`version` and the pin), `plugin/plugin.json`
and `plugin/mcp.json` (the Agent Plugin, for Copilot), `plugin/mcp_config.json`
(the same servers, for Antigravity), `mcp.json`,
`gemini-extension.json` and `plugin/package.json` (test/mcp.test.ts fails
until they agree). `npm publish` (staged: approve it on npmjs.com); then, once
the version is on npm, `npm install --package-lock-only --ignore-scripts` in
`plugin/` for the plugin directory's launcher lock; a `vX.Y.Z` tag and GitHub
release; and `mcp-publisher publish` for the MCP registry.

**Codex / ChatGPT plugin directory: likely a dead end, for a while or for
good.** Tried 2026-10-15. The portal (platform.openai.com/plugins) answered
"We are not accepting more skills-only submissions at this time", and a local
`npx` MCP server only gets in through the "desktop-only" path, which is for
OpenAI-approved partners and uploads through that same closed skills-only
form. Hosting the server for the remote-MCP route is ruled out. Don't spend
time on it unless OpenAI reopens skills-only submissions. If it does:
`thicken-codex.zip` (gitignored, repo root) holds `.claude-plugin/plugin.json`
minus `userConfig` and `mcpServers` (the portal refuses both), the icon and
`plugin/skills/`; rebuild it first. The listing also wants a subtitle of 30
characters or fewer, website, support, privacy (PRIVACY.md) and terms
(TERMS.md) URLs, and an app icon. Keep the skill provider-neutral either way.

**GitHub Copilot plugin directory: rejected, closed.** Decided 2026-10-15:
too niche for their directory, and there is no way to resubmit. The
self-hosted route in USAGE.md (`copilot plugin marketplace add
bikemeardsley/thicken`) still works and stays; `plugin/plugin.json` and
`plugin/mcp.json` stay in the release checklist for it. Don't try the
directory again.

## Tools: when to use each

- **`/git-for-me`** (replaced Kitbash), before writing any component or
  adding any dependency. The README's table is the starting verdict; re-run
  it if a part's shape changes. All parts re-checked with it 2026-10-16
  (GitHub, GitLab, Codeberg): every Kitbash verdict held; the MCP SDK row
  was added to the table.
- **Model bench**, for adversarial review of geometry/UV and format
  decisions, and for listing tasks. Panel from `route.py`; verify before
  acting; record with `offload.py`; name every seat in chat (global
  CLAUDE.md).
- **Subagents**, only for a single self-contained job that is better
  delegated, like a function call.
