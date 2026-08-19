# Descuentos por campaña — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el cliente arme campañas de descuento con vigencia, apuntadas a productos, subtipos o categorías, y que la web pública reciba el precio final junto al de lista.

**Architecture:** Dos tablas nuevas (`discount_campaigns`, `discount_targets`) donde la pertenencia a un solo objetivo la garantiza un `CHECK`. Toda la lógica de vigencia, precedencia y cálculo vive en funciones puras en `src/lib/domain/discounts.ts`, testeadas sin base. Las server actions solo orquestan transacción, dominio y revalidación, igual que el resto del repo.

**Tech Stack:** Next.js 16 App Router · Drizzle ORM · Postgres · Zod 4 · Vitest · Tailwind 4 + shadcn/ui

**Spec:** `docs/superpowers/specs/2026-08-19-descuentos-design.md`

## Global Constraints

- `npm run verify` (typecheck + lint + test + build) tiene que pasar **antes de cada commit**. Es la regla 7 del `AGENTS.md`.
- Commits en inglés, Conventional Commits. UI en español rioplatense (es-UY). Código, esquema y nombres de tabla en inglés.
- Sin dependencias nuevas. Si alguna pareciera necesaria, se para y se justifica en `DECISIONS.md`.
- Fechas SIEMPRE en `settings.timezone`, nunca UTC del servidor. Se usa `todayInTimeZone(timezone)` de `@/lib/format`, que devuelve `"YYYY-MM-DD"`.
- Plata SIEMPRE como string decimal y aritmética en centavos con `BigInt`. Jamás floats.
- Rol y datos se validan en el servidor en cada action. La UI solo oculta botones.
- Las server actions devuelven `ActionResult`, no códigos HTTP.
- Porcentaje permitido: **1 a 90** inclusive.
- Precedencia: **producto > subtipo > categoría**. Empate a misma especificidad: gana el porcentaje mayor.
- El campo `price` de la API pública conserva su significado (precio de lista). Los campos nuevos se agregan, no se resignifican.

---

## Estructura de archivos

| Archivo                                                     | Responsabilidad                                                                               |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/lib/domain/discounts.ts` (crear)                       | Estado de campaña, cálculo en centavos, resolución de precedencia. Puro, sin imports de base. |
| `src/lib/domain/discounts.test.ts` (crear)                  | Los 8 grupos de test del spec.                                                                |
| `src/lib/db/schema.ts` (modificar)                          | `discountCampaigns` y `discountTargets`.                                                      |
| `src/app/(app)/descuentos/queries.ts` (crear)               | Lecturas: lista de campañas, una campaña con objetivos, campañas vigentes para la API.        |
| `src/app/(app)/descuentos/actions.ts` (crear)               | Crear/editar/pausar campaña, agregar/quitar objetivos.                                        |
| `src/app/(app)/descuentos/page.tsx` (crear)                 | Lista de campañas.                                                                            |
| `src/app/(app)/descuentos/campaigns-manager.tsx` (crear)    | Cliente: alta y pausa.                                                                        |
| `src/app/(app)/descuentos/[id]/page.tsx` (crear)            | Detalle de campaña.                                                                           |
| `src/app/(app)/descuentos/[id]/targets-manager.tsx` (crear) | Cliente: objetivos.                                                                           |
| `src/components/app-header.tsx` (modificar)                 | Ítem de navegación, solo admin.                                                               |
| `src/app/api/public/v1/stock/route.ts` (modificar)          | `price_final` y `discount`.                                                                   |
| `src/app/(app)/stock/queries.ts` (modificar)                | Descuento vigente en catálogo y ficha.                                                        |
| `src/app/(app)/page.tsx` (modificar)                        | Aviso de campañas activas.                                                                    |

---

### Task 1: Dominio — estado de campaña y cálculo en centavos

**Files:**

- Create: `src/lib/domain/discounts.ts`
- Test: `src/lib/domain/discounts.test.ts`

**Interfaces:**

- Consumes: nada.
- Produces:
  - `type CampaignState = "paused" | "scheduled" | "ended" | "active"`
  - `type DiscountCampaign = { id: string; name: string; percentage: number; startsOn: string; endsOn: string; isActive: boolean }`
  - `function campaignState(campaign: DiscountCampaign, todayISO: string): CampaignState`
  - `function discountedPrice(price: string, percentage: number): string`
  - `const MIN_PERCENTAGE = 1`, `const MAX_PERCENTAGE = 90`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/lib/domain/discounts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  campaignState,
  discountedPrice,
  type DiscountCampaign,
} from "./discounts";

const base: DiscountCampaign = {
  id: "c1",
  name: "Día del Padre",
  percentage: 20,
  startsOn: "2026-08-10",
  endsOn: "2026-08-16",
  isActive: true,
};

describe("campaignState", () => {
  it("pausada gana sobre cualquier fecha", () => {
    expect(campaignState({ ...base, isActive: false }, "2026-08-12")).toBe(
      "paused",
    );
    expect(campaignState({ ...base, isActive: false }, "2026-09-01")).toBe(
      "paused",
    );
  });

  it("programada antes del inicio", () => {
    expect(campaignState(base, "2026-08-09")).toBe("scheduled");
  });

  it("terminada despues del fin", () => {
    expect(campaignState(base, "2026-08-17")).toBe("ended");
  });

  it("activa dentro del rango, incluidos los bordes", () => {
    expect(campaignState(base, "2026-08-10")).toBe("active");
    expect(campaignState(base, "2026-08-13")).toBe("active");
    expect(campaignState(base, "2026-08-16")).toBe("active");
  });

  it("una campana de un solo dia esta activa ese dia", () => {
    const unDia = { ...base, startsOn: "2026-08-15", endsOn: "2026-08-15" };
    expect(campaignState(unDia, "2026-08-15")).toBe("active");
    expect(campaignState(unDia, "2026-08-16")).toBe("ended");
  });
});

describe("discountedPrice", () => {
  it("caso exacto sin redondeo", () => {
    expect(discountedPrice("1250.50", 20)).toBe("1000.40");
  });

  it("redondea medio-arriba al centavo", () => {
    // 99999 * 15 / 100 = 14999.85 centavos -> 15000 -> 84999
    expect(discountedPrice("999.99", 15)).toBe("849.99");
  });

  it("no usa floats: 0.1 + 0.2 no puede filtrarse", () => {
    expect(discountedPrice("0.30", 10)).toBe("0.27");
  });

  it("un descuento del 90 por ciento deja el 10 por ciento", () => {
    expect(discountedPrice("100.00", 90)).toBe("10.00");
  });

  it("precio con un solo decimal se normaliza a dos", () => {
    expect(discountedPrice("10.5", 10)).toBe("9.45");
  });
});
```

- [ ] **Step 2: Correr el test y ver que falla**

Run: `npx vitest run src/lib/domain/discounts.test.ts`
Expected: FAIL, "Failed to resolve import ./discounts".

- [ ] **Step 3: Implementación mínima**

Crear `src/lib/domain/discounts.ts`:

```ts
// Reglas de descuentos como funciones puras: sin base, testeables solas.
// La aritmetica de plata va en centavos con BigInt, igual que el modulo Dinero
// (ver DECISIONS.md): un float redondea mal y aca el resultado es un precio.

export const MIN_PERCENTAGE = 1;
/** Un dedo de mas convierte 10 en 100 y regala el catalogo. Para regalar algo
 * se pone precio 0 a mano, que es una decision visible. */
export const MAX_PERCENTAGE = 90;

export type CampaignState = "paused" | "scheduled" | "ended" | "active";

export type DiscountCampaign = {
  id: string;
  name: string;
  percentage: number;
  startsOn: string; // "YYYY-MM-DD"
  endsOn: string; // "YYYY-MM-DD"
  isActive: boolean;
};

/**
 * Estado derivado, nunca almacenado. Las condiciones se evaluan EN ORDEN y gana
 * la primera: una campana pausada y ademas vencida muestra un solo estado.
 *
 * `todayISO` viene de `todayInTimeZone(settings.timezone)`, nunca del UTC del
 * servidor: con Montevideo en UTC-3 una campana que termina "hoy" se apagaria
 * tres horas antes de tiempo.
 */
export function campaignState(
  campaign: DiscountCampaign,
  todayISO: string,
): CampaignState {
  if (!campaign.isActive) return "paused";
  if (todayISO < campaign.startsOn) return "scheduled";
  if (todayISO > campaign.endsOn) return "ended";
  return "active";
}

/** Precio con el descuento aplicado, como string decimal de dos decimales. */
export function discountedPrice(price: string, percentage: number): string {
  const centavos = toCents(price);
  // Redondeo medio-arriba: 14999.85 centavos de descuento van a 15000.
  const descuento = (centavos * BigInt(percentage) * 2n + 100n) / 200n;
  return fromCents(centavos - descuento);
}

function toCents(price: string): bigint {
  const [enteros, decimales = ""] = price.split(".");
  return BigInt(enteros) * 100n + BigInt(decimales.padEnd(2, "0").slice(0, 2));
}

function fromCents(centavos: bigint): string {
  const entero = centavos / 100n;
  const resto = (centavos % 100n).toString().padStart(2, "0");
  return `${entero}.${resto}`;
}
```

- [ ] **Step 4: Correr el test y ver que pasa**

Run: `npx vitest run src/lib/domain/discounts.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Compuerta y commit**

```bash
npm run verify
git add src/lib/domain/discounts.ts src/lib/domain/discounts.test.ts
git commit -m "feat: campaign state and cents-based discount math"
```

---

### Task 2: Dominio — resolución de precedencia

**Files:**

- Modify: `src/lib/domain/discounts.ts`
- Test: `src/lib/domain/discounts.test.ts`

**Interfaces:**

- Consumes: `campaignState`, `discountedPrice`, `DiscountCampaign` de Task 1.
- Produces:
  - `type CampaignTargets = { productIds: string[]; subtypeIds: string[]; categoryIds: string[] }`
  - `type CampaignWithTargets = DiscountCampaign & { targets: CampaignTargets }`
  - `type ProductForDiscount = { price: string | null; categoryId: string | null; subtypeId: string | null }`
  - `type AppliedDiscount = { campaignId: string; campaignName: string; percentage: number; priceFinal: string }`
  - `function resolveDiscount(product: ProductForDiscount, campaigns: CampaignWithTargets[], todayISO: string): AppliedDiscount | null`

- [ ] **Step 1: Escribir el test que falla**

Agregar al final de `src/lib/domain/discounts.test.ts`:

```ts
import {
  resolveDiscount,
  type CampaignWithTargets,
  type ProductForDiscount,
} from "./discounts";

const HOY = "2026-08-12";

function campana(
  id: string,
  percentage: number,
  targets: Partial<CampaignWithTargets["targets"]>,
  extra: Partial<CampaignWithTargets> = {},
): CampaignWithTargets {
  return {
    id,
    name: `Campana ${id}`,
    percentage,
    startsOn: "2026-08-10",
    endsOn: "2026-08-16",
    isActive: true,
    targets: {
      productIds: targets.productIds ?? [],
      subtypeIds: targets.subtypeIds ?? [],
      categoryIds: targets.categoryIds ?? [],
    },
    ...extra,
  };
}

const producto: ProductForDiscount = {
  price: "1000.00",
  categoryId: "cat-mate",
  subtypeId: "sub-calabaza",
};

describe("resolveDiscount", () => {
  it("el producto le gana al subtipo y a la categoria", () => {
    const r = resolveDiscount(
      producto,
      [
        campana("cat", 50, { categoryIds: ["cat-mate"] }),
        campana("sub", 40, { subtypeIds: ["sub-calabaza"] }),
        campana("prod", 10, { productIds: ["p1"] }),
      ].map((c) =>
        c.id === "prod"
          ? { ...c, targets: { ...c.targets, productIds: ["p1"] } }
          : c,
      ),
      HOY,
    );
    // el producto de prueba se identifica por id en el llamador, ver Step 3
    expect(r?.percentage).toBe(10);
  });

  it("el subtipo le gana a la categoria", () => {
    const r = resolveDiscount(
      producto,
      [
        campana("cat", 50, { categoryIds: ["cat-mate"] }),
        campana("sub", 40, { subtypeIds: ["sub-calabaza"] }),
      ],
      HOY,
    );
    expect(r?.percentage).toBe(40);
  });

  it("a misma especificidad gana el porcentaje mayor", () => {
    const r = resolveDiscount(
      producto,
      [
        campana("a", 15, { categoryIds: ["cat-mate"] }),
        campana("b", 25, { categoryIds: ["cat-mate"] }),
      ],
      HOY,
    );
    expect(r?.percentage).toBe(25);
    expect(r?.campaignId).toBe("b");
  });

  it("una campana pausada no aplica aunque las fechas coincidan", () => {
    const r = resolveDiscount(
      producto,
      [campana("a", 25, { categoryIds: ["cat-mate"] }, { isActive: false })],
      HOY,
    );
    expect(r).toBeNull();
  });

  it("una campana terminada no aplica", () => {
    const r = resolveDiscount(
      producto,
      [campana("a", 25, { categoryIds: ["cat-mate"] })],
      "2026-08-17",
    );
    expect(r).toBeNull();
  });

  it("una campana programada todavia no aplica", () => {
    const r = resolveDiscount(
      producto,
      [campana("a", 25, { categoryIds: ["cat-mate"] })],
      "2026-08-09",
    );
    expect(r).toBeNull();
  });

  it("un producto sin precio no recibe descuento en ningun nivel", () => {
    const r = resolveDiscount(
      { ...producto, price: null },
      [campana("a", 25, { categoryIds: ["cat-mate"] })],
      HOY,
    );
    expect(r).toBeNull();
  });

  it("un producto sin clasificar solo recibe descuentos apuntados a el", () => {
    const sinClasificar: ProductForDiscount = {
      price: "1000.00",
      categoryId: null,
      subtypeId: null,
    };
    expect(
      resolveDiscount(
        sinClasificar,
        [campana("a", 25, { categoryIds: ["cat-mate"] })],
        HOY,
      ),
    ).toBeNull();
  });

  it("devuelve el precio final ya calculado", () => {
    const r = resolveDiscount(
      producto,
      [campana("a", 20, { categoryIds: ["cat-mate"] })],
      HOY,
    );
    expect(r?.priceFinal).toBe("800.00");
    expect(r?.campaignName).toBe("Campana a");
  });
});
```

> **Nota para el implementador:** el primer test necesita que el producto tenga
> `id`. Al escribir la implementación en el Step 3, agregá `id: string` a
> `ProductForDiscount` y corregí `producto` y `sinClasificar` para incluir
> `id: "p1"`. Después simplificá el primer test a la forma de los demás
> (tres campañas sin el `.map`).

- [ ] **Step 2: Correr el test y ver que falla**

Run: `npx vitest run src/lib/domain/discounts.test.ts`
Expected: FAIL, `resolveDiscount is not a function`.

- [ ] **Step 3: Implementación mínima**

Agregar a `src/lib/domain/discounts.ts`:

```ts
export type CampaignTargets = {
  productIds: string[];
  subtypeIds: string[];
  categoryIds: string[];
};

export type CampaignWithTargets = DiscountCampaign & {
  targets: CampaignTargets;
};

export type ProductForDiscount = {
  id: string;
  price: string | null;
  categoryId: string | null;
  subtypeId: string | null;
};

export type AppliedDiscount = {
  campaignId: string;
  campaignName: string;
  percentage: number;
  priceFinal: string;
};

/**
 * Campana ganadora para un producto: producto > subtipo > categoria.
 *
 * Si al producto lo apunta una campana DIRECTAMENTE, esa gana y las de
 * categoria ni se miran, aunque descuenten mas. Es lo que permite decir "todos
 * los mates 30%, pero el imperial solo 10%".
 *
 * A misma especificidad gana el porcentaje mayor: la precedencia sola no
 * resuelve el empate y hace falta una regla determinista.
 */
export function resolveDiscount(
  product: ProductForDiscount,
  campaigns: CampaignWithTargets[],
  todayISO: string,
): AppliedDiscount | null {
  if (product.price === null) return null;

  const vigentes = campaigns.filter(
    (c) => campaignState(c, todayISO) === "active",
  );

  const niveles: Array<(c: CampaignWithTargets) => boolean> = [
    (c) => c.targets.productIds.includes(product.id),
    (c) =>
      product.subtypeId !== null &&
      c.targets.subtypeIds.includes(product.subtypeId),
    (c) =>
      product.categoryId !== null &&
      c.targets.categoryIds.includes(product.categoryId),
  ];

  for (const alcanza of niveles) {
    const candidatas = vigentes.filter(alcanza);
    if (candidatas.length === 0) continue;
    const ganadora = candidatas.reduce((mejor, c) =>
      c.percentage > mejor.percentage ? c : mejor,
    );
    return {
      campaignId: ganadora.id,
      campaignName: ganadora.name,
      percentage: ganadora.percentage,
      priceFinal: discountedPrice(product.price, ganadora.percentage),
    };
  }
  return null;
}
```

- [ ] **Step 4: Correr el test y ver que pasa**

Run: `npx vitest run src/lib/domain/discounts.test.ts`
Expected: PASS, 19 tests.

- [ ] **Step 5: Compuerta y commit**

```bash
npm run verify
git add src/lib/domain/discounts.ts src/lib/domain/discounts.test.ts
git commit -m "feat: resolve discount precedence product over subtype over category"
```

---

### Task 3: Esquema y migración

**Files:**

- Modify: `src/lib/db/schema.ts`
- Create: `drizzle/0006_*.sql` (lo genera drizzle-kit)

**Interfaces:**

- Consumes: `products`, `productSubtypes`, `productCategories`, `users` del esquema existente.
- Produces: `discountCampaigns`, `discountTargets`, y los tipos `DiscountCampaignRow = typeof discountCampaigns.$inferSelect` y `DiscountTargetRow = typeof discountTargets.$inferSelect`.

- [ ] **Step 1: Agregar las tablas**

En `src/lib/db/schema.ts`, después de `productImages` y antes del ledger:

```ts
// Campanas de descuento. El descuento es informacion de EXHIBICION, igual que
// products.price: no toca stock ni el modulo Dinero.
export const discountCampaigns = pgTable(
  "discount_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    percentage: smallint("percentage").notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    // Interruptor manual, ademas de las fechas: permite pausar o preparar una
    // campana sin borrarla.
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "discount_campaigns_percentage_check",
      sql`${t.percentage} between 1 and 90`,
    ),
    check("discount_campaigns_dates_check", sql`${t.endsOn} >= ${t.startsOn}`),
  ],
);

// A que apunta una campana. Cada fila apunta a EXACTAMENTE un objetivo, y las
// tres columnas mantienen foraneas reales: un `target_id` polimorfico no
// podria tenerlas y dejaria objetivos apuntando a productos borrados.
export const discountTargets = pgTable(
  "discount_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => discountCampaigns.id),
    productId: uuid("product_id").references(() => products.id),
    subtypeId: uuid("subtype_id").references(() => productSubtypes.id),
    categoryId: uuid("category_id").references(() => productCategories.id),
  },
  (t) => [
    check(
      "discount_targets_exactly_one_check",
      sql`num_nonnulls(${t.productId}, ${t.subtypeId}, ${t.categoryId}) = 1`,
    ),
    index("discount_targets_campaign_idx").on(t.campaignId),
    // Unicos PARCIALES: un unique comun no impediria filas repetidas con nulo,
    // porque en Postgres los nulos no se comparan entre si.
    uniqueIndex("discount_targets_campaign_product_key")
      .on(t.campaignId, t.productId)
      .where(sql`${t.productId} is not null`),
    uniqueIndex("discount_targets_campaign_subtype_key")
      .on(t.campaignId, t.subtypeId)
      .where(sql`${t.subtypeId} is not null`),
    uniqueIndex("discount_targets_campaign_category_key")
      .on(t.campaignId, t.categoryId)
      .where(sql`${t.categoryId} is not null`),
  ],
);

export type DiscountCampaignRow = typeof discountCampaigns.$inferSelect;
export type DiscountTargetRow = typeof discountTargets.$inferSelect;
```

Agregar `uniqueIndex` al import de `drizzle-orm/pg-core` (ya están `check`, `date`, `index`, `smallint`, `sql`).

- [ ] **Step 2: Generar la migración**

Run: `npm run db:generate`
Expected: crea `drizzle/0006_<nombre>.sql`.

- [ ] **Step 3: Revisar el SQL generado**

Abrir el archivo y confirmar que contiene:

- `CHECK (num_nonnulls("product_id", "subtype_id", "category_id") = 1)`
- Los tres `CREATE UNIQUE INDEX ... WHERE ... is not null`
- `CHECK ("percentage" between 1 and 90)`

Si algún `CHECK` no aparece, el schema quedó mal escrito: corregirlo y regenerar. **No editar el SQL a mano**: se desincroniza del snapshot de drizzle.

- [ ] **Step 4: Aplicar y verificar la restricción contra una base real**

```bash
docker rm -f erp-plan >/dev/null 2>&1
docker run -d --name erp-plan -p 5433:5432 \
  -e POSTGRES_USER=surlabs -e POSTGRES_PASSWORD=surlabs -e POSTGRES_DB=surlabs_erp \
  postgres:18-alpine
sleep 5
DATABASE_URL="postgres://surlabs:surlabs@localhost:5433/surlabs_erp" npm run db:migrate
```

Después, contra esa base, comprobar que un objetivo con dos columnas cargadas es
rechazado y que uno con una sola es aceptado. Un `INSERT` con `product_id` y
`category_id` a la vez tiene que fallar con
`discount_targets_exactly_one_check`.

```bash
docker rm -f erp-plan
```

- [ ] **Step 5: Compuerta y commit**

```bash
npm run verify
git add src/lib/db/schema.ts drizzle/
git commit -m "feat: discount campaigns and targets schema"
```

---

### Task 4: Consultas y acciones de campañas

**Files:**

- Create: `src/app/(app)/descuentos/queries.ts`
- Create: `src/app/(app)/descuentos/actions.ts`

**Interfaces:**

- Consumes: `discountCampaigns`, `discountTargets` (Task 3); `campaignState`, `MIN_PERCENTAGE`, `MAX_PERCENTAGE`, `CampaignWithTargets` (Tasks 1-2).
- Produces:
  - `type CampaignListRow = { id: string; name: string; percentage: number; startsOn: string; endsOn: string; isActive: boolean; state: CampaignState; targetCount: number }`
  - `async function listCampaigns(todayISO: string): Promise<CampaignListRow[]>`
  - `async function getCampaign(id: string): Promise<CampaignDetail | undefined>`
  - `async function listCampaignsWithTargets(): Promise<CampaignWithTargets[]>`
  - `async function countActiveCampaigns(todayISO: string): Promise<number>`
  - actions: `createCampaignAction`, `updateCampaignAction`, `setCampaignActiveAction`, `addTargetAction`, `removeTargetAction`

- [ ] **Step 1: Escribir las consultas**

`src/app/(app)/descuentos/queries.ts`. `listCampaignsWithTargets` es la que
consume la API pública: trae todas las campañas con sus objetivos agrupados en
arrays, y el filtro de vigencia lo hace `resolveDiscount` en memoria. Trae
también las pausadas y vencidas a propósito: son pocas decenas de filas y filtrar
en SQL duplicaría la regla de vigencia que ya está testeada en el dominio.

`countActiveCampaigns` cuenta las que `campaignState` devuelve `"active"`.

- [ ] **Step 2: Escribir las acciones**

`src/app/(app)/descuentos/actions.ts`, todas con `await requireRole("admin")` y
devolviendo `ActionResult`. Validación con Zod:

```ts
const campaignSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { error: "El nombre es obligatorio." })
      .max(80, { error: "El nombre admite hasta 80 caracteres." }),
    percentage: z.coerce
      .number()
      .int()
      .min(MIN_PERCENTAGE, {
        error: `El descuento va de ${MIN_PERCENTAGE}% a ${MAX_PERCENTAGE}%.`,
      })
      .max(MAX_PERCENTAGE, {
        error: `El descuento va de ${MIN_PERCENTAGE}% a ${MAX_PERCENTAGE}%.`,
      }),
    startsOn: z
      .string()
      .refine(isValidISODate, { error: "La fecha de inicio no es válida." }),
    endsOn: z
      .string()
      .refine(isValidISODate, { error: "La fecha de fin no es válida." }),
  })
  .refine((v) => v.endsOn >= v.startsOn, {
    error: "La fecha de fin no puede ser anterior a la de inicio.",
  });
```

`addTargetAction` recibe `campaignId` y **exactamente uno** de `productId`,
`subtypeId` o `categoryId`; si viene más de uno o ninguno, devuelve
`{ ok: false, error: "Elegí un solo objetivo." }` sin tocar la base. El `CHECK`
de la base es la red, no la validación primaria.

Las campañas **no se borran**: `setCampaignActiveAction` pausa y reactiva.

Todas revalidan `/descuentos`, `/stock` y `/`.

- [ ] **Step 3: Compuerta**

Run: `npm run verify`
Expected: verde. Todavía no hay pantalla, así que nada las llama.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/descuentos/"
git commit -m "feat: discount campaign queries and server actions"
```

---

### Task 5: Pantalla de campañas

**Files:**

- Create: `src/app/(app)/descuentos/page.tsx`
- Create: `src/app/(app)/descuentos/campaigns-manager.tsx`
- Modify: `src/components/app-header.tsx`

**Interfaces:**

- Consumes: `listCampaigns`, `createCampaignAction`, `setCampaignActiveAction` (Task 4); `requireAdminPage` de `@/lib/auth-helpers`; `todayInTimeZone` y `getSettings`.
- Produces: la ruta `/descuentos`.

- [ ] **Step 1: Página servidor**

`page.tsx` con `export const metadata = { title: "Descuentos" }`, llamando a
`requireAdminPage()` (un operador va a `/`), `getSettings()` para la zona horaria
y `listCampaigns(todayInTimeZone(settings.timezone))`.

- [ ] **Step 2: Componente cliente**

Lista con nombre, porcentaje, período, estado y cantidad de objetivos. El estado
va como `Badge`: Activa en `default`, el resto en `secondary`. Cada fila enlaza a
`/descuentos/<id>`. Formulario de alta con nombre, porcentaje y las dos fechas.
Botón Pausar/Reactivar por fila.

Estado vacío: _"Todavía no hay campañas. Creá la primera abajo y después elegí a
qué productos o categorías aplica."_

- [ ] **Step 3: Ítem de navegación**

En `src/components/app-header.tsx`, agregar `{ href: "/descuentos", label: "Descuentos" }`
**solo para admin**, siguiendo exactamente el patrón con el que ya se ocultan
Importar y Configuración.

- [ ] **Step 4: Verificar en un browser real**

Con `npm run dev` contra un Postgres local sembrado (`npm run db:seed -- --demo`),
entrar como admin, crear una campaña con fechas que la dejen activa, y confirmar:
el badge dice Activa, aparece en la lista, y **con un usuario operador la sección
no está en la barra y entrar a `/descuentos` a mano redirige a `/`**.

- [ ] **Step 5: Compuerta y commit**

```bash
npm run verify
git add "src/app/(app)/descuentos/" src/components/app-header.tsx
git commit -m "feat: discount campaigns screen"
```

---

### Task 6: Objetivos de la campaña

**Files:**

- Create: `src/app/(app)/descuentos/[id]/page.tsx`
- Create: `src/app/(app)/descuentos/[id]/targets-manager.tsx`

**Interfaces:**

- Consumes: `getCampaign`, `addTargetAction`, `removeTargetAction`, `updateCampaignAction` (Task 4); `listClassificationOptions` de `@/app/(app)/stock/queries`; `listCatalog` para el selector de productos.
- Produces: la ruta `/descuentos/[id]`.

- [ ] **Step 1: Página servidor**

Valida que el `id` sea uuid (`notFound()` si no), trae la campaña con objetivos y
las opciones de clasificación y de productos.

- [ ] **Step 2: Componente cliente**

Tres selectores separados (Categoría, Subtipo, Producto), cada uno con su botón
Agregar. Lista de objetivos agrupada por nivel, con el nombre resuelto y un botón
Quitar por fila. Cada objetivo indica su nivel, porque un mismo nombre puede ser
subtipo de dos categorías.

Aviso permanente arriba: _"Si un producto queda alcanzado por más de una campaña,
gana la regla más puntual: producto, después subtipo, después categoría."_ Es lo
que evita el reclamo de _"cargué 10% y la web muestra otra cosa"_.

- [ ] **Step 3: Verificar en un browser real**

Agregar una categoría como objetivo, después el mismo subtipo, y confirmar que
agregar dos veces el mismo objetivo es rechazado (índice único parcial) con
mensaje en español y no con un error de base.

- [ ] **Step 4: Compuerta y commit**

```bash
npm run verify
git add "src/app/(app)/descuentos/"
git commit -m "feat: discount campaign targets"
```

---

### Task 7: API pública

**Files:**

- Modify: `src/app/api/public/v1/stock/route.ts`

**Interfaces:**

- Consumes: `listCampaignsWithTargets` (Task 4), `resolveDiscount` (Task 2), `getSettings`, `todayInTimeZone`.
- Produces: los campos `price_final` y `discount` en cada item.

- [ ] **Step 1: Modificar la ruta**

Traer las campañas junto con los productos, y por cada item llamar a
`resolveDiscount({ id, price, categoryId, subtypeId }, campanas, hoy)`.

```ts
const descuento = resolveDiscount(
  { id: row.id, price: row.price, categoryId: row.categoryId, subtypeId: row.subtypeId },
  campanas,
  hoy,
);
// ...
price: row.price,
price_final: descuento ? descuento.priceFinal : row.price,
discount: descuento
  ? { percentage: descuento.percentage, campaign: descuento.campaignName }
  : null,
```

La consulta de productos tiene que sumar `products.id`, `products.categoryId` y
`products.subtypeId` al `select`, que hoy no los trae. **`id`, `categoryId` y
`subtypeId` NO se exponen en la respuesta**: son ids internos y la regla de la
ruta es no publicarlos.

`price_final` es `null` cuando `price` es `null`.

- [ ] **Step 2: Verificar el contrato**

Con el server local y una campaña activa apuntada a una categoría:

```bash
curl -s http://localhost:3000/api/public/v1/stock | python3 -m json.tool
```

Confirmar: `price` sin cambios, `price_final` con el descuento, `discount` con
porcentaje y nombre, y que **ningún item expone `id`, `category_id` ni
`subtype_id`**. Confirmar también que un producto fuera de la campaña trae
`discount: null` y `price_final == price`.

- [ ] **Step 3: Compuerta y commit**

```bash
npm run verify
git add src/app/api/public/v1/stock/route.ts
git commit -m "feat: expose discounted price in the public catalog API"
```

---

### Task 8: Descuento visible dentro del ERP

**Files:**

- Modify: `src/app/(app)/stock/queries.ts`
- Modify: `src/app/(app)/stock/[id]/product-content.tsx`
- Modify: `src/app/(app)/page.tsx`

**Interfaces:**

- Consumes: `listCampaignsWithTargets` (Task 4), `resolveDiscount` (Task 2), `countActiveCampaigns` (Task 4).
- Produces: `CatalogRow` gana el campo opcional `discount?: AppliedDiscount | null`.

- [ ] **Step 1: Descuento en catálogo y ficha**

`listCatalog` y `getCatalogProduct` resuelven el descuento de cada fila. En la
ficha, debajo del campo de precio, mostrar cuando hay descuento:

> Precio con descuento vigente: **$1.000,40** por la campaña "Día del Padre 2026" (20%).

Sin esto, alguien que carga 10% a un producto dentro de una categoría con 30% no
entiende por qué la web muestra otro número. Es el motivo por el que se eligió
"gana el más específico" y no "gana el mayor".

- [ ] **Step 2: Aviso en el panel**

En `src/app/(app)/page.tsx`, si `countActiveCampaigns(hoy) > 0`, mostrar un aviso
enlazado a `/descuentos`: _"2 campañas de descuento activas."_ Es la red contra la
campaña olvidada.

- [ ] **Step 3: Verificar en un browser real**

Crear dos campañas solapadas, una a la categoría con 30% y otra al producto con
10%, y confirmar que la ficha del producto muestra **10%** y nombra la campaña de
producto. Ese es el caso que el spec eligió y el que hay que ver funcionando.

- [ ] **Step 4: Compuerta y commit**

```bash
npm run verify
git add "src/app/(app)/"
git commit -m "feat: surface active discounts in stock and panel"
```

---

### Task 9: Documentación

**Files:**

- Modify: `README.md`, `AGENTS.md`, `DECISIONS.md`

- [ ] **Step 1: README**

Fila nueva en la tabla de módulos:

> **Descuentos** | Campañas con vigencia por fechas más interruptor, aplicables a productos, subtipos o categorías. Gana la regla más puntual. Solo porcentaje.

- [ ] **Step 2: AGENTS.md**

Agregar H6 al estado, y `src/app/(app)/descuentos` al mapa.

- [ ] **Step 3: DECISIONS.md**

Una línea por decisión: precedencia producto > subtipo > categoría con el motivo;
empate resuelto por porcentaje mayor; tope de 90%; objetivos con tres columnas
nullable y `CHECK num_nonnulls` en vez de polimórfico; índices únicos parciales
por el comportamiento de los nulos en Postgres; `price` de la API conserva su
significado.

- [ ] **Step 4: Compuerta y commit**

```bash
npm run verify
git add README.md AGENTS.md DECISIONS.md
git commit -m "docs: document discount campaigns"
```

---

## Verificación final

Antes de dar el plan por terminado, contra un Postgres local con datos demo:

1. `npm run verify` verde.
2. Campaña activa a categoría: la ficha y la API muestran el descuento.
3. Campaña a producto solapada con una de categoría: gana la de producto.
4. Campaña pausada: desaparece de la API al instante (salvo los 60s de cache).
5. Campaña con fecha de fin de ayer: no aplica.
6. Producto sin precio dentro de una campaña: `discount: null`, `price_final: null`.
7. Un operador no ve la sección ni puede entrar por URL.
