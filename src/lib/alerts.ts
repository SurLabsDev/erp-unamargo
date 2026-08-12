import { inArray, sql } from "drizzle-orm";
import { db, type Tx } from "@/lib/db/client";
import { alertEvents } from "@/lib/db/schema";
import { buildAlertEmail, type AlertEmailProduct } from "@/lib/domain/alerts";
import { sendEmail } from "@/lib/email";
import { getSettings } from "@/lib/settings";

export type PendingAlert = AlertEmailProduct & { eventId: number };

/**
 * Evaluates the §8 state machine for one product INSIDE the caller's
 * transaction (after it changed current_stock / min_stock / is_active).
 *
 * Both transitions are single conditional UPDATEs, so the claim is atomic:
 * two concurrent operations crossing the threshold can never both "win" the
 * trigger — exactly one email per stockout event.
 *
 * Outbox: the alert_events row is inserted HERE (status 'pending') so the
 * claim and its audit trail commit atomically; deliverAlerts() only updates
 * the status after attempting the send.
 *
 * Returns the pending alert to deliver AFTER commit, or null.
 */
export async function evaluateProductAlert(
  tx: Tx,
  productId: string,
): Promise<PendingAlert | null> {
  // Silent rearm: triggered but no longer in breach (or control turned off).
  await tx.execute(sql`
    update products
    set low_stock_alerted_at = null
    where id = ${productId}
      and low_stock_alerted_at is not null
      and (min_stock = 0 or current_stock > min_stock)
  `);

  // Atomic trigger claim: only the winner returns a row.
  const rows = (await tx.execute(sql`
    update products
    set low_stock_alerted_at = now()
    where id = ${productId}
      and low_stock_alerted_at is null
      and is_active
      and min_stock > 0
      and current_stock <= min_stock
    returning id, sku, name, current_stock, min_stock
  `)) as unknown as Array<{
    id: string;
    sku: string;
    name: string;
    current_stock: number;
    min_stock: number;
  }>;

  if (rows.length === 0) return null;
  const row = rows[0];

  const [event] = await tx
    .insert(alertEvents)
    .values({
      productId: row.id,
      stockAtTrigger: row.current_stock,
      minStockAtTrigger: row.min_stock,
      recipients: [],
      status: "pending",
    })
    .returning({ id: alertEvents.id });

  return {
    eventId: event.id,
    productId: row.id,
    sku: row.sku,
    name: row.name,
    currentStock: row.current_stock,
    minStock: row.min_stock,
  };
}

/**
 * Delivers pending alerts AFTER the transaction committed. One email for a
 * single product; ONE summary email for a batch (§8.6). Awaited within the
 * request (serverless: fire-and-forget emails get lost). A failed or skipped
 * send NEVER breaks the operation — the outbox row keeps the audit trail and
 * the panel badge works regardless.
 */
export async function deliverAlerts(pendings: PendingAlert[]): Promise<void> {
  if (pendings.length === 0) return;
  const eventIds = pendings.map((pending) => pending.eventId);

  try {
    const settings = await getSettings();
    const recipients = settings.alertRecipients;
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";

    let status: "sent" | "failed" | "skipped";
    let error: string | null = null;

    if (recipients.length === 0) {
      status = "skipped";
      error = "sin destinatarios configurados";
    } else {
      const email = buildAlertEmail({
        companyName: settings.companyName,
        appUrl,
        products: pendings,
      });
      const result = await sendEmail({
        to: recipients,
        subject: email.subject,
        text: email.text,
      });
      status = result.status;
      error =
        result.status === "failed"
          ? result.error
          : result.status === "skipped"
            ? result.reason
            : null;
    }

    await db
      .update(alertEvents)
      .set({ status, error, recipients })
      .where(inArray(alertEvents.id, eventIds));
  } catch (deliveryError) {
    // Alert delivery must never break the operation. Best effort to leave the
    // failure audited; the outbox rows stay 'pending' if even this fails.
    console.error("[alerts] delivery failed", deliveryError);
    try {
      await db
        .update(alertEvents)
        .set({
          status: "failed",
          error:
            deliveryError instanceof Error
              ? deliveryError.message
              : String(deliveryError),
        })
        .where(inArray(alertEvents.id, eventIds));
    } catch {
      // already logged above
    }
  }
}
