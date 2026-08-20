import { describe, expect, it } from "vitest";
import {
  buildDescription,
  buildSku,
  deriveSubtype,
} from "./catalog-import";

describe("buildSku", () => {
  it("prefija por categoria y saca preposiciones", () => {
    expect(buildSku("Mate Ranchero de Algarrobo", "Mates", null)).toBe(
      "MATE-RANCHERO-ALGARROBO",
    );
    expect(buildSku("Secador para Mate y Bombilla", "Accesorios", null)).toBe(
      "ACC-SECADOR-MATE-BOMBILLA",
    );
  });

  it("agrega la variante al final", () => {
    expect(buildSku("Mate Camionero", "Mates", "Clásico")).toBe(
      "MATE-CAMIONERO-CLASICO",
    );
    expect(buildSku("Mate Camionero", "Mates", "Pulido")).toBe(
      "MATE-CAMIONERO-PULIDO",
    );
  });

  it("saca la palabra redundante con el prefijo", () => {
    // "Mate Camionero" no debe dar MATE-MATE-CAMIONERO
    expect(buildSku("Mate Camionero", "Mates", null)).toBe("MATE-CAMIONERO");
    expect(buildSku("Bombilla con Apliques", "Bombillas", null)).toBe(
      "BOMB-APLIQUES",
    );
  });

  it("NO saca la palabra redundante si es lo unico que queda", () => {
    // un producto llamado solo "Mate" debe dar MATE-MATE, no MATE
    expect(buildSku("Mate", "Mates", null)).toBe("MATE-MATE");
  });

  it("saca acentos y enies", () => {
    expect(buildSku("Bombillón con Diseño", "Bombillas", null)).toBe(
      "BOMB-BOMBILLON-DISENO",
    );
    expect(buildSku("Camionero Virola", "Mates", "Marrón")).toBe(
      "MATE-CAMIONERO-VIROLA-MARRON",
    );
  });

  it("produce solo caracteres validos y no pasa de 40", () => {
    const sku = buildSku(
      "Matera Cuero Crudo Cocida con Tiento",
      "Accesorios",
      null,
    );
    expect(sku).toBe("ACC-MATERA-CUERO-CRUDO-COCIDA-TIENTO");
    expect(sku.length).toBeLessThanOrEqual(40);
    expect(sku).toMatch(/^[A-Z0-9_-]+$/);
  });

  it("colapsa el signo + de los combos", () => {
    expect(buildSku("Combo Porongo + Posamate", "Combos", "Pulido")).toBe(
      "COMBO-PORONGO-POSAMATE-PULIDO",
    );
  });
});

describe("deriveSubtype", () => {
  it("mates: la forma del mate", () => {
    expect(deriveSubtype("Mate Ranchero de Algarrobo", "Mates")).toBe(
      "Ranchero",
    );
    expect(deriveSubtype("Imperial Zebra", "Mates")).toBe("Imperial");
    expect(deriveSubtype("Torpedo Virola Simple", "Mates")).toBe("Torpedo");
    expect(deriveSubtype("Porongo Virola Chata", "Mates")).toBe("Porongo");
  });

  it("mates: null cuando el nombre no dice la forma", () => {
    // "Algarrobo Oscuro" nombra el material, no la forma
    expect(deriveSubtype("Algarrobo Oscuro", "Mates")).toBeNull();
  });

  it("bombillas: siempre null, son seis y un segundo filtro no separa nada", () => {
    expect(deriveSubtype("Bombillón Dorado", "Bombillas")).toBeNull();
    expect(deriveSubtype("Bombilla con Apliques", "Bombillas")).toBeNull();
  });

  it("accesorios: agrupacion natural", () => {
    expect(deriveSubtype("Matera Dividida", "Accesorios")).toBe("Materas");
    expect(deriveSubtype("Yerbero Un Amargo", "Accesorios")).toBe("Yerberos");
    expect(deriveSubtype("Base Reposamate", "Accesorios")).toBe("Posamates");
    expect(deriveSubtype("Secador para Mate y Bombilla", "Accesorios")).toBe(
      "Limpieza",
    );
  });

  it("combos: por lo que traen adentro", () => {
    expect(deriveSubtype("Combo Porongo + Posamate", "Combos")).toBe(
      "Con porongo",
    );
    expect(deriveSubtype("Combo Camionero + Posamate", "Combos")).toBe(
      "Con camionero",
    );
    expect(deriveSubtype("Combo Galleta", "Combos")).toBe("Con galleta");
  });
});

describe("buildDescription", () => {
  it("anexa las specs como lineas legibles", () => {
    const out = buildDescription("Un mate de prueba.", [
      { label: "Material", value: "Algarrobo" },
      { label: "Cuidados", value: "Secar boca abajo" },
    ]);
    expect(out).toBe(
      "Un mate de prueba.\n\nMaterial: Algarrobo\nCuidados: Secar boca abajo",
    );
  });

  it("sin specs devuelve la descripcion tal cual", () => {
    expect(buildDescription("Solo texto.", [])).toBe("Solo texto.");
  });

  it("recorta espacios sobrantes", () => {
    expect(buildDescription("  Texto.  ", [])).toBe("Texto.");
  });
});
