"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { recordAudit } from "@/lib/audit";
import { creativeBillings } from "@/db/schema";

type Result = { ok: true } | { ok: false; error: string };

// ════════════════════════════════════════════════════════════════════════════
// Lifecycle de una factura de creative. Mucho más corto que el de un billing
// de plan: una factura de creative nace emitida ('invoiced') y sólo se cobra
// o se revierte.
//
//   invoiced ↔ paid
//
// Vive en /creative (app interna, detrás del gate de Supabase), así que acá sí
// se usan Server Actions — a diferencia del portal, que va por route handler.
// ════════════════════════════════════════════════════════════════════════════

export async function setCreativeBillingPaid(input: {
  billingId: string;
  paid: boolean;
}): Promise<Result> {
  const [before] = await db
    .select()
    .from(creativeBillings)
    .where(eq(creativeBillings.id, input.billingId))
    .limit(1);
  if (!before) return { ok: false, error: "Factura no encontrada" };

  const to = input.paid ? "paid" : "invoiced";
  if (before.status === to) return { ok: true }; // idempotente (doble click)

  if (before.status !== "invoiced" && before.status !== "paid") {
    return {
      ok: false,
      error: `No se puede cambiar el cobro desde el estado '${before.status}'`,
    };
  }

  const [after] = await db
    .update(creativeBillings)
    .set({ status: to, paidAt: input.paid ? new Date() : null })
    .where(eq(creativeBillings.id, input.billingId))
    .returning();

  await recordAudit({
    entityType: "creative_billing",
    entityId: input.billingId,
    action: "update",
    beforeJson: before,
    afterJson: after,
  });

  revalidatePath("/creative");
  return { ok: true };
}
