/**
 * Instance seed.
 *
 *   npm run db:seed           → seeds from config/instance.json (falls back to
 *                               config/instance.example.json with a warning):
 *                               settings, categories and the initial admin
 *                               (random password printed ONCE).
 *   npm run db:seed -- --demo → seeds the Unamargo demo instance with
 *                               believable demo data (products, movements,
 *                               cash) and two demo users. Refuses to run on a
 *                               non-empty database unless --reset is passed,
 *                               which wipes ALL data first (dev only).
 */
import { randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { createScriptDb, schema } from "./lib/db";

const {
  users,
  settings,
  products,
  stockMovements,
  cashCategories,
  cashMovements,
} = schema;

const instanceConfigSchema = z.object({
  companyName: z.string().min(1),
  currencyCode: z.string().length(3),
  timezone: z.string().min(1),
  alertRecipients: z.array(z.email()).max(3),
  initialBalance: z.string().regex(/^\d+(\.\d{1,2})?$/),
  initialBalanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  categories: z
    .array(
      z.object({
        name: z.string().min(1),
        kind: z.enum(["income", "expense"]),
      }),
    )
    .min(1),
  admin: z.object({ email: z.email(), name: z.string().min(1) }),
});

type InstanceConfig = z.infer<typeof instanceConfigSchema>;

const DEMO_CONFIG: InstanceConfig = {
  companyName: "Unamargo",
  currencyCode: "UYU",
  timezone: "America/Montevideo",
  alertRecipients: [],
  initialBalance: "25000.00",
  initialBalanceDate: "2026-07-01",
  categories: [
    { name: "Ventas", kind: "income" },
    { name: "Otros ingresos", kind: "income" },
    { name: "Mercadería", kind: "expense" },
    { name: "Envíos", kind: "expense" },
    { name: "Gastos operativos", kind: "expense" },
    { name: "Otros egresos", kind: "expense" },
  ],
  admin: { email: "admin@unamargo.demo", name: "Administración Demo" },
};

function loadConfig(): InstanceConfig {
  const configPath = path.resolve("config/instance.json");
  const examplePath = path.resolve("config/instance.example.json");
  let file = configPath;
  if (!existsSync(configPath)) {
    console.warn(
      "[seed] config/instance.json no existe; usando config/instance.example.json (solo válido para desarrollo).",
    );
    file = examplePath;
  }
  const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
  return instanceConfigSchema.parse(raw);
}

async function seedBase(
  db: ReturnType<typeof createScriptDb>["db"],
  config: InstanceConfig,
) {
  await db
    .insert(settings)
    .values({
      id: 1,
      companyName: config.companyName,
      currencyCode: config.currencyCode,
      timezone: config.timezone,
      alertRecipients: config.alertRecipients,
      initialBalance: config.initialBalance,
      initialBalanceDate: config.initialBalanceDate,
    })
    .onConflictDoUpdate({
      target: settings.id,
      set: {
        companyName: config.companyName,
        currencyCode: config.currencyCode,
        timezone: config.timezone,
        alertRecipients: config.alertRecipients,
        initialBalance: config.initialBalance,
        initialBalanceDate: config.initialBalanceDate,
        updatedAt: new Date(),
      },
    });

  for (const category of config.categories) {
    await db
      .insert(cashCategories)
      .values(category)
      .onConflictDoNothing({ target: cashCategories.name });
  }
}

async function ensureUser(
  db: ReturnType<typeof createScriptDb>["db"],
  input: {
    email: string;
    name: string;
    role: "admin" | "operator";
    password?: string;
  },
): Promise<{ email: string; password: string } | null> {
  const email = input.email.toLowerCase();
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing) return null; // never overwrite an existing user's password

  const password =
    input.password ?? randomBytes(9).toString("base64url").slice(0, 12);
  await db.insert(users).values({
    email,
    name: input.name,
    role: input.role,
    passwordHash: await bcrypt.hash(password, 12),
  });
  return { email, password };
}

// --- Demo data -------------------------------------------------------------

type DemoMovement = {
  type: "in" | "out" | "adjustment" | "initial";
  delta: number;
  note?: string;
};

type DemoProduct = {
  sku: string;
  name: string;
  minStock: number;
  movements: DemoMovement[];
};

const DEMO_PRODUCTS: DemoProduct[] = [
  { sku: "MATE-IMP-CUE", name: "Mate imperial forrado en cuero", minStock: 3, movements: [
    { type: "initial", delta: 10, note: "Stock inicial" },
    { type: "out", delta: -2, note: "Venta mostrador" },
  ]},
  { sku: "MATE-CAMP-NAT", name: "Mate campero natural", minStock: 5, movements: [
    { type: "initial", delta: 15, note: "Stock inicial" },
    { type: "out", delta: -3, note: "Venta feria" },
  ]},
  { sku: "MATE-TORP-ALG", name: "Mate torpedo de algarrobo", minStock: 4, movements: [
    { type: "initial", delta: 6, note: "Stock inicial" },
    { type: "out", delta: -4, note: "Venta mayorista" },
  ]},
  { sku: "MATE-CER-NEG", name: "Mate de cerámica negro", minStock: 5, movements: [
    { type: "initial", delta: 12, note: "Stock inicial" },
    { type: "in", delta: 5, note: "Reposición proveedor" },
    { type: "out", delta: -2, note: "Venta web" },
  ]},
  { sku: "MATE-CALAB-CHI", name: "Mate de calabaza chico", minStock: 3, movements: [
    { type: "initial", delta: 9, note: "Stock inicial" },
    { type: "out", delta: -1, note: "Venta mostrador" },
  ]},
  { sku: "BOMB-ALP-PIC", name: "Bombilla de alpaca pico de loro", minStock: 4, movements: [
    { type: "initial", delta: 12, note: "Stock inicial" },
    { type: "out", delta: -2, note: "Venta mostrador" },
  ]},
  { sku: "BOMB-ACE-REC", name: "Bombilla de acero recta", minStock: 5, movements: [
    { type: "initial", delta: 8, note: "Stock inicial" },
    { type: "out", delta: -5, note: "Venta feria" },
  ]},
  { sku: "YER-CAN-1KG", name: "Yerba Canarias 1 kg", minStock: 10, movements: [
    { type: "initial", delta: 40, note: "Stock inicial" },
    { type: "out", delta: -10, note: "Ventas de la semana" },
  ]},
  { sku: "YER-BAL-1KG", name: "Yerba Baldo 1 kg", minStock: 10, movements: [
    { type: "initial", delta: 20, note: "Stock inicial" },
    { type: "out", delta: -11, note: "Ventas de la semana" },
  ]},
  { sku: "YER-ORG-500", name: "Yerba orgánica 500 g", minStock: 6, movements: [
    { type: "initial", delta: 18, note: "Stock inicial" },
    { type: "adjustment", delta: -2, note: "Recuento mensual: diferencia de 2" },
  ]},
  { sku: "TER-LUM-1L", name: "Termo Lumilagro 1 L", minStock: 3, movements: [
    { type: "initial", delta: 7, note: "Stock inicial" },
    { type: "out", delta: -2, note: "Venta mostrador" },
  ]},
  { sku: "MATERA-CUE-MAR", name: "Matera de cuero marrón", minStock: 2, movements: [
    { type: "initial", delta: 6, note: "Stock inicial" },
  ]},
  { sku: "KIT-MATE-COMP", name: "Kit matero completo", minStock: 2, movements: [
    { type: "initial", delta: 5, note: "Stock inicial" },
    { type: "out", delta: -1, note: "Venta web" },
  ]},
  { sku: "FUN-MATE-NEG", name: "Funda de mate negra", minStock: 0, movements: [
    { type: "initial", delta: 10, note: "Stock inicial" },
    { type: "out", delta: -10, note: "Liquidación" },
  ]},
  { sku: "AZU-MATE-250", name: "Azucarera matera 250 g", minStock: 2, movements: [] },
];

const DEMO_CASH: Array<{
  date: string;
  kind: "income" | "expense";
  category: string;
  concept: string;
  amount: string;
  voided?: string;
}> = [
  { date: "2026-07-02", kind: "expense", category: "Gastos operativos", concept: "Alquiler del local (julio)", amount: "9000.00" },
  { date: "2026-07-03", kind: "income", category: "Ventas", concept: "Ventas de la semana", amount: "5600.00" },
  { date: "2026-07-05", kind: "income", category: "Ventas", concept: "Ventas de la semana", amount: "8500.00" },
  { date: "2026-07-07", kind: "expense", category: "Envíos", concept: "Envíos DAC", amount: "780.00" },
  { date: "2026-07-08", kind: "expense", category: "Mercadería", concept: "Compra yerba Canarias", amount: "5200.00" },
  { date: "2026-07-10", kind: "income", category: "Otros ingresos", concept: "Taller de cebado (entradas)", amount: "2400.00" },
  { date: "2026-07-12", kind: "income", category: "Ventas", concept: "Feria artesanal", amount: "6400.00" },
  { date: "2026-07-15", kind: "expense", category: "Envíos", concept: "Envíos DAC de la semana", amount: "900.00" },
  { date: "2026-07-17", kind: "income", category: "Ventas", concept: "Ventas web por transferencia", amount: "5100.00" },
  { date: "2026-07-18", kind: "expense", category: "Gastos operativos", concept: "Bolsas y packaging", amount: "1200.00" },
  { date: "2026-07-21", kind: "expense", category: "Otros egresos", concept: "Comisión bancaria transferencias", amount: "350.00" },
  { date: "2026-07-22", kind: "income", category: "Ventas", concept: "Ventas web por transferencia", amount: "4700.00" },
  { date: "2026-07-25", kind: "income", category: "Ventas", concept: "Ventas de la semana", amount: "7200.00" },
  { date: "2026-07-28", kind: "expense", category: "Mercadería", concept: "Compra mates camperos", amount: "7800.00" },
  { date: "2026-07-30", kind: "income", category: "Otros ingresos", concept: "Venta de exhibidor usado", amount: "1500.00" },
  { date: "2026-08-01", kind: "expense", category: "Gastos operativos", concept: "Alquiler del local (agosto)", amount: "9000.00" },
  { date: "2026-08-02", kind: "income", category: "Ventas", concept: "Ventas de la semana", amount: "9200.00" },
  { date: "2026-08-04", kind: "expense", category: "Envíos", concept: "Envíos DAC", amount: "850.00" },
  { date: "2026-08-05", kind: "income", category: "Ventas", concept: "Ventas web por transferencia", amount: "4300.00" },
  { date: "2026-08-06", kind: "expense", category: "Gastos operativos", concept: "Publicidad Instagram", amount: "2000.00" },
  { date: "2026-08-07", kind: "expense", category: "Otros egresos", concept: "Comisión bancaria transferencias", amount: "410.00" },
  { date: "2026-08-08", kind: "income", category: "Ventas", concept: "Feria Parque Rodó", amount: "7300.00" },
  { date: "2026-08-09", kind: "expense", category: "Gastos operativos", concept: "Cargado por error", amount: "999.00", voided: "Movimiento duplicado" },
  { date: "2026-08-10", kind: "expense", category: "Mercadería", concept: "Bombillas de alpaca", amount: "4600.00" },
  { date: "2026-08-11", kind: "income", category: "Ventas", concept: "Ventas web", amount: "3900.00" },
];

async function seedDemo(db: ReturnType<typeof createScriptDb>["db"]) {
  await seedBase(db, DEMO_CONFIG);

  const adminCreds = await ensureUser(db, {
    email: DEMO_CONFIG.admin.email,
    name: DEMO_CONFIG.admin.name,
    role: "admin",
    password: "unamargo-admin",
  });
  const operatorCreds = await ensureUser(db, {
    email: "operador@unamargo.demo",
    name: "Operación Demo",
    role: "operator",
    password: "unamargo-operador",
  });

  const [admin] = await db
    .select()
    .from(users)
    .where(eq(users.email, DEMO_CONFIG.admin.email));
  const [operator] = await db
    .select()
    .from(users)
    .where(eq(users.email, "operador@unamargo.demo"));

  // Demo timestamps: spread over July/August 2026 so history looks real.
  let dayOffset = 0;
  const movementDate = () =>
    new Date(Date.UTC(2026, 6, 10 + Math.floor(dayOffset++ / 2), 14, 30));

  for (const demo of DEMO_PRODUCTS) {
    let stock = 0;
    const [product] = await db
      .insert(products)
      .values({ sku: demo.sku, name: demo.name, minStock: demo.minStock })
      .returning();

    for (const [i, movement] of demo.movements.entries()) {
      stock += movement.delta;
      if (stock < 0) throw new Error(`Seed inválido: ${demo.sku} queda < 0`);
      await db.insert(stockMovements).values({
        productId: product.id,
        type: movement.type,
        delta: movement.delta,
        resultingStock: stock,
        note: movement.note,
        createdBy: (i % 2 === 0 ? admin : operator).id,
        createdAt: movementDate(),
      });
    }

    const inBreach = demo.minStock > 0 && stock <= demo.minStock;
    await db
      .update(products)
      .set({
        currentStock: stock,
        // Products already in breach start with a consumed alert event
        // (the email would have gone out when they crossed the minimum).
        lowStockAlertedAt: inBreach ? new Date() : null,
      })
      .where(eq(products.id, product.id));
  }

  const categories = await db.select().from(cashCategories);
  const categoryByName = new Map(categories.map((c) => [c.name, c]));
  for (const [i, entry] of DEMO_CASH.entries()) {
    const category = categoryByName.get(entry.category);
    if (!category) throw new Error(`Categoría demo faltante: ${entry.category}`);
    await db.insert(cashMovements).values({
      date: entry.date,
      kind: entry.kind,
      categoryId: category.id,
      concept: entry.concept,
      amount: entry.amount,
      createdBy: (i % 2 === 0 ? operator : admin).id,
      voidedAt: entry.voided ? new Date() : null,
      voidedBy: entry.voided ? admin.id : null,
      voidReason: entry.voided ?? null,
    });
  }

  console.log("\n[seed] Instancia DEMO Unamargo lista.");
  console.log("[seed] Credenciales demo (cambiarlas fuera de desarrollo):");
  console.log(
    `[seed]   admin    → ${adminCreds ? `${adminCreds.email} / ${adminCreds.password}` : "ya existía (password sin cambios)"}`,
  );
  console.log(
    `[seed]   operador → ${operatorCreds ? `${operatorCreds.email} / ${operatorCreds.password}` : "ya existía (password sin cambios)"}`,
  );
}

async function main() {
  const args = process.argv.slice(2);
  const demo = args.includes("--demo");
  const reset = args.includes("--reset");
  const { db, close } = createScriptDb();

  try {
    if (reset) {
      console.warn("[seed] --reset: borrando TODOS los datos…");
      await db.execute(
        sql`truncate table alert_events, stock_movements, cash_movements, cash_categories, products, users, settings restart identity cascade`,
      );
    }

    if (demo) {
      const [existingProduct] = await db.select().from(products).limit(1);
      if (existingProduct) {
        console.error(
          "[seed] La base ya tiene datos. Usá `npm run db:seed -- --demo --reset` para reiniciarla (borra todo).",
        );
        process.exitCode = 1;
        return;
      }
      await seedDemo(db);
    } else {
      const config = loadConfig();
      await seedBase(db, config);
      const creds = await ensureUser(db, {
        email: config.admin.email,
        name: config.admin.name,
        role: "admin",
      });
      console.log(`\n[seed] Instancia "${config.companyName}" lista.`);
      if (creds) {
        console.log(
          `[seed] Admin inicial: ${creds.email} / ${creds.password}  ← guardala ahora, no se vuelve a mostrar`,
        );
      } else {
        console.log("[seed] El admin ya existía; password sin cambios.");
      }
    }
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
