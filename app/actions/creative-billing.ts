"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { invalidate } from "@/lib/cache-invalidate";
import { BILLING_TAG, DASHBOARD_TAG } from "@/lib/cache-tags";
import { db } from "@/db";
import { recordAudit } from "@/lib/audit";
import { assertCanWrite } from "@/lib/read-only";
import { clients, creativeBillings } from "@/db/schema";

type Result = { ok: true } | { ok: false; error: string };
type ResultWith<T> = ({ ok: true } & T) | { ok: false; error: string };

// ════════════════════════════════════════════════════════════════════════════
// Lifecycle de una factura de creative. Mucho más corto que el de un billing
// de plan: una factura de creative nace emitida ('invoiced') y sólo se cobra
// o se revierte.
//
//   invoiced ↔ paid
//
// Vive en /creative (app interna, detrás del gate de Supabase), así que acá sí
// se usan Server Actions — a diferencia del portal, que va por route handler.
// ════════════════════════════════════════════════════════════════════════════

export async function setCreativeBillingPaid(input: {
  billingId: string;
  paid: boolean;
  // Actor de la auditoría cuando NO hay sesión de Supabase: lo manda el portal
  // del cliente (`/api/portal/creative/mark-paid`). Si hay usuario logueado,
  // gana el usuario — ver recordAudit en lib/audit.ts.
  actorEmail?: string | null;
}): Promise<Result> {
  // Barrera de escritura: frena a la sesión de auditoría y a los usuarios con
  // rol viewer antes de tocar nada. Ver lib/read-only.ts.
  const denied = await assertCanWrite();
  if (denied) return denied;

  const [before] = await db
    .select()
    .from(creativeBillings)
    .where(eq(creativeBillings.id, input.billingId))
    .limit(1);
  if (!before) return { ok: false, error: "Factura no encontrada" };

  const to = input.paid ? "paid" : "invoiced";
  if (before.status === to) return { ok: true }; // idempotente (doble click)

  if (before.status !== "invoiced" && before.status !== "paid") {
    return {
      ok: false,
      error: `No se puede cambiar el cobro desde el estado '${before.status}'`,
    };
  }

  const [after] = await db
    .update(creativeBillings)
    .set({ status: to, paidAt: input.paid ? new Date() : null })
    .where(eq(creativeBillings.id, input.billingId))
    .returning();

  await recordAudit({
    entityType: "creative_billing",
    entityId: input.billingId,
    action: "update",
    beforeJson: before,
    afterJson: after,
    actorEmail: input.actorEmail ?? null,
  });

  revalidatePath("/creative");
  invalidate(BILLING_TAG, DASHBOARD_TAG);
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// Alta de una factura de creative.
//
// Hasta acá las 21 facturas de 2025 habían entrado por SQL a mano
// (`db/creative-billings.sql`) y no había forma de cargar la 22 sin abrir el
// SQL Editor. Esto es esa forma: el mismo insert, pero validado, auditado y
// desde `/creative`.
//
// Qué se valida y por qué:
//   • `invoice_number` es UNIQUE en la tabla. Se pre-chequea para poder
//     devolver "ya existe" en castellano, y ADEMÁS se atrapa el 23505 del
//     insert — entre el select y el insert puede colarse otra carga.
//   • `month` es varchar(7) sin constraint de formato: si entra un "2025-13"
//     o un "abril", rompe el chart y el orden de la tabla en silencio.
//   • El cliente tiene que existir y no estar archivado — la vista los excluye,
//     así que una factura de un cliente archivado quedaría invisible.
// ════════════════════════════════════════════════════════════════════════════

const MONTH_RX = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

// Postgres: unique_violation. postgres.js lo expone en `err.code`.
const UNIQUE_VIOLATION = "23505";

function clean(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : null;
}

export async function createCreativeBilling(input: {
  clientId: string;
  invoiceNumber: string;
  month: string; // YYYY-MM
  amountUsd: number;
  campaignCode?: string | null;
  projectName?: string | null;
  invoiceDate?: string | null; // YYYY-MM-DD
  status?: "invoiced" | "paid";
  notesMd?: string | null;
}): Promise<ResultWith<{ billingId: string }>> {
  const denied = await assertCanWrite();
  if (denied) return denied;

  const invoiceNumber = clean(input.invoiceNumber);
  if (!input.clientId) return { ok: false, error: "Falta el cliente" };
  if (!invoiceNumber) return { ok: false, error: "Falta el N° de factura" };
  if (!MONTH_RX.test(input.month ?? "")) {
    return { ok: false, error: "El mes tiene que ser YYYY-MM (ej. 2026-09)" };
  }
  if (!Number.isFinite(input.amountUsd) || input.amountUsd <= 0) {
    return { ok: false, error: "El monto tiene que ser mayor a 0" };
  }
  const invoiceDate = clean(input.invoiceDate);
  if (invoiceDate && !DATE_RX.test(invoiceDate)) {
    return { ok: false, error: "La fecha tiene que ser YYYY-MM-DD" };
  }
  const status = input.status === "paid" ? "paid" : "invoiced";

  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, input.clientId), ne(clients.status, "archived")))
    .limit(1);
  if (!client) return { ok: false, error: "Cliente no encontrado" };

  const [dup] = await db
    .select({ id: creativeBillings.id })
    .from(creativeBillings)
    .where(eq(creativeBillings.invoiceNumber, invoiceNumber))
    .limit(1);
  if (dup) {
    return {
      ok: false,
      error: `Ya existe una factura de creative con el N° ${invoiceNumber}`,
    };
  }

  try {
    const [row] = await db
      .insert(creativeBillings)
      .values({
        clientId: client.id,
        invoiceNumber,
        campaignCode: clean(input.campaignCode),
        projectName: clean(input.projectName),
        month: input.month,
        invoiceDate,
        amountUsd: input.amountUsd.toFixed(2),
        status,
        paidAt: status === "paid" ? new Date() : null,
        notesMd: clean(input.notesMd),
      })
      .returning();

    await recordAudit({
      entityType: "creative_billing",
      entityId: row.id,
      action: "create",
      afterJson: row,
    });

    revalidatePath("/creative");
    invalidate(BILLING_TAG, DASHBOARD_TAG);
    return { ok: true, billingId: row.id };
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: `Ya existe una factura de creative con el N° ${invoiceNumber}`,
      };
    }
    return {
      ok: false,
      error: e instanceof Error ? e.message : "error desconocido",
    };
  }
}
