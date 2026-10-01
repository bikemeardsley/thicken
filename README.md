# Thicken

Flat images in, thickness out. Thicken turns photos or scans of flat-ish
physical objects into 3D assets you can drop into a three.js page or Blender.

**Status:** not started. This README is the plan.

## What it makes

| Profile | Input | Output |
| --- | --- | --- |
| Graded slab | Front and back scans or photos (PSA, CGC, SGC, BGS, TAG each have their own slab size and label window) | Slab with clear acrylic, inset card and label |
| Raw card | Front and back | Thin rounded card at 63.5 × 88.9 mm |
| Book | Cover, spine and back, or just an ISBN (cover, size and page count from Open Library) | Book with cover, spine, back and page-block edges |
| Badge | A PNG with transparency | The badge's own outline, extruded (the approach in michaelbeardsley-now's `badge-shape.ts`) |

Every output is a **GLB** at real-world size (millimetres), plus a JSON
sidecar with dimensions and the source images used.

**Motion is not part of the asset.** Sway, spin and hover belong to whatever
page shows the model, and are optional. Thicken makes the shape.

**Not a photogrammetry tool.** Everything it handles is close to a box or a
flat outline, so it builds the geometry from known dimensions and maps the
images onto it. No point clouds, no neural reconstruction.

## Inputs

- **Scanner-app images** (iOS Notes, Adobe Scan, Google Drive): already
  flat and cropped, used as-is.
- **Handheld photos:** corners found and the image straightened first.
- **Lookups:** ISBN for books. Grader cert lookups may supply slab images.
  This is unverified, so check it before building on it.

## Build plan (kitbash, verified 2026-10-01)

| Part | Verdict | Choice |
| --- | --- | --- |
| Straightening handheld photos | Adapt, don't depend | [puffinsoft/jscanify](https://github.com/puffinsoft/jscanify) (MIT): read the corner-ranking approach. Slabs give competing rectangles (acrylic edge, card border, label) and glare. |
| Triangulating badge outlines | Dependency | [mapbox/earcut](https://github.com/mapbox/earcut) (ISC) |
| Writing and compressing GLB | Dependency | [donmccurdy/glTF-Transform](https://github.com/donmccurdy/glTF-Transform) (MIT): valid GLB in Node, acrylic transmission material, KTX2/WebP and meshopt |
| Shape profiles and builders | Write | A dimensions table plus a box or extrusion with UV mapping per profile |
| CLI and library entry | Write | `thicken slab --front f.jpg --back b.jpg -o card.glb`, and the same as a function |

For refractor and holo effects in a viewer, `simeydotme/pokemon-cards-css` is
a reference only. It is GPL-3.0, so read it and don't copy it.

## Stack

TypeScript on Node, `sharp` for images. Private for now; it goes public once
it is clean and packaged.

## Used by

- vaultflip.cards: slabbed cards
- michaelbeardsley-now: certification badges
- The home library project: books
