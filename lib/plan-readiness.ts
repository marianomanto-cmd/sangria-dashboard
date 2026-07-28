// Chequeo de "completitud" de un plan antes de marcarlo Listo / Aprobado.
//
// Fuente ÚNICA de la regla, compartida por:
//   • la server action `transitionPlanStatus` (app/actions/plans.ts) — barrera
//     real, server-side; y
//   • el editor del plan (editor.tsx) — para mostrar el diálogo con lo que
//     falta ANTES de intentar la transición.
// Es un módulo puro (sin DB ni React) justamente para que las dos lo usen y no
// se desincronicen.
//
// Por qué es una regla dura: un plan Listo/Aprobado alimenta la facturación, la
// estimación y los exports. Un publisher sin monto, un placement vacío o sin su
// métrica principal se propaga como plata que no se factura o como una línea
// incompleta en el plan que ve el cliente.

import { COST_METHOD_PRIMARY_METRIC } from "@/lib/cost-methods";

export type ReadinessPlacement = {
  placementName: string | null;
  amountUsd: number;
  costMethod: string | null;
  startDate: string | null;
  endDate: string | null;
  metricsJson: Record<string, number> | null;
};

export type ReadinessPublisher = {
  publisherName: string;
  totalPlannedUsd: number;
  placements: ReadinessPlacement[];
};

export type ReadinessIssue = {
  publisherName: string;
  // null → el problema es del publisher, no de un placement puntual.
  placementName: string | null;
  // Qué falta completar, en lenguaje del planner.
  missing: string[];
};

const UNNAMED = "(placement sin nombre)";

// Un placement "vacío" es una fila que quedó sin cargar del todo (típico: se
// agregó la línea y nunca se completó). Se reporta como una sola cosa en vez de
// listarle cinco campos faltantes.
function isEmptyPlacement(p: ReadinessPlacement): boolean {
  const hasMetrics = Object.values(p.metricsJson ?? {}).some(
    (v) => typeof v === "number" && v > 0,
  );
  return (
    !(p.placementName ?? "").trim() &&
    !(p.amountUsd > 0) &&
    !p.costMethod &&
    !p.startDate &&
    !p.endDate &&
    !hasMetrics
  );
}

// Devuelve todo lo que falta completar para que el plan pueda pasar a
// Listo/Aprobado. Array vacío = el plan está completo.
export function findPlanReadinessIssues(
  publishers: ReadinessPublisher[],
): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];

  for (const pub of publishers) {
    const pubMissing: string[] = [];
    // Monto del publisher: es el total planificado del bloque. En 0 significa
    // que nunca se cargó.
    if (!(pub.totalPlannedUsd > 0)) {
      pubMissing.push("el monto del publisher");
    }
    if (pub.placements.length === 0) {
      pubMissing.push("cargar al menos un placement");
    }
    if (pubMissing.length > 0) {
      issues.push({
        publisherName: pub.publisherName,
        placementName: null,
        missing: pubMissing,
      });
    }

    for (const pl of pub.placements) {
      const name = (pl.placementName ?? "").trim();

      if (isEmptyPlacement(pl)) {
        issues.push({
          publisherName: pub.publisherName,
          placementName: name || UNNAMED,
          missing: ["completar la fila (está vacía) o eliminarla"],
        });
        continue;
      }

      const missing: string[] = [];
      if (!name) missing.push("el nombre");
      if (!(pl.amountUsd > 0)) missing.push("el monto");
      if (!pl.costMethod) missing.push("el cost method");
      if (!pl.startDate) missing.push("la fecha de inicio");
      if (!pl.endDate) missing.push("la fecha de fin");

      // Métrica principal: la que corresponde al cost method elegido (dCPM →
      // impressions, CPC → clicks, etc.). Flat/Other no tienen una canónica.
      const primary = pl.costMethod
        ? COST_METHOD_PRIMARY_METRIC[pl.costMethod]
        : null;
      if (primary) {
        const value = pl.metricsJson?.[primary];
        if (typeof value !== "number" || !(value > 0)) {
          missing.push(
            `la métrica principal del ${pl.costMethod} (${primary})`,
          );
        }
      }

      if (missing.length > 0) {
        issues.push({
          publisherName: pub.publisherName,
          placementName: name || UNNAMED,
          missing,
        });
      }
    }
  }

  return issues;
}

function joinEs(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}

// Una línea por problema, lista para el body del diálogo (que respeta saltos de
// línea) y para el mensaje de error de la server action.
export function formatReadinessIssues(issues: ReadinessIssue[]): string {
  return issues
    .map((i) => {
      const where = i.placementName
        ? `${i.publisherName} · ${i.placementName}`
        : i.publisherName;
      return `• ${where}: falta ${joinEs(i.missing)}`;
    })
    .join("\n");
}

// Mensaje completo del error server-side (la UI muestra el diálogo, pero la
// action también tiene que explicarse sola: la pueden llamar sin pasar por el
// editor).
export function readinessErrorMessage(
  issues: ReadinessIssue[],
  target: "ready_to_send" | "approved",
): string {
  const label = target === "approved" ? "Aprobado" : "Listo";
  return [
    `No se puede marcar el plan como ${label} — falta completar:`,
    formatReadinessIssues(issues),
    "Un plan Listo/Aprobado alimenta la facturación, la estimación y los exports: los montos y las métricas principales tienen que estar cargados.",
  ].join("\n\n");
}
