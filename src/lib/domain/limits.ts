import { z } from "zod";
import "@/lib/zod-locale";

// Contractual instance limits as PURE, testable rules (DoD §15.2). The
// server actions serialize their checks under advisory locks; these define
// the limits themselves.

/** Up to 5 active users per instance (§5). */
export const MAX_ACTIVE_USERS = 5;

export const USER_LIMIT_ERROR = `Límite alcanzado: la instancia admite hasta ${MAX_ACTIVE_USERS} usuarios activos.`;

/** True when one more user can become active given the current active count. */
export function canActivateUser(activeCount: number): boolean {
  return activeCount < MAX_ACTIVE_USERS;
}

/** Up to 3 alert recipients (§8), all valid emails. */
export const alertRecipientsSchema = z
  .array(z.email({ error: "Alguno de los emails no es válido." }))
  .max(3, { error: "Se admiten hasta 3 destinatarios." });
