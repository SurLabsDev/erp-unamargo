# Import del catálogo de Unamargo — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cargar en el ERP los 34 SKU reales de Unamargo con precio, descripción, clasificación y fotos, tomados de la demo HTML del cliente.

**Architecture:** Las reglas de derivación (SKU, subtipo, descripción) viven como funciones puras en `src/lib/domain/`, testeadas sin base. Un paso de extracción convierte la demo en un JSON versionado que es la única fuente del import, para que correrlo sea reproducible y auditable. El runner lee ese JSON, corrige la taxonomía, sube las fotos y crea los productos, y es idempotente de punta a punta.

**Tech Stack:** Node + tsx · Drizzle ORM · Postgres · Supabase Storage por HTTP · Vitest

**Spec:** `docs/superpowers/specs/2026-08-20-import-catalogo-design.md`

## Global Constraints

- `npm run verify` (typecheck + lint + test + build) tiene que pasar **antes de cada commit**. Regla 7 del `AGENTS.md`.
- **Código, identificadores y comentarios en inglés.** Los mensajes de consola de los scripts van en español, siguiendo `scripts/seed.ts`.
- Commits en inglés, Conventional Commits.
- Sin dependencias nuevas.
- Plata SIEMPRE como string decimal. Jamás floats.
- SKU: mayúsculas, 1 a 40 caracteres, solo `A-Z 0-9 - _`, únicos.
- El import corre con `currentStock: 0` y `minStock: 0`. Con stock 0 NO se crea movimiento de ledger, y eso es lo que mantiene los SKU editables.
- **NUNCA** correr nada contra el `DATABASE_URL` de `.env`: apunta a la base productiva del cliente. Todo lo que sea prueba va contra un Postgres local en Docker con su propio `DATABASE_URL`.
- Las 4 categorías son: `Mates`, `Bombillas`, `Combos`, `Accesorios`.
- 34 SKU. Si el conteo da otra cosa, algo se rompió.

---

## Estructura de archivos

| Archivo                                                      | Responsabilidad                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `src/lib/domain/catalog-import.ts` (crear)                   | Derivación pura: SKU, subtipo, descripción. Sin base, sin fs.                  |
| `src/lib/domain/catalog-import.test.ts` (crear)              | Tests de las tres funciones.                                                   |
| `scripts/extract-demo-catalog.ts` (crear)                    | Lee el `index.html` de la demo y escribe el JSON versionado. Se corre una vez. |
| `scripts/data/catalogo-unamargo.json` (generado, versionado) | Las 34 entradas. Única fuente del import.                                      |
| `scripts/lib/storage-upload.ts` (crear)                      | Subida de un archivo al bucket desde Node.                                     |
| `scripts/import-catalogo.ts` (crear)                         | El runner: taxonomía, productos, fotos. Idempotente.                           |

---

### Task 1: Dominio — derivación de SKU, subtipo y descripción

**Files:**

- Create: `src/lib/domain/catalog-import.ts`
- Test: `src/lib/domain/catalog-import.test.ts`

**Interfaces:**

- Consumes: nada.
- Produces:
  - `type DemoCategory = "Mates" | "Bombillas" | "Combos" | "Accesorios"`
  - `type Spec = { label: string; value: string }`
  - `function buildSku(name: string, category: DemoCategory, variantLabel: string | null): string`
  - `function deriveSubtype(name: string, category: DemoCategory): string | null`
  - `function buildDescription(fullDesc: string, specs: Spec[]): string`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/lib/domain/catalog-import.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildDescription,
  buildSku,
  deriveSubtype,
  type DemoCategory,
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
```

- [ ] **Step 2: Correr el test y ver que falla**

Run: `npx vitest run src/lib/domain/catalog-import.test.ts`
Expected: FAIL, "Failed to resolve import ./catalog-import".

- [ ] **Step 3: Implementación mínima**

Crear `src/lib/domain/catalog-import.ts`:

```ts
// Derivation rules for the one-off import of the client's HTML demo into the
// ERP. Pure and testable without a database, like the rest of src/lib/domain.
//
// These run ONCE, but they are kept as tested functions rather than inlined in
// the script because they encode judgment calls (which word is the mate's
// shape, which prefix is redundant) that a reviewer has to be able to check.

export type DemoCategory = "Mates" | "Bombillas" | "Combos" | "Accesorios";
export type Spec = { label: string; value: string };

const CATEGORY_PREFIX: Record<DemoCategory, string> = {
  Mates: "MATE",
  Bombillas: "BOMB",
  Combos: "COMBO",
  Accesorios: "ACC",
};

/** Dropped from SKUs so no name approaches the 40-character limit. */
const STOP_WORDS = new Set([
  "DE",
  "DEL",
  "CON",
  "PARA",
  "Y",
  "LA",
  "EL",
  "LOS",
  "LAS",
  "UN",
  "UNA",
]);

/** Leading word already implied by the category prefix. */
const REDUNDANT_LEAD: Record<DemoCategory, string[]> = {
  Mates: ["MATE"],
  // "BOMBILLON" is deliberately NOT here: a bombillon is a larger bombilla,
  // and dropping the word would erase the distinction between the two.
  Bombillas: ["BOMBILLA"],
  Combos: ["COMBO"],
  Accesorios: [],
};

function words(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word !== "" && !STOP_WORDS.has(word));
}

export function buildSku(
  name: string,
  category: DemoCategory,
  variantLabel: string | null,
): string {
  let parts = words(name);
  const redundant = REDUNDANT_LEAD[category];
  // Only drop the redundant lead when something is left to identify the
  // product: a product literally named "Mate" must not collapse to "MATE".
  if (parts.length > 1 && redundant.includes(parts[0])) parts = parts.slice(1);
  if (variantLabel) parts = parts.concat(words(variantLabel));
  return [CATEGORY_PREFIX[category], ...parts].join("-");
}

/** Mate shapes, in the order they are searched for. */
const MATE_SHAPES = ["Ranchero", "Camionero", "Torpedo", "Imperial", "Porongo"];

export function deriveSubtype(
  name: string,
  category: DemoCategory,
): string | null {
  const lower = name.toLowerCase();

  if (category === "Mates") {
    return (
      MATE_SHAPES.find((shape) => lower.includes(shape.toLowerCase())) ?? null
    );
  }

  // Six bombillas: a second filter level would split five against one.
  if (category === "Bombillas") return null;

  if (category === "Accesorios") {
    if (lower.includes("matera")) return "Materas";
    if (lower.includes("yerbero")) return "Yerberos";
    if (lower.includes("posamate") || lower.includes("reposamate"))
      return "Posamates";
    if (lower.includes("secador")) return "Limpieza";
    return null;
  }

  if (lower.includes("porongo")) return "Con porongo";
  if (lower.includes("camionero")) return "Con camionero";
  if (lower.includes("galleta")) return "Con galleta";
  return null;
}

export function buildDescription(fullDesc: string, specs: Spec[]): string {
  const body = fullDesc.trim();
  if (specs.length === 0) return body;
  const lines = specs.map((spec) => `${spec.label}: ${spec.value}`).join("\n");
  return `${body}\n\n${lines}`;
}
```

- [ ] **Step 4: Correr el test y ver que pasa**

Run: `npx vitest run src/lib/domain/catalog-import.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Compuerta y commit**

```bash
npm run verify
git add src/lib/domain/catalog-import.ts src/lib/domain/catalog-import.test.ts
git commit -m "feat: derivation rules for the demo catalog import"
```

---

### Task 2: Extracción del catálogo a un JSON versionado

**Files:**

- Create: `scripts/extract-demo-catalog.ts`
- Create (generado): `scripts/data/catalogo-unamargo.json`

**Interfaces:**

- Consumes: `buildSku`, `deriveSubtype`, `buildDescription`, `DemoCategory` de Task 1.
- Produces: el archivo JSON con esta forma exacta, que Tasks 5 y 6 consumen:

```ts
type CatalogEntry = {
  sku: string;
  name: string;
  category: DemoCategory;
  subtype: string | null;
  price: string; // decimal string, dos decimales
  description: string;
  images: string[]; // rutas relativas al directorio de la demo
};
type CatalogFile = {
  generatedFrom: string;
  merges: Merge[];
  products: CatalogEntry[];
};
type Merge = { dropped: string; keptInFavourOf: string; reason: string };
```

- [ ] **Step 1: Escribir el extractor**

Crear `scripts/extract-demo-catalog.ts`. Lee el `index.html` de la demo,
localiza `const PRODUCTS = [`, recorta el array balanceando corchetes y lo
evalúa. Después aplica las tres fusiones del spec y expande las variantes.

Las fusiones van declaradas como datos, no como condicionales sueltos:

```ts
const MERGES = [
  {
    dropped: "Camionero Pulido",
    keptInFavourOf: "Mate Camionero",
    reason:
      "Mismas 2 fotos y precios identicos (Clasico $490 / Pulido $690): es el mismo mate cargado dos veces.",
  },
  {
    dropped: "Porongo Pulido",
    keptInFavourOf: "Porongo",
    reason:
      "Mismas 2 fotos. El precio del Clasico difiere ($450 vs $490): se toma el mayor, $490.",
    priceOverride: { variantLabel: "Clásico", price: 490 },
  },
  {
    dropped: "Combo Porongo Virola Chata + Posamate",
    keptInFavourOf: "Combo Porongo + Posamate",
    reason:
      "Foto compartida y mismo precio $990: ya existe como variante 'Virola Chata' del combo que se conserva.",
  },
];
```

El path de la demo se pasa por argumento, con un default:

```ts
const DEMO_DIR =
  process.argv[2] ??
  "/Users/coru/Desktop/Proyectos/surlabs-prod/web-unamargo/claude code unamargo";
```

Precio a string de dos decimales: `price.toFixed(2)`. Un producto con variantes
produce una entrada por variante, con el nombre `"<nombre> (<variante>)"` y la
imagen de la variante si la tiene, o la primera del producto si no.

- [ ] **Step 2: Correrlo y verificar el resultado**

```bash
npx tsx scripts/extract-demo-catalog.ts
```

Confirmar, leyendo la salida:

- **34** productos, ni uno más ni uno menos.
- **0** SKU duplicados.
- Largo máximo de SKU **36**.
- Todos los precios con dos decimales.
- Las 3 fusiones aplicadas y listadas.

Si el conteo no da 34, **parar y reportar** en vez de ajustar el número: significa que la demo cambió o que la extracción está mal.

- [ ] **Step 3: Verificar que las imágenes referenciadas existen**

Cada ruta de `images[]` tiene que existir en el disco. Contar cuántas son y
confirmar que ninguna falta. Reportar el total (esperado: 42 rutas únicas).

- [ ] **Step 4: Compuerta y commit**

```bash
npm run verify
git add scripts/extract-demo-catalog.ts scripts/data/catalogo-unamargo.json
git commit -m "feat: extract the client demo catalog into a versioned JSON"
```

---

### Task 3: Corrección de la taxonomía

**Files:**

- Create: `scripts/import-catalogo.ts` (primera parte; Tasks 5 y 6 lo completan)

**Interfaces:**

- Consumes: `productCategories`, `productSubtypes` del esquema; `slugify`, `uniqueSlug` de `@/lib/domain/slug`.
- Produces: `async function syncTaxonomy(db): Promise<void>` dentro del mismo archivo.

- [ ] **Step 1: Escribir la sincronización**

Estado deseado, declarado como datos:

```ts
const TAXONOMY: Array<{ category: string; subtypes: string[] }> = [
  {
    category: "Mates",
    subtypes: ["Ranchero", "Camionero", "Torpedo", "Imperial", "Porongo"],
  },
  { category: "Bombillas", subtypes: [] },
  {
    category: "Combos",
    subtypes: ["Con porongo", "Con camionero", "Con galleta"],
  },
  {
    category: "Accesorios",
    subtypes: ["Materas", "Yerberos", "Posamates", "Limpieza"],
  },
];

/** Categories seeded on 2026-08-19 from an inference that the client's own
 * demo contradicts: they sell no termos and no yerba, and they group materas
 * inside Accesorios. Deactivated, never deleted, so reactivating is trivial. */
const DEACTIVATE = ["Termo", "Yerba", "Matera"];
```

Reglas:

- Crear la categoría si no existe, con su slug por `slugify` + `uniqueSlug`.
- Crear cada subtipo faltante bajo su categoría.
- Reactivar la categoría o subtipo si existía desactivado.
- Desactivar las de `DEACTIVATE`, **sin borrarlas**.
- Los subtipos viejos de una categoría que no estén en la lista deseada se
  **desactivan**, no se borran.
- Idempotente: correrlo dos veces no cambia nada la segunda vez.

- [ ] **Step 2: Probar contra un Postgres local**

```bash
docker rm -f erp-import >/dev/null 2>&1
docker run -d --name erp-import -p 5439:5432 \
  -e POSTGRES_USER=surlabs -e POSTGRES_PASSWORD=surlabs -e POSTGRES_DB=surlabs_erp \
  postgres:18-alpine
sleep 5
export DATABASE_URL="postgres://surlabs:surlabs@localhost:5439/surlabs_erp"
npm run db:migrate
```

Sembrar primero la taxonomía vieja (las 6 categorías del 19/08) para reproducir
el estado real de producción, después correr la sincronización y comprobar:

- `Combos` existe y tiene 3 subtipos.
- `Termo`, `Yerba` y `Matera` quedan con `is_active = false` y **siguen existiendo**.
- `Mates` tiene las 5 formas activas y sus subtipos viejos de material desactivados.
- Correrla una segunda vez no cambia ningún conteo.

- [ ] **Step 3: Compuerta y commit**

```bash
npm run verify
git add scripts/import-catalogo.ts
git commit -m "feat: taxonomy sync for the catalog import"
```

---

### Task 4: Interfaz de línea de comandos del runner

**Files:**

- Modify: `scripts/import-catalogo.ts`

- [ ] **Step 1: Definir los argumentos**

El runner se invoca así, y ningún paso posterior debe inventar otra forma:

```
npx tsx scripts/import-catalogo.ts [--demo-dir <ruta>] [--path-prefix <prefijo>] [--dry-run]
```

- `--demo-dir`: directorio de la demo del cliente. Default el del spec.
- `--path-prefix`: prefijo para las rutas del bucket. Vacío por defecto; `_prueba/` en los ensayos.
- `--dry-run`: imprime lo que haría (taxonomía, productos, fotos) y **no escribe nada**, ni en la base ni en el bucket.

`--dry-run` no es un lujo: es lo que permite correrlo contra producción y leer
el plan antes de ejecutarlo de verdad.

Imprimir siempre, al terminar, un resumen: categorías tocadas, productos creados
y salteados, fotos subidas y salteadas.

- [ ] **Step 2: Compuerta y commit**

```bash
npm run verify
git add scripts/import-catalogo.ts
git commit -m "feat: command line interface for the catalog import runner"
```

---

### Task 5: Import de los productos

**Files:**

- Modify: `scripts/import-catalogo.ts`

**Interfaces:**

- Consumes: el JSON de Task 2; `syncTaxonomy` de Task 3; `products` del esquema; `slugify`/`uniqueSlug`.
- Produces: `async function importProducts(db, entries): Promise<{created: number; skipped: number}>`

- [ ] **Step 1: Escribir el import**

Por cada entrada del JSON:

- Si ya existe un producto con ese SKU, **saltearlo** y contarlo como `skipped`.
- Resolver `categoryId` por nombre y `subtypeId` por nombre dentro de esa categoría.
- Insertar con `currentStock: 0`, `minStock: 0`, `price` como string, la
  descripción, y un `slug` único generado del nombre.
- **No insertar ningún movimiento de stock.** Con stock 0 no corresponde, y es
  lo que mantiene el SKU editable.

Antes de empezar, verificar el tope de 150 SKU activos: 34 entran holgados, pero
si la base ya tuviera productos hay que fallar con un mensaje claro en vez de
chocar contra el límite a mitad de camino.

- [ ] **Step 2: Probar contra el Postgres local**

Con la base del paso anterior, correr el import y comprobar:

- 34 productos creados, 0 salteados.
- Todos con `current_stock = 0` y `min_stock = 0`.
- **0 filas en `stock_movements`.**
- Cada uno con su `category_id`; 27 con `subtype_id` y 7 sin.
- Todos con `slug` no nulo y único.
- Correrlo de nuevo: 0 creados, 34 salteados, y el total sigue siendo 34.

- [ ] **Step 3: Verificar el invariante de stock**

```bash
npm run db:check
```

Expected: pasa.

- [ ] **Step 4: Compuerta y commit**

```bash
npm run verify
git add scripts/import-catalogo.ts
git commit -m "feat: import the catalog products"
```

---

### Task 6: Subida de las fotos

**Files:**

- Create: `scripts/lib/storage-upload.ts`
- Modify: `scripts/import-catalogo.ts`

**Interfaces:**

- Consumes: `SUPABASE_URL` y `SUPABASE_SECRET_KEY` del entorno; `productImages` del esquema.
- Produces:
  - `async function uploadFile(input: { bucketPath: string; bytes: Buffer; contentType: string }): Promise<{ ok: true } | { ok: false; error: string }>`
  - `async function importImages(db, entries, demoDir, pathPrefix): Promise<{uploaded: number; skipped: number}>`

- [ ] **Step 1: Escribir la subida**

`scripts/lib/storage-upload.ts` sube un archivo por `POST` a
`${SUPABASE_URL}/storage/v1/object/productos/${bucketPath}` con la secret key en
`Authorization` y `apikey`. Sin `@supabase/supabase-js`: es una llamada HTTP y la
regla 6 pide no sumar dependencias. Mismo criterio que `src/lib/storage.ts`.

En `import-catalogo.ts`, por cada producto y cada una de sus imágenes:

1. **Primero** subir el archivo, con nombre `${prefix}${sku}/${randomUUID()}.jpg`.
2. **Después** insertar la fila en `product_images` con `sortOrder` según el orden del array.

Ese orden importa y no es intercambiable: si falla la subida, no queda una fila
apuntando a una foto que no está. Al revés dejaría la web mostrando una imagen
rota. Un archivo huérfano en el bucket es invisible y barato.

Si un producto ya tiene filas en `product_images`, saltearlo entero: eso es lo
que hace re-ejecutable el script sin duplicar fotos.

El `pathPrefix` permite mandar las pruebas a `_prueba/` y borrarlas después.

- [ ] **Step 2: Probar contra el bucket real con prefijo de prueba**

Con la base local y `pathPrefix = "_prueba/"`:

- Subir todas las imágenes y contar: esperado **42**.
- Comprobar que cada URL pública responde 200.
- Confirmar que cada producto tiene el mismo número de filas que rutas tenía.
- Correr de nuevo: 0 subidas, 34 salteados.

- [ ] **Step 3: Borrar las pruebas del bucket**

Listar el prefijo `_prueba/` y borrar todo. Confirmar que queda vacío. **Esto no
es opcional**: el bucket es el de producción.

- [ ] **Step 4: Compuerta y commit**

```bash
npm run verify
git add scripts/lib/storage-upload.ts scripts/import-catalogo.ts
git commit -m "feat: upload catalog product photos during the import"
```

---

### Task 7: Ensayo completo y documentación

**Files:**

- Modify: `README.md`, `AGENTS.md`, `DECISIONS.md`

- [ ] **Step 1: Ensayo de punta a punta**

Contra una base local **limpia** (contenedor nuevo, migraciones, sin seed demo),
correr el script entero una sola vez y verificar:

1. Taxonomía: 4 categorías activas, las 3 viejas desactivadas.
2. 34 productos, 0 movimientos de stock.
3. 42 imágenes subidas y vinculadas.
4. `npm run db:check` pasa.
5. Levantar `npm run dev` contra esa base y pedir la API pública: los 34 salen
   con precio, descripción, categoría y fotos, y **ningún id interno**.
6. Correr el script una segunda vez: no crea ni sube nada.

Borrar las imágenes de prueba del bucket y el contenedor.

- [ ] **Step 2: README**

Fila nueva en la tabla de scripts:

> `npm run catalogo:import` | Carga el catálogo inicial desde `scripts/data/catalogo-unamargo.json`: taxonomía, productos y fotos. Idempotente.

Y el script en `package.json`.

- [ ] **Step 3: AGENTS.md**

Agregar H7 al estado, con el dato que importa: el import corre con stock 0, no
crea movimientos, y por eso los SKU siguen editables hasta el primer conteo.

- [ ] **Step 4: DECISIONS.md**

Una línea por decisión: SKU legibles derivados del nombre; un SKU por variante;
taxonomía de la demo del cliente en vez de la inferida el 19/08, con Termo,
Yerba y Matera desactivadas; bombillas sin subtipo; las tres fusiones de
duplicados con su evidencia y el supuesto del precio del porongo; stock inicial
en 0 y su consecuencia.

- [ ] **Step 5: Compuerta y commit**

```bash
npm run verify
git add README.md AGENTS.md DECISIONS.md package.json
git commit -m "docs: document the catalog import"
```

---

## Verificación final

1. `npm run verify` verde.
2. El script corre dos veces seguidas sin duplicar nada.
3. 34 productos, 42 fotos, 0 movimientos de stock.
4. La API pública devuelve el catálogo completo sin ids internos.
5. Ninguna imagen de prueba quedó en el bucket de producción.
6. Los SKU siguen siendo editables, o sea que ningún producto tiene movimientos.
