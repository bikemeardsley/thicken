# Slab profile: the gap between label and card, and where a run's time goes

A note from VaultFlip, 2026-11-12. Not fixed, not scheduled: one PSA slab, made
with thicken 0.4.0 from a marketplace seller's two photos (front and back,
straight-on, cropped tight to the holder). Mike saw the model and said the gap
between the label and the card is larger than the photo shows. He is right,
for two separate reasons, and both are in `src/profiles/slab.ts`.

Line numbers are `origin/main` at `dcb3df4`.

## The inputs, to reproduce

- Photos: `1.jpg` (847 x 1423, front) and `2.jpg` (832 x 1410, back), in the
  one folder under VaultFlip's `deal-photos\ebay\`. They are a seller's
  photos, not Mike's: keep them out of the repo and its fixtures.
- Model and metadata: the one `.glb` and `.json` under VaultFlip's
  `deal-models\ebay\` (`inputsKey` `7c8d7edf37de8ec4`; every seat's answer is
  in `vision.photos`).
- The same run's training examples are under VaultFlip's
  `thicken-dataset\slab\`.
- Run as `thicken <photos> --holder psa`, with `THICKEN_BENCH_URL` set (the
  `bench/vision` collection, six seats).

## 1. The gap is 12.3 mm in the model, about 10.5 to 11.2 mm in the photo

Front photo, corners as settled (all `agreed`), at the holder's scale
(80.5 x 136 mm, so 10.25 px/mm across and 10.32 px/mm down):

| | In the photo | In the model |
| --- | --- | --- |
| Holder outline | (8,8) to (833,1411) | 80.5 x 136 mm, from the table |
| Card | (73,370) to (755,1310): 66.5 x 91.1 mm | 63.5 x 88.9 mm |
| Card's top edge | +32.9 mm from the middle | +30.85 mm |
| Card's middle | -12.65 mm | -13.6 mm |
| Label | (49,36) to (782,262): 71.5 x 21.9 mm | 70.8 x 21.2 mm |
| Label's bottom edge | +43.4 mm | +43.1 mm |
| Label to card | 10.5 mm | 12.25 mm |

By eye the label's red border ends nearer y 250 and the card runs from about
y 368 to y 1322, which makes the photo's gap about 11.2 mm and the card 92.5 mm
tall. So the settled card is also about 12 px short at its bottom edge, and the
card's picture loses about 1 mm there.

What moves the card's top edge down 2 mm:

1. **The card measures 2.5% tall and 4.8% wide against the holder**, and
   `standardCard` (line 224) snaps it to 63.5 x 88.9 about its middle, so it
   loses 1.1 mm at the top and 1.1 mm at the bottom. The holder keeps its
   table size (`psa: [80.5, 136, 6.5]`, line 30). Either the photo's outline is
   a little inside the holder's real edge, or the table is a little large for
   this holder. The comment at line 92 records the same effect once before
   ("everything inside measured 3% big"), and the tall-boy entry at line 35
   already uses the card as the ruler. A standard card is cut more exactly
   than a holder is measured (the comment at line 180 says so), so when the
   card is found and has the standard shape, it could set the scale for where
   things sit, not only its own size.
2. **The card's place is the mean of both sides** (lines 346 to 351). In the
   back photo the card sits 1.9 mm lower against the outline than in the
   front (outline (4,5) to (830,1403), card (79,386) to (742,1321): its middle
   at -14.54 mm), so the mean is 0.95 mm below the front's. A card does not move
   between the two photos, so the two outlines disagree by that much. The
   front is the side people look at; its own placement could win there.

## 2. The band between the wells reads as empty space

This is the larger part of what Mike saw. In the photo the 10 mm between the
label and the card is visible plastic: the lower rim of the label's well, a
step across the full width (about y 285 to 300), and the recessed frame of the
card's well (a dark edge at about y 350). It reads as solid grey.

In the model that band is the window pane alone: `acrylic` at 12% opacity,
with a 0.6 mm ridge round each well at 8% (`FRAME_MM`, `WELL_OPACITY`, lines
174 to 176) and the rim at 20% (`EDGE_OPACITY`, line 178). On a white page the
pane all but disappears, and the label and the card look like two pieces
floating apart. The comment at line 176 says the ridges were made fainter
because denser ones "looked like a sleeve round the card", so this was tuned
on a different slab or background.

Options, cheapest first, none tried:

- A crossbar between the two wells as its own piece, at the rim's density.
- The wells drawn as recesses (the pane thinner over the card and label) so
  the plastic between and around them is visibly thicker.
- The band's look taken from the photo, as the label and card already are.

The check that would have caught it: the model drawn flat beside the photo at
one scale, on white: the GLB's own card and label pictures at their `atMm` and
size, next to the photo scaled to its outline (20 lines of HTML and a headless
browser screenshot did it here). thicken's own preview is on grey at an angle,
where the pane shows and the gap is hard to judge.

## 3. Where the 4.6 minutes went

`build.ms` was 272,194. Almost all of it is waiting for the slowest seat of
`bench/vision`, twice:

| Seat | Photo 1, first ask | second | Photo 2, first ask | second |
| --- | --- | --- | --- | --- |
| agnes-3.0-flash | 3.4 s | 2.9 s | 2.9 s | 6.6 s |
| mistral-small-4 | 4.5 s | 4.0 s | 5.1 s | 3.6 s |
| gemini-3.8-flash | 5.3 s | 16.3 s | 23.6 s | 15.9 s |
| inkling-2-small-free | 48.7 s | 85.0 s | 68.8 s | 52.5 s |
| nemotron-3.5-super-vl-120b-a12b | 36.7 s (no usable answer) | 22.8 s | 121.1 s | 69.4 s |
| sensenova-6.8-flash-lite | 144.3 s | 122.8 s | 179.1 s | 68.6 s (stream failed) |

The two photos are asked together, so the first ask cost 179 s and the second
123 s, and everything else was a few seconds. The second ask happens while a
face is unsettled (`BENCH_ASKS = 2`, `vision.ts` line 30, and line 335). Here
it was a seat reporting a second holder face in the back photo, which ended as
a review line anyway ("front in 2.jpg ... left out").

What would cut it, none tried:

- Settle as answers arrive: once enough seats agree on every face, stop
  waiting. Three seats had agreed within 24 s on both photos.
- A deadline per ask well under the gateway's 420 s, and no second ask for a
  face that is only an extra one a single seat reported.
- For a slab whose outline fills the photo and whose codes read (the cert
  barcode and QR both read here, `identifiedBy.cert: "qr and label"`), the
  holder's layout is nearly known before any model answers.

mistral-small-4 answers in 4 s and was wrong on every box (the outline from
x -288 to 1135 in an 847 px photo, team "Guardians", a holo foil): fast is not
the same as useful, so whatever settles early should still need agreement.
