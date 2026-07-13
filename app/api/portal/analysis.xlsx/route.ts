import {
  getAnalysisFilterOptions,
  getMarketActivations,
} from "@/db/queries/analysis";
import { getPortalClient } from "@/db/queries/client-portal";
import { getCurrentUser } from "@/lib/auth";
import { resolveClientFromSearchParams } from "@/lib/client-filter.server";
import { canAccessClientExport } from "@/lib/client-portal.server";
import { DEFAULT_LANGUAGE, formatMonth, type Language } from "@/lib/i18n";
import { buildAnalysisWorkbook } from "@/lib/portal-analysis-xlsx";

// ════════════════════════════════════════════════════════════════════════════
// Export de la sección ANÁLISIS (mapa por mercado) — refleja "lo que se está
// viendo en la ventana": mismos filtros (pub/mkt/bo/from/to) y mismo criterio
// de getMarketActivations que la vista. Thin handler: el armado del Excel vive
// en lib/portal-analysis-xlsx.ts. Lo usan el tab Análisis del portal de
// cliente y la sección interna /analisis (misma vista compartida).
//
// Ruta pública en el proxy (`/api/portal/*`). Barrera real: canAccessClientExport
// (sesión interna O cookie de portal del cliente).
// ════════════════════════════════════════════════════════════════════════════

export const maxDuration = 60;

function splitList(v: string | null): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

// Los filtros de período llegan como YYYY-MM (inputs type="month" de la vista).
// Cualquier otra cosa se ignora en vez de filtrar con basura.
function monthParam(v: string | null): string | null {
  return v && /^\d{4}-\d{2}$/.test(v) ? v : null;
}

// Nombres legibles de los ids seleccionados, para el header del Excel. Si un
// id no matchea opción conocida se omite; sin selección → "Todos"/"All".
function selectedNames(
  ids: string[],
  options: { id: string; name: string }[],
  allLabel: string,
): string {
  if (ids.length === 0) return allLabel;
  const byId = new Map(options.map((o) => [o.id, o.name]));
  const names = ids.map((id) => byId.get(id)).filter(Boolean);
  return names.length > 0 ? names.join(", ") : allLabel;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const clientSlug = (url.searchParams.get("client") ?? "").trim();
  if (!clientSlug) {
    return new Response("Bad request", { status: 400 });
  }
  if (!(await canAccessClientExport(clientSlug))) {
    return new Response("Forbidden", { status: 403 });
  }
  // El lookup del portal excluye clientes archivados (correcto para visitantes
  // del portal). La vista interna /analisis sí muestra archivados por URL
  // directa, así que para usuarios internos caemos a un lookup sin ese filtro
  // — si no, el botón de la vista interna daría 404 para esos clientes.
  const client =
    (await getPortalClient(clientSlug)) ??
    ((await getCurrentUser())
      ? await resolveClientFromSearchParams({ client: clientSlug })
      : null);
  if (!client) {
    return new Response("Not found", { status: 404 });
  }

  const publisherIds = splitList(url.searchParams.get("pub"));
  const marketIds = splitList(url.searchParams.get("mkt"));
  const budgetOriginIds = splitList(url.searchParams.get("bo"));
  const fromMonth = monthParam(url.searchParams.get("from"));
  const toMonth = monthParam(url.searchParams.get("to"));

  const [data, options] = await Promise.all([
    getMarketActivations({
      clientId: client.id,
      publisherIds: publisherIds.length ? publisherIds : null,
      marketIds: marketIds.length ? marketIds : null,
      budgetOriginIds: budgetOriginIds.length ? budgetOriginIds : null,
      fromMonth,
      toMonth,
    }),
    getAnalysisFilterOptions(client.id),
  ]);

  const lang: Language = client.language ?? DEFAULT_LANGUAGE;
  const es = lang === "es";
  const allLabel = es ? "Todos" : "All";
  const filters: [string, string][] = [
    ["Publisher", selectedNames(publisherIds, options.publishers, allLabel)],
    [es ? "Mercado" : "Market", selectedNames(marketIds, options.markets, allLabel)],
    ["Budget Origin", selectedNames(budgetOriginIds, options.budgetOrigins, allLabel)],
    [
      es ? "Período" : "Period",
      fromMonth || toMonth
        ? `${fromMonth ? formatMonth(fromMonth, lang) : "…"} → ${toMonth ? formatMonth(toMonth, lang) : "…"}`
        : allLabel,
    ],
  ];

  const wb = buildAnalysisWorkbook(data.rows, data.markets, {
    lang,
    clientName: client.name,
    filters,
    generatedAt: new Date(),
  });

  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  const today = new Date().toISOString().slice(0, 10);
  const filename = `${client.name}-analisis-mercados-${today}.xlsx`.replace(
    /[^A-Za-z0-9._-]+/g,
    "_",
  );

  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
