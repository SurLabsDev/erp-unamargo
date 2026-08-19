import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Reference DDL lives in PROMPT_ERP.md §4. Structure and constraints are
// contractual: do not weaken CHECKs or drop columns without a DECISIONS entry.
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(), // normalized to lowercase in app
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(), // bcrypt
    role: text("role").$type<"admin" | "operator">().notNull(),
    isActive: boolean("is_active").notNull().default(true),
    // Vendor support account (Surlabs). It is a normal 'admin' for every
    // permission check -- deliberately NOT a third role, so requireRole() and
    // the CHECK constraint stay untouched. The flag only controls that the
    // account is invisible to the client and uncounted: hidden from the users
    // list, excluded from the 5-active-users cap, excluded from the
    // last-admin rule (so the client always keeps a real admin of their own),
    // and barred from authoring ledger entries -- a movement would stamp the
    // account's name into an append-only history forever.
    isSupport: boolean("is_support").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [check("users_role_check", sql`${t.role} in ('admin','operator')`)],
);

// Exactly ONE row per instance (id = 1).
export const settings = pgTable(
  "settings",
  {
    id: smallint("id").primaryKey().default(1),
    companyName: text("company_name").notNull(),
    currencyCode: text("currency_code").notNull().default("UYU"),
    timezone: text("timezone").notNull().default("America/Montevideo"),
    alertRecipients: text("alert_recipients")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    initialBalance: numeric("initial_balance", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    initialBalanceDate: date("initial_balance_date").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("settings_single_row_check", sql`${t.id} = 1`),
    check(
      "settings_alert_recipients_check",
      sql`cardinality(${t.alertRecipients}) <= 3`,
    ),
  ],
);

// --- Taxonomia del catalogo -------------------------------------------------
// Dos niveles: categoria (que es) -> subtipo (de que variante). Los subtipos
// CUELGAN de una categoria: "De metal" existe una vez bajo Bombilla y otra
// bajo Mate, y eso es correcto, porque el cliente los elige de un selector ya
// filtrado por la categoria y nunca ve la ambiguedad.
//
// Ambas son listas cerradas que administra un admin desde Configuracion, igual
// que cash_categories. Nunca texto libre.

export const productCategories = pgTable("product_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(), // "Mate"
  slug: text("slug").notNull().unique(), // "mate" -> URL de la web del cliente
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
});

export const productSubtypes = pgTable(
  "product_subtypes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => productCategories.id),
    name: text("name").notNull(), // "De calabaza"
    slug: text("slug").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [
    // Unicos POR CATEGORIA, no globales: "De metal" tiene que poder existir
    // bajo Bombilla y bajo Mate al mismo tiempo.
    unique("product_subtypes_category_name_key").on(t.categoryId, t.name),
    unique("product_subtypes_category_slug_key").on(t.categoryId, t.slug),
    // Sirve de destino a la clave foranea compuesta de products (ver abajo).
    unique("product_subtypes_id_category_key").on(t.id, t.categoryId),
  ],
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sku: text("sku").notNull().unique(), // UPPERCASE, 1-40 chars, A-Z 0-9 - _
    name: text("name").notNull(), // <= 120 chars (validated in app)
    isActive: boolean("is_active").notNull().default(true),
    currentStock: integer("current_stock").notNull().default(0),
    minStock: integer("min_stock").notNull().default(0), // 0 = alerts disabled
    // Nullable a proposito: la importacion por CSV solo trae
    // sku/nombre/stock/minimo, asi que un producto importado nace sin
    // clasificar. La UI del ERP empuja a completarlo; la web filtra los que no
    // tienen categoria en vez de inventarles una.
    categoryId: uuid("category_id").references(() => productCategories.id),
    subtypeId: uuid("subtype_id"),
    lowStockAlertedAt: timestamp("low_stock_alerted_at", {
      withTimezone: true,
    }), // alert cycle state (PROMPT_ERP.md §8)
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("products_current_stock_check", sql`${t.currentStock} >= 0`),
    check("products_min_stock_check", sql`${t.minStock} >= 0`),
    // El subtipo TIENE que pertenecer a la categoria del producto, y eso lo
    // garantiza la base, no la app: sin esto, una request armada a mano podria
    // ponerle "De calabaza" (subtipo de Mate) a una bombilla, y el filtro de la
    // web mostraria un disparate. Con MATCH SIMPLE, si subtype_id es NULL la
    // restriccion no se evalua, que es justo lo que queremos porque el subtipo
    // es opcional.
    foreignKey({
      columns: [t.subtypeId, t.categoryId],
      foreignColumns: [productSubtypes.id, productSubtypes.categoryId],
      name: "products_subtype_belongs_to_category_fk",
    }),
  ],
);

// APPEND-ONLY ledger: never UPDATE nor DELETE rows here.
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: bigint("id", { mode: "number" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    type: text("type")
      .$type<"in" | "out" | "adjustment" | "initial">()
      .notNull(),
    delta: integer("delta").notNull(), // signed
    resultingStock: integer("resulting_stock").notNull(),
    note: text("note"), // required in app when type = 'adjustment'
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "stock_movements_type_check",
      sql`${t.type} in ('in','out','adjustment','initial')`,
    ),
    check("stock_movements_delta_check", sql`${t.delta} <> 0`),
    check(
      "stock_movements_resulting_stock_check",
      sql`${t.resultingStock} >= 0`,
    ),
    check(
      "stock_movements_type_delta_check",
      sql`(${t.type} in ('in','initial') and ${t.delta} > 0) or (${t.type} = 'out' and ${t.delta} < 0) or (${t.type} = 'adjustment')`,
    ),
    index("stock_movements_product_idx").on(t.productId, t.createdAt.desc()),
  ],
);

export const cashCategories = pgTable(
  "cash_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    kind: text("kind").$type<"income" | "expense">().notNull(),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [
    check("cash_categories_kind_check", sql`${t.kind} in ('income','expense')`),
  ],
);

// Rows are never edited nor deleted: corrections happen via soft-void
// (voided_at/by/reason, admin only) + re-entry.
export const cashMovements = pgTable(
  "cash_movements",
  {
    id: bigint("id", { mode: "number" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    date: date("date").notNull(), // operative date: not future, not before initial_balance_date
    kind: text("kind").$type<"income" | "expense">().notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => cashCategories.id),
    concept: text("concept").notNull(), // <= 200 chars (validated in app)
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: uuid("voided_by").references(() => users.id),
    voidReason: text("void_reason"),
  },
  (t) => [
    check("cash_movements_kind_check", sql`${t.kind} in ('income','expense')`),
    check("cash_movements_amount_check", sql`${t.amount} > 0`),
    index("cash_movements_date_idx")
      .on(t.date)
      .where(sql`${t.voidedAt} is null`),
  ],
);

// Audit log for "one email per stockout event". Outbox pattern: the row is
// inserted as 'pending' in the SAME transaction as the alert claim, and the
// post-commit delivery updates it to sent/failed/skipped — a crash between
// commit and delivery leaves auditable evidence instead of silence.
export const alertEvents = pgTable(
  "alert_events",
  {
    id: bigint("id", { mode: "number" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    stockAtTrigger: integer("stock_at_trigger").notNull(),
    minStockAtTrigger: integer("min_stock_at_trigger").notNull(),
    recipients: text("recipients").array().notNull(),
    status: text("status")
      .$type<"pending" | "sent" | "failed" | "skipped">()
      .notNull(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "alert_events_status_check",
      sql`${t.status} in ('pending','sent','failed','skipped')`,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type Settings = typeof settings.$inferSelect;
export type ProductCategory = typeof productCategories.$inferSelect;
export type ProductSubtype = typeof productSubtypes.$inferSelect;
export type Product = typeof products.$inferSelect;
export type StockMovement = typeof stockMovements.$inferSelect;
export type CashCategory = typeof cashCategories.$inferSelect;
export type CashMovement = typeof cashMovements.$inferSelect;
export type AlertEvent = typeof alertEvents.$inferSelect;
