// The social preview card (1280 × 640), for the repository's settings and link previews: the gold logo, what thicken
// does in one line, and one photo beside the model thicken made of it, on a flat dark ground.
//   node scripts/social-card.ts <out.png> <logo.png> <pair.webp>
import sharp from 'sharp';

const [out, logo, pair] = process.argv.slice(2);
if (!out || !logo || !pair) throw new Error('usage: node scripts/social-card.ts <out.png> <logo.png> <pair.webp>');
const [W, H] = [1280, 640];
const GROUND = '#15181c';

const PAIR_H = 360;
const wordmark = await sharp(logo).resize({ width: 520 }).toBuffer();
const shown = await sharp(pair, { page: 0 }).resize({ height: PAIR_H }).toBuffer(); // the pair's first frame: photo, then model
const { width: shownWidth = 0 } = await sharp(shown).metadata();
const text = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <g font-family="'Segoe UI', -apple-system, Helvetica, Arial, sans-serif">
    <text x="64" y="296" fill="#f2f2ef" font-size="40" font-weight="700">Photos in.</text>
    <text x="64" y="344" fill="#f2f2ef" font-size="40" font-weight="700">Out comes the object:</text>
    <text x="64" y="392" fill="#f2f2ef" font-size="40" font-weight="700">its 3D model and its metadata.</text>
    <text x="64" y="446" fill="#a4abb4" font-size="24">A GLB model at its real size, and its</text>
    <text x="64" y="478" fill="#a4abb4" font-size="24">metadata as JSON. Any kind of object.</text>
    <text x="64" y="548" fill="#e0b74c" font-size="24" font-weight="600">npm install -g thicken</text>
  </g>
</svg>`;
await sharp({ create: { width: W, height: H, channels: 4, background: GROUND } })
  .composite([
    { input: wordmark, left: 48, top: 88 },
    { input: Buffer.from(text), left: 0, top: 0 },
    { input: shown, left: W - shownWidth - 48, top: Math.round((H - PAIR_H) / 2) },
  ])
  .png()
  .toFile(out);
console.log(`${out}: ${W} × ${H}`);
