# Thicken

Flat images in, thickness out. Thicken turns photos, scans and flat artwork
into 3D assets at real-world size that you can drop into a three.js page or
Blender.

**Status:** badge, book, graded slab, raw card and a generic box work, and
Thicken picks between them itself, from codes or by asking vision models.
With a vision roster, uncropped photos are cut into straightened faces, and
a phone video can add more views.

```
npm install
node src/cli.ts book-scan.pdf                     # ISBN read off the back cover, size looked up
node src/cli.ts book cover.heic --isbn 9780061120084
node src/cli.ts --isbn 9780061120084              # no photo: cover and size from Open Library
node src/cli.ts slab front.jpg back.jpg --holder bgs
node src/cli.ts card front.jpg back.jpg --pt 130    # a thick patch card
node src/cli.ts badge badge.png --width 50 --depth 3.5
node src/cli.ts book front.heic back.heic IMG_0042.MOV  # with vision: the video's frames show the spine
node src/cli.ts batch ~/Pictures/books --preview  # one model per photo, PDF, video or subfolder, each with a preview
node src/cli.ts preview ~/Pictures/books/thicken  # previews for models already made
npm test
```

The same as a function: `thicken(files, options)` in `src/thicken.ts`.

## The Thicken object

What Thicken makes is more than a 3D shape. Each run writes a **Thicken
object**: the model (a GLB at the object's real size, in millimeters) and,
beside it, its sidecar (JSON), which knows what the object is, in its
profile's own terms:

- **A book:** its ISBN, its catalog record (title, authors, publishers,
  dates, subjects, Dewey and Library of Congress classes, pages), and how sure
  the match is when it was found by title.
- **A graded slab:** its grader, cert number and verification link, its
  holder, and the card and label inside it, each sized and placed.
- **A raw card:** its size, its thickness in points for a thick card, its
  corners and its foil.
- **Every object:** which faces are your photos and which are stand-ins,
  how each fact was found, what is still worth photographing, and what each
  vision model answered.

An app shows the model and reads the sidecar: a library shelf of your books,
a vault of your slabs. The fields are under
[What the sidecar records](#what-the-sidecar-records).

## What it makes

Thicken makes the 3D object; what it knows about kinds of object lives in
profiles, one file each in `src/profiles`. Two families:

| Profile | Input | Output |
| --- | --- | --- |
| **Digital artwork made into an object** | | |
| Badge | Artwork with transparency | The artwork's own outline, extruded |
| **A real object rebuilt at its real size** | | |
| Box | Front [back, sides], and its size (or a vision estimate) | Softly rounded box with the photos on its faces: anything box-shaped, from a game case to a phone |
| Book | Front cover, back, spine (any order, any of them), or just an ISBN | Softly rounded box at the book's size: covers, spine, page edges |
| Graded slab | Front [back] | A clear plastic holder at its real size, with the card and the grade label inside it, each cut from the photos |
| Raw card | Front [back] | A thin plate, its corners cut as the vision models say the card's are (square, slight or round), its foil shimmering where they say it is, 63.5 × 88.9 mm unless `--size` says otherwise, 0.35 mm thick unless `--pt` gives a thick card's points |

Name the profile, or leave it out and Thicken picks one:

- An ISBN barcode on any picture, or `--isbn`, means a **book**.
- A QR code pointing at a grader's site (psacard.com, beckett.com,
  cgccards.com, gosgc.com, taggrading.com) means a **slab**, and says whose.
  The sidecar keeps the grader, the cert number from the link, and the link
  itself (`verifyUrl`).
- So does an older label's Code 128 cert barcode, but only on a photo shaped
  like a holder. The grader then isn't known: a PSA-size holder is assumed,
  with a warning.
- Artwork with transparency around a shape that isn't just a rectangle means
  a **badge**.
- Otherwise, with [vision](#vision-optional), the models are shown the
  profiles and say which it is, and roughly how big: two agreeing settle it,
  as with faces, and `box` takes anything box-shaped the others don't cover.
- Anything still unknown is refused with a request to name the profile.
  Other barcodes don't count: books carry UPCs, QR codes and library
  stickers.

The sidecar's `identifiedBy.profile` says which way it was chosen: `given`,
`recognized` (codes or the artwork), or `vision`.

**Adding a profile** is one file in `src/profiles`, listed in `PROFILES`
(`src/thicken.ts`): its name; a few words on what it is and on each of its
faces, which is all the vision models are told; optionally how its codes or
pictures give it away unaided; and how to build it from the photos placed on
its faces. Generic profiles are named for the shape they build (`box`, and
later perhaps `flat` or `cylinder`), not "unknown": a shape Thicken can't
build is refused rather than forced into one it can.

Pictures are placed on faces by what they show (see
[Photos](#photos-any-number)). With no front, Open Library's cover stands in,
marked for review, so one photo of the back is enough to start a book.

## Batch

`thicken batch <folder>` makes a model from each picture, PDF or video in
the folder, and one from each subfolder's files. Put a book's front, back and
spine shots in a subfolder, or scan them into one PDF. Each model is
classified on its own; `thicken batch book <folder>` forces a profile.

- A model that fails is reported, and the rest carry on.
- Models go to `<folder>/thicken/`.
- A re-run leaves alone any model made from exactly the same pictures, hand
  edits included. Add, remove or replace a picture, whatever its file date
  (cameras keep capture dates), and that model is made again. `--force`
  remakes them all.
- At the end it lists everything still to review (below).

The quickest way to do a shelf: photograph the back of every book. Each
barcode gives the ISBN, and Open Library gives the size and a stand-in front
cover until you photograph your own.

## Photos: any number

Give as many photos of an object as you like, in any order and named
anything. Thicken works out which face each photo shows from the photo
itself, and more photos make a better model. In order:

1. **Codes:** every photo showing a book's ISBN barcode is its back. With
   vision, it's the face the barcode is printed on, whatever the models
   called it: the barcode outranks them. A slab's codes say what it is, not
   which side a photo shows, because the side a grader prints its QR code on
   changes with label designs (PSA's and CGC's current labels put it on the
   back, and PSA prints its cert barcode on both sides). The vision models
   tell the sides apart (the front shows the grade).
2. **Narrow photos, for books,** shot standing or lying down: one with print
   on it is the spine; plain paper (calm, light and pale, or showing page
   lines) is a page side. A page side as thin as the spine runs down the
   book, so it's the page edge; one that looks thicker is the top, then the
   bottom (on a book wider than tall, it's taken for the page edge).
3. **The rest:** the vision models say which is the front and which the
   back. Photo order is no evidence: without vision, two photos that nothing
   else tells apart stop the run, with a pointer to setting a roster up. A
   lone photo is the front, and once one side is proven (a book's barcode),
   the other follows.
4. **Extra shots** join the face they match in shape and color, and each
   face keeps its sharpest shot. The others stay in the sidecar as
   alternates.

A book wants three photos (front, back, spine) and a slab two (front, back).
Top, bottom and page-edge photos are extras that replace the plain page
color. Spine and page-edge photos shot square on also measure the thickness
(a face seen at an angle is foreshortened). A spine or page-edge shot lying
down is stood up as if the book lay face up. With vision, every face comes
upright as the models saw it: sides as the object normally stands, the top
looked down on from the front, the bottom with the object tipped onto its
back.

The page rules were set on real photos (43 spines and 13 page blocks, cropped
from Wikimedia Commons), and get every spine and 10 of the 13 page blocks
right. What they get wrong: sprayed and gilt page edges, and a dim photo of
yellowed pages, are taken for the spine; an ISBN barcode on a front cover
(some manga and coursepacks, or a shop's sticker) makes it the back; and,
without vision, a spine or page-edge shot with the book lying face down is
stood up upside down.

A model shows your copy, not one from the internet: every face you
photograph carries your photo. The ISBN supplies the size and catalog data.
Each sidecar's `faces` says where every face came from:

| Value | Meaning |
| --- | --- |
| `photo` | Your picture |
| `openlibrary` | A stand-in front cover from Open Library, used only when you photographed the back but not the front |
| `color` | A plain color from the cover's edge (a book's missing back or spine) |
| `plain` | A plain color from the front's edge (a box's side not photographed: an extra, not reviewed) |
| `pages` | A generated stack of cream pages (a book's top, bottom or page edge: an extra, not reviewed) |

**How it looks.** The photos sit on a matte, non-metal surface (glTF's
metallic-roughness, roughness 0.6), lit, so a model shades as it turns, like
the object; the photo's colors show where the light falls full on it.
Artwork (a badge's face) is unlit instead, its own colors in any viewer,
with only its rim shading. Edges
and corners are rounded, 1 mm on a book and 1.5 mm on a slab, and each face's
photo wraps halfway round its edges. The model still measures its full size
across the faces. Page sides with no photo get stacked page lines, generated
the same every time, not a texture from anywhere else.

A slab's holder is clear plastic: glossy and alpha-blended, so whatever is
behind it shows through, a web page included. It is built as a holder is: a
rim all round (2.5 mm, its corners rounder on CGC's than PSA's) standing
0.5 mm proud of the window on each face, and inside, ridges framing the label
and the card, the rim and ridges a little denser so they read as the edges
they are. The proportions come from real PSA and CGC slabs. Inside, halfway
through its depth, sit the card (a 0.35 mm plate, its corners cut as the
vision models see this card's own corners: square, slight, about 1.6 mm, or
round, 3.2 mm; never assumed from the card's year or kind, and slight only
when no model said) and the grade label, each with its own pictures front
and back. The clear border in the photos, which shows whatever the slab lay
on, isn't used. glTF's
transmission extension was tried first: it refracts only what's in the 3D
scene, so on a page its clear parts came out white, and viewers without the
extension draw it solid.

**Holofoil.** Foil is drawn so it flashes as the object turns: foil areas
are partly metal under a thin film whose colors shift with the angle (glTF's
`KHR_materials_iridescence`, which three.js and model-viewer render). Three
kinds are found by the vision models: a trading card's holofoil, raw or
inside a slab (below); a slab label's hologram, a patch on whichever side
the models find it (`inside.label.hologram`, per side); and a foil seal or
sticker on a book's front cover (`sticker`), drawn round when its box is
about square on the book. A stand-in cover from Open Library gets no seal:
it shows someone else's copy. For a card, the vision models say which kind
of foil it has, from every
photo and frame that shows its front: `none`; `holo`, only the picture box
shining; `reverse`, everything but the picture box; or `full`, the whole
front (full art, textured and refractor cards). Foil flashes only at some
angles, so frames that miss it say none: two answers naming a kind are
enough, and one alone isn't, so a single model's slip leaves a plain card
plain. They also find the picture box (inside a slab, within the card).
Where they don't, it goes where a standard Pokémon card has it, 8% in from
each side and 10–47% down, unless the card is landscape. The sidecar records
`foil`, `foilBy`, `pictureBox` and `pictureBoxBy`: a raw card's at its top
level, a slab's under `inside.card`. Measuring foil directly, from how a video's
frames change from angle to angle, was tried on a reverse-holo Psyduck:
handheld frames differed more by glare and slight misalignment than by foil,
so the kind is asked instead. The metal and roughness were tuned on the same
card: all metal buried the print in a dark mirror, and at 60% the text stays
clear.

## Vision (optional)

With a vision roster, photos needn't be cropped: shoot the book on the
table, at an angle, two faces at once. Set these, or put them in a `.env`
file where you run Thicken:

```
THICKEN_VISION_URL=http://your-open-webui:8080/api  # any OpenAI-compatible endpoint
THICKEN_VISION_KEY=...
THICKEN_VISION_MODELS=gemini-3.8-flash-high,gpt-6-luna,gpt-5.6-terra,gemini-3.1-pro-low  # your endpoint's model names, primary first
```

- Each photo goes to the first two models (primary and peer) at once,
  letterboxed to 1000 × 1000 px so pixel and 0–1000 coordinates are the same
  numbers. Each answers which faces it sees and their four corners, in the
  face's own upright reading order, so which way up comes with it.
- Thicken cuts each face out and straightens it (a perspective warp). The
  table goes, and an angled shot gives two faces.
- Two answers agreeing (corners within 3% of the photo's diagonal, in the
  same order) is the confidence. When two put a face in different places or
  turns, the next model is asked; if it can't settle it, the primary's answer
  is used and the face goes on the review list. A face only one model names,
  while another answered without it, is left out. When only one model
  answers for a photo at all, its faces are used, and go on the review list.
- Only the profile's own faces count; an answer's corners that cross or
  fold make no face, and aren't cut out. Corners wound the wrong way round
  are the face's mirror image, which no photo shows: on real books about
  one answer in six was one, and two models agreeing on a mirror put a
  spine's lettering backward. Such an answer counts as saying the face is
  there, but places nothing.
- When nothing else says what the object is, the first photo also goes to
  the roster with the list of profiles: which is it, and roughly how big?
  Two agreeing settle it, the same way; the size estimate stands in only
  where `--size` doesn't say, with a warning.
- The rest of the roster stands in for a seat that fails or takes over 3
  minutes. A fine-tuned model goes in by putting it first; training mode
  (below) collects the examples to tune one on.
- With no vision settings, nothing is asked and photos are used whole.

**What leaves the machine:** with `THICKEN_VISION_URL` set, the photos
themselves (re-encoded, so without their EXIF) go to that host. A LAN server
you control still forwards each photo to the model's provider; a hosted
endpoint sees every photo. The only other calls out are a book's catalog
lookups (Open Library, the Library of Congress, Google Books), which send its
ISBN, or the title and author the models read off it; never a photo.

Measured on four real phone photos of one book (2026-10-02): gemini-3.8-flash
put the corners within 0.3–0.9% of the true ones and turned angled faces
correctly. gpt-6-luna and gpt-5.6-terra were as close on position but turned
some angled faces, which is what the peer check catches. Gemini models answer
on a 0–1000 scale whatever they're asked, the reason for the square
letterbox.

## Video (optional)

A short phone video can join the photos, or stand in for them: turn the
object in your hand, or walk round it. Its frames go to the vision models as
more pictures, so a video needs a [vision roster](#vision-optional).

- Thicken samples 24 frames spread across the video and keeps the sharpest
  of each four (a moving phone blurs some): six frames, from six stretches of
  the turn. Each is turned as the phone was held and scaled to fit 2048 px.
- HDR video (an iPhone's HLG, or HDR10) is toned down to an ordinary
  picture: BT.2100's curves to light, reference white (BT.2408: 75% HLG,
  203 nits PQ) just under full white, brighter highlights rolled off, and
  BT.2020's colors to BT.709's.
- A photo always beats a frame for a face, however sharp the frame: frames
  are smaller, compressed and toned down. So a frame shows a face only where
  no photo does: a book's spine or page edge, a box's sides, a slab's back.
  A frame the models found nothing in is left out, and what they doubted in
  a frame goes on the review list only if that frame was used for a face.
- The sidecar records each frame as its video and the seconds into it
  (`"time": 2.3`).

Video needs **ffmpeg**, installed on its own and found on the `PATH`. It is
GPL; Thicken (MIT) runs it, never bundles it. Photos never need it.

| Windows | macOS | Linux |
| --- | --- | --- |
| `winget install Gyan.FFmpeg` | `brew install ffmpeg` | `sudo apt install ffmpeg`, or your distribution's package |

Any build will do: the HDR tone-down uses only filters every build has (the
usual one, zscale, isn't in Homebrew's).

## Training mode (off by default)

Thicken can keep what it asks the vision models as training examples, for
fine-tuning a model of your own to take the roster's first seat. It is off
unless you name a folder for them:

```
THICKEN_DATASET=../thicken-dataset  # outside the repo: it holds your photos
```

- Every question put to the roster (which object it is, where each face is)
  becomes one example. The image is saved exactly as sent (1000 × 1000 JPEG,
  no EXIF). `metadata.jsonl` gets a line with the prompt, every model's
  answer, and the label: the settled answer, with its corners snapped onto
  the real edges, in the image's own pixels. Disputed faces and objects are
  marked, so they can be checked by hand before training on them.
- It is the layout Hugging Face's `imagefolder` loader reads:
  `load_dataset("imagefolder", data_dir="../thicken-dataset")`.
- Thicken only collects. Training a model on the examples, and serving it
  where the roster can reach it, happen elsewhere.
- With no vision roster nothing is asked, so nothing is collected.

## Review

The review list is for what the model shows: if every face is your photo,
the right way round, there's nothing to review. Each sidecar's `review`
lists the rest, a batch ends with the list, and the preview caption shows
it: a stand-in front, a plain spine or back, a face the vision models
disagreed on, a face only one model answered for, and a photo no vision model
answered for (used whole). Add the photos (in a subfolder named after the
item), run again, and only that model is remade, with its review cleared.

Guessed sizes are warnings instead (in `warnings`, and printed): a standard
trim size, a default or estimated thickness, estimates that disagree, an
assumed slab holder. A size off by a few millimeters still shows the object;
`--size` sets the real one.

## What the sidecar records

- **Size:** `widthMm`, `heightMm`, `depthMm`; `measuredBy`, the source of
  each; `depthEstimates`, every thickness estimate made.
- **Identity:** `isbn` and `catalog`, everything Open Library has on the
  edition and its work: title, authors, publishers and where, dates (this
  edition's, its copyright, and the work's first), edition name, format,
  series, languages, subjects with their places, people and times, Dewey and
  LC classes, weight, contents, every id it lists (ISBN-10 and -13, LCCN,
  OCLC, Goodreads, LibraryThing…), links, cover, and the work's page and
  edition count. Never descriptions or excerpts: they're someone else's
  writing. Or, for a slab, `grader`, `cert` and `verifyUrl`;
  `identifiedBy`, how each was found.
- **Photos:** for each, its file and page (or, for a video's frame, the
  seconds into it), format, original size, bytes, camera, lens, capture time
  (the camera's own clock and UTC offset), sharpness, and the face it became;
  with vision, one entry per face cut from it.
- **Codes:** every barcode and QR code seen, and which photo it was on.
- **Lookups:** every catalog call: host, path, status and time.
- **Vision:** where the photos went (host and path, never the key), the
  roster, every model's answer with its status and time, and what was
  settled: the evidence for judging a model, or for training one.
- **Build:** Thicken's version, when, how long, the GLB's size, and a
  fingerprint of the photos used (`inputsKey`).
- **Never recorded:** GPS, serial numbers, and the text of any code Thicken
  didn't use (a QR code can hold a Wi-Fi password). Sidecars may be published.

## Preview

`--preview` (or `thicken preview <model or folder>`) writes
`<name>.preview.png` beside each model: the front three-quarter view and the
back three-quarter view side by side, captioned with the real size and any
face that isn't your photo. It never writes `<name>.png`, which may be your
original. The soft shadow under the model is the preview's, not part of the
asset. It is drawn by model-viewer in an installed Chrome or Edge, run
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
upright and scaled to fit 2048 px. A video (MOV, MP4) adds a handful of its
frames, with a vision roster and ffmpeg ([Video](#video-optional)).

Thicken does no background removal of its own. Both phones already do it
better:

| You want | iPhone | Android |
| --- | --- | --- |
| A badge or object without its background | Long-press the subject in Photos, then Copy or Share (PNG) | Samsung: long-press in Gallery (Image Clipper). Pixel: long-press in Google Photos, Copy sticker |
| A straight, cropped cover or slab | Notes or Files, Scan Documents (PDF) | Google Drive, Scan (choose JPEG or PDF) |
| Just a photo | HEIC or JPEG, straight-on, cropped to the object (or anyhow, with [vision](#vision-optional)) | JPEG, straight-on, cropped to the object (or anyhow, with [vision](#vision-optional)) |

On Windows, Paint's Remove background does the same as subject lifting. A
lifted subject is cropped to itself, and its see-through corners are filled
with its edge color.

## Dimensions

**Which book.** The ISBN comes from `--isbn`, else a barcode in the photos.
With neither, and [vision](#vision-optional), the title and authors the
models read off it are looked up in Open Library: by the title without its
leading article (catalogs file "The Worlds I See" as "Worlds I See") and the
first author's surname. Each result is scored for how sure the match is:
title words in common (against the title, and against title and subtitle,
as the models often read both), times an author's surname matching. Under
50% is no match (warned); under 80% is a match to check (review); the
sidecar's `match` keeps what was read, the score, the work and its editions.
The match gives an ISBN only when the work has just one edition; with
several, which one is yours is unknown, but their records still give the
page count.

**Book.** Each of width, height and depth comes from the first source that
knows it, and the sidecar's `measuredBy` says which:

1. `--size WxHxD` in mm, as measured. Any part can be left out.
2. Open Library: `physical_dimensions`, page count (`number_of_pages`, or
   the catalog's `pagination`, "xii, 336 p.") and format. In a sample of ten
   ISBNs (2026-10-01), 2 had dimensions and 8 a page count.
3. The Library of Congress catalog (free, no key): the height and page
   count from the record's physical description, "177 p. ; 20 cm."
   Catalogers round the height up to the next centimeter, so 20 cm is taken
   as 19.5. Its ISBN note ("hardback", "pbk.") gives the binding. On 15
   ISBNs (2026-10-03) it had a height for 10, where Open Library had 4,
   though Open Library's, when there, are exact. A record is used only if
   it lists the ISBN as its own, not merely cites it, and, when the title is
   known (from Open Library or read off the cover), shares it: one of the
   15 was another book that carried the ISBN by mistake, and is refused with
   a warning. Another gave a hardcover's height for its paperback, which no
   check catches; `measuredBy` says `loc`, so it can be traced.
4. Google Books `dimensions` and page count, for what's still missing.
   **Optional: bring your own key.** Without one, Thicken asks on the quota
   every keyless caller shares, which is usually spent (it answers 429, a
   warning says so, and the chain moves on). With one it's your own 1,000
   requests a day, free: in the Google Cloud console, enable the Books API,
   create an API key under Credentials (restrict it to the Books API), and
   set `GOOGLE_BOOKS_API_KEY` in your environment or a `.env` file where you
   run Thicken. The key is never recorded: lookups keep only host and path.
5. Page count × 0.075 mm (trade paper runs 300–400 pages to the inch), plus
   4 mm of boards for a hardcover.
6. The cover's shape, giving one side from the other.
7. The nearest standard trim size to the cover's shape, flagged as a guess.

**Hardcover or paperback.** The vision models are asked, for every photo
and video frame, and every answer counts, the most given winning: the copy
in the photos decides. Without an answer, the catalog's format (Open
Library's, else the Library of Congress's ISBN note); else a paperback. The
sidecar's `binding` and `bindingBy` say which and how. A paperback is a box
with softly rounded edges. A hardcover is built as one is: the spine and two
boards (2 mm each), the photos on their outsides, round a page block set
back 3 mm at the top, bottom and page edge, so the boards stand past the
pages as a real hardcover's do. A dust jacket wraps the boards, so it
changes nothing. The board and square sizes are a bookbinder's rule of
thumb, to check against real books.

The cover photo's shape is checked against the result. A mismatch over 5%
warns: it means a bad crop or a different edition.

**Inside a slab.** With vision, the models find the card and the label in
each photo, along with the slab itself. Their corners, mapped through the
slab's, give their sizes and places in the holder, averaged over the front
and back. A card measured within 5% of standard (63.5 × 88.9 mm, either way
up) is taken as standard: the rest is measurement noise. The label stays
above the card, and everything stays 1 mm inside the holder. Without vision,
or when the models miss one, they go where a holder usually has them: one
layout for every holder, PSA's proportions by eye. That's a warning without
vision and a review item with it. The sidecar's `inside` records each
part's size, middle and what placed it.

**Slab.** Graders don't publish exterior holder sizes, and figures online
disagree by 1–5 mm, so the table in `src/profiles/slab.ts` holds the best found, each
with its source. Correct it against real holders. It covers PSA (standard,
`psa-thick`, and `psa-tall` for oversized and tall cards such as 1976–77
Topps basketball), BGS, CGC (and `cgc-tall`, estimated from one photo), SGC
and TAG. `--size` overrides it per model. A QR code tells the grader but not
the holder; with vision, a tall holder is told by its label, which is the same
size on every holder: it spans about 87% of a standard one's width and about
60% of a tall one's (measured on real PSA and CGC slabs). Under 75%, the
grader's tall holder is taken, with a warning; `--holder` overrides. A photo
whose shape is off the holder's by more than 4% warns.

`--pt` gives a thick card's thickness in points (thousandths of an inch, the
number thick cards are sold by: 55, 75, 100, 130, 180), for a raw card or the
card inside a slab. A standard card is 0.35 mm; 35 pt is the size of the
holder it fits, not its own thickness.

## Built on

| Part | How | Choice |
| --- | --- | --- |
| Triangulating badge outlines | Dependency | [mapbox/earcut](https://github.com/mapbox/earcut) (ISC) |
| Writing GLB | Dependency | [donmccurdy/glTF-Transform](https://github.com/donmccurdy/glTF-Transform) (MIT) |
| Decoding HEIC | Dependency | [catdad-experiments/libheif-js](https://github.com/catdad-experiments/libheif-js) (LGPL-3.0, used unmodified). sharp's binaries leave out HEVC. |
| Reading barcodes | Dependency | [Sec-ant/zxing-wasm](https://github.com/Sec-ant/zxing-wasm) (MIT). Its `.wasm` is loaded from `node_modules`, not its default CDN. |
| Pictures from scanner PDFs | Dependency | [unjs/unpdf](https://github.com/unjs/unpdf) (MIT, pdf.js inside) |
| Frames from video | Outside program | [FFmpeg](https://ffmpeg.org), run from the `PATH`, never bundled: it is GPL, Thicken MIT. [eugeneware/ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) (GPL-3.0) would put a GPL binary in every install, video or not; [ffmpegwasm/ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) is built for browsers. Choosing the frames is ours. |
| Reading camera details (EXIF) | Dependency | [devongovett/exif-reader](https://github.com/devongovett/exif-reader) (MIT): parses the EXIF block sharp returns |
| Drawing previews | Dependency | [google/model-viewer](https://github.com/google/model-viewer) (Apache-2.0): frames and lights a GLB; three.js inside |
| Running the preview browser | Dependency | [microsoft/playwright](https://github.com/microsoft/playwright) (`playwright-core`, Apache-2.0): drives an installed Chrome or Edge, no browser download |
| Book dimension sources | Write | Read [palmerabollo/node-isbn](https://github.com/palmerabollo/node-isbn)'s provider fallback. Ours is per dimension, not first-provider-wins. The Library of Congress's one field (MARC 300) is read with a regular expression, not a MARC library. |
| Hardcovers | Write | Four rounded boxes from `src/glb.ts`, and the binding asked of the vision models like a card's corners. |
| Holofoil | Write | Which areas shine for each kind of foil read from [simeydotme/pokemon-cards-css](https://github.com/simeydotme/pokemon-cards-css) (GPL-3.0: facts read, nothing copied); the film values are `KHR_materials_iridescence`'s defaults, as [KhronosGroup/glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) uses them; glTF-Transform, already a dependency, writes the extension. |
| Profiles, box, classifier, CLI | Write | |
| Slab holder, card and label | Write | glTF-Transform's materials (already a dependency) for the clear holder; the card and label plates, where they sit, and putting them together are ours. Khronos's [glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) were the reference for clear materials. |
| Finding faces in photos | Write | Vision models over any OpenAI-compatible endpoint, primary and peer (src/vision.ts): one POST each, no SDK. |
| Straightening faces | Adapt, don't depend | [jlouthan/perspective-transform](https://github.com/jlouthan/perspective-transform) (MIT): the 4-point homography; the resampling over sharp's pixels is ours. sharp has no perspective warp, and OpenCV.js is megabytes for one. |
| Snapping corners to edges | Write | `snap` in src/image.ts moves a model's corners (about 1% off) onto the real edges. It samples brightness steps along each side, takes the line they support nearest the model's, and fits it by least squares, in about 70 ms a face. [puffinsoft/jscanify](https://github.com/puffinsoft/jscanify)'s corner ranking was read; a line fit near the model's corners was enough. |

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

## License

MIT. See [LICENSE](LICENSE).
