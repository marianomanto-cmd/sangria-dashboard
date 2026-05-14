"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  auditLog,
  campaignActualSnapshots,
  campaignPlacementActuals,
  clients,
  mediaPlanPlacements,
  mediaPlanPublishers,
  mediaPlans,
  projects,
} from "@/db/schema";
import {
  directKeysFromMetricsJson,
  isDirectMetricKey,
} from "@/lib/campaign-metrics";

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

// ════════════════════════════════════════════════════════════════════════════
// closeDailyLoad — "Cerrar carga del día". Toma un snapshot del estado actual
// (lo que hay en campaign_placement_actuals) y lo persiste en el histórico
// append-only campaign_actual_snapshots, fechado con el día de hoy.
//
// No bloquea la edición: se puede seguir cargando y volver a cerrar — el
// re-cierre del mismo día actualiza el snapshot (unique placement+métrica+
// fecha). Snapshotea TODAS las métricas direct de cada placement (aunque
// estén en 0) para que el histórico sea una grilla completa para Reportes.
// ════════════════════════════════════════════════════════════════════════════

export async function closeDailyLoad(input: {
  planId: string;
}): Promise<Result<{ snapshotDate: string; rowCount: number }>> {
  // Estructura del plan: cada placement con su contexto denormalizado.
  const rows = await db
    .select({
      placementId: mediaPlanPlacements.id,
      amountUsd: mediaPlanPlacements.amountUsd,
      metricsJson: mediaPlanPlacements.metricsJson,
      marketId: mediaPlanPlacements.marketId,
      publisherId: mediaPlanPublishers.publisherId,
      mediaPlanId: mediaPlanPublishers.mediaPlanId,
      projectId: projects.id,
      clientId: clients.id,
    })
    .from(mediaPlanPlacements)
    .innerJoin(
      mediaPlanPublishers,
      eq(mediaPlanPlacements.mediaPlanPublisherId, mediaPlanPublishers.id),
    )
    .innerJoin(mediaPlans, eq(mediaPlanPublishers.mediaPlanId, mediaPlans.id))
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(eq(mediaPlanPublishers.mediaPlanId, input.planId));

  if (rows.length === 0)
    return { ok: false, error: "El plan no tiene placements para cerrar" };

  const placementIds = rows.map((r) => r.placementId);

  // Estado actual cargado (capa viva).
  const liveRows = await db
    .select({
      placementId: campaignPlacementActuals.placementId,
      metricKey: campaignPlacementActuals.metricKey,
      valueActual: campaignPlacementActuals.valueActual,
    })
    .from(campaignPlacementActuals)
    .where(inArray(campaignPlacementActuals.placementId, placementIds));

  const liveByPlacement = new Map<string, Map<string, number>>();
  for (const r of liveRows) {
    let m = liveByPlacement.get(r.placementId);
    if (!m) {
      m = new Map();
      liveByPlacement.set(r.placementId, m);
    }
    m.set(r.metricKey, Number.parseFloat(r.valueActual));
  }

  const snapshotDate = new Date().toISOString().slice(0, 10);

  const values: (typeof campaignActualSnapshots.$inferInsert)[] = [];
  for (const r of rows) {
    const metricsJson = (r.metricsJson ?? {}) as Record<string, number>;
    const directKeys = ["amount", ...directKeysFromMetricsJson(metricsJson)];
    const live = liveByPlacement.get(r.placementId);
    for (const key of directKeys) {
      const goal =
        key === "amount"
          ? Number.parseFloat(r.amountUsd)
          : (metricsJson[key] ?? 0);
      values.push({
        clientId: r.clientId,
        projectId: r.projectId,
        mediaPlanId: r.mediaPlanId,
        publisherId: r.publisherId,
        marketId: r.marketId,
        placementId: r.placementId,
        metricKey: key,
        valueAccumulated: (live?.get(key) ?? 0).toFixed(4),
        goalValue: goal > 0 ? goal.toFixed(4) : null,
        snapshotDate,
      });
    }
  }

  await db
    .insert(campaignActualSnapshots)
    .values(values)
    .onConflictDoUpdate({
      target: [
        campaignActualSnapshots.placementId,
        campaignActualSnapshots.metricKey,
        campaignActualSnapshots.snapshotDate,
      ],
      set: {
        valueAccumulated: sql`excluded.value_accumulated`,
        goalValue: sql`excluded.goal_value`,
        closedAt: sql`excluded.closed_at`,
      },
    });

  await db.insert(auditLog).values({
    entityType: "campaign_daily_close",
    entityId: input.planId,
    action: "create",
    afterJson: { snapshotDate, rowCount: values.length },
  });

  revalidatePath(`/campaign-tracker/${input.planId}`);
  revalidatePath("/campaign-tracker");

  return { ok: true, snapshotDate, rowCount: values.length };
}
