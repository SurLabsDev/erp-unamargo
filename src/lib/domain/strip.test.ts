import { describe, expect, it } from "vitest";
import {
  MAX_ALT_LENGTH,
  MAX_STRIP_PHOTOS,
  STRIP_LIMIT_ERROR,
  canAddStripPhoto,
  compareStripPhotos,
  isStripMoveDirection,
  moveStripPhoto,
  nextStripSortOrder,
  sortStripPhotos,
  stripAltSchema,
  toPublicStripPhotos,
  type StripOrderable,
  type StripPhotoContent,
} from "./strip";

function photo(
  id: string,
  sortOrder: number,
  createdAtISO = "2026-11-06T12:00:00.000Z",
): StripOrderable {
  return { id, sortOrder, createdAt: new Date(createdAtISO) };
}

const ids = (photos: readonly { id: string }[]) => photos.map((p) => p.id);

describe("sortStripPhotos (orden de la tira)", () => {
  it("ordena por sort_order", () => {
    const sorted = sortStripPhotos([photo("c", 2), photo("a", 0), photo("b", 1)]);
    expect(ids(sorted)).toEqual(["a", "b", "c"]);
  });

  it("a igual sort_order va primero la subida mas vieja", () => {
    const sorted = sortStripPhotos([
      photo("nueva", 0, "2026-11-06T12:00:00.001Z"),
      photo("vieja", 0, "2026-11-06T12:00:00.000Z"),
    ]);
    expect(ids(sorted)).toEqual(["vieja", "nueva"]);
  });

  it("sort_order le gana a la fecha", () => {
    const sorted = sortStripPhotos([
      photo("vieja-al-final", 5, "2020-01-01T00:00:00Z"),
      photo("nueva-primero", 1, "2026-11-06T00:00:00Z"),
    ]);
    expect(ids(sorted)).toEqual(["nueva-primero", "vieja-al-final"]);
  });

  it("empate exacto: el id menor, sin importar el orden de entrada", () => {
    const a = photo("aaa", 3);
    const b = photo("bbb", 3);
    expect(ids(sortStripPhotos([b, a]))).toEqual(["aaa", "bbb"]);
    expect(ids(sortStripPhotos([a, b]))).toEqual(["aaa", "bbb"]);
    expect(compareStripPhotos(a, a)).toBe(0);
  });

  it("los huecos que deja una foto quitada no cambian nada", () => {
    expect(ids(sortStripPhotos([photo("b", 7), photo("a", 2)]))).toEqual([
      "a",
      "b",
    ]);
  });

  it("devuelve una copia y deja la entrada como estaba", () => {
    const input = [photo("b", 1), photo("a", 0)];
    const sorted = sortStripPhotos(input);
    expect(ids(input)).toEqual(["b", "a"]);
    expect(sorted).not.toBe(input);
  });
});

describe("limite de fotos", () => {
  it("entran hasta MAX_STRIP_PHOTOS, ni una mas", () => {
    expect(MAX_STRIP_PHOTOS).toBe(20);
    expect(canAddStripPhoto(0)).toBe(true);
    expect(canAddStripPhoto(MAX_STRIP_PHOTOS - 1)).toBe(true);
    expect(canAddStripPhoto(MAX_STRIP_PHOTOS)).toBe(false);
    expect(canAddStripPhoto(MAX_STRIP_PHOTOS + 3)).toBe(false);
  });

  it("el mensaje dice el limite y que hacer", () => {
    expect(STRIP_LIMIT_ERROR).toContain(`${MAX_STRIP_PHOTOS} fotos`);
    expect(STRIP_LIMIT_ERROR).toContain("Quitá una");
  });
});

describe("nextStripSortOrder", () => {
  it("la primera foto arranca en 0", () => {
    expect(nextStripSortOrder([])).toBe(0);
  });

  it("una subida nueva va despues de la ultima, aunque haya huecos", () => {
    expect(nextStripSortOrder([{ sortOrder: 0 }, { sortOrder: 1 }])).toBe(2);
    expect(nextStripSortOrder([{ sortOrder: 9 }, { sortOrder: 2 }])).toBe(10);
  });
});

/** The four photos of the examples, already contiguous. */
const tidy = () => [photo("a", 0), photo("b", 1), photo("c", 2), photo("d", 3)];

function expectContiguous(order: { sortOrder: number }[]) {
  expect(order.map((entry) => entry.sortOrder)).toEqual(
    order.map((_, index) => index),
  );
}

describe("moveStripPhoto", () => {
  it("subir intercambia con la de arriba y toca solo esas dos filas", () => {
    const result = moveStripPhoto(tidy(), "c", "up");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ids(result.order)).toEqual(["a", "c", "b", "d"]);
    expectContiguous(result.order);
    expect(result.changes).toEqual([
      { id: "c", sortOrder: 1 },
      { id: "b", sortOrder: 2 },
    ]);
  });

  it("bajar intercambia con la de abajo", () => {
    const result = moveStripPhoto(tidy(), "a", "down");
    expect(result.ok && ids(result.order)).toEqual(["b", "a", "c", "d"]);
  });

  it("no se sube la primera ni se baja la ultima", () => {
    expect(moveStripPhoto(tidy(), "a", "up")).toEqual({
      ok: false,
      reason: "at-edge",
    });
    expect(moveStripPhoto(tidy(), "d", "down")).toEqual({
      ok: false,
      reason: "at-edge",
    });
    expect(moveStripPhoto([photo("sola", 0)], "sola", "down")).toEqual({
      ok: false,
      reason: "at-edge",
    });
  });

  it("una foto que no esta: not-found", () => {
    expect(moveStripPhoto(tidy(), "zzz", "up")).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(moveStripPhoto([], "a", "down")).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it("con huecos y repetidos, renumera todo 0..n-1 en el orden que se ve", () => {
    const messy = [
      photo("d", 40),
      photo("b", 5, "2026-11-06T10:00:00Z"),
      photo("c", 5, "2026-11-06T11:00:00Z"),
      photo("a", -3),
    ];
    // Seen as: a, b, c, d. Moving d up puts it between b and c.
    const result = moveStripPhoto(messy, "d", "up");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ids(result.order)).toEqual(["a", "b", "d", "c"]);
    expectContiguous(result.order);
    expect(result.changes).toEqual([
      { id: "a", sortOrder: 0 },
      { id: "b", sortOrder: 1 },
      { id: "d", sortOrder: 2 },
      { id: "c", sortOrder: 3 },
    ]);
  });

  it("subir y despues bajar la misma foto deja el orden como estaba", () => {
    const up = moveStripPhoto(tidy(), "c", "up");
    if (!up.ok) throw new Error("expected a move");
    const after = up.order.map((entry) => ({
      ...entry,
      createdAt: new Date("2026-11-06T12:00:00Z"),
    }));
    const down = moveStripPhoto(after, "c", "down");
    expect(down.ok && ids(down.order)).toEqual(["a", "b", "c", "d"]);
  });

  it("no toca la entrada", () => {
    const input = tidy();
    moveStripPhoto(input, "b", "down");
    expect(input.map((p) => [p.id, p.sortOrder])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
      ["d", 3],
    ]);
  });
});

describe("isStripMoveDirection (lo que llega por el server action)", () => {
  it("solo up y down", () => {
    expect(isStripMoveDirection("up")).toBe(true);
    expect(isStripMoveDirection("down")).toBe(true);
    for (const value of ["UP", "arriba", "", null, undefined, 1, {}]) {
      expect(isStripMoveDirection(value)).toBe(false);
    }
  });
});

describe("stripAltSchema (descripcion corta)", () => {
  it("es opcional: vacio o solo espacios vuelve como null, nunca ''", () => {
    expect(stripAltSchema.parse("")).toBeNull();
    expect(stripAltSchema.parse("   \t ")).toBeNull();
  });

  it("recorta los espacios de los bordes", () => {
    expect(stripAltSchema.parse("  Mate de calabaza  ")).toBe("Mate de calabaza");
  });

  it(`admite hasta ${MAX_ALT_LENGTH} caracteres, contados despues de recortar`, () => {
    expect(MAX_ALT_LENGTH).toBe(120);
    const exact = "a".repeat(MAX_ALT_LENGTH);
    expect(stripAltSchema.parse(exact)).toBe(exact);
    expect(stripAltSchema.parse(`  ${exact}  `)).toBe(exact);
    const result = stripAltSchema.safeParse(exact + "a");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "La descripción admite hasta 120 caracteres.",
    );
  });

  it("rechaza lo que no es texto (un archivo, un numero)", () => {
    expect(stripAltSchema.safeParse(42).success).toBe(false);
    expect(stripAltSchema.safeParse(null).success).toBe(false);
  });
});

const resolver = (path: string) =>
  `https://storage.example/storage/v1/object/public/productos/${path}`;

function content(
  id: string,
  sortOrder: number,
  extra: Partial<StripPhotoContent> = {},
): StripPhotoContent {
  return {
    id,
    sortOrder,
    createdAt: new Date("2026-11-06T12:00:00Z"),
    imagePath: `tira/${id}.webp`,
    width: 1280,
    height: 1600,
    alt: null,
    ...extra,
  };
}

describe("toPublicStripPhotos (contrato de /api/public/v1/tira)", () => {
  it("arma cada foto campo por campo y en el orden de la tira", () => {
    const photos = toPublicStripPhotos(
      [
        content("segunda", 1, { width: 597, height: 900, alt: "Termo" }),
        content("primera", 0, { alt: "Mate de calabaza" }),
      ],
      resolver,
    );
    expect(photos).toEqual([
      {
        url: "https://storage.example/storage/v1/object/public/productos/tira/primera.webp",
        width: 1280,
        height: 1600,
        alt: "Mate de calabaza",
      },
      {
        url: "https://storage.example/storage/v1/object/public/productos/tira/segunda.webp",
        width: 597,
        height: 900,
        alt: "Termo",
      },
    ]);
  });

  it("nunca deja pasar el id, el autor, el numero de orden ni las fechas", () => {
    // The storage name is its own uuid, unrelated to the row id (storage.ts).
    const row = {
      ...content("3f2b8c1e-5d4a-4b7e-9c1a-2e6f8d0b7a91", 7, {
        imagePath: "tira/0b6f2d4e-8c1a-4f3b-9e7d-5a2c1b0e9f8d.webp",
      }),
      createdBy: "9a1c7e2b-0f3d-4e5a-8b6c-1d2e3f4a5b6c",
      updatedAt: new Date("2026-11-07T09:30:00Z"),
    };
    const [result] = toPublicStripPhotos([row], resolver);
    expect(Object.keys(result).sort()).toEqual(["alt", "height", "url", "width"]);
    const json = JSON.stringify(result);
    for (const secret of [
      "3f2b8c1e",
      "9a1c7e2b",
      "2026-11-06",
      "2026-11-07",
      "sortOrder",
      "createdBy",
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it("sin fotos, un array vacio", () => {
    expect(toPublicStripPhotos([], resolver)).toEqual([]);
  });

  it("sin storage configurado no manda URLs vacias: saca la foto", () => {
    expect(toPublicStripPhotos([content("a", 0)], () => "")).toEqual([]);
  });

  it("alt vacio o de espacios (una fila editada a mano) sale como null", () => {
    const photos = toPublicStripPhotos(
      [
        content("a", 0, { alt: "" }),
        content("b", 1, { alt: "   " }),
        content("c", 2, { alt: "  Bombilla  " }),
      ],
      resolver,
    );
    expect(photos.map((p) => p.alt)).toEqual([null, null, "Bombilla"]);
  });
});
