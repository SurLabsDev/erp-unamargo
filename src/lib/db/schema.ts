import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
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

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sku: text("sku").notNull().unique(), // UPPERCASE, 1-40 chars, A-Z 0-9 - _
    name: text("name").notNull(), // <= 120 chars (validated in app)
    isActive: boolean("is_active").notNull().default(true),
    currentStock: integer("current_stock").notNull().default(0),
    minStock: integer("min_stock").notNull().default(0), // 0 = alerts disabled
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
export type Product = typeof products.$inferSelect;
export type StockMovement = typeof stockMovements.$inferSelect;
export type CashCategory = typeof cashCategories.$inferSelect;
export type CashMovement = typeof cashMovements.$inferSelect;
export type AlertEvent = typeof alertEvents.$inferSelect;
