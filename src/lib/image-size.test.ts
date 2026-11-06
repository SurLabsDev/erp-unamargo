import { describe, expect, it } from "vitest";
import { readImageInfo } from "./image-size";

const b64 = (value: string) => new Uint8Array(Buffer.from(value, "base64"));

// The first bytes of real files, from the encoders that actually feed the
// upload: the in-browser resize in Chrome and in WebKit (Safari, and every
// browser on an iPhone), libwebp's cwebp and Pillow. Captured 2026-11-06; each
// prefix ends just past the header that carries the size.
const REAL = {
  // Chrome, canvas.toBlob("image/webp"): extended WebP (VP8X) with an ICC chunk.
  chromeWebp: b64("UklGRmxxAgBXRUJQVlA4WAoAAAAgAAAA/wQAPwYA"),
  // WebKit, the SAME call: it cannot encode WebP and hands back a PNG.
  webkitPng: b64("iVBORw0KGgoAAAANSUhEUgAABQAAAAZACAYAAAAmVO8G"),
  // WebKit, canvas.toBlob("image/jpeg"): EXIF and Photoshop segments first.
  webkitJpeg: b64(
    "/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAFAKADAAQAAAABAAAGQAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgGQAUAAwEiAAIRAQMRAQ==",
  ),
  // cwebp -q 82: simple lossy WebP (VP8), odd size on purpose.
  lossyWebp: b64("UklGRjKOAABXRUJQVlA4ICaOAAAQKgOdASpBBucD"),
  // cwebp -lossless: VP8L packs width-1 and height-1 in 14 bits each.
  losslessWebp: b64("UklGRrQsAABXRUJQVlA4TKgsAAAvQIb5AA=="),
  losslessWebp1x1: b64("UklGRhwAAABXRUJQVlA4TBAAAAAvAAAAAA=="),
  // cwebp from a PNG with transparency: VP8X with the alpha flag.
  alphaWebp: b64("UklGRpSdAABXRUJQVlA4WAoAAAAQAAAAfwIAHwMA"),
  // Pillow, progressive JPEG: the frame header is SOF2, not SOF0.
  progressiveJpeg: b64(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wgARCAZABQADASIAAhEBAxEB",
  ),
  // Pillow, JPEG with EXIF orientation 6 (shown rotated): 400x300 stored.
  exifJpeg: b64(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAEsAZADASIAAhEBAxEB",
  ),
};

describe("readImageInfo: lo que de verdad sube el navegador", () => {
  it("WebP de Chrome (VP8X con perfil de color)", () => {
    expect(readImageInfo(REAL.chromeWebp)).toEqual({
      type: "image/webp",
      width: 1280,
      height: 1600,
    });
  });

  it("el PNG que devuelve WebKit cuando se le pide WebP", () => {
    expect(readImageInfo(REAL.webkitPng)).toEqual({
      type: "image/png",
      width: 1280,
      height: 1600,
    });
  });

  it("JPEG de WebKit, con segmentos EXIF y Photoshop antes del cuadro", () => {
    expect(readImageInfo(REAL.webkitJpeg)).toEqual({
      type: "image/jpeg",
      width: 1280,
      height: 1600,
    });
  });
});

describe("readImageInfo: las variantes de cada formato", () => {
  it("WebP con perdida (VP8): 14 bits por lado", () => {
    expect(readImageInfo(REAL.lossyWebp)).toEqual({
      type: "image/webp",
      width: 1601,
      height: 999,
    });
  });

  it("WebP sin perdida (VP8L), incluido el de 1x1", () => {
    expect(readImageInfo(REAL.losslessWebp)).toEqual({
      type: "image/webp",
      width: 1601,
      height: 999,
    });
    expect(readImageInfo(REAL.losslessWebp1x1)).toEqual({
      type: "image/webp",
      width: 1,
      height: 1,
    });
  });

  it("WebP extendido con transparencia (VP8X)", () => {
    expect(readImageInfo(REAL.alphaWebp)).toEqual({
      type: "image/webp",
      width: 640,
      height: 800,
    });
  });

  it("JPEG progresivo (SOF2)", () => {
    expect(readImageInfo(REAL.progressiveJpeg)).toEqual({
      type: "image/jpeg",
      width: 1280,
      height: 1600,
    });
  });

  it("JPEG con EXIF: devuelve el tamano guardado, sin rotar", () => {
    expect(readImageInfo(REAL.exifJpeg)).toEqual({
      type: "image/jpeg",
      width: 400,
      height: 300,
    });
  });

  it("alcanza con el encabezado: no hace falta el archivo entero", () => {
    // Every REAL fixture above is only a prefix of its file.
    expect(REAL.webkitJpeg.length).toBeLessThan(200);
  });
});

// --- Synthetic files, for the edges no encoder above produced ----------------

function png(width: number, height: number, chunk = "IHDR"): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set(new TextEncoder().encode(chunk), 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function jpeg(segments: number[][]): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, ...segments.flat()]);
}

/** A marker segment: 0xFF, the marker, a big-endian length and its payload. */
function segment(marker: number, payload: number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, length >> 8, length & 0xff, ...payload];
}

/** Frame header payload: precision, height, width, one component. */
function frame(width: number, height: number): number[] {
  return [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1, 1, 0x11, 0];
}

describe("readImageInfo: casos armados a mano", () => {
  it("PNG en el limite de un integer de Postgres, y uno pasado", () => {
    expect(readImageInfo(png(0x7fffffff, 1))).toEqual({
      type: "image/png",
      width: 0x7fffffff,
      height: 1,
    });
    expect(readImageInfo(png(0x80000000, 1))).toBeNull();
  });

  it("PNG con un lado en cero, o sin IHDR primero", () => {
    expect(readImageInfo(png(0, 10))).toBeNull();
    expect(readImageInfo(png(10, 0))).toBeNull();
    expect(readImageInfo(png(10, 10, "iCCP"))).toBeNull();
  });

  it("JPEG: saltea los marcadores sueltos y el relleno 0xFF", () => {
    const bytes = jpeg([
      segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]),
      [0xff, 0xff, 0xff], // fill bytes before the next marker
      segment(0xdb, new Array(65).fill(1)),
      segment(0xc1, frame(300, 200)),
    ]);
    expect(readImageInfo(bytes)).toEqual({
      type: "image/jpeg",
      width: 300,
      height: 200,
    });
  });

  it("JPEG: la tabla de Huffman (C4) no es un cuadro", () => {
    const bytes = jpeg([
      segment(0xc4, [0, 1, 2, 3, 4, 5, 6, 7, 8]),
      segment(0xc0, frame(64, 48)),
    ]);
    expect(readImageInfo(bytes)).toEqual({
      type: "image/jpeg",
      width: 64,
      height: 48,
    });
  });

  it("JPEG sin cuadro antes del escaneo, o con alto 0 (DNL)", () => {
    expect(readImageInfo(jpeg([segment(0xda, [1, 2, 3])]))).toBeNull();
    expect(readImageInfo(jpeg([segment(0xc0, frame(64, 0))]))).toBeNull();
  });

  it("WebP VP8 que no es un cuadro clave no da tamano", () => {
    const bytes = new Uint8Array(REAL.lossyWebp);
    bytes[20] |= 1; // frame tag bit 0 = 1: interframe
    expect(readImageInfo(bytes)).toBeNull();
  });

  it("WebP VP8 sin el codigo de inicio", () => {
    const bytes = new Uint8Array(REAL.lossyWebp);
    bytes[23] = 0;
    expect(readImageInfo(bytes)).toBeNull();
  });

  it("WebP VP8L sin la firma 0x2F", () => {
    const bytes = new Uint8Array(REAL.losslessWebp);
    bytes[20] = 0;
    expect(readImageInfo(bytes)).toBeNull();
  });

  it("RIFF que no es WebP (un WAV)", () => {
    const bytes = new Uint8Array(REAL.chromeWebp);
    bytes.set(new TextEncoder().encode("WAVE"), 8);
    expect(readImageInfo(bytes)).toBeNull();
  });

  it.each([
    ["vacio", new Uint8Array(0)],
    ["texto", new TextEncoder().encode("hola, esto no es una imagen")],
    ["GIF", new TextEncoder().encode("GIF89a\x10\x00\x10\x00")],
    ["SVG", new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ["PNG cortado", REAL.webkitPng.subarray(0, 20)],
    ["WebP cortado", REAL.chromeWebp.subarray(0, 26)],
    ["VP8 cortado", REAL.lossyWebp.subarray(0, 27)],
    ["JPEG cortado antes del cuadro", REAL.webkitJpeg.subarray(0, 120)],
    ["JPEG cortado en el cuadro", REAL.webkitJpeg.subarray(0, 168)],
    ["solo el inicio de un JPEG", Uint8Array.from([0xff, 0xd8])],
  ])("%s: null", (_label, bytes) => {
    expect(readImageInfo(bytes)).toBeNull();
  });
});
