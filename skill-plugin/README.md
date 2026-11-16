# thicken, the skill

thicken's skill for making a model, for Anthropic's plugin directory. The
plugin runs nothing itself: the skill works through the tools of thicken's
MCP server, which you add once yourself:

```
claude mcp add thicken -- npx -y thicken mcp
```

Vision settings go on the same command, as `-e THICKEN_VISION_URL=...` and
the rest (see [USAGE.md](../USAGE.md)). Making your own profiles, and the
plugin's settings form, come with the full plugin in [`plugin/`](../plugin):
`/plugin marketplace add bikemeardsley/thicken`, then
`/plugin install thicken@thicken`.

**What leaves your machine, once the server is added:** a book's lookups, to
openlibrary.org, covers.openlibrary.org, lx2.loc.gov and www.googleapis.com
(an ISBN, or the title and author read off the cover); with a vision endpoint
set, each photo, without its EXIF, to that endpoint; photos you agree to
contribute, to thicken's relay
([PRIVACY.md](../PRIVACY.md#contributing-photos)); and the package itself,
from registry.npmjs.org. Nothing else.
