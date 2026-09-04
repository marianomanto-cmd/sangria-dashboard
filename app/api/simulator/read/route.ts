import { NextResponse } from "next/server";
import {
  getBenchmarkDetail,
  getBenchmarks,
  getScenario,
  listCompareablePlans,
  listProjectsForPromotion,
} from "@/db/queries/simulator";
import type { BenchmarkFilters } from "@/lib/simulator-types";

// ════════════════════════════════════════════════════════════════════════════
// Lecturas del simulador, por GET.
//
// ── Por qué existe ──────────────────────────────────────────────────────────
// El simulador refresca data desde el browser sin recargar la página (cambiar
// filtros, abrir un escenario, cargar el drawer de detalle). Eso estaba hecho
// con "read-actions": server actions que sólo leen. Funcionan, pero un Server
// Action de Next viaja **por POST**, y la sesión de auditoría —solo lectura—
// tiene cerrado todo lo que no sea GET en el proxy, justamente para que
// ninguna escritura pueda pasar (ver lib/audit-session.ts).
//
// Resultado: con las read-actions, para la auditora los tabs Benchmarks,
// Comparativa y Builder quedaban colgados en "Cargando…" — y son las
// pantallas de análisis puro, exactamente lo que una auditoría quiere mirar.
//
// La solución es la que el repo ya venía usando para el mismo problema:
// `app/api/plans/[planId]/version-diff/route.ts`, que es un GET por la misma
// razón. Acá se hace lo mismo para las cinco lecturas del simulador, en una
// sola ruta con `?op=`, porque comparten forma (parámetros chicos y planos) y
// no vale la pena cinco archivos casi iguales.
//
// ── Auth ────────────────────────────────────────────────────────────────────
// La ruta NO está en la allowlist del proxy, así que exige sesión: la interna
// de la agencia o la de auditoría (GET, que sí pasa). El portal de cliente
// no llega — su allowlist es `/api/portal/*`.
//
// ── Regla ───────────────────────────────────────────────────────────────────
// Acá SÓLO van lecturas. Si algo tiene que escribir, va como server action con
// su `assertCanWrite()`, no como un handler más de este archivo.
// ════════════════════════════════════════════════════════════════════════════

function filtersFrom(sp: URLSearchParams): BenchmarkFilters {
  const val = (k: string) => {
    const v = sp.get(k);
    return v === null || v === "" ? null : v;
  };
  return {
    clientId: val("clientId"),
    publisherId: val("publisherId"),
    marketId: val("marketId"),
    costMethod: val("costMethod"),
    dateFrom: val("dateFrom"),
    dateTo: val("dateTo"),
  };
}

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const op = sp.get("op");

  try {
    switch (op) {
      case "benchmarks":
        return NextResponse.json({ rows: await getBenchmarks(filtersFrom(sp)) });

      case "benchmarkDetail": {
        // El detalle se pide para una celda concreta de la tabla: los mismos
        // filtros más el publisher/mercado/cost method de esa fila.
        const publisherId = sp.get("detailPublisherId");
        if (!publisherId) {
          return NextResponse.json(
            { error: "Falta detailPublisherId" },
            { status: 400 },
          );
        }
        const rows = await getBenchmarkDetail({
          filters: filtersFrom(sp),
          publisherId,
          marketId: sp.get("detailMarketId") || null,
          costMethod: sp.get("detailCostMethod") || null,
        });
        return NextResponse.json({ rows });
      }

      case "compareablePlans": {
        const clientId = sp.get("clientId");
        if (!clientId) {
          return NextResponse.json({ error: "Falta clientId" }, { status: 400 });
        }
        return NextResponse.json({ rows: await listCompareablePlans(clientId) });
      }

      case "projectsForPromotion": {
        const clientId = sp.get("clientId");
        if (!clientId) {
          return NextResponse.json({ error: "Falta clientId" }, { status: 400 });
        }
        return NextResponse.json({
          rows: await listProjectsForPromotion(clientId),
        });
      }

      case "scenario": {
        const id = sp.get("id");
        if (!id) {
          return NextResponse.json({ error: "Falta id" }, { status: 400 });
        }
        return NextResponse.json({ scenario: await getScenario(id) });
      }

      default:
        return NextResponse.json({ error: "op inválida" }, { status: 400 });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
