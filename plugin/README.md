# thicken, as a plugin

The thicken MCP server (`npx -y thicken mcp`) and its skills (making a model,
and making a profile), for Claude Code,
Codex and Copilot CLI. The tools: `thicken_make` (photos, a video, words or an
ISBN in; a GLB model and its metadata, a JSON sidecar, written) and
`thicken_profiles` (the kinds of object it makes). The [README](../README.md)
has the rest.

In Claude Code (2.1.275 or later):

```
/plugin install thicken --marketplace bikemeardsley/thicken
```

Or, in any version, `/plugin marketplace add bikemeardsley/thicken` and then
`/plugin install thicken@thicken`. For Codex and Copilot CLI, see
[USAGE.md](../USAGE.md#from-an-ai-agent).

**What it reads and writes:** the files you point it at, and the model, its
sidecar and an optional preview, written beside them or where you say.

**What leaves your machine:** a book's lookups, to openlibrary.org,
covers.openlibrary.org, lx2.loc.gov and www.googleapis.com (an ISBN, or the
title and author read off the cover); with a vision endpoint set, each photo,
without its EXIF, to that endpoint; and the package itself, from
registry.npmjs.org on first run. Nothing else.
