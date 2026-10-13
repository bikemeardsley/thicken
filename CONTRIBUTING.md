# Contributing to thicken

thicken takes new **profiles**: kinds of object it knows how to make. A
profile is one file, and adding one changes nothing else: thicken finds it,
the CLI lists it, the README's table of profiles shows it, and the shared
tests check it.

Anything else (a bug fix, a core feature): open an
[issue](https://github.com/bikemeardsley/thicken/issues) first, so we can
talk it over before you write code.

## What makes a good profile

- **A kind of object with sizes or a build of its own** that the generic box
  doesn't capture: a record sleeve, a coin in its capsule, a comic in a bag
  and board, a cassette. `slab` is one: a clear holder with a card and a
  label inside.
- **Or a generic shape thicken can't build yet**, named for the shape
  (`cylinder`, `flat`), not "other" or "unknown". `box` is the model.
- **Not** a variation of an existing profile (open an issue to extend it),
  and not an app: collections, prices and catalogs belong to whatever reads
  the sidecar.

## Adding one

1. **Start from the simplest.** Copy `src/profiles/box.ts` (about 60 lines)
   to `src/profiles/<name>.ts`. The file's name is the profile's name:
   lowercase, as typed in `thicken <name> photo.jpg`. Export one profile.
2. **Describe it.** Each field is documented on the `Profile` interface in
   `src/thicken.ts`:
   - `about`: what it is, in a few words. The vision models are told this
     when they choose a profile for a photo, and the README shows it.
   - `input` and `makes`: what it's made from and what it makes, for the
     README.
   - `faces`: each face in a few words, for the vision models to find in a
     photo. Artwork has none (`badge.ts`).
   - `reads`: what's printed on it worth reading. More is better: the apps
     that read the sidecar take what they want.
   - `asks`: short questions with one-word answers (a card's corners).
   - Optional: `note` (how it stands), `unsnapped`, `generic`, and `read`
     (how its codes or pictures give it away without vision).
3. **Build it.** `build(pictures, job)` returns the model (GLB bytes) and its
   sidecar. Use the shared parts rather than writing your own:
   - `src/faces.ts`: `cut` (the faces the vision models found, straightened),
     `shots`, `assignFaces`, `pictureRecord`.
   - `src/glb.ts`: `box`, `roundedBox`, `plate`, `ring`, the materials, and
     `toGlb`.
   - `src/vision.ts` (`pooled`, `readOf`) and `src/foil.ts`.

   The model is at the object's real size (glTF's unit is the meter). The
   sidecar gives sizes in millimeters and says where each came from
   (`measuredBy`); a guess goes in `warnings`, and a face worth photographing
   again in `review`.
4. **Test it** in `test/profiles/<name>.test.ts`. Use pictures the test
   draws itself (sharp, SVG; see `test/profiles/slab.test.ts`), or small
   images you made, in `test/fixtures/<name>/`. No photos of real products,
   cover art, logos or anyone else's artwork: the repo has to stay
   publishable. Tests run offline (a fetch with no stand-in fails):
   `catalog()` in `test/helpers.ts` stands in for web lookups and the
   vision models.
5. **Check it:** `npm run readme` (rewrites the README's table of profiles),
   `npm run check`, `npm test`. `test/profiles.test.ts` checks every profile
   for what it must have, and that no profile recognizes another's
   pictures: your `read` must not claim the other profiles' fixtures, nor
   theirs yours.

## Rules

- **Nothing runs when it loads.** thicken loads every profile on every run,
  so a profile file only declares: no top-level code beyond its constants
  and its profile. Work happens in `read` and `build`.
- **Recognize only your own.** `read` says a picture is yours from what's
  certain (a code, a shape no other object has); anything less is left to
  the vision models, which choose by `about`.
- **Real sizes, with sources.** Each standard size gets a comment saying
  where it came from: a spec, a maker's page, a measured example. Estimates
  are fine, marked as estimates.
- **The vision models decide what a photo shows** (which side is the front,
  how corners are cut): ask them (`asks`) rather than guess from pixels.
- **No new dependencies and no new command-line options** in a profile pull
  request: open an issue first.
- **Network calls** only to free public services, each with a timeout,
  failing softly (a warning), and recorded in the sidecar's `lookups` (host
  and path, never a key). Never record secrets or GPS. Name the hosts in
  your pull request.
- **Every machine:** CI runs Windows, macOS and Linux.
- **American English** in code and text.

## The pull request

It adds new files only: `src/profiles/<name>.ts`,
`test/profiles/<name>.test.ts`, and fixtures in `test/fixtures/<name>/`, each
under 1 MB; and changes `README.md` only in its regenerated table. A check
fails a pull request from a fork that edits, deletes or renames anything
else, before any of its code runs; improving an existing profile starts as an
issue. Fill in the template; the maintainer approves or declines it, and an
approved profile ships in the next release.

The review reads the whole profile: what it does at load, which hosts it
contacts and what it sends them, how broadly `read` claims pictures, and
where its sizes come from.

By contributing, you agree your work is released under the
[MIT license](LICENSE).
