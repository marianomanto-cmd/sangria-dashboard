import { getBillingEstimate } from "@/db/queries/dashboard";
import { getPortalClient } from "@/db/queries/client-portal";
import { canAccessClientExport } from "@/lib/client-portal.server";
import { DEFAULT_LANGUAGE, type Language } from "@/lib/i18n";
import { buildEstimateWorkbook } from "@/lib/portal-estimate-xlsx";

// ════════════════════════════════════════════════════════════════════════════
// Export de la tab ESTIMACIÓN del portal — refleja "lo que se está viendo en la
// ventana": los mismos meses (filtro de Mes, o el default mes anterior + 2
// próximos) y filtros (Budget Origin / Proyecto) que la vista, con el mismo
// criterio de getBillingEstimate. Thin handler: el armado del Excel vive en
// lib/portal-estimate-xlsx.ts.
//
// Ruta pública en el proxy (`/api/portal/*`). Barrera real: canAccessClientExport
// (sesión interna O cookie de portal del cliente).
// ════════════════════════════════════════════════════════════════════════════

export const maxDuration = 60;

// Mismos helpers de mes que EstimateSection (portal-content.tsx).
function nextMonths(count: number): string[] {
  const out: string[] = [];
  const now = new Date();
  let y = now.getFullYear();
  let m = now.getMonth() + 1;
  for (let i = 0; i < count; i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}
function previousMonth(): string {
  const now = new Date();
  let y = now.getFullYear();
  let m = now.getMonth();
  if (m === 0) {
    y -= 1;
    m = 12;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}
function thisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
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

  const selectedMonths = splitList(url.searchParams.get("month"));
  // Mismos meses que la ventana: los elegidos, o el default (mes anterior + 2).
  const months = selectedMonths.length
    ? selectedMonths
    : [previousMonth(), ...nextMonths(2)];

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
