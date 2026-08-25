import { unstable_cache } from "next/cache";
import { cache } from "react";
import { db } from "@/lib/db/client";
import { settings, type Settings } from "@/lib/db/schema";

export const ETIQUETA_SETTINGS = "settings";

/**
 * La configuracion de la instancia: una sola fila que cambia una vez cada
 * varios meses, y que se leia en CADA render de CADA pantalla.
 *
 * `cache()` de React solo deduplica dentro de un mismo pedido, asi que cada
 * navegacion pagaba su consulta. Sumado al chequeo de sesion, eran dos
 * consultas fijas por pantalla antes de mirar un solo dato del negocio.
 *
 * Ahora se guarda entre pedidos y se limpia por etiqueta cuando alguien la
 * edita, asi que sigue siendo exacta sin costar una ida a la base cada vez.
 */
const settingsCacheados = unstable_cache(
  async (): Promise<Settings> => {
    const [row] = await db.select().from(settings).limit(1);
    if (!row) {
      throw new Error(
        "La instancia no está configurada: corré `npm run db:seed` (ver README).",
      );
    }
    return row;
  },
  ["settings"],
  { revalidate: 300, tags: [ETIQUETA_SETTINGS] },
);

export const getSettings = cache(async (): Promise<Settings> => {
  const row = await settingsCacheados();
  // Las fechas vuelven como texto de la cache (pasa por JSON). Se reconstruyen
  // aca, que es el mismo problema que tiro abajo el panel entero una vez.
  return { ...row, updatedAt: new Date(row.updatedAt) };
});
