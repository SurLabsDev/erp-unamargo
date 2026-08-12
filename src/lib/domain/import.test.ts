import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_IMPORT_ROWS,
  PRODUCTS_CSV_TEMPLATE,
  parseProductsCsv,
} from "./import";

describe("PRODUCTS_CSV_TEMPLATE", () => {
  it("matches the versioned template file byte for byte (single source of truth)", () => {
    const file = readFileSync(
      path.resolve("templates/plantilla-productos.csv"),
      "utf8",
    );
    expect(file).toBe(PRODUCTS_CSV_TEMPLATE);
  });

  it("parses cleanly with zero rejections", () => {
    const result = parseProductsCsv(PRODUCTS_CSV_TEMPLATE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows).toHaveLength(3);
      expect(result.rejected).toHaveLength(0);
      expect(result.rows[0]).toMatchObject({
        sku: "MATE-IMP-CUE",
        stock: 10,
        minStock: 3,
      });
    }
  });
});

describe("parseProductsCsv", () => {
  it("autodetects ';' separator and tolerates BOM + accented header", () => {
    const csv = "\uFEFF" + "SKU;Nombre;Stock;Mínimo\r\nmate-1;Mate uno;5;2\r\n";
    const result = parseProductsCsv(csv);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows).toEqual([
        { line: 2, sku: "MATE-1", name: "Mate uno", stock: 5, minStock: 2 },
      ]);
    }
  });

  it("supports quoted fields containing the separator", () => {
    const csv = 'sku,nombre,stock,minimo\n"MATE-2","Mate, edición especial",3,1\n';
    const result = parseProductsCsv(csv);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows[0].name).toBe("Mate, edición especial");
    }
  });

  it("rejects rows individually without aborting the file", () => {
    const csv = [
      "sku,nombre,stock,minimo",
      "MATE-OK,Mate válido,5,2",
      ",Sin sku,1,1",
      "MATE-OK,Duplicado en archivo,2,1",
      "MATE-NEG,Stock negativo,-3,1",
      "MATE-DEC,Stock con decimales,2.5,1",
      "MATE-SIN-NOMBRE,,4,1",
      "MATE-INT4,Stock que desborda int4,3000000000,1",
    ].join("\n");
    const result = parseProductsCsv(csv);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows.map((r) => r.sku)).toEqual(["MATE-OK"]);
      expect(result.rejected).toHaveLength(6);
      expect(result.rejected.map((r) => r.line)).toEqual([3, 4, 5, 6, 7, 8]);
      expect(result.rejected[1].reason).toContain("duplicado");
      expect(result.rejected[5].reason).toContain("1.000.000");
    }
  });

  it("rejects the whole file on wrong header, empty file or > 150 rows", () => {
    expect(parseProductsCsv("").ok).toBe(false);
    expect(parseProductsCsv("codigo,descripcion\nx,y").ok).toBe(false);

    const tooMany = [
      "sku,nombre,stock,minimo",
      ...Array.from(
        { length: MAX_IMPORT_ROWS + 1 },
        (_, i) => `SKU-${i},Producto ${i},1,0`,
      ),
    ].join("\n");
    const result = parseProductsCsv(tooMany);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fileError).toContain("151");
  });
});
