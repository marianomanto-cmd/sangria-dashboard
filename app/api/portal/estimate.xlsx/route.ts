import { getBillingEstimate } from "@/db/queries/dashboard";
import { getPortalClient } from "@/db/queries/client-portal";
import { canAccessClientExport } from "@/lib/client-portal.server";
import { estimateWindowMonths, thisMonth } from "@/lib/estimate-window";
import { DEFAULT_LANGUAGE, type Language } from "@/lib/i18n";
import { buildEstimateWorkbook } from "@/lib/portal-estimate-xlsx";

// ════════════════════════════════════════════════════════════════════════════
// Export de la tab ESTIMACIÓN del portal — refleja "lo que se está viendo en la
// ventana": los mismos filtros de Año/Mes (o el default mes anterior + 2
// próximos) y Budget Origin / Proyecto que la vista, con el mismo criterio de
// getBillingEstimate (ventana calculada por estimateWindowMonths, compartida con
// portal-content). Thin handler: el armado del Excel vive en
// lib/portal-estimate-xlsx.ts.
//
// Ruta pública en el proxy (`/api/portal/*`). Barrera real: canAccessClientExport
// (sesión interna O cookie de portal del cliente).
// ════════════════════════════════════════════════════════════════════════════

export const maxDuration = 60;

function splitList(v: string | null): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
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
  const client = await getPortalClient(clientSlug);
  if (!client) {
    return new Response("Not found", { status: 404 });
  }

  // Misma ventana que la vista (helper compartido): meses elegidos scopeados al
  // año, o el default (año actual/Todos → mes anterior + 2 próximos; un año
  // puntual → sus 12 meses).
  const months = estimateWindowMonths({
    year: (url.searchParams.get("year") ?? "").trim(),
    selectedMonths: splitList(url.searchParams.get("month")),
  });

  const estimates = await getBillingEstimate({
    clientId: client.id,
    budgetOriginIds: splitList(url.searchParams.get("bo")),
    projectIds: splitList(url.searchParams.get("proj")),
    months,
  });

  const lang: Language = client.language ?? DEFAULT_LANGUAGE;
  const wb = buildEstimateWorkbook(estimates, {
    lang,
    clientName: client.name,
    currentMonth: thisMonth(),
  });

  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  const today = new Date().toISOString().slice(0, 10);
  const filename = `${client.name}-estimacion-${today}.xlsx`.replace(
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
