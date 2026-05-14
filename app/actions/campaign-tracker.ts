"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  auditLog,
  campaignPlacementActuals,
  mediaPlanPlacements,
  mediaPlanPublishers,
} from "@/db/schema";
import { isDirectMetricKey } from "@/lib/campaign-metrics";

type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true } & T)
  | { ok: false; error: string };

// ════════════════════════════════════════════════════════════════════════════
// setPlacementActual — upsert del valor real acumulado de una métrica direct
// de un placement. NO es time-series: hay un solo row por (placement, métrica)
// y el valor se reemplaza. Las métricas calculadas (CPM, CTR…) no se cargan
// acá: se derivan en runtime.
// ════════════════════════════════════════════════════════════════════════════

export async function setPlacementActual(input: {
  planId: string;
  placementId: string;
  metricKey: string;
  value: number;
}): Promise<Result> {
  if (!Number.isFinite(input.value) || input.value < 0)
    return { ok: false, error: "Valor inválido" };
  if (!isDirectMetricKey(input.metricKey))
    return {
      ok: false,
      error: `La métrica "${input.metricKey}" no es editable (es calculada o desconocida)`,
    };

  // El placement tiene que existir y pertenecer al plan indicado.
  const [placement] = await db
    .select({
      id: mediaPlanPlacements.id,
      planId: mediaPlanPublishers.mediaPlanId,
    })
    .from(mediaPlanPlacements)
    .innerJoin(
      mediaPlanPublishers,
      eq(mediaPlanPlacements.mediaPlanPublisherId, mediaPlanPublishers.id),
    )
    .where(eq(mediaPlanPlacements.id, input.placementId))
    .limit(1);

  if (!placement) return { ok: false, error: "Placement no encontrado" };
  if (placement.planId !== input.planId)
    return { ok: false, error: "El placement no pertenece a este plan" };

  const [existing] = await db
    .select()
    .from(campaignPlacementActuals)
    .where(
      and(
        eq(campaignPlacementActuals.placementId, input.placementId),
        eq(campaignPlacementActuals.metricKey, input.metricKey),
      ),
    )
    .limit(1);

  const valueStr = input.value.toFixed(4);

  if (existing) {
    const [updated] = await db
      .update(campaignPlacementActuals)
      .set({ valueActual: valueStr, updatedAt: new Date() })
      .where(eq(campaignPlacementActuals.id, existing.id))
      .returning();
    await db.insert(auditLog).values({
      entityType: "campaign_placement_actual",
      entityId: existing.id,
      action: "update",
      beforeJson: existing,
      afterJson: updated,
    });
  } else {
    const [created] = await db
      .insert(campaignPlacementActuals)
      .values({
        placementId: input.placementId,
        metricKey: input.metricKey,
        valueActual: valueStr,
      })
      .returning();
    await db.insert(auditLog).values({
      entityType: "campaign_placement_actual",
      entityId: created.id,
      action: "create",
      afterJson: created,
    });
  }

  revalidatePath(`/campaign-tracker/${input.planId}`);
  revalidatePath("/campaign-tracker");

  return { ok: true };
}
