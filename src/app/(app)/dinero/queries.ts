import { and, asc, count, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db/client";
import {
  cashCategories,
  cashMovements,
  users,
  type CashCategory,
} from "@/lib/db/schema";
import type { Period, PeriodTotals } from "@/lib/domain/money";

export const CASH_PAGE_SIZE = 50;

export type CashRow = {
  id: number;
  date: string;
  kind: "income" | "expense";
  categoryId: string;
  categoryName: string;
  concept: string;
  amount: string;
  userName: string;
  voidedAt: Date | null;
  voidedByName: string | null;
  voidReason: string | null;
};

export type CashFilters = {
  kind?: "income" | "expense";
  categoryId?: string;
  includeVoided: boolean;
  page: number;
};

const voidedByUser = alias(users, "voided_by_user");

export async function listCashMovements(
  period: Period,
  filters: CashFilters,
): Promise<{ rows: CashRow[]; total: number; pageCount: number }> {
  const conditions = [
    gte(cashMovements.date, period.fromISO),
    lte(cashMovements.date, period.toISO),
    filters.kind ? eq(cashMovements.kind, filters.kind) : undefined,
    filters.categoryId
      ? eq(cashMovements.categoryId, filters.categoryId)
      : undefined,
    filters.includeVoided ? undefined : isNull(cashMovements.voidedAt),
  ].filter((c) => c !== undefined);
  const where = and(...conditions);

  const page = Math.max(1, Math.floor(filters.page) || 1);
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: cashMovements.id,
        date: cashMovements.date,
        kind: cashMovements.kind,
        categoryId: cashMovements.categoryId,
        categoryName: cashCategories.name,
        concept: cashMovements.concept,
        amount: cashMovements.amount,
        userName: users.name,
        voidedAt: cashMovements.voidedAt,
        voidedByName: voidedByUser.name,
        voidReason: cashMovements.voidReason,
      })
      .from(cashMovements)
      .innerJoin(cashCategories, eq(cashMovements.categoryId, cashCategories.id))
      .innerJoin(users, eq(cashMovements.createdBy, users.id))
      .leftJoin(voidedByUser, eq(cashMovements.voidedBy, voidedByUser.id))
      .where(where)
      .orderBy(desc(cashMovements.date), desc(cashMovements.id))
      .limit(CASH_PAGE_SIZE)
      .offset((page - 1) * CASH_PAGE_SIZE),
    db.select({ total: count() }).from(cashMovements).where(where),
  ]);

  return {
    rows,
    total,
    pageCount: Math.max(1, Math.ceil(total / CASH_PAGE_SIZE)),
  };
}

/**
 * The four aggregates that determine the §7.2 summary, in one pass over the
 * non-voided movements. Amounts come back as decimal strings.
 */
export async function periodTotals(period: Period): Promise<PeriodTotals> {
  const [row] = await db
    .select({
      incomeBefore: sql<string>`coalesce(sum(${cashMovements.amount}) filter (where ${cashMovements.kind} = 'income' and ${cashMovements.date} < ${period.fromISO}), 0)`,
      expenseBefore: sql<string>`coalesce(sum(${cashMovements.amount}) filter (where ${cashMovements.kind} = 'expense' and ${cashMovements.date} < ${period.fromISO}), 0)`,
      incomePeriod: sql<string>`coalesce(sum(${cashMovements.amount}) filter (where ${cashMovements.kind} = 'income' and ${cashMovements.date} >= ${period.fromISO} and ${cashMovements.date} <= ${period.toISO}), 0)`,
      expensePeriod: sql<string>`coalesce(sum(${cashMovements.amount}) filter (where ${cashMovements.kind} = 'expense' and ${cashMovements.date} >= ${period.fromISO} and ${cashMovements.date} <= ${period.toISO}), 0)`,
    })
    .from(cashMovements)
    .where(isNull(cashMovements.voidedAt));
  return {
    incomeBefore: String(row.incomeBefore),
    expenseBefore: String(row.expenseBefore),
    incomePeriod: String(row.incomePeriod),
    expensePeriod: String(row.expensePeriod),
  };
}

export type CategoryBreakdownRow = {
  categoryName: string;
  kind: "income" | "expense";
  total: string;
};

export async function categoryBreakdown(
  period: Period,
): Promise<CategoryBreakdownRow[]> {
  const rows = await db
    .select({
      categoryName: cashCategories.name,
      kind: cashMovements.kind,
      total: sql<string>`sum(${cashMovements.amount})`,
    })
    .from(cashMovements)
    .innerJoin(cashCategories, eq(cashMovements.categoryId, cashCategories.id))
    .where(
      and(
        isNull(cashMovements.voidedAt),
        gte(cashMovements.date, period.fromISO),
        lte(cashMovements.date, period.toISO),
      ),
    )
    .groupBy(cashCategories.name, cashMovements.kind)
    .orderBy(asc(cashMovements.kind), desc(sql`sum(${cashMovements.amount})`));
  return rows.map((row) => ({ ...row, total: String(row.total) }));
}

export type CategoryWithUsage = CashCategory & { inUse: boolean };

export async function listCategories(): Promise<CategoryWithUsage[]> {
  return db
    .select({
      id: cashCategories.id,
      name: cashCategories.name,
      kind: cashCategories.kind,
      isActive: cashCategories.isActive,
      inUse: sql<boolean>`exists (select 1 from cash_movements cm where cm.category_id = cash_categories.id)`,
    })
    .from(cashCategories)
    .orderBy(asc(cashCategories.kind), asc(cashCategories.name));
}

/** All rows for CSV export: the period + active filters, voided EXCLUDED. */
export async function listCashForExport(
  period: Period,
  filters: Pick<CashFilters, "kind" | "categoryId">,
): Promise<CashRow[]> {
  const conditions = [
    isNull(cashMovements.voidedAt),
    gte(cashMovements.date, period.fromISO),
    lte(cashMovements.date, period.toISO),
    filters.kind ? eq(cashMovements.kind, filters.kind) : undefined,
    filters.categoryId
      ? eq(cashMovements.categoryId, filters.categoryId)
      : undefined,
  ].filter((c) => c !== undefined);

  return db
    .select({
      id: cashMovements.id,
      date: cashMovements.date,
      kind: cashMovements.kind,
      categoryId: cashMovements.categoryId,
      categoryName: cashCategories.name,
      concept: cashMovements.concept,
      amount: cashMovements.amount,
      userName: users.name,
      voidedAt: cashMovements.voidedAt,
      voidedByName: sql<string | null>`null`,
      voidReason: cashMovements.voidReason,
    })
    .from(cashMovements)
    .innerJoin(cashCategories, eq(cashMovements.categoryId, cashCategories.id))
    .innerJoin(users, eq(cashMovements.createdBy, users.id))
    .where(and(...conditions))
    .orderBy(asc(cashMovements.date), asc(cashMovements.id));
}
