/**
 * Pixel size of a PNG, JPEG or WebP, read from the header bytes without
 * decoding the image. Pure and dependency-free (rule 6): three formats, a few
 * dozen lines, against a whole image library.
 *
 * It exists for the strip photos (src/app/(app)/tira): the public API hands the
 * site each photo's width and height, and the site lays every photo out at its
 * own proportions with them. So the size is read from the bytes that are
 * actually stored, on the server, and never taken from the form: whatever the
 * browser says about a file, these bytes are what the site will show.
 *
 * The format is detected from the content, not from the declared MIME type,
 * because the two can disagree: WebKit (Safari, and every browser on an iPhone)
 * cannot encode WebP from a canvas and hands back a PNG when asked for one.
 *
 * The size is the STORED one. A JPEG with an EXIF orientation of 5 to 8 is
 * shown rotated, so its width and height come out swapped. That cannot happen
 * through the ERP: every upload passes through the in-browser resize
 * (src/lib/redimensionar-imagen.ts), and drawing on a canvas bakes the
 * orientation into the pixels.
 */

export type ImageFormat = "image/png" | "image/jpeg" | "image/webp";

export type ImageInfo = { type: ImageFormat; width: number; height: number };

/** Largest value of a Postgres `integer`, the type of the columns it fills. */
const MAX_SIDE = 0x7fffffff;

function size(type: ImageFormat, width: number, height: number): ImageInfo | null {
  const valid = (side: number) =>
    Number.isInteger(side) && side > 0 && side <= MAX_SIDE;
  return valid(width) && valid(height) ? { type, width, height } : null;
}

function ascii(bytes: Uint8Array, offset: number, text: string): boolean {
  if (offset + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** PNG: the signature, then IHDR (always the first chunk) with two uint32 BE. */
function readPng(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 24) return null;
  if (PNG_SIGNATURE.some((byte, i) => bytes[i] !== byte)) return null;
  if (!ascii(bytes, 12, "IHDR")) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return size("image/png", view.getUint32(16), view.getUint32(20));
}

/**
 * WebP: "RIFF", the file size, "WEBP" and then ONE of three first chunks.
 * - "VP8 " (lossy): a key frame starts with a 3-byte tag (bit 0 = 0 for a key
 *   frame) and the start code 9D 01 2A; then width and height as uint16 LE,
 *   of which the low 14 bits are the size and the top 2 a scaling hint.
 * - "VP8L" (lossless): signature 0x2F, then width-1 and height-1 in 14 bits
 *   each, packed little-endian.
 * - "VP8X" (extended: transparency, color profile, metadata, animation):
 *   canvas width-1 and height-1 as uint24 LE. Chrome's canvas output is this
 *   one, because it carries an ICC profile.
 */
function readWebp(bytes: Uint8Array): ImageInfo | null {
  if (!ascii(bytes, 0, "RIFF") || !ascii(bytes, 8, "WEBP")) return null;
  const b = (i: number) => bytes[i] ?? 0;

  if (ascii(bytes, 12, "VP8 ")) {
    if (bytes.length < 30) return null;
    const keyFrame = (b(20) & 1) === 0;
    const startCode = b(23) === 0x9d && b(24) === 0x01 && b(25) === 0x2a;
    if (!keyFrame || !startCode) return null;
    return size(
      "image/webp",
      (b(26) | (b(27) << 8)) & 0x3fff,
      (b(28) | (b(29) << 8)) & 0x3fff,
    );
  }

  if (ascii(bytes, 12, "VP8L")) {
    if (bytes.length < 25 || b(20) !== 0x2f) return null;
    return size(
      "image/webp",
      1 + (b(21) | ((b(22) & 0x3f) << 8)),
      1 + ((b(22) >> 6) | (b(23) << 2) | ((b(24) & 0x0f) << 10)),
    );
  }

  if (ascii(bytes, 12, "VP8X")) {
    if (bytes.length < 30) return null;
    return size(
      "image/webp",
      1 + (b(24) | (b(25) << 8) | (b(26) << 16)),
      1 + (b(27) | (b(28) << 8) | (b(29) << 16)),
    );
  }

  return null;
}

/** Start-of-frame markers: C0-CF except C4 (Huffman), C8 (reserved) and CC
 *  (arithmetic coding). Baseline is C0; progressive, C2. */
function isFrameMarker(marker: number): boolean {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  );
}

/**
 * JPEG: walks the marker segments from SOI until the frame header (SOFn),
 * which holds precision, height and width as uint16 BE. EXIF, ICC and quality
 * tables come before it, so it is rarely near the start.
 */
function readJpeg(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    // Any number of 0xFF fill bytes may precede a marker.
    while (i < bytes.length && bytes[i] === 0xff) i++;
    if (i >= bytes.length) return null;
    const marker = bytes[i];
    i++;

    // Markers without a length: TEM, the restart markers and a stray SOI.
    if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    // End of image, or the scan data begins: no frame header came first.
    if (marker === 0xd9 || marker === 0xda) return null;

    if (i + 2 > bytes.length) return null;
    // The length counts its own two bytes, not the marker.
    const length = (bytes[i] << 8) | bytes[i + 1];
    if (length < 2) return null;

    if (isFrameMarker(marker)) {
      if (length < 8 || i + length > bytes.length) return null;
      // A height of 0 means "defined later, by a DNL marker": unreadable here.
      return size(
        "image/jpeg",
        (bytes[i + 5] << 8) | bytes[i + 6],
        (bytes[i + 3] << 8) | bytes[i + 4],
      );
    }
    i += length;
  }
  return null;
}

/**
 * Format and pixel size of an image, or null when the bytes are not a PNG,
 * JPEG or WebP whose header can be read, or when a side is 0 or does not fit a
 * Postgres `integer`. Reading the header only, it also works on a prefix of
 * the file.
 */
export function readImageInfo(bytes: Uint8Array): ImageInfo | null {
  return readPng(bytes) ?? readWebp(bytes) ?? readJpeg(bytes);
}
