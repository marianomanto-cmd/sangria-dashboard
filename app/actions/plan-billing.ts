"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  auditLog,
  mediaPlanFees,
  mediaPlanPublishers,
  mediaPlans,
  planBillingFees,
  planBillingPublishers,
  planBillings,
  projects,
  publishers,
} from "@/db/schema";

type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true } & T)
  | { ok: false; error: string };

const MONTH_RX = /^\d{4}-(0[1-9]|1[0-2])$/;

// ════════════════════════════════════════════════════════════════════════════
// ensureBillingForMonth: si no existe, crea el draft con todos los publishers
// del plan pre-cargados en $0 y todos los fees pre-imputados en $0.
// ════════════════════════════════════════════════════════════════════════════

export async function ensureBillingForMonth(input: {
  planId: string;
  month: string;
}): Promise<Result<{ billingId: string }>> {
  if (!MONTH_RX.test(input.month))
    return { ok: false, error: "Mes inválido (formato YYYY-MM)" };

  const [existing] = await db
    .select()
    .from(planBillings)
    .where(
      and(
        eq(planBillings.mediaPlanId, input.planId),
        eq(planBillings.month, input.month),
      ),
    )
    .limit(1);

  if (existing) return { ok: true, billingId: existing.id };

  const [plan] = await db
    .select()
    .from(mediaPlans)
    .where(eq(mediaPlans.id, input.planId))
    .limit(1);
  if (!plan) return { ok: false, error: "Plan no encontrado" };

  const [billing] = await db
    .insert(planBillings)
    .values({
      mediaPlanId: input.planId,
      month: input.month,
      status: "draft",
    })
    .returning();

  // Pre-cargar rows en cero para todos los publishers del plan.
  const planPubs = await db
    .select({
      publisherId: mediaPlanPublishers.publisherId,
      mppOverride: mediaPlanPublishers.agencyPaysOverride,
    })
    .from(mediaPlanPublishers)
    .where(eq(mediaPlanPublishers.mediaPlanId, input.planId));

  if (planPubs.length > 0) {
    // Need agency_pays defaults from publishers
    const pubDefaults = await db
      .select({ id: publishers.id, agencyPaysDefault: publishers.agencyPaysDefault })
      .from(publishers)
      .where(inArray(publishers.id, planPubs.map((p) => p.publisherId)));
    const defaultsMap = new Map(pubDefaults.map((p) => [p.id, p.agencyPaysDefault]));

    await db.insert(planBillingPublishers).values(
      planPubs.map((p) => ({
        planBillingId: billing.id,
        publisherId: p.publisherId,
        amountRealUsd: "0.00",
        isBillable: p.mppOverride ?? defaultsMap.get(p.publisherId) ?? true,
      })),
    );
  }

  // Pre-cargar fees en cero.
  const planFees = await db
    .select({ id: mediaPlanFees.id })
    .from(mediaPlanFees)
    .where(eq(mediaPlanFees.mediaPlanId, input.planId));

  if (planFees.length > 0) {
    await db.insert(planBillingFees).values(
      planFees.map((f) => ({
        planBillingId: billing.id,
        mediaPlanFeeId: f.id,
        amountImputedUsd: "0.00",
      })),
    );
  }

  await db.insert(auditLog).values({
    entityType: "plan_billing",
    entityId: billing.id,
    action: "create",
    afterJson: billing,
  });

  // Find project to revalidate
  const [proj] = await db
    .select({ code: projects.code })
    .from(projects)
    .where(eq(projects.id, plan.projectId))
    .limit(1);
  if (proj) {
    revalidatePath(`/proyectos/${proj.code}/planes/${input.planId}/billing`);
    revalidatePath("/billing");
  }

  return { ok: true, billingId: billing.id };
}

// ════════════════════════════════════════════════════════════════════════════
// Recalcular totales del billing a partir de sus sublines
// ════════════════════════════════════════════════════════════════════════════

async function recalcBillingTotals(billingId: string) {
  const [pubsTotal] = await db
    .select({
      total: sql<string>`coalesce(sum(${planBillingPublishers.amountRealUsd}) filter (where ${planBillingPublishers.isBillable}), 0)`,
    })
    .from(planBillingPublishers)
    .where(eq(planBillingPublishers.planBillingId, billingId));

  const [feesTotal] = await db
    .select({
      total: sql<string>`coalesce(sum(${planBillingFees.amountImputedUsd}), 0)`,
    })
    .from(planBillingFees)
    .where(eq(planBillingFees.planBillingId, billingId));

  const totalNet = Number.parseFloat(pubsTotal.total);
  const totalFee = Number.parseFloat(feesTotal.total);
  const totalUsd = totalNet + totalFee;

  await db
    .update(planBillings)
    .set({
      totalNetUsd: totalNet.toFixed(2),
      totalFeeUsd: totalFee.toFixed(2),
      totalUsd: totalUsd.toFixed(2),
    })
    .where(eq(planBillings.id, billingId));
}

// ════════════════════════════════════════════════════════════════════════════
// Upsert consumption per publisher in a billing
// ════════════════════════════════════════════════════════════════════════════

export async function setPublisherConsumption(input: {
  billingId: string;
  publisherId: string;
  amountRealUsd: number;
  isBillable?: boolean;
  notes?: string | null;
}): Promise<Result> {
  if (!Number.isFinite(input.amountRealUsd) || input.amountRealUsd < 0)
    return { ok: false, error: "Monto inválido" };

  const [existing] = await db
    .select()
    .from(planBillingPublishers)
    .where(
      and(
        eq(planBillingPublishers.planBillingId, input.billingId),
        eq(planBillingPublishers.publisherId, input.publisherId),
      ),
    )
    .limit(1);

  if (existing) {
    const updated = await db
      .update(planBillingPublishers)
      .set({
        amountRealUsd: input.amountRealUsd.toFixed(2),
        ...(input.isBillable !== undefined && { isBillable: input.isBillable }),
        ...(input.notes !== undefined && { notes: input.notes }),
      })
      .where(eq(planBillingPublishers.id, existing.id))
      .returning();

    await db.insert(auditLog).values({
      entityType: "plan_billing_publisher",
      entityId: existing.id,
      action: "update",
      beforeJson: existing,
      afterJson: updated[0],
    });
  } else {
    const [created] = await db
      .insert(planBillingPublishers)
      .values({
        planBillingId: input.billingId,
        publisherId: input.publisherId,
        amountRealUsd: input.amountRealUsd.toFixed(2),
        isBillable: input.isBillable ?? true,
        notes: input.notes ?? null,
      })
      .returning();

    await db.insert(auditLog).values({
      entityType: "plan_billing_publisher",
      entityId: created.id,
      action: "create",
      afterJson: created,
    });
  }

  await recalcBillingTotals(input.billingId);
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// Upsert fee imputation per month
// ════════════════════════════════════════════════════════════════════════════

export async function setFeeImputation(input: {
  billingId: string;
  mediaPlanFeeId: string;
  amountImputedUsd: number;
  notes?: string | null;
}): Promise<Result> {
  if (!Number.isFinite(input.amountImputedUsd) || input.amountImputedUsd < 0)
    return { ok: false, error: "Monto inválido" };

  const [existing] = await db
    .select()
    .from(planBillingFees)
    .where(
      and(
        eq(planBillingFees.planBillingId, input.billingId),
        eq(planBillingFees.mediaPlanFeeId, input.mediaPlanFeeId),
      ),
    )
    .limit(1);

  if (existing) {
    const updated = await db
      .update(planBillingFees)
      .set({
        amountImputedUsd: input.amountImputedUsd.toFixed(2),
        ...(input.notes !== undefined && { notes: input.notes }),
      })
      .where(eq(planBillingFees.id, existing.id))
      .returning();

    await db.insert(auditLog).values({
      entityType: "plan_billing_fee",
      entityId: existing.id,
      action: "update",
      beforeJson: existing,
      afterJson: updated[0],
    });
  } else {
    const [created] = await db
      .insert(planBillingFees)
      .values({
        planBillingId: input.billingId,
        mediaPlanFeeId: input.mediaPlanFeeId,
        amountImputedUsd: input.amountImputedUsd.toFixed(2),
        notes: input.notes ?? null,
      })
      .returning();

    await db.insert(auditLog).values({
      entityType: "plan_billing_fee",
      entityId: created.id,
      action: "create",
      afterJson: created,
    });
  }

  await recalcBillingTotals(input.billingId);
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// Status transitions
// ════════════════════════════════════════════════════════════════════════════

export async function transitionBillingStatus(input: {
  billingId: string;
  to: "draft" | "ready" | "sent" | "paid";
}): Promise<Result> {
  const [before] = await db
    .select()
    .from(planBillings)
    .where(eq(planBillings.id, input.billingId))
    .limit(1);
  if (!before) return { ok: false, error: "Billing no encontrado" };

  const valid: Record<string, string[]> = {
    draft: ["ready"],
    ready: ["draft", "sent"],
    sent: ["paid"],
    paid: [],
  };
  if (!valid[before.status].includes(input.to)) {
    return {
      ok: false,
      error: `Transición ${before.status} → ${input.to} no permitida`,
    };
  }

  const update: Record<string, unknown> = { status: input.to };

  if (input.to === "sent") {
    // Asignar número de factura sequential YYYY-NNNN si no tiene.
    if (!before.invoiceNumber) {
      const year = Number.parseInt(before.month.slice(0, 4), 10);
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(planBillings)
        .where(
          and(
            sql`${planBillings.month} >= ${`${year}-01`}`,
            sql`${planBillings.month} < ${`${year + 1}-01`}`,
            sql`${planBillings.invoiceNumber} IS NOT NULL`,
          ),
        );
      update.invoiceNumber = `${year}-${String(count + 1).padStart(4, "0")}`;
    }
    update.sentAt = new Date();
    const due = new Date();
    due.setDate(due.getDate() + 30);
    update.dueDate = due.toISOString().slice(0, 10);
  }
  if (input.to === "paid") update.paidAt = new Date();

  const [after] = await db
    .update(planBillings)
    .set(update)
    .where(eq(planBillings.id, input.billingId))
    .returning();

  await db.insert(auditLog).values({
    entityType: "plan_billing",
    entityId: input.billingId,
    action: "update",
    beforeJson: before,
    afterJson: after,
  });

  // Find project for revalidate
  const [plan] = await db
    .select({ projectId: mediaPlans.projectId })
    .from(mediaPlans)
    .where(eq(mediaPlans.id, before.mediaPlanId))
    .limit(1);
  if (plan) {
    const [proj] = await db
      .select({ code: projects.code })
      .from(projects)
      .where(eq(projects.id, plan.projectId))
      .limit(1);
    if (proj) {
      revalidatePath(`/proyectos/${proj.code}/planes/${before.mediaPlanId}/billing`);
      revalidatePath("/billing");
    }
  }

  return { ok: true };
}
