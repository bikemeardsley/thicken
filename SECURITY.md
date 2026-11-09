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
  into that folder. A video's frames go to a temporary folder
  that is removed afterwards. Contributing photos keeps your answer in
  `~/.thicken/config.json`, the photos you contributed in
  `~/.thicken/contributed.jsonl`, and those still to send in
  `~/.thicken/outbox/`.
- **The network:** a book's catalog lookups, to Open Library
  (`openlibrary.org`, `covers.openlibrary.org`), the Library of Congress
  (`lx2.loc.gov`) and Google Books (`www.googleapis.com`), sending an ISBN,
  or the title and author read off the cover. `GOOGLE_BOOKS_API_KEY`, if
  set, is sent only to Google Books. With a vision roster
  (`THICKEN_VISION_URL`), each photo, re-encoded without its EXIF, goes to
  that endpoint with `THICKEN_VISION_KEY`; nothing else does. If you said
  yes to contributing photos, each photo's frame and its note go to the
  upload point (below). Each lookup has a timeout. Nothing else is
  contacted.
- **As an MCP server** (`thicken mcp`), it speaks only on stdio, to the agent
  that started it, and never listens on a port: its tools read and write files
  on your machine, where the agent asks.
- **Programs it runs:** `ffmpeg` from your `PATH`, only to read a video; an
  installed Chrome or Edge, headless, only for previews, with the viewer and
  the model served from disk and no other request answered.
- **The sidecar:** it records the hosts and paths of lookups, never a key;
  never GPS or serial numbers; and of the codes on your photos, only the text
  of those thicken used (a stray QR code can hold a Wi-Fi password).
  Sidecars may be published.
- **Profiles are code.** Every profile in `src/profiles` runs on each use;
  ones contributed from outside are reviewed line by line before they ship
  ([CONTRIBUTING.md](CONTRIBUTING.md)). Your own, in `~/.thicken/profiles`
  (or `THICKEN_PROFILES`), run too, with your permissions: keep only files
  you wrote or trust there.
- **`thicken profile contribute`** runs `git`, the GitHub CLI (`gh`) as you're
  signed in to it, and `npm ci` in a temporary clone of your fork, then opens
  a pull request from it. Nothing else is sent.

## The upload point for contributed photos

`thicken contribute` sends only what
[PRIVACY.md](PRIVACY.md#contributing-photos) lists, and only once you have
said yes: each photo's 1000 × 1000 frame and its note, to
`contribute.wendellresearch.ai/thicken`. That is a Cloudflare Worker, its
code in `relay/`.

- **What it receives:** the frame (1.5 MB at most, 1024 px a side at most,
  JPEG only), the note (4 KB at most, nothing but its listed fields) and,
  like any server, your IP address.
- **What it keeps:** in an EU bucket, the photo re-encoded (no metadata
  left), the note, the time, a keyed hash of the address (of an IPv6
  address, its first half), the network's number (ASN), the user agent and
  the checks' scores; of a photo its contributor forgot, only its id. A photo
  nobody reviewed is deleted after 180 days. It
  never logs a request's body or a full IP address, except for a known-abuse
  match (below), and it sends no CORS headers.
- **What it refuses:** too much from one address, one network or everyone in
  a day, an exact repeat, a match on any list of known child sexual abuse
  material it is set up with (Offlimits', Arachnid Shield's, Microsoft
  PhotoDNA's and NCMEC's), and a photo its image model finds sexual, with a
  face in it, or of something else. If no list answers, it takes nothing. A sudden flood pauses it. A photo's id, which only its
  contributor's thicken is told, is what deletes it, and is never listed
  publicly. Its admin routes need the
  author's token; every other route answers 404.
- **Reporting abuse:** to report a photo there that shouldn't be (one of you,
  one you hold the rights to, or anything illegal), write privately through
  a [security advisory](https://github.com/bikemeardsley/thicken/security/advisories/new).
  Never post the image or a link to it. Report child sexual abuse material to
  [NCMEC's CyberTipline](https://report.cybertip.org) as well.

On a match against known abuse material, the upload point stores nothing
for review: it keeps the bytes it received apart, unopened and never served,
with the full IP address, the network, the user agent, the time, the SHA-256
hash and which lists matched and answered, and it pauses itself. The author then follows
this procedure, also in [relay/README.md](relay/README.md), as
18 U.S.C. § 2258A requires:

1. Don't open or download the file.
2. Intake is already paused.
3. Register with NCMEC's CyberTipline as an electronic service provider, if
   not yet registered (§ 2258A(a)(1)(B)(i)), and report the incident there.
4. Ask NCMEC how to send the preserved file without viewing it.
5. Keep it for 1 year in the locked `incidents/` prefix (§ 2258A(h)), then
   delete it.
