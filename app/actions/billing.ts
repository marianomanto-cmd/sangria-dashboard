"use server";

import { and, asc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  actualSpend,
  auditLog,
  billingLines,
  billings,
  mediaPlanLines,
  mediaPlans,
  projects,
} from "@/db/schema";
import { getNextInvoiceNumber } from "@/db/queries/billing";

const MONTH_RX = /^\d{4}-(0[1-9]|1[0-2])$/;

// ────────────────────────────────────────────────────────────────────────────
// Generar billing draft desde actual_spend del proyecto en un mes
// ────────────────────────────────────────────────────────────────────────────

export type GenerateBillingResult =
  | { ok: true; billingId: string }
  | { ok: false; error: string };

export async function generateBillingDraft(
  projectId: string,
  month: string,
): Promise<GenerateBillingResult> {
  if (!MONTH_RX.test(month))
    return { ok: false, error: "Mes inválido (formato YYYY-MM)" };
  if (!projectId) return { ok: false, error: "Falta project_id" };

  // Validar que no exista ya una factura para este (proyecto, mes).
  const [existing] = await db
    .select({ id: billings.id })
    .from(billings)
    .where(
      and(eq(billings.projectId, projectId), eq(billings.month, month)),
    )
    .limit(1);
  if (existing) {
    return {
      ok: false,
      error: `Ya existe una factura para ${month} (id ${existing.id.slice(0, 8)}…)`,
    };
  }

  // Obtener proyecto + budget origin.
  const [proj] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!proj) return { ok: false, error: "Proyecto no encontrado" };

  // Obtener líneas del plan vigente con su fee_pct.
  const lines = await db
    .select({
      id: mediaPlanLines.id,
      placementName: mediaPlanLines.placementName,
      feePct: mediaPlanLines.feePct,
    })
    .from(mediaPlanLines)
    .innerJoin(mediaPlans, eq(mediaPlanLines.mediaPlanId, mediaPlans.id))
    .where(
      and(
        eq(mediaPlans.projectId, projectId),
        eq(mediaPlans.status, "approved"),
      ),
    )
    .orderBy(asc(mediaPlanLines.sortOrder));
  if (lines.length === 0) {
    return { ok: false, error: "El proyecto no tiene plan aprobado" };
  }

  // Spend del mes para esas líneas.
  const lineIds = lines.map((l) => l.id);
  const monthSpend = await db
    .select()
    .from(actualSpend)
    .where(
      and(
        sql`${actualSpend.mediaPlanLineId} = ANY(${lineIds})`,
        eq(actualSpend.month, month),
      ),
    );

  const spendByLine = new Map<string, number>();
  for (const s of monthSpend) {
    spendByLine.set(s.mediaPlanLineId, Number.parseFloat(s.amountUsd));
  }

  // Compose billing lines. Solo incluimos líneas con spend > 0.
  const newLines = lines
    .map((ln) => {
      const amountNet = spendByLine.get(ln.id) ?? 0;
      if (amountNet <= 0) return null;
      const feePct = Number.parseFloat(ln.feePct);
      const feeAmount = amountNet * (feePct / 100);
      const total = amountNet + feeAmount;
      return {
        mediaPlanLineId: ln.id,
        amountNet: amountNet.toFixed(2),
        feeAmount: feeAmount.toFixed(2),
        total: total.toFixed(2),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (newLines.length === 0) {
    return {
      ok: false,
      error: `No hay gastos cargados para ${month} en este proyecto`,
    };
  }

  const totalNet = newLines.reduce(
    (s, l) => s + Number.parseFloat(l.amountNet),
    0,
  );
  const totalFee = newLines.reduce(
    (s, l) => s + Number.parseFloat(l.feeAmount),
    0,
  );
  const totalUsd = totalNet + totalFee;

  // Insertar billing + lines (idealmente en una tx; postgres-js soporta
  // db.transaction(). Por ahora sequencial — si fallan las lines se queda
  // un billing draft huérfano que el usuario puede borrar manualmente).
  const [billing] = await db
    .insert(billings)
    .values({
      projectId: proj.id,
      budgetOriginId: proj.budgetOriginId,
      month,
      status: "draft",
      totalNetUsd: totalNet.toFixed(2),
      totalFeeUsd: totalFee.toFixed(2),
      totalUsd: totalUsd.toFixed(2),
    })
    .returning();

  await db.insert(billingLines).values(
    newLines.map((l) => ({
      billingId: billing.id,
      mediaPlanLineId: l.mediaPlanLineId,
      amountNet: l.amountNet,
      feeAmount: l.feeAmount,
      total: l.total,
    })),
  );

  await db.insert(auditLog).values({
    entityType: "billing",
    entityId: billing.id,
    action: "create",
    afterJson: { ...billing, linesCount: newLines.length },
  });

  revalidatePath("/billing");
  revalidatePath(`/proyectos/${proj.code}`);

  return { ok: true, billingId: billing.id };
}

// ────────────────────────────────────────────────────────────────────────────
// Emitir billing (draft → sent) — asigna invoice_number sequential del año
// ────────────────────────────────────────────────────────────────────────────

export type SendBillingResult =
  | { ok: true; invoiceNumber: string }
  | { ok: false; error: string };

export async function sendBilling(
  billingId: string,
): Promise<SendBillingResult> {
  if (!billingId) return { ok: false, error: "Falta billing_id" };

  const [before] = await db
    .select()
    .from(billings)
    .where(eq(billings.id, billingId))
    .limit(1);
  if (!before) return { ok: false, error: "Billing no encontrado" };
  if (before.status !== "draft") {
    return {
      ok: false,
      error: `Solo se puede emitir un draft (estado actual: ${before.status})`,
    };
  }

  const year = Number.parseInt(before.month.slice(0, 4), 10);
  const invoiceNumber = await getNextInvoiceNumber(year);
  const sentAt = new Date();
  // Due date: 30 días después de emitir (configurable luego).
  const dueDate = new Date(sentAt);
  dueDate.setDate(dueDate.getDate() + 30);

  const [updated] = await db
    .update(billings)
    .set({
      status: "sent",
      invoiceNumber,
      sentAt,
      dueDate: dueDate.toISOString().slice(0, 10),
    })
    .where(eq(billings.id, billingId))
    .returning();

  await db.insert(auditLog).values({
    entityType: "billing",
    entityId: billingId,
    action: "update",
    beforeJson: before,
    afterJson: updated,
  });

  revalidatePath("/billing");
  revalidatePath(`/billing/${billingId}`);

  return { ok: true, invoiceNumber };
}

// ────────────────────────────────────────────────────────────────────────────
// Marcar como pagada (sent → paid)
// ────────────────────────────────────────────────────────────────────────────

export type MarkPaidResult = { ok: true } | { ok: false; error: string };

export async function markBillingPaid(
  billingId: string,
): Promise<MarkPaidResult> {
  if (!billingId) return { ok: false, error: "Falta billing_id" };

  const [before] = await db
    .select()
    .from(billings)
    .where(eq(billings.id, billingId))
    .limit(1);
  if (!before) return { ok: false, error: "Billing no encontrado" };
  if (before.status !== "sent") {
    return {
      ok: false,
      error: `Solo se pueden marcar como pagadas las emitidas (estado actual: ${before.status})`,
    };
  }

  const [updated] = await db
    .update(billings)
    .set({ status: "paid", paidAt: new Date() })
    .where(eq(billings.id, billingId))
    .returning();

  await db.insert(auditLog).values({
    entityType: "billing",
    entityId: billingId,
    action: "update",
    beforeJson: before,
    afterJson: updated,
  });

  revalidatePath("/billing");
  revalidatePath(`/billing/${billingId}`);

  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────────
// Eliminar billing draft (no se permite borrar emitidas/pagadas)
// ────────────────────────────────────────────────────────────────────────────

export type DeleteBillingResult = { ok: true } | { ok: false; error: string };

export async function deleteBillingDraft(
  billingId: string,
): Promise<DeleteBillingResult> {
  const [before] = await db
    .select()
    .from(billings)
    .where(eq(billings.id, billingId))
    .limit(1);
  if (!before) return { ok: false, error: "Billing no encontrado" };
  if (before.status !== "draft") {
    return {
      ok: false,
      error:
        "Solo se pueden borrar drafts. Para revertir una factura emitida hay que crear una nota de crédito.",
    };
  }

  await db.delete(billings).where(eq(billings.id, billingId));

  await db.insert(auditLog).values({
    entityType: "billing",
    entityId: billingId,
    action: "delete",
    beforeJson: before,
  });

  revalidatePath("/billing");
  return { ok: true };
}
