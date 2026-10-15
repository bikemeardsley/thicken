# Privacy policy

*Effective 15 October 2026.*

thicken runs on your own machine. It has no account, no telemetry and no
server of its own, and nothing you do with it reaches the author.

## What leaves your machine

Only these requests, and only when the job needs them:

- **Book lookups:** an ISBN, or the title and author read off a cover, to
  Open Library (`openlibrary.org`, `covers.openlibrary.org`), the Library of
  Congress (`lx2.loc.gov`) and Google Books (`www.googleapis.com`). A
  `GOOGLE_BOOKS_API_KEY`, if you set one, goes only to Google Books.
- **Vision, if you set it up:** with `THICKEN_VISION_URL` set, each photo,
  re-encoded without its EXIF data (so no GPS location), goes to that
  endpoint with `THICKEN_VISION_KEY`. You choose that endpoint; its own
  privacy policy applies.
- **Contributing a profile**, only if you run `thicken profile contribute`:
  `git` and the GitHub CLI push your profile to your fork and open a pull
  request, as you.

Nothing else is contacted. As an MCP server it talks only to the agent that
started it, over stdio, and never listens on a network port.

## What stays on your machine

The photos, PDFs and videos you give it are read locally. It writes each
model and its JSON sidecar where you tell it. Sidecars record the lookups made,
never an API key, GPS location or serial number. Training mode, only when you
set `THICKEN_DATASET`, saves the images it sent and their metadata into that
folder. [SECURITY.md](SECURITY.md) has the full detail.

## Third parties

The services above, npm (where thicken is installed from) and the AI
assistant you use it with each have their own privacy policies.

## Changes

Changes to this policy are made in this file, and its history is in the
repository's commits.

## Contact

Questions: [open an issue](https://github.com/bikemeardsley/thicken/issues).
