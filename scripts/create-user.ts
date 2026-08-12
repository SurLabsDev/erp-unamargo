/**
 * CLI user creation (also possible from Configuración in the UI, Hito 2).
 *
 *   npm run user:create -- --email ana@cliente.uy --name "Ana Pérez" --role operator
 *
 * Enforces the 5-active-users limit and prints the temporary password ONCE.
 */
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { count, eq } from "drizzle-orm";
import { z } from "zod";
import { createScriptDb, schema } from "./lib/db";

const { users } = schema;

const argsSchema = z.object({
  email: z.email(),
  name: z.string().min(1),
  role: z.enum(["admin", "operator"]),
});

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) out[arg.slice(2)] = argv[++i] ?? "";
  }
  return out;
}

async function main() {
  const parsed = argsSchema.safeParse(parseArgs(process.argv.slice(2)));
  if (!parsed.success) {
    console.error(
      'Uso: npm run user:create -- --email x@y.z --name "Nombre" --role admin|operator',
    );
    process.exit(1);
  }
  const { name, role } = parsed.data;
  const email = parsed.data.email.toLowerCase();

  const { db, close } = createScriptDb();
  try {
    const [{ activeCount }] = await db
      .select({ activeCount: count() })
      .from(users)
      .where(eq(users.isActive, true));
    if (activeCount >= 5) {
      console.error(
        "Límite alcanzado: la instancia admite hasta 5 usuarios activos. Desactivá uno para crear otro.",
      );
      process.exitCode = 1;
      return;
    }

    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existing) {
      console.error(`Ya existe un usuario con el email ${email}.`);
      process.exitCode = 1;
      return;
    }

    const password = randomBytes(9).toString("base64url").slice(0, 12);
    await db.insert(users).values({
      email,
      name,
      role,
      passwordHash: await bcrypt.hash(password, 12),
    });

    console.log(`Usuario creado: ${email} (${role})`);
    console.log(
      `Password temporal: ${password}  ← compartila de forma segura; no se vuelve a mostrar`,
    );
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
