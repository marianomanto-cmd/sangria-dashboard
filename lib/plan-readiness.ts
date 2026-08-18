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
//
// Lo mismo vale para el CUADRE del publisher (placements vs total del bloque),
// y ahí el daño es silencioso: el total del plan —y con él la base del
// management fee, los KPIs y la estimación— sale de
// `sum(media_plan_publishers.total_planned_usd)`, mientras que el prorrateo
// mensual, el pacing, el campaign tracker y las líneas del Excel salen de los
// PLACEMENTS. Si no cuadran, la diferencia es plata que figura en el total pero
// no se prorratea a ningún mes (o al revés: meses que facturan más que el
// total). Por eso cuadrar es requisito para Listo/Aprobado, no una sugerencia.

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

// Tolerancia del cuadre publisher ↔ placements: un centavo. Los montos son
// numeric(14,2), así que cualquier diferencia real es >= 0.01; el margen existe
// solo para no pelearse con el redondeo binario de los floats.
// La exporta el editor para pintar el aviso con el MISMO criterio con el que la
// regla bloquea (si divergieran, el aviso diría "cuadrado" y el pase fallaría).
export const BALANCE_TOLERANCE_USD = 0.01;

// Plata para los mensajes: sin decimales cuando es redondo (lo normal) y con
// centavos cuando los hay, para que una diferencia de $0.50 no se muestre como
// "$1" y mande al planner a buscar un peso que no existe.
function money(value: number): string {
  const hasCents = Math.round(value * 100) % 100 !== 0;
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  })}`;
}

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

    // Cuadre del bloque: la suma de los placements tiene que dar el total del
    // publisher. Solo se chequea cuando hay algo con qué cuadrar — si falta el
    // monto o no hay placements, ya se reportó arriba y agregar el descuadre
    // sería ruido.
    if (pub.totalPlannedUsd > 0 && pub.placements.length > 0) {
      const placementsTotal = pub.placements.reduce(
        (sum, pl) => sum + (Number.isFinite(pl.amountUsd) ? pl.amountUsd : 0),
        0,
      );
      const balance = pub.totalPlannedUsd - placementsTotal;
      if (Math.abs(balance) >= BALANCE_TOLERANCE_USD) {
        const gap =
          balance > 0
            ? `faltan ${money(balance)}`
            : `sobran ${money(-balance)}`;
        pubMissing.push(
          `cuadrar los placements con el total del publisher: suman ${money(
            placementsTotal,
          )} contra un total de ${money(pub.totalPlannedUsd)} (${gap})`,
        );
      }
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
    "Un plan Listo/Aprobado alimenta la facturación, la estimación y los exports: los montos y las métricas principales tienen que estar cargados, y el total de cada publisher tiene que coincidir con la suma de sus placements.",
  ].join("\n\n");
}
