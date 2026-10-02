// A raster image's resolution, written into its file.
type Bytes = Uint8Array<ArrayBuffer>;

/** The image with its resolution written in, so other apps place it at its printed
 *  size (without it they take 72 DPI): a PNG's pHYs chunk, a JPEG's JFIF header. The
 *  headers macOS adds that say 72 DPI (Exif, Photoshop's) are left out. */
export function withDpi(bytes: Bytes, format: "png" | "jpeg", dpi: number) {
  return new Blob(format === "png" ? pngWithDpi(bytes, dpi) : jpegWithDpi(bytes, dpi), { type: `image/${format}` });
}

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
const nameAt = (bytes: Bytes, at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));

/** A PNG's chunks, its pHYs (pixels per meter) right after its header, IHDR. */
function pngWithDpi(png: Bytes, dpi: number): Bytes[] {
  const ppm = Math.round(dpi / 0.0254);
  const phys = new Uint8Array(21);
  const view = new DataView(phys.buffer);
  view.setUint32(0, 9);
  phys.set(ascii("pHYs"), 4);
  view.setUint32(8, ppm);
  view.setUint32(12, ppm);
  phys[16] = 1; // the unit: the meter
  view.setUint32(17, crc32(phys.subarray(4, 17)));
  // 8 bytes of signature, then IHDR (25), then the other chunks.
  const chunks = [png.subarray(0, 33), phys];
  const length = new DataView(png.buffer, png.byteOffset);
  for (let at = 33; at < png.length; ) {
    const end = at + 12 + length.getUint32(at);
    if (!["pHYs", "eXIf"].includes(nameAt(png, at + 4))) chunks.push(png.subarray(at, end));
    at = end;
  }
  return chunks;
}

/** A JPEG's parts: its JFIF header saying `dpi`, then its other headers (APP0 to
 *  APP15: a color profile…) and the image. */
function jpegWithDpi(jpeg: Bytes, dpi: number): Bytes[] {
  const density = [dpi >> 8, dpi & 255];
  // APP0, 16 bytes long: "JFIF", version 1.1, the unit (the inch), X and Y densities, no thumbnail.
  const jfif = new Uint8Array([0xff, 0xe0, 0, 16, ...ascii("JFIF"), 0, 1, 1, 1, ...density, ...density, 0, 0]);
  const parts = [jpeg.subarray(0, 2), jfif];
  let at = 2;
  while (jpeg[at] === 0xff && jpeg[at + 1] >= 0xe0 && jpeg[at + 1] <= 0xef) {
    const end = at + 2 + ((jpeg[at + 2] << 8) | jpeg[at + 3]);
    if (!["JFIF", "Exif", "Phot"].includes(nameAt(jpeg, at + 4))) parts.push(jpeg.subarray(at, end));
    at = end;
  }
  parts.push(jpeg.subarray(at));
  return parts;
}

/** The CRC-32 a PNG chunk ends with. */
function crc32(bytes: Bytes) {
  let c = ~0;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
