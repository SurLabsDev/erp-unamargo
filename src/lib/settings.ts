import { cache } from "react";
import { db } from "@/lib/db/client";
import { settings, type Settings } from "@/lib/db/schema";

// Single-row instance configuration, seeded per client (config/instance.json).
// Cached per request via React cache().
export const getSettings = cache(async (): Promise<Settings> => {
  const [row] = await db.select().from(settings).limit(1);
  if (!row) {
    throw new Error(
      "La instancia no está configurada: corré `npm run db:seed` (ver README).",
    );
  }
  return row;
});
