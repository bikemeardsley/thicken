---
name: thicken-profile
description: Makes, checks and contributes a thicken profile, the plug-in that teaches thicken a kind of object (its real sizes, its shape, what's printed on it worth reading), so thicken can make 3D models (GLB) and metadata of that kind from photos. Use when the user wants thicken to handle a kind of object it has no profile for (a record sleeve, a coin capsule, a cassette), to improve one of thicken's own profiles (truer sizes, more it reads), or to offer their profile to thicken as a pull request.
---

# A thicken profile

A profile is one TypeScript file in the user's profiles folder
(`~/.thicken/profiles`, or wherever `THICKEN_PROFILES` says), loaded by
thicken every time it runs, beside its built-in ones. It says what the kind
of object is, in a few words for the vision models, and builds the model and
its sidecar from the photos. thicken's own profiles are the examples to read:
https://github.com/bikemeardsley/thicken/tree/main/src/profiles. The full
guide, with the rules a contribution is held to, is
https://github.com/bikemeardsley/thicken/blob/main/CONTRIBUTING.md.

## Making one

```sh
npx -y thicken profile new vinyl               # from the template: a box at the size given
npx -y thicken profile new book                # thicken's own book, to improve, used in its place
npx -y thicken profile new tray --from box     # a new one, starting from another
```

It prints the file's path. The template works as it is; each TODO in it is
a field to fill in. Fill them from what the user knows about the object, and
ask rather than invent:

- **`about`**, a few words: the vision models choose the profile by it.
- **`records`**, each sidecar field it writes, in a few words; **`reads`**,
  what's printed on it worth reading (more is better); **`faces`**, each in a
  few words, for the models to find in a photo.
- **Its real sizes, each with its source in a comment** (a spec, a maker's
  page, a measured example). An estimate is fine, marked as one. Never a
  made-up figure presented as a standard.
- **`build`** makes the shape from thicken's parts (`thicken/kit`: `cut`,
  `shots`, `assignFaces`, `box`, `roundedBox`, `plate`, `ring`, ...). Start
  from the built-in profile closest in shape.

Nothing runs when the file loads: only constants and the profile. `read`
claims a picture only from what's certain (a code, a shape no other object
has); the vision models decide everything else. A profile is code that runs
with the user's permissions, so write only what they asked for, and no
network calls they didn't.

## Trying it

```sh
npx -y thicken vinyl front.jpg back.jpg --size 315x315x4 --preview
```

A running thicken MCP server loaded the profiles when it started: try a new
one from the shell, or restart the server for `thicken_make` to see it.

## Checking and contributing it

```sh
npx -y thicken profile check vinyl         # what thicken's CI checks of every profile, short of its tests
npx -y thicken profile contribute vinyl    # opens a pull request to thicken
```

Fix what `check` lists before contributing. `contribute` opens a pull request
on the user's GitHub account, through the GitHub CLI: ask before running it.
It runs the checks and tests first, and stops if they fail. Afterwards, its
test is worth making its own (`test/profiles/<name>.test.ts`), on pictures the
test draws or small images the user made: no photos of real products, cover
art or anyone else's artwork.
