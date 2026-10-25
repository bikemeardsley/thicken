# Foil patterns: the catalog to build from

*Written 2026-10-22. **Built** the same day in `src/patterns.ts` (the eleven patterns, the parallel-name words) and
`src/foil.ts` (`foilLook`: the parallel's name, then the models' `pattern` answer, then plain), with three
changes from the draft below: a tint isn't drawn (the printing carries it, and metal reflects in its printed color),
the base is `rainbow` or `mirror` only, and lightning is `lines` drawn zigzag. Not built: `border` and `figure`
coverage, `emboss`, and the unconfirmed shapes (question 1). Sources and the full per-pattern notes:
[foil-patterns-research.md](foil-patterns-research.md) (web research, 157 entries with URLs). The model bench's lists
(gemini-3.8-flash, nemotron-3.5-lightning, inkling-small-free, mercury-3) were used only to catch names the research
missed; where they and the sources disagree, the sources win.*

## The idea

About 150 named foils reduce to **eleven drawable patterns** with a few settings each, plus a tint, a base and where on
the card the foil goes. A named foil ("Gold Wave Refractor", "Cosmos holo", "Master Ball reverse") is a preset: one
pattern, its settings, a tint. thicken draws a pattern as it draws cracked ice today: a film-thickness map (each piece
its own color at any angle) and a facet map (each piece its own moment to flash), under the foil map that says where
the foil is.

Two things the research settled:

- **Texture is not foil.** A full art's embossed ridges and its foil sheet are separate layers (a Full Art and its
  Rainbow share one emboss with different foil). Emboss goes in the normal map whatever the foil is; see `emboss` below.
- **Rainbow or mirror.** Modern English reverse holos (Sword & Shield, Scarlet & Violet) and Panini base Prizm sit on a
  mirror base with almost no rainbow: patterned chrome. That is a setting (`base`), not a pattern.

## The settings every foil has

| Setting | Values | Example |
|---|---|---|
| `pattern` | one of the eleven below | `flow` |
| `tint` | none, or a color | Gold Wave Refractor: `gold` |
| `base` | `rainbow` (film), `mirror` (chrome, little color), `gold` (warm metal) | SV reverse: `mirror` |
| `where` | `art`, `not-art`, `full`, `border`, `figure` | holo `art`, reverse `not-art`, full art `full` |

`where` extends today's kinds (holo = `art`, reverse = `not-art`, full = `full`) with `border` (ex/LV.X borders,
Reptilian and Camo refractor borders) and `figure` (Shining Pokémon, BREAK gold figure). `figure` needs the figure's
outline, which the vision models don't give yet: flagged below.

## The eleven patterns

| Pattern | What it draws | Settings | Named foils that use it (S = a source describes the geometry, U = name only, shape guessed) |
|---|---|---|---|
| `sweep` | no pieces: one smooth film whose thickness runs across the card, so one rainbow band sweeps as it turns | direction (diagonal, horizontal, vertical) | Sheen (XY, diagonal) S; Mirage (SV, horizontal) S; plain reverse (DP–HGSS, Mega Evolution) S; Delta Species holo S; Refractor and color refractors S; Silver Prizm / Optic Holo S; Leaf Mirror, Press Pass Reflector U; Certified Mirror U; Illustration Rare S; Futuristic Rare S; Absolute Spectrum U; MTG traditional and double-rainbow S |
| `lines` | parallel stripes, each its own thickness | angle, spacing, width | Tinsel (BW, horizontal) S; Line (SWSH, vertical) S; Topps Shimmer (diagonal streaks) S; Velocity S; Yu-Gi-Oh Secret (diagonal dot lines) and Prismatic (crossed) S; Dufex engraved lines U |
| `cells` | a regular grid of tiles, neighbours alternating | shape (square, diamond, rectangle, hex), size, alternate | X-Fractor (small squares) S; Checkerboard / Checker Flag S; Crosshatch (diagonal grid) S; BREAK squared holo S; Mosaic (box tiles) S; Hyper ("pixelated" cells) S, sources conflict; Mini-Diamond (rhombus facets) S; Prism (faceted tiles, shape unsure) U; Mega Box tire tread U; Atomic (plaid / squares by year) S, conflicting; Yu-Gi-Oh Mosaic Rare S; Panini Select Courtside S |
| `motifs` | a regular grid of a symbol | symbol, size, rows offset, one big symbol | Poké Ball reverse S; Master Ball reverse S; energy-symbol reverses (EX Hidden Legends, FRLG/TRR, Ascended Heroes) S; type-symbol scatter (BW/XY, random sizes) S; SM rows + big symbol S; SWSH chevron tiles S; SV Paldea tiles S; Poké Balls and stars (EX Emerald) S; 3D Poké Ball (Unseen Forces) S; special balls / Rocket R (Ascended Heroes) S; Logofractor (league logos, diagonal) S; Team Plasma shield S; MTG step-and-compleat, mana foil S |
| `points` | many small random points, each flashing alone | shape (dot, square, star, hex), size, density | Starlight (WotC) S; Speckle refractor S; Sparkle S; Pixel / Confetti (square bits) S; Sequin S; Glitter stars (Gem Pack) S; Starfractor U; Yu-Gi-Oh Starfoil S; MTG confetti and dazzle S; UD Glitter Bomb U |
| `circles` | random dots and rings of mixed sizes | size range, rings vs filled, density | Cosmos (2000–2011 holo, and cosmos reverse) S; Disco / Bubbles S; Fast Break S; Pulsar (dots; one source says waves) S; MTG galaxy S; Topps Lunar Glow (craters) U |
| `shards` | cracked ice: random polygons | size | Cracked Ice (Pokémon theme decks, Panini Ice / Crystals) S; Sapphire S; Yu-Gi-Oh Shatterfoil S; MTG fracture, facet S; Topps Tek Diffractor U; Frozenfractor U. **Built.** |
| `flow` | flowing curves | kind (wave, ripple, lava blobs, streaks, marble, nebula), scale, angle | Water Web (SM) S; Topps Wave S; Panini Wave S; Panini Shimmer (rippled) S; Lava S; Raywave (Panini, wavy) S; MTG surge, halo, ripple S; Tie-Dye U; Nebula U; Genesis U; Leaf Metal Wave / Marble U; Obsidian Electric Etch U; Revolution Lava / Groove U |
| `radial` | one feature centerd on the card | kind (rings, spiral, rays, pinwheel), count | Superfractor (gold spiral) S; Gold Vinyl (record grooves) S; Scope (reticle rings) S; Topps RayWave (rays) S; Museum Collection sunray S; Pinwheel (EX Deoxys, Gem Pack prismatic) S; Swirl (WotC/EX holo, one big arc) S; Fireworks reverse (many bursts: `radial` repeated) S |
| `skin` | printed animal or camo texture over the foil | kind (zebra, tiger, snake, scales, elephant, peacock, camo, blossom) | Zebra S; Tiger Stripe S; Snakeskin S; Dragon Scale S; Reptilian refractor (border) S; Elephant S; Peacock S; Camo (Panini, Topps border) U; Cherry / Plum Blossom U; MTG dragonscale S |
| `maze` | an etched maze or chain-link | scale | Panini Mojo ("maze-type etching", Flair Showcase lineage) S; Topps Mojo (chain-link, sources conflict) S; Choice ("like Mojo") S; Leaf Metal Mojo U |

`emboss` is the twelfth thing, not a pattern: a relief in the normal map, on top of whichever pattern. Kinds: ridges
along the art's contours (SIR, SWSH alt arts, Gold/Hyper, VMAX), fingerprint whorls (BW/XY Full Art), parallel lines (SM
Full Art), raised picture (1997 Finest Embossed, Yu-Gi-Oh Ultimate Rare). Contour ridges can be traced from the photo's
own edges, the one place where the photo itself shapes the effect. Rainbow Rare = Full Art emboss + `sweep` + a printed
pastel rainbow (already in the photo).

## Not foil (leave as print)

Negative and Sepia refractors (photo treatments over a plain `sweep`), Chrome Black stock, acetate windows (Clear Cut,
E-X2000, Topps Tek: see-through, a geometry job, not foil), whole-card holograms (UD Holoview, Yu-Gi-Oh Ghost Rare:
can't be drawn as a film), neon and invisible ink, Finest peel-off protector, Stained Glass (its own artwork).

## Choosing the preset for a card

1. **The parallel name, if the card has one** (the sidecar's reads, or a name passed in): each word in it is looked up
   below; a pattern word picks the pattern, a color word the tint. "Gold Wave Refractor" → `flow` wave, tint gold.
2. **Otherwise the vision models are asked** which of the eleven patterns, the tint and the base, with the same "two
   answers must agree" rule `foilKind` uses now.
3. **Otherwise** `plain`, one flat sheet of film, and the review asks for a video of the front tilting (question 3).

### Parallel-name words → preset

From vaultflip's `PARALLEL_WORDS` (1009 SportsCardsPro searches) plus names from the research. Color words (gold,
red, aqua…) are tints and not listed.

| Pattern | Words |
|---|---|
| `sweep` | refractor, fractor, reflector, prizm, prism*, holo, holographic, mirror, rainbow, spectrum, gradient, glow, flash*, foil, foilfractor, foilfactor |
| `lines` | tinsel, velocity, shimmer (Topps), vapor, groove, laser, lazer, vector, rayfoil |
| `cells` | xfractor, checkerboard, checker, crosshatch, mosaic, hyper, diamond, diamonds, minidiamond, diamante, atomic, plaid, prism* |
| `motifs` | logofractor, cupfractor, packfractor, pokeball, masterball, energy, stars* |
| `points` | speckle, sparkle, sparkles, glitter, sandglitter, confetti, dazzle, razzle, dust, scintillate, sequin, pixel, stars* |
| `circles` | cosmos, cosmic, galaxy, galactic, constellation, interstellar, disco, bubble, dots, circles, pulsar, pulse, nucleus, lunar |
| `shards` | cracked, ice, icy, crystal, crystals, crackle, shattered, shatter, frozenfractor, sapphire, glass |
| `flow` | wave, waves, raywave (Panini), riptide, ripple, vibrations, sonar, lava, lave, molten, swirl*, tie-dye, tiedye, psychedelic, nebula, genesis, marble, haze |
| `radial` | superfractor, vinyl, scope, raywave (Topps), sunburst, starburst, pinwheel, fireworks, explosion, xplosion, kaleidoscope |
| `skin` | zebra, tiger, snake, snakeskin, reptilian, dragon, elephant, peacock, camo, blossom, koi |
| `maze` | mojo, choice |

\* ambiguous: `prism` is Topps Prism (`cells`) but "Prizm" alone is Panini silver (`sweep`); `stars` is Optic Stars
(`points`) or Pokémon star reverses (`motifs`); `swirl` is Mosaic Swirl (`flow`) or the WotC swirl (`radial`);
`raywave` differs by maker; `flash` is Select Flash (lightning, see question 2) or a plain word. The maker in the
card's name decides; with none, vision is asked.

## Questions for Mike

Mike said to go ahead without answering (2026-10-22); the defaults taken are noted on each, and each stays open.

1. **Unconfirmed shapes** (default: left to the vision models' pattern answer). Sources name but don't describe: Panini Pandora, Seismic, Lazer, Photon, Reactive, Genesis,
   Kaleidoscopic, Fusion, Honeycomb; Topps Geometric, Pulsar, Cosmic Chrome parallels; most Upper Deck (OPC Rainbow,
   Spectrum FX, OPC Platinum ladder); Pokémon Radiant, Trainer Gallery, Paldean Fates shinies, ACE SPEC. Beckett's
   parallel image galleries would settle most of them by eye. Look at those in the browser and describe what they show,
   or do you have some of these on hand to photograph?
2. **Shock / Flash (lightning bolts)** fits none of the eleven well. Add a twelfth (`bolts`), or draw it as `lines`?
   (Default: `lines`, zigzag.)
3. **The default when nothing names the pattern.** *Decided by Mike, 2026-10-22:* `plain`, foil as it was before
   patterns (one flat sheet of film), since less foil is better than wrong foil, and the review asks for a video of
   the front tilting so the models can see the pattern.
4. **`figure` and `border` coverage.** *Border built 2026-10-22:* the models are asked whether the printed border is
   foil and find its inside edge (the `frame` face; a standard card's 3 mm border where they don't), and the border
   shines in the card's look, alongside any holo, reverse or full foil. *Figure still open:* a Shining Pokémon's or a
   BREAK card's figure needs its outline, which four corners can't give; it wants a segmentation step.
5. **Emboss.** *Built 2026-10-22:* the models are asked whether the front is textured; if so, the photo's own edges
   become ridges in the normal map, over foil and print alike, with or without foil. `RIDGE` in src/patterns.ts sets
   their height, a guess until it's tuned on a real textured full art.
