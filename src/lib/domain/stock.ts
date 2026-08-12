import { z } from "zod";
import "@/lib/zod-locale";

// Business rules for the stock module as PURE functions/schemas (testable
// without DB). Server actions orchestrate transaction + this domain.

/** Contractual limit: 150 active SKUs per instance. */
export const MAX_ACTIVE_PRODUCTS = 150;

/** SKU: 1-40 chars, A-Z 0-9 - _, stored UPPERCASE, unique case-insensitive. */
export const skuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_-]{1,40}$/, {
    error:
      "El SKU admite 1 a 40 caracteres: letras, números, guion y guion bajo.",
  });

const nameSchema = z
  .string()
  .trim()
  .min(1, { error: "El nombre es obligatorio." })
  .max(120, { error: "El nombre admite hasta 120 caracteres." });

// z.coerce alone turns "" and null into 0: an absent field would silently
// become a valid value (e.g. an adjustment "counted" to 0). The preprocess
// collapses empty/null to undefined so missing input FAILS validation.
const requiredInt = (label: string, min: number, minError: string) =>
  z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.coerce
      .number({ error: `${label} es obligatorio.` })
      .int({ error: `${label} debe ser un número entero.` })
      .min(min, { error: minError }),
  );

const nonNegativeInt = (label: string) =>
  requiredInt(label, 0, `${label} no puede ser negativo.`);

const noteSchema = z
  .string()
  .trim()
  .max(500, { error: "La nota admite hasta 500 caracteres." });

export const productCreateSchema = z.object({
  sku: skuSchema,
  name: nameSchema,
  minStock: nonNegativeInt("El stock mínimo"),
  initialStock: nonNegativeInt("El stock inicial").default(0),
});

export const productUpdateSchema = z.object({
  // SKU is immutable once the product has movements (enforced in the action).
  sku: skuSchema.optional(),
  name: nameSchema,
  minStock: nonNegativeInt("El stock mínimo"),
});

/**
 * Movement input. UI types map to ledger rows as:
 *  - entrada → type 'in',  delta = +quantity
 *  - salida  → type 'out', delta = -quantity
 *  - ajuste  → type 'adjustment', the user enters the COUNTED stock and the
 *    system computes the delta; note is mandatory.
 */
export const movementInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("entrada"),
    productId: z.uuid(),
    quantity: requiredInt("La cantidad", 1, "La cantidad debe ser al menos 1."),
    note: noteSchema.optional(),
  }),
  z.object({
    type: z.literal("salida"),
    productId: z.uuid(),
    quantity: requiredInt("La cantidad", 1, "La cantidad debe ser al menos 1."),
    note: noteSchema.optional(),
  }),
  z.object({
    type: z.literal("ajuste"),
    productId: z.uuid(),
    countedStock: nonNegativeInt("El stock contado"),
    note: z
      .string({
        error: "El ajuste requiere una nota que explique el motivo.",
      })
      .trim()
      .min(1, { error: "El ajuste requiere una nota que explique el motivo." })
      .max(500, { error: "La nota admite hasta 500 caracteres." }),
  }),
]);

export type MovementInput = z.infer<typeof movementInputSchema>;

/** Adjustment semantics: user enters counted stock, system derives the delta. */
export function computeAdjustmentDelta(
  currentStock: number,
  countedStock: number,
): number {
  return countedStock - currentStock;
}

/**
 * Low-stock badge, computed LIVE (independent of the email alert state).
 * min_stock = 0 means "no alert control" for that product.
 */
export function isLowStock(product: {
  isActive: boolean;
  currentStock: number;
  minStock: number;
}): boolean {
  return (
    product.isActive &&
    product.minStock > 0 &&
    product.currentStock <= product.minStock
  );
}

export const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  in: "Entrada",
  out: "Salida",
  adjustment: "Ajuste",
  initial: "Inicial",
};
