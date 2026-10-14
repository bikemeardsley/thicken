# Contributing to thicken

thicken takes **profiles**, the kinds of object it knows how to make: new
ones, and improvements to the ones it has. A profile is one file, and adding
one changes nothing else: thicken finds it, the CLI lists it, the README's
table of profiles shows it, and the shared tests check it.

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
- **Or a better version of one thicken has:** truer sizes, a part it misses,
  something more it reads. It must still pass that profile's tests.
- **Not** an app: collections, prices and catalogs belong to whatever reads
  the sidecar.

## Making one, while you use thicken

You don't need to clone anything to start:

```sh
thicken profile new vinyl          # a new profile, from the template
thicken profile new book           # thicken's own book, yours to improve
thicken profile new tray --from box   # a new one, starting from another
```

Each lands in `~/.thicken/profiles` (`THICKEN_PROFILES` to put them
elsewhere), and thicken uses it straight away: `thicken vinyl front.jpg`. One
named as a built-in is used in its place, with a note, while you try it out.
The template works as it is, a box at the size you give, with a comment on
every field and a TODO on each one to fill in.

- **The fields:** `about` (what it is, in a few words: the vision models are
  told this when they choose a profile), `input` and `makes` (for the
  README), `records` (each field it writes in the sidecar, in a few words:
  the record is half of what thicken makes, so say what yours holds), `faces`
  (each in a few words, for the models to find), `reads`
  (what's printed on it worth reading: more is better), `asks` (short
  questions with one-word answers). Optional: `note`, `unsnapped`, `generic`,
  and `read` (how its codes or pictures give it away without vision). Each is
  described on the `Profile` type.
- **Building it:** `build(pictures, job)` returns the model (GLB bytes) and
  its sidecar. thicken's parts come from `thicken/kit`: `cut` (the faces the
  models found, straightened), `shots`, `assignFaces`, `pictureRecord`,
  `box`, `roundedBox`, `plate`, `ring`, the materials, `toGlb`, `pooled`,
  `readOf`, the foil helpers. The built-in profiles in `src/profiles` are the
  examples to read.
- The model is at the object's real size (glTF's unit is the meter). The
  sidecar gives sizes in millimeters and says where each came from
  (`measuredBy`); a guess goes in `warnings`, and a face worth photographing
  again in `review`.

## Contributing it

```sh
thicken profile check vinyl        # what CI will check of it, short of its tests
thicken profile contribute vinyl   # opens the pull request
```

With git and the [GitHub CLI](https://cli.github.com) signed in
(`gh auth login`), `contribute` does the rest: it brings your fork up to date,
lays the profile out on a branch (its imports become `../kit.ts`), adds a test
from the template if it has none, makes the README's table, runs the type
check and the profile's tests, pushes, and opens the pull request with the
checklist filled in. An improvement keeps the profile's own tests, which must
still pass. Without the GitHub CLI, it lays the contribution out in a folder
and says what to do with it.

Then make its test its own: `test/profiles/<name>.test.ts`, on pictures the
test draws itself (sharp, SVG; see `test/profiles/slab.test.ts`) or small
images you made, in `test/fixtures/<name>/`. No photos of real products,
cover art, logos or anyone else's artwork: the repo has to stay publishable.
Tests run offline (a fetch with no stand-in fails): `catalog()` in
`test/helpers.ts` stands in for web lookups and the vision models.

From a clone of this repository, the same commands run as
`node src/cli.ts profile …`, or write the profile in `src/profiles` directly,
importing from `../kit.ts`, and run `npm run readme`, `npm run check` and
`npm test`.

## Rules

- **Nothing runs when it loads.** thicken loads every profile on every run,
  so a profile file only declares: no top-level code beyond its constants
  and its profile. Work happens in `read` and `build`.
- **Recognize only your own.** `read` says a picture is yours from what's
  certain (a code, a shape no other object has); anything less is left to
  the vision models, which choose by `about`. The shared tests check that no
  profile claims another's pictures.
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

It adds or changes only profiles' own files: `src/profiles/<name>.ts`,
`test/profiles/<name>.test.ts` and fixtures in `test/fixtures/<name>/`, each
under 1 MB; and `README.md` only in its regenerated table. A check fails a
pull request from a fork that touches anything else, or deletes or renames
anything, before any of its code runs. The maintainer approves or declines
it, and an approved profile ships in the next release.

The review reads the whole profile: what it does at load, which hosts it
contacts and what it sends them, how broadly `read` claims pictures, and
where its sizes come from.

By contributing, you agree your work is released under the
[MIT license](LICENSE).
