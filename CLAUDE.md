# Thicken

Flat images in, 3D assets (GLB) out: slabs, raw cards, books, badges.
**Start with [README.md](README.md)**: the profiles, inputs, outputs and the
kitbash-verified build plan.

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

## Reference code elsewhere

- `P:\windsurf\michaelbeardsley-now\src\lib\badge-shape.ts`: traces a badge
  PNG's outline from its transparency. The badge profile starts from this.
- `P:\windsurf\michaelbeardsley-now\src\scripts\badges-3d.ts`: the
  three.js viewer with sway and spin. It's a consumer of Thicken's output,
  not part of Thicken.
