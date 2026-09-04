import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { clients, creativeBillings } from "@/db/schema";
import { setCreativeBillingPaid } from "@/app/actions/creative-billing";
import { canWriteAsClientPortal } from "@/lib/client-portal.server";
import { readOnlyResponse } from "@/lib/read-only";

// ════════════════════════════════════════════════════════════════════════════
// "Marcar pagado" del tab Creative del portal de cliente.
//
// Gemelo de app/api/portal/billing/mark-paid/route.ts, para la otra tabla de
// facturas (`creative_billings`, sin media plan detrás). Mismo canal y mismas
// tres barreras, porque el proxy sólo deja pasar GET en `/<slug>`: una
// escritura del portal va SIEMPRE por un route handler autovalidante en
// `/api/portal/*`, nunca por un Server Action.
//
//   1. cookie de portal del MISMO cliente (o sesión interna de Sangria);
//   2. la factura tiene que ser de ESE cliente, no archivado (si no, 404 — no
//      se filtra si el id existe);
//   3. sólo se acepta invoiced → paid. Revertir el cobro sigue siendo
//      exclusivo de la app interna (/creative).
// ════════════════════════════════════════════════════════════════════════════

const UUID_RX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  let body: { clientSlug?: string; billingId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Body inválido" }, { status: 400 });
  }

  const clientSlug = (body.clientSlug ?? "").trim().toLowerCase();
  const billingId = (body.billingId ?? "").trim();
  if (!clientSlug || !UUID_RX.test(billingId)) {
    return Response.json({ ok: false, error: "Body inválido" }, { status: 400 });
  }

  if (!(await canWriteAsClientPortal(clientSlug))) {
    return Response.json({ ok: false, error: "Sin acceso" }, { status: 403 });
  }

  // Cuarta barrera: una sesión de solo lectura (auditoría externa o rol
  // Viewer) no escribe ni siquiera por el canal del portal. El proxy ya la
  // frena en el método, pero este endpoint es público y se valida solo, así
  // que no se apoya en eso. Ver lib/read-only.ts.
  const ro = await readOnlyResponse();
  if (ro) return ro;

  // Ownership + estado actual en una sola query.
  const [row] = await db
    .select({ status: creativeBillings.status })
    .from(creativeBillings)
    .innerJoin(clients, eq(creativeBillings.clientId, clients.id))
    .where(
      and(
        eq(creativeBillings.id, billingId),
        eq(clients.slug, clientSlug),
        ne(clients.status, "archived"),
      ),
    )
    .limit(1);

  if (!row) {
    return Response.json(
      { ok: false, error: "Factura no encontrada" },
      { status: 404 },
    );
  }

  // Idempotente: si ya está pagada (doble click, dos pestañas), no es un error.
  if (row.status === "paid") return Response.json({ ok: true, status: "paid" });

  if (row.status !== "invoiced") {
    return Response.json(
      {
        ok: false,
        error: `Sólo se puede marcar como pagada una factura facturada (estado actual: ${row.status}).`,
      },
      { status: 409 },
    );
  }

  // El lifecycle (transición, paidAt, auditoría y revalidate de /creative) vive
  // en setCreativeBillingPaid — fuente única, igual que en el billing de planes.
  const res = await setCreativeBillingPaid({
    billingId,
    paid: true,
    // Actor de la auditoría: sin sesión de Supabase quedaría "Sistema".
    actorEmail: `portal-${clientSlug}@sangria.portal`,
  });
  if (!res.ok) return Response.json(res, { status: 409 });

  return Response.json({ ok: true, status: "paid" });
}
