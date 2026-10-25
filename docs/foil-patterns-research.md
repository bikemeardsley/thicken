# Trading-card foil / refractor / holo patterns (research, 2026-10-22)

Format per line:
NAME | aliases / words in parallel names | structure | tilt behavior | coverage | products/eras | source

"(unconfirmed)" = not stated by the cited source (or by any source found); it is a best description to be checked against photos.
Tilt behavior is almost never written down by sources; where a source only gives structure, the tilt field is marked (unconfirmed).

Two facts that matter for a glTF model (normal map vs iridescence):
- Foil pattern and embossed texture are separate layers. A Full Art and its Rainbow version can share the same emboss ("etch") map while having different foil sheets (Elite Fourum, https://www.elitefourum.com/t/question-regarding-card-texturing-guardians-rising/45104). So model texture as a normal map and foil pattern as an iridescence/roughness mask, independently.
- Modern English reverse holos (SWSH, SV) use a mirror foil base that has almost no color scattering (Bulbapedia note 1, https://bulbapedia.bulbagarden.net/wiki/Holofoil_(TCG)). They behave more like patterned chrome than rainbow holo.

---

## 1. Pokémon TCG

### 1a. Holo-rare patterns (foil in the art window)

Starlight | WotC holo, Base/Jungle/Fossil holo, "starlight holo" | starbursts of different sizes spread across the image, slightly blurry; CardTrader adds "fine sparkling microdots"; random scatter, elements roughly 1-5% of card width (size unconfirmed) | scattered points flash individually (unconfirmed) | art window only | Base Set, Jungle, Fossil (1999-2000) | https://bulbapedia.bulbagarden.net/wiki/Holofoil_(TCG)

Cosmos | galaxy holo, cosmos holo, "new cosmos" (later promo variant, forum term) | dots and circles of different sizes spread across the image; random scatter; PokeFolio says the swirls are random per print | individual circles/dots catch light at different angles (unconfirmed) | art window only (rare holos); also used as reverse ("Reverse Cosmos Holofoil") | default holo from Base Set 2 through Call of Legends (2000-2011), i.e. Neo, e-Card, EX, DP, Platinum, HGSS; afterwards a promo/blister pattern | https://bulbapedia.bulbagarden.net/wiki/Cosmos_Holofoil_(TCG)

Swirl (holo variant) | "swirl", "Saturn swirl" (Portuguese/Brazilian) | a large circular swirl in the starlight/cosmos foil where the foil sheet's pattern center lands on a card; one large feature per card, position varies (structure unconfirmed; the forum only names it) | the swirl arc shows as a curved highlight that moves with tilt (unconfirmed) | art window | WotC holos, EX Team Rocket Returns and FireRed & LeafGreen; Portuguese "Saturn" holo | https://www.elitefourum.com/t/total-number-of-holofoil-patterns/51850

Delta Species plain holo | δ holo | plain holofoil with no pattern on the border and on the Pokémon itself | one smooth rainbow sweep (unconfirmed) | card border + Pokémon figure | EX Delta Species (2005) δ Pokémon holo rares | https://bulbapedia.bulbagarden.net/wiki/Cosmos_Holofoil_(TCG)

Tinsel | BW holo | horizontal stripes across the image | horizontal bands light up and move up/down as the card tilts (unconfirmed) | art window; Japanese prints also the border | Black & White to Legendary Treasures (2011-2013), promos | https://bulbapedia.bulbagarden.net/wiki/Holofoil_(TCG)

Sheen | XY holo, "plain holo" | no decorative pattern, smooth glossy foil; refracts along a diagonal: Japanese bottom-left to top-right over the whole card, Korean same direction image only, international image only bottom-right to top-left | one rainbow band sweeps diagonally across the surface | international/Korean art window; Japanese whole card | XY series (2014-2016), promos | https://bulbapedia.bulbagarden.net/wiki/Holofoil_(TCG)

Water Web | SM holo, "oil slick" (collector name) | wavy pattern like flowing water; continuous curved lines, irregular | rainbow ripples shift across the waves (unconfirmed) | art window | Sun & Moon to Cosmic Eclipse (2017-2019) | https://bulbapedia.bulbagarden.net/wiki/Holofoil_(TCG)

Line | SWSH holo, "vertical tinsel" (forum) | thin vertical lines; PokeBeach: "vertical rainbow pattern with spaces between each line" | refracts light from top to bottom of the image: rainbow bands run along the vertical lines as you tilt | art window; Japanese prints also holo borders | Sword & Shield to Crown Zenith (2020-2023) | https://www.pokebeach.com/2019/09/sword-shield-holo-pattern-revealed

Mirage | SV holo | like Sheen (smooth, no pattern) but refracts horizontally | one smooth band sweeps horizontally | art window + the silver border | Scarlet & Violet series (2023-2025) and onward | https://bulbapedia.bulbagarden.net/wiki/Holofoil_(TCG)

Cracked Ice | broken glass, shards, shattered glass, shattered holo | irregular reflective polygons like shattered glass; random, shards maybe 3-10% of card width (size unconfirmed) | each shard flashes independently (unconfirmed) | usually the art window; some prints (English Frost Rotom, Rising Rivals) everything except the Pokémon image | theme-deck exclusive holos from Platinum through HGSS to Sword & Shield; blister promos; Japanese GX Ultra Shiny "reverse cracked ice" parallel set | https://bulbapedia.bulbagarden.net/wiki/Holofoil_(TCG)

Crosshatch | | intersecting diagonal lines forming a regular reflective grid | grid cells flash in diagonal rows (unconfirmed) | often the background, like a reverse holo | Play! Pokémon prize/league cards, league Energy | https://bulbapedia.bulbagarden.net/wiki/Holofoil_(TCG)

Sequin | | many small reflective geometric shapes scattered across the image | pieces flash individually like sequins (unconfirmed) | art window | General Mills cereal promos (2017, 2019, 2021) | https://bulbapedia.bulbagarden.net/wiki/Holofoil_(TCG)

Pixel / Confetti | | small blocky (square) reflective shapes scattered randomly, like confetti | pieces flash individually (unconfirmed) | art window | McDonald's Collection sets; Celebrations Classic Collection | https://bulbapedia.bulbagarden.net/wiki/Holofoil_(TCG)

Japanese-exclusive holo variants (several) | e.g. a pattern giving "crescent-moon-like effects at certain angles" | not described beyond photos (unconfirmed) | crescent highlights at angles | varies | Japanese/Korean/Chinese promos and sets | https://www.elitefourum.com/t/total-number-of-holofoil-patterns/51850

### 1b. Reverse-holo patterns (foil everywhere except the art, unless noted)

Fireworks reverse | Legendary Collection reverse | busy bursts ("fireworks") over the whole card body; dense, random | many small bursts sparkle (unconfirmed) | whole card except artwork | Legendary Collection (2002) | https://bulbapedia.bulbagarden.net/wiki/Holofoil_(TCG)

Cosmos reverse (WotC promo) | circles and stars | circles and stars like Cosmos | as Cosmos (unconfirmed) | whole card except art | WotC Black Star Promo #34 Entei (2002), later cosmos-reverse promos | https://www.codedyellow.com/reverse-holo-patterns/

Plain / flat reverse | "flat holographic finish", "rainbow sheen", "holographic sheen with vertical rainbow colors" (DP-HGSS) | no pattern, smooth foil | one rainbow sweep across the whole foil area; DP-HGSS described as vertical rainbow bands | whole card except art (EX Delta Species to Power Keepers: inside the art background instead; EX Dragon Frontiers: on the Pokémon itself) | Expedition to EX Team Magma vs Aqua; EX Delta Species-Power Keepers; DP, Platinum, HGSS, BW base; Plasma/Ancient Trait/Evolutions/Double Crisis; SV Ancient & Future cards; Mega Evolution series (2025-) with "mirror-like border" | https://www.codedyellow.com/reverse-holo-patterns/

Energy-symbol array in art | EX Hidden Legends reverse | an array of type/energy symbols behind the Pokémon (regular repeat); rares add a faint foil type symbol in the attack box | symbols flash together (unconfirmed) | art background only (not the body) | EX Hidden Legends (2004) | https://bulbapedia.bulbagarden.net/wiki/Holofoil_(TCG)

Energy-symbol + Poké Ball stamp | FRLG / TRR reverse | energy-symbol pattern in the picture window, faint foil Poké Ball in the attack box; TRR adds set logo; rare reverses get gold-foil name/HP and silver rarity symbol | (unconfirmed) | art window + small foil stamps | EX FireRed & LeafGreen, EX Team Rocket Returns (2004) | https://bulbapedia.bulbagarden.net/wiki/Holofoil_(TCG)

Pinwheel / prismatic | EX Deoxys reverse, Gem Pack "prismatic holo" | radiating pinwheel segments from a center (one large radial feature) | rainbow rotates around the center as you tilt (unconfirmed) | EX Deoxys: art window (Coded Yellow says image and text); Gem Pack 1: whole card | EX Deoxys (2005); Gem Pack Vol. 1-2 (China, 2025) | https://bulbapedia.bulbagarden.net/wiki/Holofoil_(TCG)

Poké Ball and stars | EX Emerald reverse | repeated Poké Balls and stars | (unconfirmed) | picture window | EX Emerald (2005) | https://bulbapedia.bulbagarden.net/wiki/Holofoil_(TCG)

3D Poké Ball | EX Unseen Forces reverse | Poké Ball pattern drawn with a 3D look | (unconfirmed) | picture window | EX Unseen Forces (2005) | https://bulbapedia.bulbagarden.net/wiki/Holofoil_(TCG)

Type-symbol scatter | BW/XY reverse | type symbols of different sizes spread randomly; dual types split down the middle (Steam Siege); Trainers use Poké Balls | symbols flash with the base foil (unconfirmed) | whole card except art | Emerging Powers to Steam Siege (2011-2016) | https://bulbapedia.bulbagarden.net/wiki/Holofoil_(TCG)

Team Plasma shield | | a shield in the center of the text area, plain holo | (unconfirmed) | body | Plasma Storm/Freeze/Blast Team Plasma cards (2013) | https://www.codedyellow.com/reverse-holo-patterns/

Rows + big type symbol | SM reverse | type symbol repeated in horizontal rows with one very large symbol at the lower side | (unconfirmed) | whole card except art | Sun & Moon to Cosmic Eclipse (2017-2019) | https://www.codedyellow.com/reverse-holo-patterns/

Chevron tiles | SWSH reverse, "tile" | repeated upward-facing light/dark chevrons, each holding the type symbol; regular grid; on a mirror-foil base | patterned chrome; little rainbow (mirror base) | whole card except art | Sword & Shield to Crown Zenith (2020-2023) | https://www.codedyellow.com/reverse-holo-patterns/

Paldea tiles | SV reverse, "parallel foil" | type symbols of different sizes interspersed with pebble-like shapes; a circled type symbol ringed by small symbols on the right; mirror-foil base; inspired by Paldea tilework | patterned chrome (mirror base) | foil pattern surrounding the artwork | Scarlet & Violet to Black Bolt/White Flare (2023-2025) | https://www.pokemon.com/us/pokemon-news/pokemon-tcg-scarlet-and-violet-revamps-pokemon-tcg-card-aesthetic

Poké Ball pattern | "Poké Ball reverse", JP "Monster Ball mirror" | repeated Poké Ball motifs (regular repeat, size unconfirmed) | (unconfirmed) | whole card except art | Prismatic Evolutions (2025), Black Bolt/White Flare, JP Pokémon Card 151, Gem Packs | https://www.codedyellow.com/reverse-holo-patterns/

Master Ball pattern | "Master Ball reverse/mirror" | repeated Master Ball "M" motifs | (unconfirmed) | whole card except art | Prismatic Evolutions, Black Bolt/White Flare, JP 151 (1 per box), Gem Packs | https://www.codedyellow.com/reverse-holo-patterns/

Energy reverse + special-ball reverse | "Energy pattern", Love/Quick/Friend/Dusk Ball, Team Rocket symbol | one version uses the Pokémon's Energy symbol, the other a specialty ball or Rocket "R" motif | (unconfirmed) | whole card except art | Ascended Heroes (Jan 2026; two reverses per Pokémon); Gem Pack "Energy pattern" | https://www.codedyellow.com/reverse-holo-patterns/

Glitter (stars) | "Glitter holo", "Stars pattern" | many small five-pointed stars scattered across the card | stars twinkle individually (unconfirmed) | whole card | Gem Pack 1 (China) | https://bulbapedia.bulbagarden.net/wiki/Holofoil_(TCG)

Ripple reverse | | named only by a retailer (unconfirmed) | (unconfirmed) | (unconfirmed) | Gem Pack Vol. 1 | (unconfirmed, retailer listing only)

### 1c. Special rarities, borders and textures

Shining (foil Pokémon) | Shining Pokémon | the Pokémon figure itself is reflective foil; Japanese Neo Shinings have an extra glitter/sparkle over the whole card (forum); SM Shining Legends use a similar holo | figure shines while the background stays matte; glitter twinkles (unconfirmed) | the Pokémon figure (EN); whole card glitter (JP) | Neo Revelation, Neo Destiny (2001-02); Shining Legends (2017); Celebrations/30th Celebration reprints with "special textured foil" | https://bulbapedia.bulbagarden.net/wiki/Shining_Pokémon_(TCG)

Gold Star | Pokémon ★, "gold star" | gold tinges on frame corners; the shadows of the frame graphics are holographic; gold-foil rarity star; the figure breaks out of the art window. Holo pattern in the art itself not described (unconfirmed) | (unconfirmed) | frame details + art (unconfirmed) | EX Team Rocket Returns to EX Power Keepers (2004-07) | https://bulbapedia.bulbagarden.net/wiki/Pokémon_Star_(TCG)

Holofoil border | Pokémon-ex border, LV.X border, Prime border, "glittering borders" | foil on the card border, sparkly/glitter on first-gen ex (forum) | border glints | border only (plus Prime gold-foil name text) | EX-era Pokémon-ex (2003-07), DP LV.X (2007-09), HGSS Prime (2010-11) | https://bulbapedia.bulbagarden.net/wiki/Pokémon_LV.X_(TCG)

Crystal Pokémon foil | Crystal | holo treatment not described (unconfirmed) | (unconfirmed) | (unconfirmed) | Aquapolis, Skyridge (2003) | https://bulbapedia.bulbagarden.net/wiki/Crystal_Pokémon_(TCG)

Full Art etched texture | Full Art, FA, "embossed etching", "fingerprint texture" | foil over the whole card plus an embossed texture; BW/XY-era described as fingerprint-like ridges; Sun & Moon Full Art Pokémon reflect light "in parallel lines"; later textures follow the artwork contours | ridges catch light in lines; texture is independent of the foil pattern | whole front | BW (Next Destinies, 2012) to SWSH; English FA EX/GX/V | https://bulbapedia.bulbagarden.net/wiki/Full_Art_card_(TCG)

VMAX etched full art | VMAX texture | etched full-art print, multi-colored background, ridge-like texture | ridges catch light (unconfirmed) | whole front | Sword & Shield (2020-23) | https://bulbapedia.bulbagarden.net/wiki/Pokémon_V_(TCG)

Rainbow Rare | Secret Rainbow Rare, HR (JP) | art reprinted with a pastel rainbow gradient tint under a heavy textured foil; foil covers the whole card | looks different at every angle; the rainbow is partly printed, so the color does not depend on angle | whole front | Guardians Rising/Sun & Moon (2017) to Sword & Shield (2023) | https://cardcodex.com/blog/rainbow-pokemon-cards-every-one-worth-owning/

Gold Secret / Hyper Rare | gold card, gold secret, Hyper Rare (SV), UR (JP) | gold-toned full-art foil with gilded borders/accents and etched (hot-foil-stamped) ridges | metallic gold; ridges flash (unconfirmed) | whole front | BW to SWSH gold secrets; SV Hyper Rare (3 gold stars) | https://www.pokemon.com/us/pokemon-news/pokemon-tcg-scarlet-and-violet-revamps-pokemon-tcg-card-aesthetic

Shiny Vault (Hidden Fates) | SV-numbered shiny | "special embossed holofoil treatment" on shiny Pokémon; visual pattern (sparkly silver background) unconfirmed | (unconfirmed) | whole front (unconfirmed) | Hidden Fates (2019); Shining Fates shiny vault (2021, unconfirmed same treatment) | https://bulbapedia.bulbagarden.net/wiki/Hidden_Fates_(TCG)

Amazing Rare | | Pokémon on a rainbow swirl or graffiti-style splash backdrop that bursts past the picture border; textured effect on the framed image, subtler foil elsewhere | (unconfirmed) | whole front, strongest in the art | Vivid Voltage (2020), Shining Fates (2021) | https://cardgamer.com/games/amazing-rare-pokemon-cards/

Radiant | Radiant Pokémon | "an exclusive foiling style", not described (unconfirmed) | (unconfirmed) | (unconfirmed) | Astral Radiance to Crown Zenith (2022-23) | https://bulbapedia.bulbagarden.net/wiki/Radiant_Pokémon_(TCG)

SV Double Rare sheen | ex double rare, "star-like sheen" | foil border plus a star-like sheen across the card | (unconfirmed) | border + card | Scarlet & Violet Pokémon ex (2023-) | https://www.pokemon.com/us/pokemon-news/pokemon-tcg-scarlet-and-violet-revamps-pokemon-tcg-card-aesthetic

Tera ex foil | Tera Pokémon ex | "a unique foil across the card and a textured appearance" (pattern not described; crystalline look unconfirmed) | (unconfirmed) | whole card | Scarlet & Violet Tera ex double rares (2023-) | https://www.pokemon.com/us/pokemon-news/pokemon-tcg-scarlet-and-violet-revamps-pokemon-tcg-card-aesthetic

Illustration Rare | IR, 1 gold star | full-art foil illustration; glossy sheen, no deep etched texture (secondary source) | smooth sweep (unconfirmed) | whole front | Scarlet & Violet (2023-) | https://billsarchive.com/articles/pokemon-tcg-rarities.html

Special Illustration Rare | SIR, 2 gold stars, (SWSH "alternate art" equivalent) | full-art foil plus heavy etched texture with ridges that follow the artwork contours | ridges catch light along the drawn shapes | whole front | SV (2023-); SWSH alt arts also textured | https://billsarchive.com/articles/pokemon-tcg-rarities.html

SV Ultra Rare full art | 2 silver stars | etched full-art foil | (unconfirmed) | whole front | SV (2023-) | https://billsarchive.com/articles/pokemon-tcg-rarities.html

Mega Attack Rare | MAR, pink/green stars | heavy etched texture (secondary source only) | (unconfirmed) | whole front | Mega Evolution era (date given inconsistently by the source) | https://billsarchive.com/articles/pokemon-tcg-rarities.html

Futuristic Rare | | "opalescent, holographic-shift finish that shifts color as the card catches the light" | whole-surface color shift | whole front | 30th Celebration (Sept 2026), YOSHIROTTEN art | https://billsarchive.com/articles/pokemon-tcg-rarities.html

Classic Collection textured foil | Celebrations / 30th Celebration retro reprints | "special textured foil treatment" on old designs (pattern unconfirmed) | (unconfirmed) | (unconfirmed) | Celebrations (2021), 30th Celebration (2026) | https://bulbapedia.bulbagarden.net/wiki/Shining_Pokémon_(TCG)

BREAK squared holo | Pokémon BREAK | Pokémon art completely covered in gold with sparks around it; a "unique squared holofoil pattern" in the background (regular grid of squares, size unconfirmed); card printed sideways (landscape) | squares flash in grid rows (unconfirmed) | gold figure + squared-holo background | XY BREAKthrough to Evolutions (2015-16) | https://bulbapedia.bulbagarden.net/wiki/Pokémon_BREAK_(TCG)

Prism Star | ◇ cards | black borders with rainbow tinges on frame corners; subject drawn with a glow; holo pattern itself not described (unconfirmed) | (unconfirmed) | (unconfirmed) | Ultra Prism to Cosmic Eclipse (2018-19) | https://bulbapedia.bulbagarden.net/wiki/Prism_Star_(TCG)

Not found in any source (unconfirmed, list for photo checking): Trainer Gallery / Galarian Gallery (SWSH), SV Shiny Rare / Shiny Ultra Rare (Paldean Fates), ACE SPEC Rare foil (SV), Shrouded Fable's "new holofoil treatment" mentioned on Elite Fourum.

---

## 2. Sports / non-sport

[snippet] = wording taken from a search-engine summary because the page itself refused automated fetching (topps.com, ripped.topps.com, beckett.com, cardboardconnection.com, reddit). Treat as weaker than a fetched page.

### 2a. Topps / Bowman chromium family (Chrome, Bowman Chrome, Finest, Bowman's Best, Chrome Update, Cosmic, Sapphire, F1)

Refractor (base) | Refractor, "silver refractor"; color refractors (Purple, Blue, Green, Gold, Orange, Red, Black, Aqua, Pink...) are this finish plus a colored design element | smooth rainbow sheen, no discrete elements (one secondary source: "diagonal rainbow shimmer") | looks like the base card until tilted, then one strong rainbow sweep over the surface | whole front | 1993 Finest to present | https://cardlines.com/topps-refractors-guide/

X-Fractor | Xfractor, color X-Fractors, die-cut X-Fractors | checkerboard background of many small reflective squares ("tiny reflective squares or X-shaped sections"); regular grid, cells small vs card | the individual squares flash as light moves across; adjacent cells alternate | background (plus refractor finish overall) | Chrome, Bowman Chrome, occasionally Finest; retail/Mega Box common | https://en.wikipedia.org/wiki/Refractor_card

Prism Refractor | Prism | repeating geometric tiled pattern, easily confused with X-Fractor but a different tile shape (exact shape unconfirmed; triangular/faceted prism tiles commonly cited) | facets flash individually (unconfirmed) | whole front/background | Chrome 2012 onward (Prism /50 hobby in 2012 Chrome FB); "prism pattern" also on 1997 Finest Silver Embossed Refractors | https://cardlines.com/topps-refractors-guide/

Wave Refractor | Blue/Green/Gold/Orange/Red/Fuchsia/Purple Wave | flowing wavy reflective lines across the card | waves appear to move through the background as you tilt | background | modern Chrome and Bowman Chrome | https://cardlines.com/topps-refractors-guide/

RayWave Refractor | Aqua/Green-Aqua/Gold/Blue RayWave | reflective lines radiating outward across the card (sunburst rays); more aggressive than Wave | rays sweep around the radiating center (unconfirmed) | whole front | 2024 onward Chrome, Bowman Chrome | https://cardlines.com/topps-refractors-guide/

Shimmer Refractor | Purple/Gold/Orange/Fuchsia/B&W Shimmer | streaked foil; "diagonal streaks" | light appears to shimmer across the card along the streaks | whole front | mainly Bowman Chrome | https://prospectpulsev1.com/articles/bowman-chrome-parallel-guide/

Speckle Refractor | Magenta/Purple/Green/Gold/Orange/Red Speckle | small reflective dots/speckles scattered randomly, "like glitter" | specks twinkle individually (unconfirmed) | background | 2020s Chrome, Bowman Chrome | https://cardlines.com/topps-refractors-guide/

Mini-Diamond Refractor | Gold/Purple/Aqua Mini-Diamond, B&W Mini-Diamond | "small reflective facets", fine diamond (rhombus) texture; regular; one forum post links it to the 2011 Topps Diamond Anniversary refractor pattern | facets sparkle (unconfirmed) | whole front | Bowman's Best, Bowman Chrome, Chrome Update, Chrome Black (2022 onward) | https://prospectpulsev1.com/articles/bowman-chrome-parallel-guide/

Lava Refractor | Aqua/Blue/Green/Red/Gold/Black Lava, "Lava Lamp" | swirling molten look like flowing or bubbling lava; organic, irregular blobs; look varies by color | (unconfirmed) | whole front | 2024 onward Chrome, Bowman Chrome, Bowman's Best | https://cardlines.com/topps-refractors-guide/

Mojo Refractor (Topps) | Mojo, many colors, Mega Box Mojo | Mega Box-exclusive "Japanese foil pattern"; other sources call it chain-link / interlocking tiles / "tire tread"; a Beckett guide traces it to 1990s Flair Showcase [snippet] | (unconfirmed) | whole front | Bowman/Bowman Chrome Mega Box (about 2019 onward) | https://www.bleachernation.com/collectibles/2026/09/23/bowman-chrome-mega/

Mega Box "tire tread" refractor | Mega Box refractor | tire-tread tiled pattern (regular) | (unconfirmed) | background | Topps Chrome Mega Box before 2022 | https://baseballcardpedia.com/index.php/2022_Topps_Chrome_Logofractor

Logofractor | Logofractor Edition, Rose Gold 1/1 | league logo repeated as a tiled pattern, running diagonally (2026) [snippet]; regular grid of logos | (unconfirmed) | background | Topps Chrome Logofractor (topps.com exclusive, 2022 onward); F1 version 2024 | https://baseballcardpedia.com/index.php/2022_Topps_Chrome_Logofractor

Superfractor | SuperFractor 1/1; White, Bordered, Die-cut Superfractor | gold spiral design ("spiral gold-vinyl pattern"); one large spiral/concentric-ring field centerd on the card | gold rings flare as you tilt (unconfirmed) | whole front | Bowman Chrome / Topps Chrome early 2000s to present | https://en.wikipedia.org/wiki/Refractor_card

Atomic Refractor | Atomic, Mirror Image Atomic | different background from the plain refractor; 1996 Bowman's Best described as "a hybrid plaid and Refractor combination"; later years described as a repeating square pattern or "shattered prism" — sources conflict by year | (unconfirmed) | background | Bowman's Best 1996 onward; 2011 Chrome; GPK Chrome | https://allvintagecards.com/refractor-card-guide/

Negative Refractor | Negative | not a foil pattern: photo inverted like a film negative over the refractor finish | normal refractor sweep | picture (+ refractor overall) | modern Chrome | https://cardlines.com/topps-refractors-guide/

Sepia Refractor | Sepia | color treatment only: brown/bronze antique-photo tone on refractor finish | normal refractor sweep | picture | modern Chrome retail | https://cardlines.com/topps-refractors-guide/

Frozenfractor | FrozenFractor (numbered -5/0 to -1/0) | icy, "frozen-looking" treatment; frost/ice-crystal geometry (unconfirmed) | (unconfirmed) | whole design | Chrome Hobby Jumbo 2023 onward | https://www.si.com/collectibles/topps-chrome-frozenfractor-inserts-a-look-at-the-best

Reptilian Refractor | Reptilian Blue/Green/Gold/Orange/Black/Red | reptile-scale motif replacing the standard border [snippet]; dense tiling of irregular scales | (unconfirmed) | border | Bowman Chrome Prospects 2024 onward | https://ripped.topps.com/whats-2024-bowman-chrome-reptillian-refractor-product

Lunar Glow | Lunar Glow refractor | "moon-textured" [listing snippet]; crater mottling (unconfirmed) | (unconfirmed) | (unconfirmed) | Bowman Chrome Prospects 2023-24 | https://www.ebay.com/itm/405734412179

Sapphire | Chrome Sapphire Edition, Sapphire/Blue Refractor | blue backdrop with "cracked-ice style refractor technology" [snippet]; random shards | shards flash (unconfirmed) | background | Chrome Sapphire, Update Sapphire, Tennis Sapphire (2017 onward), Bowman Chrome Sapphire | https://topps.com/pages/topps-chrome-tennis-sapphire-edition

Chrome Black stock | Topps Chrome Black | black chromium stock, satin/matte black finish under a full refractor ladder | (unconfirmed) | whole card | 2021 onward | https://baseballcardpedia.com/index.php/2021_Topps_Chrome_Black

Checker Flag Refractor | Checker Flag, Pink/Aqua/Purple/Gold Checker (listed as X-Fractor in 2022) | checkered-flag grid of squares; 2025 adds "small splashes of colors within the checkered pattern" [snippet] | (unconfirmed) | background | Topps Chrome F1 2021 onward | https://www.beckett.com/news/2025-topps-chrome-formula-1-parallel-guide-and-image-gallery/

Starfractor | StarFractor | "exclusive star foil pattern" [snippet] | (unconfirmed) | (unconfirmed) | 2024 Cosmic Chrome Football | https://www.blowoutcards.com/2024-topps-cosmic-chrome-football-hobby-box.html

Embossed Refractor | Silver/Gold Embossed (1997 Finest) | raised (embossed) player image; Silver = prism pattern refractor, Gold = X-Fractor pattern + deckled edges; Wikipedia: first refractor variant (1997) | (unconfirmed) | picture raised; whole front refractor | 1997 Finest | https://baseballcardpedia.com/index.php/1997_Finest

Finest Protector | "peel and remove" coating | clear peel-off film, not a pattern (matters only for a modelled "unpeeled" look) | n/a | whole front | Finest 1993-late 1990s | https://en.wikipedia.org/wiki/Refractor_card

Camo Refractor | Camo | camouflage-pattern border (armed-forces tribute) | (unconfirmed) | border | special editions | https://en.wikipedia.org/wiki/Refractor_card

Topps Tek patterns | Tek patterns 1-90, Diffractor | clear acetate cards, each player on up to 90 different background patterns; Diffractors described with an "Atomic Refractor or Cracked Ice finish" [snippet] | see-through + pattern | background | Topps Tek 1998-2000, High Tek 2014-19 | https://baseballcardpedia.com/index.php/1998_Topps_Tek

Topps names confirmed to exist but with no visual description found (unconfirmed): Geometric, Pulsar, Mosaic refractor, Pigskin (2009 Finest), Gold Ink, Steel Metal, Pearl, Cosmic Chrome parallels (Purple Nebula, Green Space Dust, Gold Interstellar, Orange Galactic, Black/Lunar Eclipse), Fuchsia and Sky Blue (probably color only), Bowman Draft Sparkle and Snakeskin. Existence of Geometric/Pulsar: https://www.checklistinsider.com/2025-bowman-chrome-baseball . Best unread sources: Beckett "Parallel Guide and Image Gallery" pages (2025/2026 Chrome, 2025 Chrome Update, 2025 F1, 2019 Bowman Chrome).

### 2b. Panini (Prizm, Select, Optic, Mosaic, Revolution, Obsidian, others)

Source note: Collectors MD's hobby dictionary (https://collectorsmd.com/hobby-dictionary/) is the only source with one-line descriptions for ~30 Panini pattern names; it is generic, so treat it as one source. Several 2024-26 guides (Cardboard Connection reviews, AgentGrail, Cardszn) read as machine-written and contradict older sources (Hyper "swirling", Mojo "diagonal wave", Pulsar "concentric rings"); those claims are not used except where flagged. Pattern names are shared across Prizm, Select, Optic, Mosaic, so one line covers all uses.

Silver Prizm / Holo | Silver, Prizm, Optic "Holo", Rated Rookie Holo | smooth refractor, no pattern elements; base Prizm "reflects like a mirror", Silver "refracts" a multicolor rainbow | multicolor rainbow highlights shift as the card moves (base card: single-color glare) | background/full front; photo not foiled | all Prizm since 2012, Optic since 2016 | https://forums.collectors.com/discussion/comment/12270216

Hyper | Hyper Prizm, Blue/Red Hyper, Hyper Green/Pink | silver base with a "geometric shape design that gives the card a pixelated look": small repeated geometric cells, regular (other sources: "fine-grid"; one machine-written: "swirling") | (unconfirmed) | background (unconfirmed) | Prizm about 2018 onward (mostly retail), Optic | https://forums.collectors.com/discussion/comment/12270216

Mojo (Panini) | Red/Blue Mojo, Choice Blue Mojo | "background etching", same etched pattern as late-1990s Flair Showcase Legacy; "maze-type pattern"; "kinetic energy" look | (unconfirmed) | background | Prizm 2014 onward (/25 recently), Optic Choice | https://web.archive.org/web/2020/https://www.beckett.com/news/2015-panini-prizm-football-parallel-rainbow-has-new-patterns-fewer-exclusives/

Cracked Ice / Ice | Red/Blue/Purple/Orange/Pink Ice, Green Crystals, Crystal | irregular angular shards like shattered glass/ice, "geometric shards... like a broken windshield"; random, not a grid; shard size not stated | shards flash independently (unconfirmed) | background (unconfirmed) | Prizm retail Mega/Blaster, Select, Optic, Contenders Optic | https://cardszn.com/blog/prizm-color-hierarchy-cheat-sheet/

Disco | Disco Prizm, White Disco, Bubbles | "small circular dots that shimmer under light", "little circles... like disco balls"; many small dots per card | dots glint individually | background | Select H2 2019-20 onward, Prizm blasters | https://collectorsmd.com/hobby-dictionary/

Fast Break | Fast Break Prizm/Holo and colors | small circles in the background (same disco-ball look as Disco) | dots glint (unconfirmed) | background | Prizm/Optic Fast Break boxes 2017 onward | https://cardszn.com/blog/prizm-color-hierarchy-cheat-sheet/

Pulsar | Red/Blue/Green/Purple/Neon Pulsar, Black Pulsar 1/1, RWB Pulsar | "the ones with dots", textured-looking dotted background; "small mirrored circles" (Collectors MD also says "or wave lines") | (unconfirmed) | background | Prizm 2013 onward, Select, Obsidian; Topps also uses "Pulsar" | https://web.archive.org/web/2024/https://www.cardboardconnection.com/2014-panini-prizm-basketball-prizm

Scope | Green/Pink Scope, Scope Prizm | "circular, kaleidoscope-like pattern often resembling a rifle scope or lens": circles / reticle | (unconfirmed) | (unconfirmed) | Prizm football 2020 onward, Select | https://collectorsmd.com/hobby-dictionary/

Wave (Panini) | Blue/Red/Ruby/Purple/Teal/Orange Wave | "flowing, ripple effect across the card's surface"; pattern "breaks up the image" | (unconfirmed) | full surface (unconfirmed) | Prizm 2014 onward, Select, Mosaic | https://collectorsmd.com/hobby-dictionary/

Shimmer (Panini) | Red/Blue/Gold/Green/Black Shimmer, FOTL Shimmer | "rippled, wave-like reflective finish giving a fluid shine"; Beckett treats Wave and Shimmer as distinct (photos only) | (unconfirmed) | (unconfirmed) | Prizm FOTL 2018 onward, Select | https://collectorsmd.com/hobby-dictionary/

Raywave (Panini) | RayWave | "wavy, refractive light pattern across the card surface" | (unconfirmed) | full surface (unconfirmed) | Prizm 2025-26 | https://collectorsmd.com/hobby-dictionary/

Snakeskin | Black Snakeskin 1/1, Snake Skin Pulsar | reptile-scale texture; Prizm version a red-and-black snake design inside a symmetrical border; Select version green-and-black | (unconfirmed) | background + border | Prizm 2020 onward (~1 per case), Select | https://www.pressreader.com/usa/beckett-football/20210701/281582358517570

Dragon Scale | Dragon Scale Prizm | "reptilian pattern mimicking iridescent dragon scales" | (unconfirmed) | (unconfirmed) | Select football 2020 | https://collectorsmd.com/hobby-dictionary/

Tiger Stripe | Tiger, Choice Tiger Stripe | bold orange-and-black tiger stripes (printed pattern over prizm) | (unconfirmed) | (unconfirmed) | Prizm Choice 2018-19 onward, Select | https://collectorsmd.com/hobby-dictionary/

Zebra | Zebra Prizm | black-and-white zebra stripes; unnumbered SSP | (unconfirmed) | (unconfirmed) | Select | https://collectorsmd.com/hobby-dictionary/

Elephant | Elephant Prizm | gray textured design resembling elephant skin | (unconfirmed) | (unconfirmed) | Select 2020-21 retail | https://collectorsmd.com/hobby-dictionary/

Peacock | Choice Peacock | colorful iridescent feather-eye pattern like a peacock's tail | (unconfirmed) | background | Prizm/Mosaic Choice | https://collectorsmd.com/hobby-dictionary/

Camo (Panini) | Camo, Navy/Forest Camo, Camo Pink/Red | camouflage blobs, random (unconfirmed; only listed) | (unconfirmed) | (unconfirmed) | Prizm football /25 2020 onward, Mosaic retail | https://web.archive.org/web/2024/https://www.cardboardconnection.com/2020-panini-prizm-football-nfl-cards

Tie-Dye | Tie-Dye /25 | "colorful, psychedelic pattern" (machine-written source); multicolor swirls (unconfirmed) | (unconfirmed) | (unconfirmed) | Prizm 2015, Select | https://web.archive.org/web/2025/https://www.cardboardconnection.com/2024-25-panini-select-basketball-set-review-and-checklist

Choice pattern | Choice, Choice Red & Green, Choice Black Gold | "geometric backdrop, reminiscent of Mojo" | (unconfirmed) | background | Prizm/Optic/Mosaic Choice (Asia) | https://web.archive.org/web/2025/https://www.cardboardconnection.com/2024-25-panini-donruss-optic-nba-trading-card-box-set-review-and-checklist

Nebula | Choice Nebula 1/1 | cosmic swirling galaxy/nebula look ("looks like deep space") | (unconfirmed) | (unconfirmed) | Choice 1/1s; Spectra | https://collectorsmd.com/hobby-dictionary/

Red White & Blue | RWB, RWB Pulsar, RWB Power Plaid, RWB Mosaic | three-color version of an existing pattern; pattern changes by year (Pulsar dots 2014-15, Plaid 2014 World Cup, Mosaic 2013-14) | (unconfirmed) | background | Prizm retail cello/multi-packs | https://web.archive.org/web/2024/https://www.cardboardconnection.com/2014-panini-prizm-basketball-prizm

Gold Vinyl | Gold Vinyl /5 or 1/1 | "same circular background as Topps Superfractors", vinyl-record circles: one large concentric/spiral ring field centerd on the card | rings flare (unconfirmed) | background | Prizm 2015 onward, Optic | https://web.archive.org/web/2020/https://www.beckett.com/news/2015-panini-prizm-football-parallel-rainbow-has-new-patterns-fewer-exclusives/

Sparkle | White Sparkle | "glittery, confetti-like finish that sparkles under light" | glints | (unconfirmed) | Prizm 2015 Rewards, Sparkle packs; Optic | https://collectorsmd.com/hobby-dictionary/

Cherry Blossom | Cherry Blossom /20, Plum Blossom /8 | pink floral design | (unconfirmed) | (unconfirmed) | Prizm 2025-26 | https://collectorsmd.com/hobby-dictionary/

Checkerboard | Black & White Checker, Bronze Checker, Checkerboard Prizm | alternating squares, regular grid; 2014-15 Select Courtside "reminiscent of early X-fractors" | squares alternate (unconfirmed) | background | Prizm gravity feeds, Select, Optic | https://web.archive.org/web/2024/https://www.cardboardconnection.com/2014-panini-select-basketball-prizm

Velocity | Pink/Blue/Green/Black/Red Velocity | "grid-like or laser background pattern that gives the illusion of speed"; "textured backdrop" | (unconfirmed) | background | Optic 2017 onward, Prizm retail | https://collectorsmd.com/hobby-dictionary/

Shock / Flash | Purple/Green/Red Shock (Optic); Orange/Purple/Gold Flash (Select) | "jagged, lightning-like patterns" | (unconfirmed) | (unconfirmed) | Optic blasters, Select/Illusions retail | https://collectorsmd.com/hobby-dictionary/

Mosaic | Mosaic Prizm (silver and colors) | "refractive, box-like pattern": small square/rectangular tiles, regular | a rainbow "wave of color" moves across under direct light | background | Prizm Mosaic 2015-19, Mosaic 2019 onward | https://www.cardlines.com/ultimate-mosaic-parallel-guide/

Select tier stocks | Concourse / Premier Level / Courtside (FB: Club Level, Field Level) | 2014-15: Concourse = plain Prizms; Premier = mostly die-cut with a shield-shaped background; Courtside = checkerboard X-fractor look. Later years: "distinct designs" per tier; different stock (unconfirmed) | (unconfirmed) | background | Select 2014-15 confirmed | https://web.archive.org/web/2024/https://www.cardboardconnection.com/2014-panini-select-basketball-prizm

Revolution foil board | Galactic, Cosmic, Fractal, Sunburst, Cubic, Astro, Lava, Groove, Infinite, Nova, Angular, Futura, Chinese New Year | holo card stock where parallels change the foil background pattern instead of the color; Cosmic = "colorful, space-like"; Lava = "molten, streaked"; others (unconfirmed; names suggest fractal / sunburst rays / cubes) | (unconfirmed) | background | Revolution 2015 onward | https://blog.paniniamerica.net/surface-exploration-the-definitive-guide-to-2015-16-revolution-basketball-parallels/

Obsidian Electric Etch | Electric Etch colors, Flood, Crystals, Vitreous | black card fronts with etched foil ("lava flow" wording seen, unverified) | (unconfirmed) | full front | Obsidian 2018 onward | https://degreegrading.com/checklists/2022-panini-obsidian-football/

Certified Mirror | Mirror Red/Blue/Gold/Purple/Green/Black | smooth mirror foil board; reflective foil border | mirror reflection (unconfirmed) | border + frame | Certified | https://www.cardboardconnection.com/2025-panini-certified-football-set-review-and-checklisy?amp=1

Absolute Spectrum | Spectrum colors | "iridescent", "liquid metal" look | (unconfirmed) | (unconfirmed) | Absolute | https://www.cardboardconnection.com/2025-panini-absolute-football-set-review-and-checklist?amp=1

Panini names with no description found (unconfirmed): Pandora (Optic), Seismic, Lazer/Laser, Photon, Stars (Optic FOTL), Glitter (Optic/Select), Skewed, Starburst, Reactive, Genesis, Honeycomb, Swirl (Mosaic FOTL), Fusion ("hybrid of multiple colors" only), Phoenix Fire Burst, Spectra Neon (color tier), Crown Royale Kaleidoscopic, Prestige Xtra Points, Elite Status, Chronicles, Immaculate, Court Kings. Plain-color lines (Fluorescent, Lime Green, Copper, Maroon, Aqua, Gold, Black) are color variants, not patterns. Stained Glass (Mosaic) is a case-hit insert with its own artwork, not a foil pattern; Press Proof is a foil-stamped Donruss variant, not a refractor pattern.

### 2c. Upper Deck, Leaf, Press Pass and 1990s products

Leaf Metal Prismatic / Wave / Crystal / Marble / Mojo | each color in Prismatic, Wave, Marble, Crystal, Mojo | Prismatic = plain refractor look; Wave, Crystal, Marble, Mojo = different background designs (wavy lines / crystal shards / marbling / Panini-style mojo, all unconfirmed) | (unconfirmed) | background | Leaf Metal Draft 2017 onward | https://www.beckett.com/news/2021-leaf-metal-draft-football-cards/ [snippet]

Leaf Mirror / Press Pass Reflector | Mirror (Leaf), Reflector (Press Pass) | the brands' names for a refractor-type smooth rainbow finish (structure unconfirmed) | rainbow sweep | whole front | Leaf 2010s, Press Pass | https://en.wikipedia.org/wiki/Refractor_card

Dufex | Pinnacle Dufex, later Panini "Nufex" | UV-transparent inks over aluminum foil with a design hand-engraved into the foil; fine engraved lines (geometry unconfirmed) | engraved lines flash and shift, giving a moving faceted shine (unconfirmed) | whole front | Pinnacle 1993-98 (Select, Zenith, Museum Collection), 2005 Zenith | https://baseballcardpedia.com/index.php/Dufex

Museum Collection sunray | Pinnacle Museum | Dufex "sunray appearance above a gold foil diamond": radiating lines from a center | rays sweep (unconfirmed) | whole front | Pinnacle brands 1996-97 | https://www.tcdb.com/Inserts.cfm/sid/980/1997-Pinnacle-Home/Away [snippet]

Artist's Proof foil | Score/Pinnacle Artist's Proof | gold, silver or bronze foil background plus stamp; flat foil, no fine pattern | (unconfirmed) | background + stamp | 1996-97 Pinnacle, Score | https://www.tcdb.com/Inserts.cfm/sid/980/1997-Pinnacle-Home/Away [snippet]

Acetate window | SkyBox E-X2000, E-X Century; Pacific Invincible cel; UD Clear Cut; Topps Tek | clear or translucent plastic layer (see-through "sky"/cel window) with die-cut player and color-foil borders | see-through; foil border flashes | window = background; foil = border | 1996-2001; UD Clear Cut modern | https://www.fanaticscollect.com/premier/90f5495a-9ef9-11f0-b0f8-0a58a9feac02 [snippet]

Etched metal (Metal Universe / PMG) | Precious Metal Gems (Red, Green) | colored etched-foil base design; etched-line metallic backgrounds (geometry unconfirmed) | (unconfirmed) | whole front | 1997 SkyBox Metal Universe | https://baseballcardpedia.com/index.php/1997_Metal_Universe [snippet]

Flair Showcase foil stamping | Legacy (blue foil /100), Masterpiece (purple foil 1/1), Rows 0/1/2 | foil stamping on three row designs (pattern unconfirmed) | (unconfirmed) | stamping | 1997 Flair Showcase | https://baseballcardpedia.com/index.php/1997_Flair_Showcase [snippet]

Hologram (whole card) | UD SPx, Holoview, HH1/HH2 | the card image itself is a hologram (3D image) | 3D parallax and color shift with angle | whole card | Upper Deck 1991-97 | https://baseballcardpedia.com/index.php/Hologram

Upper Deck glitter / gradient (Allure) | Gold Glitter Bomb, Green Rainbow | glitter effects; gradient overlay | (unconfirmed) | (unconfirmed) | 2024-25 UD Allure | (source URL not recorded; unconfirmed)

Upper Deck / Fleer / others with no visual description found (unconfirmed): O-Pee-Chee Rainbow Foil, UD Exclusives, High Gloss, Young Guns Clear Cut (acetate only), OPC Platinum ladder (Rainbow, Violet Pixels, Seismic Gold, Arctic Freeze, Traxx, Red Prism, Matte White), SP Authentic Spectrum FX, UD Ice, Premier, Synergy, Sweet Spot, Fleer Ultra Gold Medallion, Stadium Club First Day Issue, Collector's Choice signatures, Leaf Rookies & Stars Longevity, Donruss Elite (1990s), Pacific Crown Royale / Aurora / Prism, Fleer Mystique, Topps Gold Label (foil-stamped names only).

### 2d. Other TCGs (non-sport) — included because their foil types have the best written geometric descriptions

Magic: The Gathering (all from https://mtg.wiki/page/Foil unless noted):
Traditional foil | rainbow foil | smooth rainbow laminate; areas with white under-print reflect more | rainbow sweep | whole card | 1999/2003 onward | https://mtg.wiki/page/Foil
Surge foil | | rippling streaked waves, "like a surging wave or sun-streaked meadow" (scale-like per another source) | whole card seems to vibrate with light | whole card | 2022 onward Universes Beyond | https://mtg.wiki/page/Foil
Foil-etched | gold-etched | metallic paint only in specific areas; grainy, darker, matte-ish | etched lines sparkle | frame/parts, not the art | 2020 onward | https://mtg.wiki/page/Foil
Galaxy foil | | spots like stars in space, compared to Pokémon Base Set 2 (cosmos) | (unconfirmed) | whole card | Unfinity, Edge of Eternities | https://mtg.wiki/page/Foil
Confetti foil | | many tiny scattered speckles like thrown glitter | shimmering sparkle | whole card | 2023 | https://mtg.wiki/page/Foil
Dazzle foil | Pool Party foil | like confetti but denser, smaller, squarer points | sparkle | whole card | Secret Lair 2026 | https://mtg.wiki/page/Foil
Halo foil | | swirling liquid-like curved swooping lines | (unconfirmed) | whole card | 2023 onward | https://mtg.wiki/page/Foil
Textured foil | | raised embossed lines and grain in the art | art appears to move | whole card | 2022 onward | https://mtg.wiki/page/Foil
Gilded foil | | raised hot-stamped gold frame elements | (unconfirmed) | frame | Streets of New Capenna | https://mtg.wiki/page/Foil
Step-and-compleat foil | | raised repeating symbol in a regular step-and-repeat grid | (unconfirmed) | whole card | Phyrexia: All Will Be One | https://mtg.wiki/page/Foil
Mana foil | | five raised mana symbols in a randomised pattern | (unconfirmed) | whole card | Foundations | https://mtg.wiki/page/Foil
Oil-slick raised foil | | dark petroleum-rainbow sheen with raised outlines | glistening | whole card | ONE | https://mtg.wiki/page/Foil
Double-rainbow foil | | two foil layers, brighter smooth multicolor | (unconfirmed) | whole card | 2022 onward serialized | https://mtg.wiki/page/Foil
Ripple foil | | ripples like water | (unconfirmed) | whole card | Modern Horizons 3 | https://mtg.wiki/page/Foil
Fracture foil | | cracked faceted foil texture | (unconfirmed) | border | Duskmourn onward | https://www.misprint.com/posts/magic-foil-treatments-explained
Facet foil | | shimmer limited to splintering shards | (unconfirmed) | shards only | 2026 | https://mtg.wiki/page/Foil
Dragonscale foil | | textured dragon scales | (unconfirmed) | (unconfirmed) | Tarkir: Dragonstorm | https://mtg.wiki/page/Foil
Raised foil / Embossed & foil / Neon ink / Invisible ink / Silverscreen | | raised gold stamp; glossy embossed logo; fluorescent solid ink; hidden margin ink; monochrome art on silver | neon glows under UV; invisible ink shows at grazing angles | frame/overlay/margins/whole | various | https://mtg.wiki/page/Foil

Yu-Gi-Oh! (Yugipedia):
Super Rare | SR | holofoil on the art only | (unconfirmed) | picture | all eras | https://yugipedia.com/wiki/Super_Rare
Ultra Rare | UR | gold holofoil name + holofoil art | (unconfirmed) | name + picture | all eras | https://yugipedia.com/wiki/Rarity
Secret Rare | | rainbow name; art in "parallel holofoil" of fine dots in diagonal lines (TCG); thicker jagged cross pattern from Duelist Alliance | diagonal rainbow lines (unconfirmed) | name + picture | all eras | https://yugipedia.com/wiki/Secret_Rare
Prismatic Secret Rare | | as Secret but the lines run horizontal and vertical; speckled name | (unconfirmed) | name + picture | tins, OCG | https://yugipedia.com/wiki/Prismatic_Secret_Rare
Starlight Rare | | Prismatic horizontal pattern over the whole card except text box and parts of the art | (unconfirmed) | whole card | 2019 onward | https://yugipedia.com/wiki/Starlight_Rare
Quarter Century / Platinum Secret | | Secret foil over the whole surface, colored name, watermark | (unconfirmed) | whole card | 2014-15, 2023-25 | https://yugipedia.com/wiki/Quarter_Century_Secret_Rare
Ultimate Rare | | embossed (raised) holofoil art, gold embossed borders | (unconfirmed) | picture + borders | 2003 onward | https://yugipedia.com/wiki/Ultimate_Rare
Ghost Rare | Holographic Rare | 3D hologram image with pale washed-out colors | colors return dimly at one angle | picture | 2007 onward | https://yugipedia.com/wiki/Ghost_Rare
Parallel / Collector's Rare | Duel Terminal | rainbow coating over the whole surface; dot holofoil; later speckle, dot-matrix, shatterfoil | (unconfirmed) | whole/most of face | various | https://yugipedia.com/wiki/Collector%27s_Rare
Mosaic Rare | | shiny regular grid of squares | (unconfirmed) | whole face | Battle Pack 2 | https://yugipedia.com/wiki/Mosaic_Rare
Starfoil Rare | | shiny pattern of stars | (unconfirmed) | whole face | Battle Pack: Epic Dawn | https://yugipedia.com/wiki/Starfoil_Rare
Shatterfoil Rare | | shattered-glass pattern | (unconfirmed) | whole face | Battle Pack 3 | https://yugipedia.com/wiki/Shatterfoil_Rare

Lorcana / One Piece:
Lorcana cold foil | | slightly matte textured look that keeps a sheen | (unconfirmed) | whole card | Lorcana | https://articles.starcitygames.com/lorcana/organized-play-details-foil-treatments-and-more-lorcana-updates-from-may/
Lorcana Enchanted | | borderless alternate art in "inkwash" rainbow foil | (unconfirmed) | whole card | Lorcana | https://www.shonentcg.com/blog/disney-lorcana-enchanted-cards-explained
One Piece parallel / rare foil | | parallels: alt art, embossed "ONE PIECE" on the left; Rares foil on border and some art elements; Super Rares partial rainbow holo | (unconfirmed) | border / partial art | One Piece TCG | https://cardgamer.com/games/tcgs/one-piece/one-piece-card-game-foil-cards/

Topps Chrome Star Wars / Marvel / Disney / Garbage Pail Kids Chrome use the same refractor names as section 2a (not checked set by set).

---

## 3. Cross-index: the geometric primitives these reduce to

(My grouping of the lines above; it is analysis, not a source claim.)

- Smooth sweep, no elements: Sheen, Mirage, plain reverse, Delta Species, Refractor, Silver Prizm/Holo, Leaf Mirror, Certified Mirror, MTG traditional. Variable = sweep direction (Sheen diagonal, Mirage horizontal) and mirror vs rainbow base.
- Parallel lines / stripes: Tinsel (horizontal), Line (vertical), Shimmer (diagonal streaks), Yu-Gi-Oh Secret (diagonal dot-lines) / Prismatic (h+v), Velocity, Full Art "parallel lines" emboss.
- Regular grid of cells: X-Fractor, Checker Flag, Checkerboard, Crosshatch, BREAK squares, Mosaic, Hyper (pixelated), Mini-Diamond, Prism, Mega Box tire tread, Yu-Gi-Oh Mosaic Rare.
- Regular grid of motifs: SWSH chevrons, SV Paldea tiles, SM rows, Poké Ball / Master Ball / Energy reverses, Logofractor, MTG step-and-compleat.
- Random small points: Starlight, Speckle, Sparkle, Confetti/Pixel, Sequin, Glitter stars, Starfoil, MTG confetti/dazzle.
- Random dots + circles of mixed size: Cosmos/galaxy, Disco, Fast Break, Pulsar, MTG galaxy.
- Random shards (Voronoi): Cracked Ice (Pokémon and Panini), Sapphire, Shatterfoil, MTG fracture/facet.
- Flowing curves: Water Web, Wave, Lava, Surge, Halo, Ripple, Panini Wave/Shimmer, Tie-Dye, Nebula.
- One radial feature centerd on the card: Superfractor, Gold Vinyl, Pinwheel, RayWave, Museum sunray, Scope, swirl.
- Organic printed animal/camo textures over prizm: Snakeskin, Dragon Scale, Reptilian, Tiger, Zebra, Elephant, Peacock, Camo.
- Emboss / texture (normal map, independent of foil): Full Art, VMAX, SIR, Rainbow, Gold/Hyper, Shiny Vault, Ultimate Rare, MTG textured/gilded/raised, 1997 Finest Embossed.
- Not a foil pattern (print or stock treatment): Negative, Sepia, Chrome Black, acetate windows, holograms, neon ink.

