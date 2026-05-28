// Query del generador de reportes históricos (/reportes/generador).
//
// Devuelve 1 fila por placement que tiene data histórica cargada (billing o
// tracker) dentro del rango de fechas pedido + el resto de filtros. El propósito
// es alimentar tanto el preview en pantalla como el Excel descargable: ambos
// deben mostrar exactamente los mismos números.
//
// Reglas de agregación:
// - Tracker: `campaign_actual_snapshots.value_accumulated` es un total
//   acumulado a la fecha del cierre del día. Para una ventana [from, to]
//   tomamos el último snapshot por (placement, metric) dentro de la ventana
//   (es decir el valor acumulado al cierre del rango).
// - Billing: `plan_billing_publishers.amount_real_usd` se carga a nivel
//   publisher×mes, no por placement. Se prorratea a cada placement por la
//   fracción `placement.amount_usd / Σ amount_usd de placements del publisher
//   en el plan`. Es una atribución derivada — la única manera honesta de bajar
//   el billing a granularidad de placement.
// - Un placement aparece en el resultado si tiene billing prorrateado > 0 O al
//   menos un snapshot de tracker dentro de la ventana.

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  budgetOrigins,
  campaignActualSnapshots,
  clients,
  markets,
  mediaPlans,
  mediaPlanPlacements,
  mediaPlanPublishers,
  metricsCatalog,
  planBillings,
  planBillingPublishers,
  projects,
  publishers,
} from "@/db/schema";

export type HistoricalReportFilters = {
  clientId?: string | null;
  budgetOriginId?: string | null;
  projectId?: string | null;
  planId?: string | null;
  placementId?: string | null;
  fromMonth?: string | null; // YYYY-MM (inclusive)
  toMonth?: string | null; // YYYY-MM (inclusive)
};

export type HistoricalReportRow = {
  placementId: string;
  placementName: string;
  marketName: string | null;
  audience: string | null;
  costMethod: string | null;
  startDate: string | null;
  endDate: string | null;
  plannedUsd: number;
  // Identity (denormalized para que cada fila sea autocontenida en el Excel).
  clientName: string;
  clientSlug: string;
  projectCode: string;
  projectName: string;
  budgetOriginName: string;
  planId: string;
  planName: string;
  publisherId: string;
  publisherName: string;
  // Billing prorrateado dentro de la ventana, sumando todos los meses.
  billedShareUsd: number;
  // Tracker: último valor acumulado dentro de la ventana, por metric slug.
  trackedMetrics: Record<string, number>;
};

// Columnas de métricas a mostrar: las que aparecen en al menos un placement
// con valor finito > 0. El page/Excel deciden cómo ordenarlas + cómo
// formatearlas (% / $ / count) usando el metrics_catalog del cliente.
export type HistoricalReportMetricColumn = {
  slug: string;
  name: string;
  unit: string | null;
};

export type HistoricalReportResult = {
  rows: HistoricalReportRow[];
  metricColumns: HistoricalReportMetricColumn[];
  // Cuántos placements quedaron por filtro vs cuántos tienen data dentro del
  // rango (para mostrar "X de Y" en el preview).
  totalPlacementsInScope: number;
};

// Fecha de fin del mes YYYY-MM (último día) en ISO YYYY-MM-DD. Pasar diciembre
// devuelve 'YYYY-12-31'. Usado para que el filtro toMonth sea inclusivo del mes
// completo en las queries a snapshot_date.
function endOfMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split("-").map(Number);
  // Día 0 del mes siguiente = último día del mes actual.
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

function startOfMonth(yyyymm: string): string {
  return `${yyyymm}-01`;
}

export async function getHistoricalReport(
  filters: HistoricalReportFilters,
): Promise<HistoricalReportResult> {
  const fromDate = filters.fromMonth ? startOfMonth(filters.fromMonth) : null;
  const toDate = filters.toMonth ? endOfMonth(filters.toMonth) : null;

  // ── 1) Snapshots de tracker dentro de la ventana + filtros ──────────────
  // campaign_actual_snapshots denormaliza client/project/plan/publisher, así
  // que filtramos directo sin joinear (y son indexed).
  const snapConds = [];
  if (filters.clientId) snapConds.push(eq(campaignActualSnapshots.clientId, filters.clientId));
  if (filters.projectId)
    snapConds.push(eq(campaignActualSnapshots.projectId, filters.projectId));
  if (filters.planId) snapConds.push(eq(campaignActualSnapshots.mediaPlanId, filters.planId));
  if (filters.placementId)
    snapConds.push(eq(campaignActualSnapshots.placementId, filters.placementId));
  if (fromDate) snapConds.push(sql`${campaignActualSnapshots.snapshotDate} >= ${fromDate}`);
  if (toDate) snapConds.push(sql`${campaignActualSnapshots.snapshotDate} <= ${toDate}`);

  // budget_origin no está denormalizado en snapshots: si filtra por origen
  // tenemos que joinear projects para filtrarlo.
  const snapRows = filters.budgetOriginId
    ? await db
        .select({
          placementId: campaignActualSnapshots.placementId,
          metricKey: campaignActualSnapshots.metricKey,
          valueAccumulated: campaignActualSnapshots.valueAccumulated,
          snapshotDate: campaignActualSnapshots.snapshotDate,
        })
        .from(campaignActualSnapshots)
        .innerJoin(projects, eq(projects.id, campaignActualSnapshots.projectId))
        .where(
          and(
            eq(projects.budgetOriginId, filters.budgetOriginId),
            ...snapConds,
          ),
        )
    : snapConds.length === 0
      ? await db
          .select({
            placementId: campaignActualSnapshots.placementId,
            metricKey: campaignActualSnapshots.metricKey,
            valueAccumulated: campaignActualSnapshots.valueAccumulated,
            snapshotDate: campaignActualSnapshots.snapshotDate,
          })
          .from(campaignActualSnapshots)
      : await db
          .select({
            placementId: campaignActualSnapshots.placementId,
            metricKey: campaignActualSnapshots.metricKey,
            valueAccumulated: campaignActualSnapshots.valueAccumulated,
            snapshotDate: campaignActualSnapshots.snapshotDate,
          })
          .from(campaignActualSnapshots)
          .where(and(...snapConds));

  // Por (placement, metric) → último snapshot dentro de la ventana. La
  // unique constraint del schema garantiza un snapshot por (placement,
  // metric, day), así que ordenar por snapshot_date desc y quedarnos con
  // el primero es determinístico.
  const latest = new Map<string, { date: string; value: number }>();
  for (const r of snapRows) {
    const k = `${r.placementId}::${r.metricKey}`;
    const prev = latest.get(k);
    if (!prev || r.snapshotDate > prev.date) {
      latest.set(k, {
        date: r.snapshotDate,
        value: Number.parseFloat(r.valueAccumulated),
      });
    }
  }
  const trackerByPlacement = new Map<string, Map<string, number>>();
  for (const [k, { value }] of latest) {
    const sep = k.indexOf("::");
    const pid = k.slice(0, sep);
    const mk = k.slice(sep + 2);
    const cur = trackerByPlacement.get(pid) ?? new Map<string, number>();
    cur.set(mk, value);
    trackerByPlacement.set(pid, cur);
  }

  // ── 2) Billing dentro de la ventana ─────────────────────────────────────
  // Necesitamos $ por (publisher, plan) sumando los meses en ventana.
  const billConds = [];
  if (fromDate) billConds.push(sql`${planBillings.month} >= ${filters.fromMonth ?? ""}`);
  if (toDate) billConds.push(sql`${planBillings.month} <= ${filters.toMonth ?? ""}`);
  if (filters.planId) billConds.push(eq(planBillings.mediaPlanId, filters.planId));

  const billRowsRaw = await db
    .select({
      planId: planBillings.mediaPlanId,
      publisherId: planBillingPublishers.publisherId,
      amountRealUsd: planBillingPublishers.amountRealUsd,
    })
    .from(planBillings)
    .innerJoin(
      planBillingPublishers,
      eq(planBillingPublishers.planBillingId, planBillings.id),
    )
    .where(billConds.length === 0 ? undefined : and(...billConds));

  // Suma por (planId, publisherId).
  const billedByPubInPlan = new Map<string, number>();
  for (const r of billRowsRaw) {
    const key = `${r.planId}::${r.publisherId}`;
    billedByPubInPlan.set(
      key,
      (billedByPubInPlan.get(key) ?? 0) + Number.parseFloat(r.amountRealUsd),
    );
  }

  // ── 3) Trae metadata de placements que tienen tracker o están en planes
  //    que tuvieron billing en la ventana ────────────────────────────────
  // Para el prorrateo necesitamos placement.amountUsd + media_plan_publisher_id.
  // Filtros vivos sobre estructura: usamos mediaPlans/projects/clients.
  const placementMetadataConds = [isNull(mediaPlans.deletedAt)];
  if (filters.clientId)
    placementMetadataConds.push(eq(projects.clientId, filters.clientId));
  if (filters.budgetOriginId)
    placementMetadataConds.push(
      eq(projects.budgetOriginId, filters.budgetOriginId),
    );
  if (filters.projectId)
    placementMetadataConds.push(eq(projects.id, filters.projectId));
  if (filters.planId) placementMetadataConds.push(eq(mediaPlans.id, filters.planId));
  if (filters.placementId)
    placementMetadataConds.push(eq(mediaPlanPlacements.id, filters.placementId));

  const placementMeta = await db
    .select({
      placementId: mediaPlanPlacements.id,
      placementName: mediaPlanPlacements.placementName,
      audience: mediaPlanPlacements.audience,
      amountUsd: mediaPlanPlacements.amountUsd,
      costMethod: mediaPlanPlacements.costMethod,
      startDate: mediaPlanPlacements.startDate,
      endDate: mediaPlanPlacements.endDate,
      marketName: markets.name,
      mediaPlanPublisherId: mediaPlanPlacements.mediaPlanPublisherId,
      publisherId: mediaPlanPublishers.publisherId,
      publisherName: publishers.name,
      planId: mediaPlans.id,
      planName: mediaPlans.name,
      projectId: projects.id,
      projectCode: projects.code,
      projectName: projects.name,
      budgetOriginName: budgetOrigins.name,
      clientName: clients.name,
      clientSlug: clients.slug,
      clientId: clients.id,
    })
    .from(mediaPlanPlacements)
    .innerJoin(
      mediaPlanPublishers,
      eq(mediaPlanPublishers.id, mediaPlanPlacements.mediaPlanPublisherId),
    )
    .innerJoin(publishers, eq(publishers.id, mediaPlanPublishers.publisherId))
    .innerJoin(mediaPlans, eq(mediaPlans.id, mediaPlanPublishers.mediaPlanId))
    .innerJoin(projects, eq(projects.id, mediaPlans.projectId))
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .innerJoin(budgetOrigins, eq(budgetOrigins.id, projects.budgetOriginId))
    .leftJoin(markets, eq(markets.id, mediaPlanPlacements.marketId))
    .where(and(...placementMetadataConds));

  // Suma de amount_usd por (planId, publisherId) para denominador del
  // prorrateo (separado de la query de billing para no romper el sum por
  // cartesians u otros joins).
  const planPubAmountTotal = new Map<string, number>();
  for (const p of placementMeta) {
    const key = `${p.planId}::${p.publisherId}`;
    planPubAmountTotal.set(
      key,
      (planPubAmountTotal.get(key) ?? 0) + Number.parseFloat(p.amountUsd),
    );
  }

  // ── 4) Construir filas finales (solo placements con data histórica) ────
  const rows: HistoricalReportRow[] = [];
  const metricsSeen = new Set<string>();
  for (const p of placementMeta) {
    const key = `${p.planId}::${p.publisherId}`;
    const pubBilled = billedByPubInPlan.get(key) ?? 0;
    const pubTotalPlanned = planPubAmountTotal.get(key) ?? 0;
    const placementShare = pubTotalPlanned > 0
      ? Number.parseFloat(p.amountUsd) / pubTotalPlanned
      : 0;
    const placementBilled = pubBilled * placementShare;
    const tracker = trackerByPlacement.get(p.placementId);
    const hasTracker = tracker != null && tracker.size > 0;
    const hasBilling = placementBilled > 0.005;
    if (!hasTracker && !hasBilling) continue;

    // metricKey 'amount' del tracker es el $ consumido cargado por la
    // trafficker; no es una métrica del catálogo. Lo dejamos fuera del set
    // de columnas de métricas (se podría exponer aparte pero por simplicidad
    // v1 no se muestra — el billing ya cubre el $ histórico).
    const trackedMetrics: Record<string, number> = {};
    if (tracker) {
      for (const [k, v] of tracker) {
        if (k === "amount") continue;
        trackedMetrics[k] = v;
        metricsSeen.add(k);
      }
    }

    rows.push({
      placementId: p.placementId,
      placementName: p.placementName,
      marketName: p.marketName ?? null,
      audience: p.audience ?? null,
      costMethod: p.costMethod ?? null,
      startDate: p.startDate ?? null,
      endDate: p.endDate ?? null,
      plannedUsd: Number.parseFloat(p.amountUsd),
      clientName: p.clientName,
      clientSlug: p.clientSlug,
      projectCode: p.projectCode,
      projectName: p.projectName,
      budgetOriginName: p.budgetOriginName,
      planId: p.planId,
      planName: p.planName,
      publisherId: p.publisherId,
      publisherName: p.publisherName,
      billedShareUsd: placementBilled,
      trackedMetrics,
    });
  }

  // Si filtraron por placement específico, también traemos placements que
  // tienen tracker pero ningún billing (ya cubierto arriba). Para placements
  // que tienen tracker pero ya no están en placementMeta (porque el plan
  // se eliminó), v1 los ignoramos — los snapshots son self-contained pero el
  // schema vivo no resuelve la metadata. Si esto pasa en la práctica,
  // próxima iteración: traer también data desde el snapshot mismo.

  // ── 5) Columnas de métricas: ordenar por catálogo del cliente si hay un
  //    cliente filtrado; si no, por slug A-Z (no podemos resolver name/unit
  //    sin clientId).
  const metricColumns: HistoricalReportMetricColumn[] = [];
  if (metricsSeen.size > 0 && filters.clientId) {
    const cat = await db
      .select({
        slug: metricsCatalog.slug,
        name: metricsCatalog.name,
        unit: metricsCatalog.unit,
        sortOrder: metricsCatalog.sortOrder,
      })
      .from(metricsCatalog)
      .where(
        and(
          eq(metricsCatalog.clientId, filters.clientId),
          inArray(metricsCatalog.slug, [...metricsSeen]),
        ),
      )
      .orderBy(metricsCatalog.sortOrder, metricsCatalog.name);
    for (const m of cat) {
      metricColumns.push({ slug: m.slug, name: m.name, unit: m.unit });
    }
    // Slugs presentes pero no en el catálogo del cliente: igual los mostramos
    // por slug (fallback graceful).
    const inCatalog = new Set(cat.map((m) => m.slug));
    for (const slug of metricsSeen) {
      if (!inCatalog.has(slug))
        metricColumns.push({ slug, name: slug, unit: null });
    }
  } else {
    for (const slug of [...metricsSeen].sort()) {
      metricColumns.push({ slug, name: slug, unit: null });
    }
  }

  rows.sort((a, b) => {
    const c = a.projectName.localeCompare(b.projectName);
    if (c !== 0) return c;
    const c2 = a.planName.localeCompare(b.planName);
    if (c2 !== 0) return c2;
    const c3 = a.publisherName.localeCompare(b.publisherName);
    if (c3 !== 0) return c3;
    return a.placementName.localeCompare(b.placementName);
  });

  return {
    rows,
    metricColumns,
    totalPlacementsInScope: placementMeta.length,
  };
}

// ── Opciones de filtros para el form ────────────────────────────────────────
// Devuelve los listados para los dropdowns cascading. Server-side, una sola
// query con joins; el client-side filtra/cascada localmente.

export type ReportFilterOptions = {
  budgetOrigins: { id: string; name: string }[];
  projects: { id: string; code: string; name: string; budgetOriginId: string }[];
  plans: { id: string; name: string; projectId: string }[];
  placements: { id: string; name: string; planId: string; publisherName: string }[];
  // Catálogo de métricas del cliente, para el column picker del form. Incluye
  // direct y calculated; el report sólo materializa los direct (los snapshots
  // sólo guardan direct), pero la lista completa se expone para que el form
  // sepa qué chequear.
  metrics: { slug: string; name: string; unit: string | null; kind: "direct" | "calculated" }[];
};

export async function getReportFilterOptions(
  clientId: string | null,
): Promise<ReportFilterOptions> {
  if (!clientId) {
    return {
      budgetOrigins: [],
      projects: [],
      plans: [],
      placements: [],
      metrics: [],
    };
  }

  const [origins, projs, plans, placs, metrics] = await Promise.all([
    db
      .select({ id: budgetOrigins.id, name: budgetOrigins.name })
      .from(budgetOrigins)
      .where(eq(budgetOrigins.clientId, clientId))
      .orderBy(budgetOrigins.name),
    db
      .select({
        id: projects.id,
        code: projects.code,
        name: projects.name,
        budgetOriginId: projects.budgetOriginId,
      })
      .from(projects)
      .where(eq(projects.clientId, clientId))
      .orderBy(projects.name),
    db
      .select({
        id: mediaPlans.id,
        name: mediaPlans.name,
        projectId: mediaPlans.projectId,
      })
      .from(mediaPlans)
      .innerJoin(projects, eq(projects.id, mediaPlans.projectId))
      .where(
        and(eq(projects.clientId, clientId), isNull(mediaPlans.deletedAt)),
      )
      .orderBy(mediaPlans.name),
    db
      .select({
        id: mediaPlanPlacements.id,
        name: mediaPlanPlacements.placementName,
        planId: mediaPlans.id,
        publisherName: publishers.name,
      })
      .from(mediaPlanPlacements)
      .innerJoin(
        mediaPlanPublishers,
        eq(mediaPlanPublishers.id, mediaPlanPlacements.mediaPlanPublisherId),
      )
      .innerJoin(publishers, eq(publishers.id, mediaPlanPublishers.publisherId))
      .innerJoin(mediaPlans, eq(mediaPlans.id, mediaPlanPublishers.mediaPlanId))
      .innerJoin(projects, eq(projects.id, mediaPlans.projectId))
      .where(
        and(eq(projects.clientId, clientId), isNull(mediaPlans.deletedAt)),
      )
      .orderBy(mediaPlanPlacements.placementName),
    db
      .select({
        slug: metricsCatalog.slug,
        name: metricsCatalog.name,
        unit: metricsCatalog.unit,
        kind: metricsCatalog.kind,
      })
      .from(metricsCatalog)
      .where(
        and(
          eq(metricsCatalog.clientId, clientId),
          eq(metricsCatalog.enabled, true),
        ),
      )
      .orderBy(metricsCatalog.sortOrder, metricsCatalog.name),
  ]);

  return {
    budgetOrigins: origins,
    projects: projs,
    plans,
    placements: placs,
    metrics,
  };
}
