# Thicken

Flat images in, 3D assets (GLB) out: slabs, raw cards, books, badges.
**Start with [README.md](README.md)**: the profiles, inputs, outputs and what
each part is built on.

## Conventions

- **Ponytail on, full intensity.** Shortest correct diff; no abstractions,
  config or scaffolding nobody asked for.
- **TypeScript**, Node 22+, `sharp` for images. Dependencies pinned to exact
  versions; never auto-upgrade.
- **The asset is the product.** Thicken outputs GLB plus a JSON sidecar at
  real-world millimetres. Motion and viewers belong to whatever page shows
  the model, not here.
- **Git:** one `main` branch, short-lived feature branches. Tests are
  committed and run offline on small fixture images.
- **Profiles are plug-ins.** Every file in `src/profiles` loads by itself
  (no list to edit), each tested in `test/profiles/<name>.test.ts` and by
  `test/profiles.test.ts`. The README's table of profiles is generated:
  `npm run readme` after changing a profile's `about`, `input`, `makes` or
  `reads`. Outside contributors add profiles only (CONTRIBUTING.md).
- Private for now on bikemeardsley; it goes public once clean. Don't add
  anything (images, fonts, copied code) you couldn't publish later.
  `pokemon-cards-css` is GPL-3.0: read it, don't copy it.

## Tools: when to use each

- **Kitbash**, before writing any component or adding any dependency. The
  README's table is the starting verdict; re-run kitbash if a part's shape
  changes.
- **Model bench**, for adversarial review of geometry/UV and format
  decisions, and for listing tasks. Panel from `route.py`; verify before
  acting; record with `offload.py`; name every seat in chat (global
  CLAUDE.md).
- **Subagents**, only for a single self-contained job that is better
  delegated, like a function call.
