import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { clients, mediaPlans, planBillings, projects } from "@/db/schema";
import { transitionBillingStatus } from "@/app/actions/plan-billing";
import { canWriteAsClientPortal } from "@/lib/client-portal.server";

// ════════════════════════════════════════════════════════════════════════════
// "Marcar pagado" del Billing Tracker del portal de cliente.
//
// Endpoint dedicado y autovalidante en vez de un Server Action: el proxy sólo
// deja pasar GET para las rutas del portal (`/<slug>`) justamente para que las
// mutaciones internas no queden abiertas, y `/api/portal/*` es el canal público
// que se valida solo (mismo patrón que login/logout y los exports).
//
// Tres barreras, todas server-side:
//   1. cookie de portal del MISMO cliente (o sesión interna de Sangria);
//   2. la factura tiene que colgar de un plan vivo de un proyecto de ESE
//      cliente (si no, 404 — no se filtra si el id existe);
//   3. sólo se acepta invoiced → paid. Ninguna otra transición del lifecycle
//      sale por acá, y revertir el pago sigue siendo exclusivo de la app
//      interna.
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

  // Ownership + estado actual en una sola query: la factura tiene que ser de un
  // plan no borrado, de un proyecto de este cliente, y el cliente no archivado.
  const [row] = await db
    .select({ status: planBillings.status })
    .from(planBillings)
    .innerJoin(
      mediaPlans,
      and(
        eq(planBillings.mediaPlanId, mediaPlans.id),
        isNull(mediaPlans.deletedAt),
      ),
    )
    .innerJoin(projects, eq(mediaPlans.projectId, projects.id))
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .where(
      and(
        eq(planBillings.id, billingId),
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

  // El lifecycle (validación de la transición, paidAt, auditoría y revalidate
  // de las vistas internas) vive en transitionBillingStatus — fuente única.
  const res = await transitionBillingStatus({
    billingId,
    to: "paid",
    // Actor de la auditoría: sin sesión de Supabase quedaría "Sistema".
    // `actorLabel()` usa el local-part → "Portal Copa Airlines".
    actorEmail: `portal-${clientSlug}@sangria.portal`,
  });
  if (!res.ok) return Response.json(res, { status: 409 });

  return Response.json({ ok: true, status: "paid" });
}
