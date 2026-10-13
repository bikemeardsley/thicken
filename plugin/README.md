# thicken, as a plugin

The thicken MCP server (`npx -y thicken mcp`) and its skill, for Claude Code,
Codex and Copilot CLI. The tools: `thicken_make` (photos, a video, words or an
ISBN in; a GLB model and its JSON sidecar written) and `thicken_profiles`
(the kinds of object it makes). The [README](../README.md) has the rest.

**What it reads and writes:** the files you point it at, and the model, its
sidecar and an optional preview, written beside them or where you say.

**What leaves your machine:** a book's lookups, to openlibrary.org,
covers.openlibrary.org, lx2.loc.gov and www.googleapis.com (an ISBN, or the
title and author read off the cover); with a vision endpoint set, each photo,
without its EXIF, to that endpoint; and the package itself, from
registry.npmjs.org on first run. Nothing else.
