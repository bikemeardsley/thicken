# Thicken

Flat images in, thickness out. Thicken turns photos, scans and flat artwork
into 3D assets at real-world size that you can drop into a three.js page or
Blender.

**Status:** badge, book and slab work, and Thicken picks between them
itself. The raw card, slab acrylic and photo straightening are still the plan.

```
npm install
node src/cli.ts book-scan.pdf                     # ISBN read off the back cover, size looked up
node src/cli.ts book cover.heic --isbn 9780061120084
node src/cli.ts --isbn 9780061120084              # no photo: cover and size from Open Library
node src/cli.ts slab front.jpg back.jpg --holder bgs
node src/cli.ts badge badge.png --width 50 --depth 3.5
node src/cli.ts batch ~/Pictures/books --preview  # one model per photo, PDF or subfolder, each with a preview
node src/cli.ts preview ~/Pictures/books/thicken  # previews for models already made
npm test
```

The same as a function: `thicken(files, options)` in `src/thicken.ts`.

## What it makes

Two families:

| Profile | Input | Output |
| --- | --- | --- |
| **Digital artwork made into an object** | | |
| Badge | Artwork with transparency | The artwork's own outline, extruded (the approach in michaelbeardsley-now's `badge-shape.ts`) |
| **A real object rebuilt at its real size** | | |
| Book | Front cover, back, spine (any order, any of them), or just an ISBN | Box at the book's size: covers, spine, cream page edges |
| Graded slab | Front [back] | Box at the holder's size, with the photos on its faces and clear-plastic edges |
| Raw card (planned) | Front and back | Thin rounded card at 63.5 × 88.9 mm |

Name the profile, or leave it out and Thicken picks one:

- An ISBN barcode on any picture, or `--isbn`, means a **book**.
- A QR code pointing at a grader's site (psacard.com, beckett.com,
  cgccards.com, gosgc.com, taggrading.com) means a **slab**, and says whose.
  The sidecar keeps the grader, the cert number from the link, and the link
  itself (`verifyUrl`).
- So does an older label's Code 128 cert barcode, but only on a photo shaped
  like a holder. The grader then isn't known: a PSA-size holder is assumed,
  with a warning to name it.
- Artwork with transparency around a shape that isn't just a rectangle means
  a **badge**.
- Anything else is refused with a request to name the profile. Other
  barcodes don't count: books carry UPCs, QR codes and library stickers.

A book's pictures are placed by what they show, not their order. The
picture carrying the ISBN barcode is the back cover, and a tall, narrow
picture is the spine. The rest, in order, are the front and (with no
barcode) the back. With no front, the cover comes from Open Library, so one
photo of the back is a whole book.

## Batch

`thicken batch <folder>` makes a model from each picture or PDF in the
folder, and one from each subfolder's pictures. Put a book's front, back and
spine shots in a subfolder, or scan them into one PDF. Each model is
classified on its own; `thicken batch book <folder>` forces a profile.

- A model that fails is reported, and the rest carry on.
- Models go to `<folder>/thicken/`.
- A re-run leaves alone any model made from exactly the same pictures, hand
  edits included. Add, remove or replace a picture, whatever its file date
  (cameras keep capture dates), and that model is made again. `--force`
  remakes them all.
- At the end it lists the faces still to photograph (below).

The quickest way to do a shelf: photograph the back of every book. Each
barcode gives the ISBN, and Open Library gives the size and a stand-in front
cover until you photograph your own.

## Your photos, or stand-ins

A model shows your copy, not one from the internet: every face you
photograph carries your photo, exactly as taken (unlit, so its colors are
untouched). The ISBN only supplies the size. Faces you didn't photograph
are filled in, and each sidecar's `faces` says which is which:

| Value | Meaning |
| --- | --- |
| `photo` | Your picture |
| `openlibrary` | A stand-in front cover from Open Library, used only when you photographed the back but not the front |
| `color` | A plain color from the cover's edge (a book's missing back or spine) |
| `plastic` | Plain plastic (a slab with no back photo) |

So a book wants three photos (front, back, spine) and a slab two (front,
back); fewer still make a model. A batch ends with the list of faces still
to photograph. Put the item's photos in a subfolder named after it and run
the batch again, and only that model is remade.

## Preview

`--preview` (or `thicken preview <model or folder>`) writes
`<name>.preview.png` beside each model: the front three-quarter view and the
back three-quarter view side by side, captioned with the real size and any
face that isn't your photo. It never writes `<name>.png`, which may be your
original. It is drawn by model-viewer in an installed Chrome or Edge, run
headless, with nothing fetched from the network.

Every output is a **GLB** at real-world size (glTF's unit is the meter, so a
50 mm badge is 0.05 across), plus a JSON sidecar. The sidecar holds the
dimensions in millimeters, where each came from, any warnings, and the
source images used.

**Motion is not part of the asset.** Sway, spin and hover belong to whatever
page shows the model, and are optional. Thicken makes the shape.

**Not a photogrammetry tool.** Everything it handles is close to a box or a
flat outline, so it builds the geometry from known dimensions and maps the
images onto it. No point clouds, no neural reconstruction.

## Inputs

JPEG, PNG, HEIC, WebP, AVIF, GIF, TIFF, SVG, or a scanner app's PDF, where
each page is a picture in order (front, back, spine). Every picture is turned
upright and scaled to fit 2048 px.

Thicken does no background removal of its own. Both phones already do it
better:

| You want | iPhone | Android |
| --- | --- | --- |
| A badge or object without its background | Long-press the subject in Photos, then Copy or Share (PNG) | Samsung: long-press in Gallery (Image Clipper). Pixel: long-press in Google Photos, Copy sticker |
| A straight, cropped cover or slab | Notes or Files, Scan Documents (PDF) | Google Drive, Scan (choose JPEG or PDF) |
| Just a photo | HEIC or JPEG, straight-on, cropped to the object | JPEG, straight-on, cropped to the object |

On Windows, Paint's Remove background does the same as subject lifting. A
lifted subject is cropped to itself, and its see-through corners are filled
with its edge color.

## Dimensions

**Book.** Each of width, height and depth comes from the first source that
knows it, and the sidecar's `measuredBy` says which:

1. `--size WxHxD` in mm, as measured. Any part can be left out.
2. Open Library: `physical_dimensions`, page count and format. In a sample
   of ten ISBNs (2026-10-01), 2 had dimensions and 8 a page count.
3. Google Books `dimensions`. The keyless quota is shared and often spent,
   so set `GOOGLE_BOOKS_API_KEY`.
4. Page count × 0.075 mm (trade paper runs 300–400 pages to the inch), plus
   4 mm of boards for a hardcover.
5. The cover's shape, giving one side from the other.
6. The nearest standard trim size to the cover's shape, flagged as a guess.

The cover photo's shape is checked against the result. A mismatch over 5%
warns: it means a bad crop or a different edition.

**Slab.** Graders don't publish exterior holder sizes, and figures online
disagree by 1–5 mm, so the table in `src/slab.ts` holds the best found, each
with its source. Correct it against real holders. It covers PSA (standard,
`psa-thick`, and `psa-tall` for tall boys such as 1969–70 Topps basketball),
BGS, CGC, SGC and TAG. `--size` overrides it per model. A QR code tells the
grader but not the holder, so a tall boy needs `--holder psa-tall`. A photo
whose shape is off the holder's by more than 4% warns.

## Build plan (kitbash, verified 2026-10-01)

| Part | Verdict | Choice |
| --- | --- | --- |
| Triangulating badge outlines | Dependency | [mapbox/earcut](https://github.com/mapbox/earcut) (ISC) |
| Writing GLB | Dependency | [donmccurdy/glTF-Transform](https://github.com/donmccurdy/glTF-Transform) (MIT) |
| Decoding HEIC | Dependency | [catdad-experiments/libheif-js](https://github.com/catdad-experiments/libheif-js) (LGPL-3.0, used unmodified). sharp's binaries leave out HEVC. |
| Reading barcodes | Dependency | [Sec-ant/zxing-wasm](https://github.com/Sec-ant/zxing-wasm) (MIT). Its `.wasm` is loaded from `node_modules`, not its default CDN. |
| Pictures from scanner PDFs | Dependency | [unjs/unpdf](https://github.com/unjs/unpdf) (MIT, pdf.js inside) |
| Drawing previews | Dependency | [google/model-viewer](https://github.com/google/model-viewer) (Apache-2.0): frames and lights a GLB; three.js inside |
| Running the preview browser | Dependency | [microsoft/playwright](https://github.com/microsoft/playwright) (`playwright-core`, Apache-2.0): drives an installed Chrome or Edge, no browser download |
| Book dimension sources | Write | Read [palmerabollo/node-isbn](https://github.com/palmerabollo/node-isbn)'s provider fallback. Ours is per dimension, not first-provider-wins. |
| Profiles, box, classifier, CLI | Write | |
| Straightening handheld photos (planned) | Adapt, don't depend | [puffinsoft/jscanify](https://github.com/puffinsoft/jscanify) (MIT): read the corner-ranking approach. Slabs give competing rectangles (acrylic edge, card border, label) and glare. |

For refractor and holo effects in a viewer, `simeydotme/pokemon-cards-css` is
a reference only. It is GPL-3.0, so read it and don't copy it.

**Made with** (tools, not dependencies):
[tt-a1i/archify](https://github.com/tt-a1i/archify) drew the architecture
diagram in `.archify/`.

## Stack

TypeScript on Node 22.18+, run directly (Node strips the types), with `sharp`
for images. Private for now; it goes public once it is clean and packaged.
Publishing to npm needs a build step, because Node won't strip types inside
`node_modules`.

## Used by

- vaultflip.cards: slabbed cards
- michaelbeardsley-now: certification badges
- The home library project: books
