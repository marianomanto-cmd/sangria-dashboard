"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  markReportDelivered,
  setReportDeliveryDate,
} from "@/app/actions/reports";
import { ReportingGantt } from "@/components/reporting-gantt";
import type { CalendarReport } from "@/db/queries/reports";
import { formatDate, type Language } from "@/lib/i18n";

type DialogState =
  | { kind: "closed" }
  | { kind: "assign"; reportId: string; currentDate: string | null; projectName: string }
  | { kind: "confirmDelivered"; reportId: string; projectName: string };

export function ReportingCalendarClient({
  pending,
  inProgress,
  lang,
}: {
  pending: CalendarReport[];
  inProgress: CalendarReport[];
  lang: Language;
}) {
  const [dialog, setDialog] = useState<DialogState>({ kind: "closed" });
  const [pendingAction, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const openAssign = (
    reportId: string,
    currentDate: string | null,
    projectName: string,
  ) => {
    setError(null);
    setDialog({ kind: "assign", reportId, currentDate, projectName });
  };

  const openMarkDelivered = (reportId: string, projectName: string) => {
    setError(null);
    setDialog({ kind: "confirmDelivered", reportId, projectName });
  };

  const close = () => setDialog({ kind: "closed" });

  const submitAssign = (date: string) => {
    if (dialog.kind !== "assign") return;
    setError(null);
    startTransition(async () => {
      const res = await setReportDeliveryDate({
        reportId: dialog.reportId,
        deliveryDate: date,
      });
      if (!res.ok) {
        setError(res.error);
      } else {
        close();
      }
    });
  };

  const submitDelivered = () => {
    if (dialog.kind !== "confirmDelivered") return;
    setError(null);
    startTransition(async () => {
      const res = await markReportDelivered({ reportId: dialog.reportId });
      if (!res.ok) {
        setError(res.error);
      } else {
        close();
      }
    });
  };

  return (
    <>
      <section className="mb-8">
        <header className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">
            {lang === "es"
              ? "Proyectos cerrados pendientes de asignar fecha"
              : "Closed projects pending date assignment"}
          </h2>
          <span className="text-[11px] uppercase tracking-[0.08em] text-muted font-medium">
            {pending.length}
            {lang === "es"
              ? ` proyecto${pending.length === 1 ? "" : "s"}`
              : ` project${pending.length === 1 ? "" : "s"}`}
          </span>
        </header>
        {pending.length === 0 ? (
          <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-8 text-center text-sm text-muted">
            {lang === "es"
              ? "No hay proyectos cerrados pendientes. Cuando cierres uno aparecerá acá."
              : "No closed projects pending. New closes will appear here."}
          </div>
        ) : (
          <div className="rounded-lg border border-line bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-paper-2 border-b border-line">
                <tr className="text-left text-[10px] uppercase tracking-[0.08em] text-muted font-medium">
                  <th className="px-4 py-2.5">
                    {lang === "es" ? "Proyecto" : "Project"}
                  </th>
                  <th className="px-4 py-2.5">
                    {lang === "es" ? "Cliente" : "Client"}
                  </th>
                  <th className="px-4 py-2.5">Budget Origin</th>
                  <th className="px-4 py-2.5">
                    {lang === "es" ? "Cerrado el" : "Closed on"}
                  </th>
                  <th className="px-4 py-2.5 text-right" />
                </tr>
              </thead>
              <tbody>
                {pending.map((r) => (
                  <tr
                    key={r.reportId}
                    className="border-t border-line-soft hover:bg-paper-2 transition-colors"
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/proyectos/${r.projectCode}`}
                        className="font-medium text-ink hover:text-accent"
                      >
                        {r.projectName}
                      </Link>
                      <p className="text-[11px] text-muted font-mono">
                        {r.projectCode}
                      </p>
                    </td>
                    <td className="px-4 py-2.5">{r.clientName}</td>
                    <td className="px-4 py-2.5 text-muted">
                      {r.budgetOriginName}
                    </td>
                    <td className="px-4 py-2.5 text-muted font-mono">
                      {formatDate(r.closedAt.slice(0, 10), lang)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => openAssign(r.reportId, null, r.projectName)}
                        className="inline-flex items-center rounded-md bg-ink text-white px-3 py-1 text-xs font-medium hover:bg-ink-2 transition-colors"
                      >
                        {lang === "es" ? "Asignar fecha" : "Assign date"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <header className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">
            {lang === "es" ? "Calendario de entregas" : "Delivery calendar"}
          </h2>
          <span className="text-[11px] uppercase tracking-[0.08em] text-muted font-medium">
            {inProgress.length}
            {lang === "es"
              ? ` reporte${inProgress.length === 1 ? "" : "s"} en curso`
              : ` report${inProgress.length === 1 ? "" : "s"} in progress`}
            <span className="text-stone-300"> · </span>
            {lang === "es" ? "ventana -30 / +30 días" : "window -30 / +30 days"}
          </span>
        </header>
        <ReportingGantt
          reports={inProgress}
          lang={lang}
          onAssignDate={(reportId, current) => {
            const r = inProgress.find((x) => x.reportId === reportId);
            openAssign(reportId, current, r?.projectName ?? "");
          }}
          onMarkDelivered={(reportId) => {
            const r = inProgress.find((x) => x.reportId === reportId);
            openMarkDelivered(reportId, r?.projectName ?? "");
          }}
        />
      </section>

      {/* Dialog: asignar / editar fecha */}
      {dialog.kind === "assign" && (
        <Modal onClose={close}>
          <AssignDateForm
            projectName={dialog.projectName}
            initialDate={dialog.currentDate}
            lang={lang}
            pending={pendingAction}
            error={error}
            onCancel={close}
            onSubmit={submitAssign}
          />
        </Modal>
      )}

      {/* Dialog: confirmar entregado */}
      {dialog.kind === "confirmDelivered" && (
        <Modal onClose={close}>
          <div className="space-y-3">
            <h3 className="text-base font-semibold">
              {lang === "es"
                ? "¿Marcar el reporte como entregado?"
                : "Mark the report as delivered?"}
            </h3>
            <p className="text-sm text-muted">
              {lang === "es" ? (
                <>
                  El proyecto <strong>{dialog.projectName}</strong> va a pasar a
                  estado <em>reportado</em> y desaparecer del calendario. La
                  acción queda en el log de auditoría.
                </>
              ) : (
                <>
                  Project <strong>{dialog.projectName}</strong> will move to
                  <em> reported </em>status and leave the calendar. The action
                  is recorded in the audit log.
                </>
              )}
            </p>
            {error && <p className="text-xs text-danger">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={close}
                disabled={pendingAction}
                className="rounded-md border border-line bg-white px-3 py-1.5 text-sm hover:bg-paper-2 disabled:opacity-50"
              >
                {lang === "es" ? "Cancelar" : "Cancel"}
              </button>
              <button
                type="button"
                onClick={submitDelivered}
                disabled={pendingAction}
                className="rounded-md bg-success text-white px-3 py-1.5 text-sm font-medium hover:bg-success/90 disabled:opacity-50"
              >
                {pendingAction
                  ? lang === "es"
                    ? "Guardando…"
                    : "Saving…"
                  : lang === "es"
                    ? "Marcar entregado"
                    : "Mark delivered"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function AssignDateForm({
  projectName,
  initialDate,
  lang,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  projectName: string;
  initialDate: string | null;
  lang: Language;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (date: string) => void;
}) {
  const [value, setValue] = useState<string>(initialDate ?? defaultDate());

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!value) return;
        onSubmit(value);
      }}
    >
      <h3 className="text-base font-semibold">
        {initialDate
          ? lang === "es"
            ? "Editar fecha de entrega"
            : "Edit delivery date"
          : lang === "es"
            ? "Asignar fecha de entrega"
            : "Assign delivery date"}
      </h3>
      <p className="text-sm text-muted">
        {projectName}
      </p>
      <label className="block">
        <span className="text-[11px] uppercase tracking-[0.08em] text-muted font-medium">
          {lang === "es" ? "Fecha de entrega" : "Delivery date"}
        </span>
        <input
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="mt-1 block w-full rounded-md border border-line bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          required
        />
      </label>
      <p className="text-[11px] text-muted italic">
        {lang === "es"
          ? "Al guardar, el día de hoy queda registrado como el momento del compromiso."
          : "On save, today is recorded as the moment of the commitment."}
      </p>
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-md border border-line bg-white px-3 py-1.5 text-sm hover:bg-paper-2 disabled:opacity-50"
        >
          {lang === "es" ? "Cancelar" : "Cancel"}
        </button>
        <button
          type="submit"
          disabled={pending || !value}
          className="rounded-md bg-ink text-white px-3 py-1.5 text-sm font-medium hover:bg-ink-2 disabled:opacity-50"
        >
          {pending
            ? lang === "es"
              ? "Guardando…"
              : "Saving…"
            : lang === "es"
              ? "Guardar"
              : "Save"}
        </button>
      </div>
    </form>
  );
}

function Modal({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink/30 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg border border-line bg-white shadow-xl p-5">
        {children}
      </div>
    </div>
  );
}

function defaultDate(): string {
  // Sugerencia: 14 días después de hoy. El manager puede cambiarla.
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().slice(0, 10);
}
