// Draws the DMG window's background (src-tauri/icons/dmg-background.png): a light
// backdrop with an arrow from where Helix sits to where the Applications folder sits
// (positions in tauri.conf.json › bundle › macOS › dmg). Drawn at 2x and marked 144 dpi,
// so it shows at the window's size, sharp on Retina. Run: node scripts/dmg-background.mjs
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const W = 660;
const H = 400;
const BACKGROUND = [245, 245, 247];
const ARROW = [161, 161, 166];
// The arrow, in window points: a shaft and a head, each a round-capped stroke.
const STROKES = [
  [272, 185, 384, 185],
  [370, 172, 386, 185],
  [386, 185, 370, 198],
];
const HALF_WIDTH = 1.5;

/** Distance from (x, y) to the segment (x0, y0)–(x1, y1). */
function distance(x, y, [x0, y0, x1, y1]) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
}

function png(scale) {
  const w = W * scale;
  const h = H * scale;
  const rows = Buffer.alloc((w * 3 + 1) * h);
  for (let py = 0; py < h; py++) {
    rows[py * (w * 3 + 1)] = 0; // no filter
    for (let px = 0; px < w; px++) {
      const x = (px + 0.5) / scale;
      const y = (py + 0.5) / scale;
      const d = Math.min(...STROKES.map((s) => distance(x, y, s)));
      // Anti-aliased edge, one device pixel wide.
      const ink = Math.max(0, Math.min(1, (HALF_WIDTH - d) * scale + 0.5));
      const i = py * (w * 3 + 1) + 1 + px * 3;
      for (let c = 0; c < 3; c++) rows[i + c] = Math.round(BACKGROUND[c] + (ARROW[c] - BACKGROUND[c]) * ink);
    }
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  // pHYs: 72 dpi per scale, so macOS shows it at the window's size.
  const phys = Buffer.alloc(9);
  phys.writeUInt32BE(Math.round((72 * scale) / 0.0254), 0);
  phys.writeUInt32BE(Math.round((72 * scale) / 0.0254), 4);
  phys[8] = 1;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("pHYs", phys),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

writeFileSync("src-tauri/icons/dmg-background.png", png(2));
