# Security

## Supported versions

Fixes ship on `main` and in the next npm release. Use the latest of either.

| Version | Supported |
| --- | --- |
| latest npm release, `main` | ✅ |
| older releases | ❌ |

## Reporting a vulnerability

Report it privately through
[GitHub Security Advisories](https://github.com/bikemeardsley/thicken/security/advisories/new).
Please don't open a public issue for a vulnerability.

Include what you can: the version or commit, steps to reproduce, and what an
attacker gains.

## What thicken touches

- **Your files:** it reads the pictures, PDFs and videos you give it, and a
  `.env` file in the folder you run it from, if there is one. It writes each
  model (`<name>.glb`) and its sidecar (`<name>.json`) beside the first
  picture, or where `-o` says; a batch writes into `<folder>/thicken/`;
  `--preview` adds `<name>.preview.png`. Training mode, only when
  `THICKEN_DATASET` is set, writes the images it sent and a `metadata.jsonl`
  into that folder. A video's frames go to a temporary folder that is
  removed afterwards.
- **The network:** a book's catalog lookups, to Open Library
  (`openlibrary.org`, `covers.openlibrary.org`), the Library of Congress
  (`lx2.loc.gov`) and Google Books (`www.googleapis.com`), sending an ISBN,
  or the title and author read off the cover. `GOOGLE_BOOKS_API_KEY`, if
  set, is sent only to Google Books. With a vision roster
  (`THICKEN_VISION_URL`), each photo, re-encoded without its EXIF, goes to
  that endpoint with `THICKEN_VISION_KEY`; nothing else does. Each lookup
  has a timeout. Nothing else is contacted.
- **Programs it runs:** `ffmpeg` from your `PATH`, only to read a video; an
  installed Chrome or Edge, headless, only for previews, with the viewer and
  the model served from disk and no other request answered.
- **The sidecar:** it records the hosts and paths of lookups, never a key;
  never GPS or serial numbers; and of the codes on your photos, only the text
  of those thicken used (a stray QR code can hold a Wi-Fi password).
  Sidecars may be published.
- **Profiles are code.** Every profile in `src/profiles` runs on each use;
  ones contributed from outside are reviewed line by line before they ship
  ([CONTRIBUTING.md](CONTRIBUTING.md)).
