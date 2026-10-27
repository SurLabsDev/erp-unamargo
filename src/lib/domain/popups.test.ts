import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MAX_BODY_LENGTH,
  MAX_CTA_URL_LENGTH,
  MAX_TITLE_LENGTH,
  describeSchedule,
  isSafeCtaUrl,
  pickPopup,
  popupInputSchema,
  popupState,
  popupVersion,
  toPublicPopup,
  type PopupCandidate,
  type PopupContent,
  type PopupSchedule,
} from "./popups";

const base: PopupSchedule = {
  isActive: true,
  startsOn: "2026-11-01",
  endsOn: "2026-11-30",
};

describe("popupState", () => {
  it("apagado gana sobre cualquier fecha", () => {
    expect(popupState({ ...base, isActive: false }, "2026-11-15")).toBe("off");
    expect(popupState({ ...base, isActive: false }, "2026-12-15")).toBe("off");
    expect(popupState({ ...base, isActive: false }, "2026-10-15")).toBe("off");
  });

  it("programado antes del inicio", () => {
    expect(popupState(base, "2026-10-31")).toBe("scheduled");
  });

  it("en vivo dentro del rango, incluidos los dos bordes", () => {
    expect(popupState(base, "2026-11-01")).toBe("live");
    expect(popupState(base, "2026-11-15")).toBe("live");
    expect(popupState(base, "2026-11-30")).toBe("live");
  });

  it("terminado despues del fin", () => {
    expect(popupState(base, "2026-12-01")).toBe("ended");
  });

  it("sin fechas, esta en vivo mientras este encendido", () => {
    const open = { isActive: true, startsOn: null, endsOn: null };
    expect(popupState(open, "2000-01-01")).toBe("live");
    expect(popupState(open, "2099-12-31")).toBe("live");
  });

  it("solo con inicio: programado antes, en vivo desde ese dia para siempre", () => {
    const fromNov = { isActive: true, startsOn: "2026-11-01", endsOn: null };
    expect(popupState(fromNov, "2026-10-31")).toBe("scheduled");
    expect(popupState(fromNov, "2026-11-01")).toBe("live");
    expect(popupState(fromNov, "2030-01-01")).toBe("live");
  });

  it("solo con fin: en vivo hasta ese dia inclusive, terminado despues", () => {
    const untilNov = { isActive: true, startsOn: null, endsOn: "2026-11-30" };
    expect(popupState(untilNov, "2020-01-01")).toBe("live");
    expect(popupState(untilNov, "2026-11-30")).toBe("live");
    expect(popupState(untilNov, "2026-12-01")).toBe("ended");
  });

  it("un pop-up de un solo dia esta en vivo ese dia", () => {
    const oneDay = { isActive: true, startsOn: "2026-11-15", endsOn: "2026-11-15" };
    expect(popupState(oneDay, "2026-11-14")).toBe("scheduled");
    expect(popupState(oneDay, "2026-11-15")).toBe("live");
    expect(popupState(oneDay, "2026-11-16")).toBe("ended");
  });
});

const TODAY = "2026-11-15";

function popup(
  id: string,
  updatedAtISO: string,
  extra: Partial<PopupCandidate> = {},
): PopupCandidate {
  return {
    id,
    updatedAt: new Date(updatedAtISO),
    isActive: true,
    startsOn: null,
    endsOn: null,
    ...extra,
  };
}

describe("pickPopup", () => {
  it("sin pop-ups en vivo devuelve null", () => {
    expect(pickPopup([], TODAY)).toBeNull();
    expect(
      pickPopup(
        [
          popup("a", "2026-11-14T10:00:00Z", { isActive: false }),
          popup("b", "2026-11-14T10:00:00Z", { startsOn: "2026-11-20" }),
          popup("c", "2026-11-14T10:00:00Z", { endsOn: "2026-11-10" }),
        ],
        TODAY,
      ),
    ).toBeNull();
  });

  it("entre los que estan en vivo gana el editado mas recientemente", () => {
    const picked = pickPopup(
      [
        popup("viejo", "2026-11-10T10:00:00Z"),
        popup("nuevo", "2026-11-14T10:00:00Z"),
        popup("medio", "2026-11-12T10:00:00Z"),
      ],
      TODAY,
    );
    expect(picked?.id).toBe("nuevo");
  });

  it("uno editado despues pero que no esta en vivo no tapa al que si", () => {
    const picked = pickPopup(
      [
        popup("vivo", "2026-11-01T10:00:00Z"),
        popup("apagado", "2026-11-14T10:00:00Z", { isActive: false }),
        popup("programado", "2026-11-14T11:00:00Z", { startsOn: "2026-11-16" }),
        popup("terminado", "2026-11-14T12:00:00Z", { endsOn: "2026-11-14" }),
      ],
      TODAY,
    );
    expect(picked?.id).toBe("vivo");
  });

  it("uno programado que arranca hoy NO pasa adelante de uno en vivo editado despues", () => {
    const programado = popup("programado", "2026-11-01T10:00:00Z", {
      startsOn: TODAY,
    });
    const editadoDespues = popup("editado-despues", "2026-11-05T10:00:00Z");
    expect(pickPopup([programado, editadoDespues], TODAY)?.id).toBe(
      "editado-despues",
    );
    // Sin el otro, el programado sale solo el dia que arranca.
    expect(pickPopup([programado], "2026-11-14")).toBeNull();
    expect(pickPopup([programado], TODAY)?.id).toBe("programado");
  });

  it("empate exacto en la edicion: gana el id mayor, sin importar el orden", () => {
    const a = popup("aaa", "2026-11-14T10:00:00.000Z");
    const b = popup("bbb", "2026-11-14T10:00:00.000Z");
    expect(pickPopup([a, b], TODAY)?.id).toBe("bbb");
    expect(pickPopup([b, a], TODAY)?.id).toBe("bbb");
  });

  it("un milisegundo alcanza para desempatar", () => {
    const a = popup("zzz", "2026-11-14T10:00:00.000Z");
    const b = popup("aaa", "2026-11-14T10:00:00.001Z");
    expect(pickPopup([a, b], TODAY)?.id).toBe("aaa");
  });

  it("devuelve la misma fila que recibio, con sus campos extra", () => {
    const row = { ...popup("a", "2026-11-14T10:00:00Z"), title: "Envíos" };
    expect(pickPopup([row], TODAY)).toBe(row);
  });
});

describe("isSafeCtaUrl (guarda XSS del boton)", () => {
  it.each([
    "https://example.com",
    "https://example.com/",
    "https://www.example.com/tienda?utm_source=popup&utm_medium=web#arriba",
    "https://wa.me/59899123456?text=Hola%20quiero%20info",
    "https://example.com:8443/ruta",
    "https://ñandú.example/",
    // Comilla simple: es un caracter legal en una URL, asi que se acepta.
    "https://example.com/wiki/O'Higgins",
    "#tienda",
    "#seccion-2",
    "#Contacto",
  ])("acepta %j", (value) => {
    expect(isSafeCtaUrl(value)).toBe(true);
  });

  it.each([
    // Esquemas que ejecutan codigo o traen contenido propio.
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "JAVASCRIPT:alert(document.cookie)",
    "javascript://example.com/%0Aalert(1)",
    " javascript:alert(1)",
    "\u0000javascript:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "vbscript:msgbox(1)",
    // Cualquier otro esquema, aunque sea inofensivo: la regla es una lista
    // blanca.
    "http://example.com",
    "HTTPS://example.com",
    "Https://example.com",
    "mailto:hola@example.com",
    "tel:+59899123456",
    "ftp://example.com",
    "file:///etc/passwd",
    // Formas que el parser de URLs perdona y el navegador interpreta.
    "//evil.example",
    "/tienda",
    "tienda",
    "example.com",
    "https:evil.example",
    "https:/evil.example",
    "https://",
    "https:///",
    " https://example.com",
    "https://example.com ",
    "https://exa mple.com",
    // Credenciales: se lee como un sitio y lleva a otro.
    "https://user:pass@evil.example",
    "https://shop.example@evil.example",
    // Caracteres para salirse de un atributo o disfrazar el destino.
    'https://example.com/"onmouseover="alert(1)',
    "https://example.com/<script>alert(1)</script>",
    "https://example.com/`x`",
    "https://example.com\\@evil.example",
    "https://example.com/‮gnp.exe",
    "https://example.com/​",
    "",
  ])("rechaza %j", (value) => {
    expect(isSafeCtaUrl(value)).toBe(false);
  });

  it.each([
    "#",
    "##tienda",
    "#tienda online",
    "#tienda_2",
    "#ñandú",
    "#javascript:alert(1)",
    "#<img src=x onerror=alert(1)>",
    "tienda#contacto",
  ])("rechaza el ancla %j", (value) => {
    expect(isSafeCtaUrl(value)).toBe(false);
  });

  it("respeta el largo maximo", () => {
    const prefix = "https://example.com/";
    const exact = prefix + "a".repeat(MAX_CTA_URL_LENGTH - prefix.length);
    expect(exact).toHaveLength(MAX_CTA_URL_LENGTH);
    expect(isSafeCtaUrl(exact)).toBe(true);
    expect(isSafeCtaUrl(exact + "a")).toBe(false);
  });
});

const emptyForm = {
  title: "",
  body: "",
  ctaLabel: "",
  ctaUrl: "",
  startsOn: "",
  endsOn: "",
};

function parseForm(fields: Partial<typeof emptyForm>) {
  return popupInputSchema.safeParse({ ...emptyForm, ...fields });
}

function firstError(fields: Partial<typeof emptyForm>): string | undefined {
  const result = parseForm(fields);
  return result.success ? undefined : result.error.issues[0]?.message;
}

describe("popupInputSchema", () => {
  it("con solo el titulo, lo opcional vuelve como null y no como ''", () => {
    const result = parseForm({ title: "  Envíos gratis  " });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      title: "Envíos gratis",
      body: null,
      ctaLabel: null,
      ctaUrl: null,
      startsOn: null,
      endsOn: null,
    });
  });

  it("el titulo es obligatorio y acotado", () => {
    expect(firstError({ title: "   " })).toBe("El título es obligatorio.");
    expect(firstError({ title: "a".repeat(MAX_TITLE_LENGTH) })).toBeUndefined();
    expect(firstError({ title: "a".repeat(MAX_TITLE_LENGTH + 1) })).toContain(
      `${MAX_TITLE_LENGTH} caracteres`,
    );
  });

  it("el texto normaliza los saltos de linea y respeta el largo", () => {
    const result = parseForm({ title: "x", body: "Línea uno\r\nLínea dos\r" });
    expect(result.data?.body).toBe("Línea uno\nLínea dos");
    expect(
      firstError({ title: "x", body: "a".repeat(MAX_BODY_LENGTH + 1) }),
    ).toContain(`${MAX_BODY_LENGTH} caracteres`);
  });

  it("el boton lleva texto y link juntos, o ninguno", () => {
    expect(firstError({ title: "x", ctaLabel: "Ver tienda" })).toContain(
      "texto y link",
    );
    expect(firstError({ title: "x", ctaUrl: "#tienda" })).toContain(
      "texto y link",
    );
    const both = parseForm({
      title: "x",
      ctaLabel: " Ver tienda ",
      ctaUrl: " #tienda ",
    });
    expect(both.data?.ctaLabel).toBe("Ver tienda");
    expect(both.data?.ctaUrl).toBe("#tienda");
  });

  it("el link inseguro no entra por el formulario", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "http://example.com",
    ]) {
      expect(
        firstError({ title: "x", ctaLabel: "Ver", ctaUrl: url }),
      ).toContain("https://");
    }
  });

  it("recorta los espacios del link antes de validarlo", () => {
    const result = parseForm({
      title: "x",
      ctaLabel: "Ver",
      ctaUrl: "  https://example.com/tienda  ",
    });
    expect(result.data?.ctaUrl).toBe("https://example.com/tienda");
  });

  it("las fechas son opcionales, validas y en orden", () => {
    expect(parseForm({ title: "x", startsOn: "2026-11-01" }).data?.startsOn).toBe(
      "2026-11-01",
    );
    expect(parseForm({ title: "x", endsOn: "2026-11-30" }).data?.endsOn).toBe(
      "2026-11-30",
    );
    expect(
      parseForm({ title: "x", startsOn: "2026-11-15", endsOn: "2026-11-15" })
        .success,
    ).toBe(true);
    expect(firstError({ title: "x", startsOn: "2026-02-30" })).toBe(
      "La fecha de inicio no es válida.",
    );
    expect(firstError({ title: "x", endsOn: "mañana" })).toBe(
      "La fecha de fin no es válida.",
    );
    expect(
      firstError({ title: "x", startsOn: "2026-11-30", endsOn: "2026-11-01" }),
    ).toBe("La fecha de fin no puede ser anterior a la de inicio.");
  });
});

describe("describeSchedule", () => {
  it("dice el periodo segun las fechas que haya", () => {
    expect(describeSchedule("2026-11-01", "2026-11-30")).toBe(
      "01/11/2026 a 30/11/2026",
    );
    expect(describeSchedule("2026-11-01", null)).toBe("Desde el 01/11/2026");
    expect(describeSchedule(null, "2026-11-30")).toBe("Hasta el 30/11/2026");
    expect(describeSchedule(null, null)).toBe("Sin fechas");
  });
});

const ID = "3f2b8c1e-5d4a-4b7e-9c1a-2e6f8d0b7a91";
const EDITED = new Date("2026-11-14T13:45:12.345Z");

describe("popupVersion", () => {
  it("son los primeros 16 hex de sha256(id + updatedAt ISO)", async () => {
    const expected = createHash("sha256")
      .update(ID + EDITED.toISOString())
      .digest("hex")
      .slice(0, 16);
    await expect(popupVersion(ID, EDITED)).resolves.toBe(expected);
    await expect(popupVersion(ID, EDITED)).resolves.toMatch(/^[0-9a-f]{16}$/);
  });

  it("cambia si el pop-up se edita, aunque sea un milisegundo despues", async () => {
    const later = new Date(EDITED.getTime() + 1);
    expect(await popupVersion(ID, later)).not.toBe(
      await popupVersion(ID, EDITED),
    );
  });

  it("cambia si se pasa a mostrar otro pop-up", async () => {
    const other = "9a1c7e2b-0f3d-4e5a-8b6c-1d2e3f4a5b6c";
    expect(await popupVersion(other, EDITED)).not.toBe(
      await popupVersion(ID, EDITED),
    );
  });

  it("no expone ni el id ni la fecha", async () => {
    const version = await popupVersion(ID, EDITED);
    expect(ID).not.toContain(version);
    expect(EDITED.toISOString()).not.toContain(version);
  });
});

const content: PopupContent = {
  id: ID,
  updatedAt: EDITED,
  title: "Envíos gratis",
  body: "Todo noviembre.",
  imagePath: "popups/0b6f.webp",
  ctaLabel: "Ver tienda",
  ctaUrl: "#tienda",
};

const resolver = (path: string) =>
  `https://storage.example/object/public/productos/${path}`;

describe("toPublicPopup", () => {
  it("arma el contrato publico campo por campo", async () => {
    await expect(toPublicPopup(content, resolver)).resolves.toEqual({
      version: await popupVersion(ID, EDITED),
      title: "Envíos gratis",
      body: "Todo noviembre.",
      image: "https://storage.example/object/public/productos/popups/0b6f.webp",
      cta: { label: "Ver tienda", url: "#tienda" },
    });
  });

  it("nunca deja pasar el id, el autor, las fechas ni el interruptor", async () => {
    const row = {
      ...content,
      createdBy: "user-1",
      createdAt: EDITED,
      startsOn: "2026-11-01",
      endsOn: "2026-11-30",
      isActive: true,
    };
    const result = await toPublicPopup(row, resolver);
    expect(Object.keys(result).sort()).toEqual([
      "body",
      "cta",
      "image",
      "title",
      "version",
    ]);
    const json = JSON.stringify(result);
    for (const secret of [ID, "user-1", "2026-11-01", "2026-11-30", "isActive"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("sin imagen, o sin storage configurado, la imagen es null y no ''", async () => {
    expect(
      (await toPublicPopup({ ...content, imagePath: null }, resolver)).image,
    ).toBeNull();
    expect((await toPublicPopup(content, () => "")).image).toBeNull();
  });

  it("sin boton, cta es null", async () => {
    const result = await toPublicPopup(
      { ...content, ctaLabel: null, ctaUrl: null },
      resolver,
    );
    expect(result.cta).toBeNull();
  });

  it("un link inseguro editado a mano en la base saca el boton, no el pop-up", async () => {
    const result = await toPublicPopup(
      { ...content, ctaUrl: "javascript:alert(1)" },
      resolver,
    );
    expect(result.cta).toBeNull();
    expect(result.title).toBe("Envíos gratis");
  });

  it("un texto de boton vacio tambien saca el boton", async () => {
    const result = await toPublicPopup({ ...content, ctaLabel: "  " }, resolver);
    expect(result.cta).toBeNull();
  });
});
