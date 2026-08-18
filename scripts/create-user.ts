/**
 * CLI user creation (also possible from Configuración in the UI, Hito 2).
 *
 *   npm run user:create -- --email ana@cliente.uy --name "Ana Pérez" --role operator
 *   npm run user:create -- --email ... --name "..." --role admin --support
 *
 * Enforces the 5-active-users limit and prints the temporary password ONCE.
 *
 * --support creates the Surlabs vendor account: invisible to the client, not
 * counted against the 5-user cap and unable to author ledger entries. Only
 * available from the CLI on purpose -- nothing in the UI can create one.
 */
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { createScriptDb, schema } from "./lib/db";

const { users } = schema;

const argsSchema = z.object({
  email: z.email(),
  name: z.string().min(1),
  role: z.enum(["admin", "operator"]),
  support: z.boolean().default(false),
});

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    // Flags sin valor (--support) no deben comerse el argumento siguiente.
    if (next === undefined || next.startsWith("--")) out[key] = "true";
    else out[key] = argv[++i];
  }
  return out;
}

async function main() {
  const crudo = parseArgs(process.argv.slice(2));
  const parsed = argsSchema.safeParse({
    ...crudo,
    support: "support" in crudo,
  });
  if (!parsed.success) {
    console.error(
      'Uso: npm run user:create -- --email x@y.z --name "Nombre" --role admin|operator [--support]',
    );
    process.exit(1);
  }
  const { name, role, support } = parsed.data;
  const email = parsed.data.email.toLowerCase();

  const { db, close } = createScriptDb();
  try {
    const [{ activeCount }] = await db
      .select({ activeCount: count() })
      .from(users)
      .where(and(eq(users.isActive, true), eq(users.isSupport, false)));
    // La cuenta de soporte no ocupa lugar en el tope de la instancia.
    if (!support && activeCount >= 5) {
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
      isSupport: support,
      passwordHash: await bcrypt.hash(password, 12),
    });

    console.log(
      `Usuario creado: ${email} (${role}${support ? ", cuenta de soporte" : ""})`,
    );
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
