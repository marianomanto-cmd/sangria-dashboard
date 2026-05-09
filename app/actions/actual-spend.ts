"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { actualSpend, auditLog } from "@/db/schema";

const MONTH_RX = /^\d{4}-(0[1-9]|1[0-2])$/;

export type UpsertActualSpendInput = {
  mediaPlanLineId: string;
  month: string; // 'YYYY-MM'
  amount: number;
};

export type UpsertActualSpendResult =
  | { ok: true; id: string; amount: number; updatedAt: string }
  | { ok: false; error: string };

export async function upsertActualSpend(
  input: UpsertActualSpendInput,
): Promise<UpsertActualSpendResult> {
  // Validación de borde
  if (!MONTH_RX.test(input.month)) {
    return { ok: false, error: "Mes inválido (formato YYYY-MM)" };
  }
  if (!Number.isFinite(input.amount) || input.amount < 0) {
    return { ok: false, error: "Monto inválido (debe ser ≥ 0)" };
  }
  if (!input.mediaPlanLineId) {
    return { ok: false, error: "Falta media_plan_line_id" };
  }

  const amountStr = input.amount.toFixed(2);

  try {
    // Snapshot del estado anterior para el audit log.
    const [before] = await db
      .select()
      .from(actualSpend)
      .where(
        and(
          eq(actualSpend.mediaPlanLineId, input.mediaPlanLineId),
          eq(actualSpend.month, input.month),
        ),
      )
      .limit(1);

    // No-op: si ya existe con el mismo monto (al centavo), no escribimos nada.
    // Importante para evitar contaminar el audit_log con keystrokes que vuelven
    // al valor previo.
    if (before && before.amountUsd === amountStr) {
      return {
        ok: true,
        id: before.id,
        amount: input.amount,
        updatedAt: before.recordedAt.toISOString(),
      };
    }

    // Upsert por (media_plan_line_id, month).
    const [upserted] = await db
      .insert(actualSpend)
      .values({
        mediaPlanLineId: input.mediaPlanLineId,
        month: input.month,
        amountUsd: amountStr,
        recordedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [actualSpend.mediaPlanLineId, actualSpend.month],
        set: {
          amountUsd: amountStr,
          recordedAt: new Date(),
        },
      })
      .returning();

    // Audit log — toda edición se audita (regla §6.2 del prompt).
    await db.insert(auditLog).values({
      entityType: "actual_spend",
      entityId: upserted.id,
      action: before ? "update" : "create",
      beforeJson: before ?? null,
      afterJson: upserted,
      // userId: null hasta que integremos Supabase Auth (Fase 9).
    });

    return {
      ok: true,
      id: upserted.id,
      amount: input.amount,
      updatedAt: upserted.recordedAt.toISOString(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return { ok: false, error: message };
  }
}
