// ════════════════════════════════════════════════════════════════════════════
// Diff entre dos versiones aprobadas de un plan.
//
// El historial de versiones (abajo del editor) despliega cada versión y muestra
// QUÉ cambió respecto de la anterior y CUÁNDO. La fuente es el snapshot
// inmutable de cada versión (`media_plan_snapshots.snapshot_json`), no el
// audit_log: el snapshot es exactamente lo que se aprobó, así que el diff es
// determinístico y no depende de que el audit haya registrado cada evento.
//
// Matching entre versiones por `id` de fila (los uuid sobreviven a las
// ediciones: `updatePlacement` muta la misma row). Una línea nueva trae id
// nuevo → "agregada"; una que desapareció → "eliminada".
//
// Publisher y market se muestran con el nombre ACTUAL del catálogo (el
// snapshot congela ids), igual que `getPlanDetailAtVersion`.
// ════════════════════════════════════════════════════════════════════════════

import type {
  mediaPlanFees,
  mediaPlanPlacements,
  mediaPlanPublishers,
  mediaPlans,
} from "@/db/schema";

// Forma de lo que guarda `capturePlanSnapshot` (app/actions/plans.ts). Los
// numéricos y las fechas vuelven del JSONB como string.
export type CapturedSnapshot = {
  plan?: typeof mediaPlans.$inferSelect;
  publishers?: (typeof mediaPlanPublishers.$inferSelect)[];
  placements?: (typeof mediaPlanPlacements.$inferSelect)[];
  fees?: (typeof mediaPlanFees.$inferSelect)[];
};

export type NameLookups = {
  publisherName: (id: string) => string;
  marketName: (id: string | null) => string | null;
  // Nombre visible de una métrica del catálogo por slug (para el diff de
  // metrics_json). Si no está en el catálogo se usa el slug.
  metricName: (slug: string) => string;
  // true si el slug es una métrica direct (delivery). El delivery se guarda
  // exacto y se muestra redondeado, así que el diff lo formatea sin decimales
  // para no contradecir a la grilla, al PDF y al Excel.
  metricIsCount: (slug: string) => boolean;
};

export type FieldChange = {
  label: string;
  before: string;
  after: string;
};

export type LineChange = {
  kind: "added" | "removed" | "changed";
  publisherName: string;
  placementName: string;
  amountBefore: number | null;
  amountAfter: number | null;
  fields: FieldChange[];
};

export type PublisherChange = {
  kind: "added" | "removed" | "changed";
  publisherName: string;
  totalBefore: number | null;
  totalAfter: number | null;
};

export type FeeChange = {
  kind: "added" | "removed" | "changed";
  name: string;
  amountBefore: number | null;
  amountAfter: number | null;
  fields: FieldChange[];
};

export type PlanVersionDiff = {
  // v1 (o una versión sin anterior): no hay contra qué comparar, se describe
  // el contenido en vez del cambio.
  isInitial: boolean;
  planFields: FieldChange[];
  publishers: PublisherChange[];
  lines: LineChange[];
  fees: FeeChange[];
  totals: {
    mediaBefore: number;
    mediaAfter: number;
    feesBefore: number;
    feesAfter: number;
    grandBefore: number;
    grandAfter: number;
  };
  counts: {
    linesBefore: number;
    linesAfter: number;
    added: number;
    removed: number;
    changed: number;
  };
  // Total de cambios detectados (plan + publishers + líneas + fees).
  changeCount: number;
};

const num = (v: string | null | undefined): number => {
  const n = Number.parseFloat(v ?? "0");
  return Number.isFinite(n) ? n : 0;
};

const txt = (v: unknown): string => {
  if (v == null || v === "") return "—";
  return String(v);
};

const money = (n: number): string =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

// Media total de un snapshot = suma de los montos de sus placements. Se usa
// para derivar los management fees (que guardan % y no monto).
function mediaOf(snap: CapturedSnapshot): number {
  return (snap.placements ?? []).reduce((s, p) => s + num(p.amountUsd), 0);
}

// Monto efectivo de un fee, con la misma fórmula que usa getPlanDetail: un
// management fee con ratePct válido deriva su monto de la media total.
function feeAmount(
  fee: typeof mediaPlanFees.$inferSelect,
  totalMedia: number,
): number {
  const ratePct = fee.ratePct ? Number.parseFloat(fee.ratePct) : null;
  if (
    fee.feeType === "management" &&
    ratePct != null &&
    ratePct > 0 &&
    ratePct < 100
  ) {
    return (totalMedia * ratePct) / (100 - ratePct);
  }
  return num(fee.amountUsd);
}

function byId<T extends { id: string }>(rows: T[] | undefined): Map<string, T> {
  return new Map((rows ?? []).map((r) => [r.id, r]));
}

// Diff de los indicadores cargados a mano (metrics_json). Compara clave por
// clave: agregadas, quitadas y cambiadas.
function metricFieldChanges(
  before: Record<string, number> | null | undefined,
  after: Record<string, number> | null | undefined,
  names: NameLookups,
): FieldChange[] {
  const b = before ?? {};
  const a = after ?? {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();
  const out: FieldChange[] = [];
  for (const k of keys) {
    const bv = typeof b[k] === "number" && Number.isFinite(b[k]) ? b[k] : null;
    const av = typeof a[k] === "number" && Number.isFinite(a[k]) ? a[k] : null;
    if (bv === av) continue;
    const count = names.metricIsCount(k);
    const fmt = (v: number) =>
      v.toLocaleString("en-US", count ? { maximumFractionDigits: 0 } : undefined);
    out.push({
      label: names.metricName(k),
      before: bv == null ? "—" : fmt(bv),
      after: av == null ? "—" : fmt(av),
    });
  }
  return out;
}

function placementFieldChanges(
  b: typeof mediaPlanPlacements.$inferSelect,
  a: typeof mediaPlanPlacements.$inferSelect,
  names: NameLookups,
): FieldChange[] {
  const out: FieldChange[] = [];
  const push = (label: string, before: unknown, after: unknown) => {
    const bs = txt(before);
    const as_ = txt(after);
    if (bs !== as_) out.push({ label, before: bs, after: as_ });
  };

  push("Nombre", b.placementName, a.placementName);
  push("Mercado", names.marketName(b.marketId), names.marketName(a.marketId));
  if (num(b.amountUsd) !== num(a.amountUsd)) {
    out.push({
      label: "Inversión",
      before: money(num(b.amountUsd)),
      after: money(num(a.amountUsd)),
    });
  }
  push("Cost method", b.costMethod, a.costMethod);
  push("Inicio", b.startDate, a.startDate);
  push("Fin", b.endDate, a.endDate);
  push("Audiencia", b.audience, a.audience);
  push("Notas", b.notesMd, a.notesMd);
  out.push(...metricFieldChanges(b.metricsJson, a.metricsJson, names));
  return out;
}

function feeFieldChanges(
  b: typeof mediaPlanFees.$inferSelect,
  a: typeof mediaPlanFees.$inferSelect,
  mediaBefore: number,
  mediaAfter: number,
): FieldChange[] {
  const out: FieldChange[] = [];
  if (b.name !== a.name) {
    out.push({ label: "Nombre", before: txt(b.name), after: txt(a.name) });
  }
  if (b.feeType !== a.feeType) {
    out.push({ label: "Tipo", before: txt(b.feeType), after: txt(a.feeType) });
  }
  const bRate = b.ratePct ? Number.parseFloat(b.ratePct) : null;
  const aRate = a.ratePct ? Number.parseFloat(a.ratePct) : null;
  if (bRate !== aRate) {
    out.push({
      label: "Rate",
      before: bRate == null ? "—" : `${bRate}%`,
      after: aRate == null ? "—" : `${aRate}%`,
    });
  }
  const bAmt = feeAmount(b, mediaBefore);
  const aAmt = feeAmount(a, mediaAfter);
  if (Math.round(bAmt) !== Math.round(aAmt)) {
    out.push({ label: "Monto", before: money(bAmt), after: money(aAmt) });
  }
  if (txt(b.notes) !== txt(a.notes)) {
    out.push({ label: "Notas", before: txt(b.notes), after: txt(a.notes) });
  }
  return out;
}

export function buildPlanVersionDiff(
  prev: CapturedSnapshot | null,
  next: CapturedSnapshot,
  names: NameLookups,
): PlanVersionDiff {
  const mediaBefore = prev ? mediaOf(prev) : 0;
  const mediaAfter = mediaOf(next);
  const feesBefore = prev
    ? (prev.fees ?? []).reduce((s, f) => s + feeAmount(f, mediaBefore), 0)
    : 0;
  const feesAfter = (next.fees ?? []).reduce(
    (s, f) => s + feeAmount(f, mediaAfter),
    0,
  );

  const totals = {
    mediaBefore,
    mediaAfter,
    feesBefore,
    feesAfter,
    grandBefore: mediaBefore + feesBefore,
    grandAfter: mediaAfter + feesAfter,
  };

  const nextPubs = byId(next.publishers);
  const prevPubs = byId(prev?.publishers);
  const pubNameOf = (mppId: string | null | undefined): string => {
    if (!mppId) return "—";
    const row = nextPubs.get(mppId) ?? prevPubs.get(mppId);
    return row ? names.publisherName(row.publisherId) : "—";
  };

  const linesBefore = (prev?.placements ?? []).length;
  const linesAfter = (next.placements ?? []).length;

  // ── Versión inicial: no hay contra qué comparar ──────────────────────────
  if (!prev) {
    return {
      isInitial: true,
      planFields: [],
      publishers: [],
      lines: [],
      fees: [],
      totals,
      counts: {
        linesBefore: 0,
        linesAfter,
        added: linesAfter,
        removed: 0,
        changed: 0,
      },
      changeCount: 0,
    };
  }

  // ── Metadata del plan ────────────────────────────────────────────────────
  const planFields: FieldChange[] = [];
  if (prev.plan && next.plan) {
    if (prev.plan.name !== next.plan.name) {
      planFields.push({
        label: "Nombre del plan",
        before: txt(prev.plan.name),
        after: txt(next.plan.name),
      });
    }
    if (txt(prev.plan.notesMd) !== txt(next.plan.notesMd)) {
      planFields.push({
        label: "Notas del plan",
        before: txt(prev.plan.notesMd),
        after: txt(next.plan.notesMd),
      });
    }
  }

  // ── Bloques de publisher ─────────────────────────────────────────────────
  const publisherChanges: PublisherChange[] = [];
  for (const [id, a] of nextPubs) {
    const b = prevPubs.get(id);
    if (!b) {
      publisherChanges.push({
        kind: "added",
        publisherName: names.publisherName(a.publisherId),
        totalBefore: null,
        totalAfter: num(a.totalPlannedUsd),
      });
    } else if (num(b.totalPlannedUsd) !== num(a.totalPlannedUsd)) {
      publisherChanges.push({
        kind: "changed",
        publisherName: names.publisherName(a.publisherId),
        totalBefore: num(b.totalPlannedUsd),
        totalAfter: num(a.totalPlannedUsd),
      });
    }
  }
  for (const [id, b] of prevPubs) {
    if (nextPubs.has(id)) continue;
    publisherChanges.push({
      kind: "removed",
      publisherName: names.publisherName(b.publisherId),
      totalBefore: num(b.totalPlannedUsd),
      totalAfter: null,
    });
  }

  // ── Líneas (placements) ──────────────────────────────────────────────────
  const nextPl = byId(next.placements);
  const prevPl = byId(prev.placements);
  const lines: LineChange[] = [];
  let added = 0;
  let removed = 0;
  let changed = 0;

  for (const [id, a] of nextPl) {
    const b = prevPl.get(id);
    if (!b) {
      added++;
      lines.push({
        kind: "added",
        publisherName: pubNameOf(a.mediaPlanPublisherId),
        placementName: a.placementName,
        amountBefore: null,
        amountAfter: num(a.amountUsd),
        fields: [],
      });
      continue;
    }
    const fields = placementFieldChanges(b, a, names);
    // Mover una línea de bloque de publisher también es un cambio real.
    if (b.mediaPlanPublisherId !== a.mediaPlanPublisherId) {
      fields.unshift({
        label: "Publisher",
        before: pubNameOf(b.mediaPlanPublisherId),
        after: pubNameOf(a.mediaPlanPublisherId),
      });
    }
    if (fields.length === 0) continue;
    changed++;
    lines.push({
      kind: "changed",
      publisherName: pubNameOf(a.mediaPlanPublisherId),
      placementName: a.placementName,
      amountBefore: num(b.amountUsd),
      amountAfter: num(a.amountUsd),
      fields,
    });
  }
  for (const [id, b] of prevPl) {
    if (nextPl.has(id)) continue;
    removed++;
    lines.push({
      kind: "removed",
      publisherName: pubNameOf(b.mediaPlanPublisherId),
      placementName: b.placementName,
      amountBefore: num(b.amountUsd),
      amountAfter: null,
      fields: [],
    });
  }

  // Orden estable y legible: agregadas, cambiadas, eliminadas; dentro de cada
  // grupo por publisher y luego por nombre de línea.
  const kindRank = { added: 0, changed: 1, removed: 2 } as const;
  lines.sort(
    (x, y) =>
      kindRank[x.kind] - kindRank[y.kind] ||
      x.publisherName.localeCompare(y.publisherName) ||
      x.placementName.localeCompare(y.placementName),
  );

  // ── Fees ─────────────────────────────────────────────────────────────────
  const nextFees = byId(next.fees);
  const prevFees = byId(prev.fees);
  const fees: FeeChange[] = [];
  for (const [id, a] of nextFees) {
    const b = prevFees.get(id);
    if (!b) {
      fees.push({
        kind: "added",
        name: a.name,
        amountBefore: null,
        amountAfter: feeAmount(a, mediaAfter),
        fields: [],
      });
      continue;
    }
    const fields = feeFieldChanges(b, a, mediaBefore, mediaAfter);
    if (fields.length === 0) continue;
    fees.push({
      kind: "changed",
      name: a.name,
      amountBefore: feeAmount(b, mediaBefore),
      amountAfter: feeAmount(a, mediaAfter),
      fields,
    });
  }
  for (const [id, b] of prevFees) {
    if (nextFees.has(id)) continue;
    fees.push({
      kind: "removed",
      name: b.name,
      amountBefore: feeAmount(b, mediaBefore),
      amountAfter: null,
      fields: [],
    });
  }

  return {
    isInitial: false,
    planFields,
    publishers: publisherChanges,
    lines,
    fees,
    totals,
    counts: { linesBefore, linesAfter, added, removed, changed },
    changeCount:
      planFields.length + publisherChanges.length + lines.length + fees.length,
  };
}
