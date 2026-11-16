# thicken, skills only

thicken's skills (making a model, and making a profile) for Anthropic's
plugin directory, which takes no MCP server from this plugin. Claude runs
thicken from the shell instead (`npx -y thicken ...`); vision settings go in
your environment or a `.env` file where it runs (see
[USAGE.md](../USAGE.md)).

To give Claude thicken's tools as well, and skip a permission prompt per run,
add its MCP server:

```
claude mcp add thicken -- npx -y thicken mcp
```

Or install the full plugin, with the MCP server and a settings form, from
[`plugin/`](../plugin): `/plugin marketplace add bikemeardsley/thicken`, then
`/plugin install thicken@thicken`.

**What leaves your machine:** a book's lookups, to openlibrary.org,
covers.openlibrary.org, lx2.loc.gov and www.googleapis.com (an ISBN, or the
title and author read off the cover); with a vision endpoint set, each photo,
without its EXIF, to that endpoint; photos you agree to contribute, to
thicken's relay ([PRIVACY.md](../PRIVACY.md#contributing-photos)); and the
package itself, from registry.npmjs.org. Nothing else.
