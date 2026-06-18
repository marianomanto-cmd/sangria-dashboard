"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ExternalLink, Link2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/button";
import {
  createManualReport,
  deleteManualReport,
  markReportDelivered,
  setReportDeliveryDate,
  setReportPptUrl,
} from "@/app/actions/reports";
import { ReportingGantt } from "@/components/reporting-gantt";
import {
  ReportCommentsButton,
  ReportCommentsModal,
} from "@/components/report-comments";
import type { CalendarReport, SentReport } from "@/db/queries/reports";
import { formatDate, type Language } from "@/lib/i18n";
import { availableYears, periodMatchesYear } from "@/lib/year-filter";

type ReportKind = CalendarReport["kind"];

// Fecha que representa al reporte para el filtro de año: la de entrega
// (programada o real) y, si todavía no tiene, la del cierre del proyecto.
function reportDate(r: {
  deliveryDate: string | null;
  closedAt: string | null;
  deliveredAt?: string;
}): string | null {
  return r.deliveryDate ?? r.deliveredAt ?? r.closedAt ?? null;
}

type DialogState =
  | { kind: "closed" }
  | {
      kind: "assign";
      reportId: string;
      reportKind: ReportKind;
      currentDate: string | null;
      title: string;
    }
  | {
      kind: "confirmDelivered";
      reportId: string;
      reportKind: ReportKind;
      title: string;
    }
  | { kind: "createManual" }
  | {
      kind: "confirmDeleteManual";
      reportId: string;
      title: string;
    };

export function ReportingCalendarClient({
  pending,
  inProgress,
  sent,
  lang,
  currentClient,
  clientOptions,
}: {
  pending: CalendarReport[];
  inProgress: CalendarReport[];
  sent: SentReport[];
  lang: Language;
  currentClient: { id: string; name: string } | null;
  clientOptions: { id: string; name: string }[];
}) {
  const [dialog, setDialog] = useState<DialogState>({ kind: "closed" });
  const [pendingAction, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [budgetOrigin, setBudgetOrigin] = useState<string>("");
  // Filtro de año (default: año actual). Client-side, igual que budget origin.
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<number | null>(currentYear);
  // Tablerito de comentarios abierto desde una fila del Gantt.
  const [commentsFor, setCommentsFor] = useState<{
    reportId: string;
    kind: ReportKind;
    title: string;
  } | null>(null);

  // Solo se cuentan budget origins reales (project_reports los tienen;
  // manual_reports vienen con null y no entran al filtro).
  const budgetOrigins = useMemo(() => {
    const set = new Set<string>();
    for (const r of pending)
      if (r.budgetOriginName) set.add(r.budgetOriginName);
    for (const r of inProgress)
      if (r.budgetOriginName) set.add(r.budgetOriginName);
    for (const r of sent)
      if (r.budgetOriginName) set.add(r.budgetOriginName);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [pending, inProgress, sent]);

  // Años disponibles (desc) según la fecha representativa de cada reporte.
  const years = useMemo(
    () =>
      availableYears(
        [...pending, ...inProgress, ...sent].map((r) => {
          const d = reportDate(r);
          return { start: d, end: d };
        }),
        currentYear,
      ),
    [pending, inProgress, sent, currentYear],
  );

  const matchYear = (r: {
    deliveryDate: string | null;
    closedAt: string | null;
    deliveredAt?: string;
  }) => {
    if (year == null) return true;
    const d = reportDate(r);
    return periodMatchesYear({ start: d, end: d }, year, currentYear);
  };

  // Al filtrar por origen, los manuales (sin origen) se excluyen.
  const fPending = useMemo(
    () =>
      pending.filter(
        (r) =>
          (!budgetOrigin || r.budgetOriginName === budgetOrigin) && matchYear(r),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pending, budgetOrigin, year, currentYear],
  );
  const fInProgress = useMemo(
    () =>
      inProgress.filter(
        (r) =>
          (!budgetOrigin || r.budgetOriginName === budgetOrigin) && matchYear(r),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inProgress, budgetOrigin, year, currentYear],
  );
  const fSent = useMemo(
    () =>
      sent.filter(
        (r) =>
          (!budgetOrigin || r.budgetOriginName === budgetOrigin) && matchYear(r),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sent, budgetOrigin, year, currentYear],
  );

  const openAssign = (
    reportId: string,
    reportKind: ReportKind,
    currentDate: string | null,
    title: string,
  ) => {
    setError(null);
    setDialog({ kind: "assign", reportId, reportKind, currentDate, title });
  };

  const openMarkDelivered = (
    reportId: string,
    reportKind: ReportKind,
    title: string,
  ) => {
    setError(null);
    setDialog({ kind: "confirmDelivered", reportId, reportKind, title });
  };

  const openCreateManual = () => {
    setError(null);
    setDialog({ kind: "createManual" });
  };

  const openConfirmDeleteManual = (reportId: string, title: string) => {
    setError(null);
    setDialog({ kind: "confirmDeleteManual", reportId, title });
  };

  const close = () => setDialog({ kind: "closed" });

  const submitAssign = (date: string) => {
    if (dialog.kind !== "assign") return;
    setError(null);
    startTransition(async () => {
      const res = await setReportDeliveryDate({
        reportId: dialog.reportId,
        kind: dialog.reportKind,
        deliveryDate: date,
      });
      if (!res.ok) setError(res.error);
      else close();
    });
  };

  const submitDelivered = () => {
    if (dialog.kind !== "confirmDelivered") return;
    setError(null);
    startTransition(async () => {
      const res = await markReportDelivered({
        reportId: dialog.reportId,
        kind: dialog.reportKind,
      });
      if (!res.ok) setError(res.error);
      else close();
    });
  };

  const submitCreateManual = (input: {
    clientId: string;
    name: string;
    description: string;
    deliveryDate: string;
  }) => {
    if (dialog.kind !== "createManual") return;
    if (!input.clientId) {
      setError(
        lang === "es"
          ? "Elegí un cliente para el reporte."
          : "Pick a client for the report.",
      );
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await createManualReport({
        clientId: input.clientId,
        name: input.name,
        description: input.description || null,
        deliveryDate: input.deliveryDate,
      });
      if (!res.ok) setError(res.error);
      else close();
    });
  };

  const submitDeleteManual = () => {
    if (dialog.kind !== "confirmDeleteManual") return;
    setError(null);
    startTransition(async () => {
      const res = await deleteManualReport({ reportId: dialog.reportId });
      if (!res.ok) setError(res.error);
      else close();
    });
  };

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-paper-2 border border-line">
            <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted mr-1">
              {lang === "es" ? "Año" : "Year"}
            </span>
            <div className="flex items-center gap-0.5">
              {years.map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => setYear(y)}
                  data-active={year === y}
                  className="px-2 py-0.5 rounded text-xs text-muted hover:text-ink data-[active=true]:bg-white dark:data-[active=true]:bg-paper-2 dark:bg-paper-2 data-[active=true]:text-ink data-[active=true]:shadow-sm transition-colors"
                >
                  {y}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setYear(null)}
                data-active={year === null}
                className="px-2 py-0.5 rounded text-xs text-muted hover:text-ink data-[active=true]:bg-white dark:data-[active=true]:bg-paper-2 dark:bg-paper-2 data-[active=true]:text-ink data-[active=true]:shadow-sm transition-colors"
              >
                {lang === "es" ? "Todos" : "All"}
              </button>
            </div>
          </div>
          {budgetOrigins.length > 1 && (
            <div className="flex items-center gap-2">
              <label
                htmlFor="bo-filter"
                className="text-[10px] uppercase tracking-[0.08em] text-muted font-medium"
              >
                Budget Origin
              </label>
              <select
                id="bo-filter"
                value={budgetOrigin}
                onChange={(e) => setBudgetOrigin(e.target.value)}
                className="rounded-md border border-line bg-white dark:bg-paper-2 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="">{lang === "es" ? "Todos" : "All"}</option>
                {budgetOrigins.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <Button
          onClick={openCreateManual}
          disabled={clientOptions.length === 0}
          title={
            clientOptions.length > 0
              ? undefined
              : lang === "es"
                ? "No hay clientes activos"
                : "No active clients"
          }
        >
          <Plus size={14} strokeWidth={2.5} />
          {lang === "es" ? "Crear reporte" : "Create report"}
        </Button>
      </div>

      <section className="mb-8">
        <header className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">
            {lang === "es"
              ? "Proyectos cerrados pendientes de asignar fecha"
              : "Closed projects pending date assignment"}
          </h2>
          <span className="text-[11px] uppercase tracking-[0.08em] text-muted font-medium">
            {fPending.length}
            {lang === "es"
              ? ` proyecto${fPending.length === 1 ? "" : "s"}`
              : ` project${fPending.length === 1 ? "" : "s"}`}
          </span>
        </header>
        {fPending.length === 0 ? (
          <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-8 text-center text-sm text-muted">
            {lang === "es"
              ? "No hay proyectos cerrados pendientes. Cuando cierres uno aparecerá acá."
              : "No closed projects pending. New closes will appear here."}
          </div>
        ) : (
          <div className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden">
            {/* Desktop: tabla. En mobile usamos tarjetas (abajo). */}
            <div className="hidden lg:block">
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
                  {fPending.map((r) => (
                    <tr
                      key={r.reportId}
                      className="border-t border-line-soft hover:bg-paper-2 transition-colors"
                    >
                      <td className="px-4 py-2.5">
                        {r.projectCode ? (
                          <Link
                            href={`/proyectos/${r.projectCode}`}
                            className="font-medium text-ink hover:text-accent"
                          >
                            {r.projectName}
                          </Link>
                        ) : (
                          <span className="font-medium text-ink">
                            {r.projectName}
                          </span>
                        )}
                        {r.projectCode && (
                          <p className="text-[11px] text-muted font-mono">
                            {r.projectCode}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-2.5">{r.clientName}</td>
                      <td className="px-4 py-2.5 text-muted">
                        {r.budgetOriginName ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-muted font-mono">
                        {r.closedAt
                          ? formatDate(r.closedAt.slice(0, 10), lang)
                          : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className="inline-flex items-center gap-3">
                          <ReportCommentsButton
                            reportRef={{ kind: r.kind, reportId: r.reportId }}
                            title={r.projectName}
                            count={r.commentsCount}
                            lang={lang}
                          />
                          <Button
                            size="xs"
                            onClick={() =>
                              openAssign(r.reportId, r.kind, null, r.projectName)
                            }
                          >
                            {lang === "es" ? "Asignar fecha" : "Assign date"}
                          </Button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile: tarjetas (sin scroll horizontal). */}
            <div className="lg:hidden divide-y divide-line-soft">
              {fPending.map((r) => (
                <div key={r.reportId} className="px-4 py-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      {r.projectCode ? (
                        <Link
                          href={`/proyectos/${r.projectCode}`}
                          className="font-medium text-ink hover:text-accent"
                        >
                          {r.projectName}
                        </Link>
                      ) : (
                        <span className="font-medium text-ink">
                          {r.projectName}
                        </span>
                      )}
                      {r.projectCode && (
                        <p className="text-[11px] text-muted font-mono mt-0.5">
                          {r.projectCode}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0">
                      <ReportCommentsButton
                        reportRef={{ kind: r.kind, reportId: r.reportId }}
                        title={r.projectName}
                        count={r.commentsCount}
                        lang={lang}
                      />
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <CalCardStat
                      label={lang === "es" ? "Cliente" : "Client"}
                      value={r.clientName}
                    />
                    <CalCardStat
                      label="Budget Origin"
                      value={r.budgetOriginName ?? "—"}
                    />
                    <CalCardStat
                      label={lang === "es" ? "Cerrado el" : "Closed on"}
                      value={
                        r.closedAt
                          ? formatDate(r.closedAt.slice(0, 10), lang)
                          : "—"
                      }
                      mono
                    />
                  </div>
                  <div className="mt-3">
                    <Button
                      size="xs"
                      onClick={() =>
                        openAssign(r.reportId, r.kind, null, r.projectName)
                      }
                    >
                      {lang === "es" ? "Asignar fecha" : "Assign date"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section>
        <header className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">
            {lang === "es" ? "Calendario de entregas" : "Delivery calendar"}
          </h2>
          <span className="text-[11px] uppercase tracking-[0.08em] text-muted font-medium">
            {fInProgress.length}
            {lang === "es"
              ? ` reporte${fInProgress.length === 1 ? "" : "s"} en curso`
              : ` report${fInProgress.length === 1 ? "" : "s"} in progress`}
            <span className="text-line"> · </span>
            {lang === "es" ? "ventana -30 / +30 días" : "window -30 / +30 days"}
          </span>
        </header>
        <ReportingGantt
          reports={fInProgress}
          lang={lang}
          onAssignDate={(reportId, current) => {
            const r = fInProgress.find((x) => x.reportId === reportId);
            if (!r) return;
            openAssign(reportId, r.kind, current, r.projectName);
          }}
          onMarkDelivered={(reportId) => {
            const r = fInProgress.find((x) => x.reportId === reportId);
            if (!r) return;
            openMarkDelivered(reportId, r.kind, r.projectName);
          }}
          onDeleteManual={(reportId) => {
            const r = fInProgress.find((x) => x.reportId === reportId);
            if (!r) return;
            openConfirmDeleteManual(reportId, r.projectName);
          }}
          onOpenComments={(reportId) => {
            const r = fInProgress.find((x) => x.reportId === reportId);
            if (!r) return;
            setCommentsFor({ reportId, kind: r.kind, title: r.projectName });
          }}
        />
      </section>

      <SentReportsSection sent={fSent} lang={lang} />

      {/* Dialog: asignar / editar fecha */}
      {dialog.kind === "assign" && (
        <Modal onClose={close}>
          <AssignDateForm
            title={dialog.title}
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
              {dialog.reportKind === "project" ? (
                lang === "es" ? (
                  <>
                    El proyecto <strong>{dialog.title}</strong> va a pasar a
                    estado <em>reportado</em> y desaparecer del calendario. La
                    acción queda en el log de auditoría.
                  </>
                ) : (
                  <>
                    Project <strong>{dialog.title}</strong> will move to{" "}
                    <em>reported</em> status and leave the calendar. The action
                    is recorded in the audit log.
                  </>
                )
              ) : lang === "es" ? (
                <>
                  El reporte <strong>{dialog.title}</strong> va a marcarse como
                  entregado y pasar a la lista de enviados.
                </>
              ) : (
                <>
                  Report <strong>{dialog.title}</strong> will be marked as
                  delivered and move to the sent list.
                </>
              )}
            </p>
            {error && <p role="alert" className="text-xs text-danger">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={close}
                disabled={pendingAction}
                className="rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-1.5 text-sm hover:bg-paper-2 disabled:opacity-50"
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

      {/* Dialog: crear reporte manual */}
      {dialog.kind === "createManual" && (
        <Modal onClose={close}>
          <CreateManualReportForm
            clientOptions={clientOptions}
            defaultClientId={currentClient?.id ?? ""}
            lang={lang}
            pending={pendingAction}
            error={error}
            onCancel={close}
            onSubmit={submitCreateManual}
          />
        </Modal>
      )}

      {/* Tablerito de comentarios (abierto desde el Gantt) */}
      {commentsFor && (
        <ReportCommentsModal
          reportRef={{ kind: commentsFor.kind, reportId: commentsFor.reportId }}
          title={commentsFor.title}
          lang={lang}
          onClose={() => setCommentsFor(null)}
        />
      )}

      {/* Dialog: confirmar eliminación de reporte manual */}
      {dialog.kind === "confirmDeleteManual" && (
        <Modal onClose={close}>
          <div className="space-y-3">
            <h3 className="text-base font-semibold">
              {lang === "es"
                ? "¿Eliminar este reporte manual?"
                : "Delete this manual report?"}
            </h3>
            <p className="text-sm text-muted">
              <strong>{dialog.title}</strong>
              {lang === "es"
                ? " — esta acción no se puede deshacer. Si ya fue entregado, se borra también del histórico."
                : " — this can't be undone. If it was already delivered, it's removed from history too."}
            </p>
            {error && <p role="alert" className="text-xs text-danger">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={close}
                disabled={pendingAction}
                className="rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-1.5 text-sm hover:bg-paper-2 disabled:opacity-50"
              >
                {lang === "es" ? "Cancelar" : "Cancel"}
              </button>
              <button
                type="button"
                onClick={submitDeleteManual}
                disabled={pendingAction}
                className="rounded-md bg-danger text-white px-3 py-1.5 text-sm font-medium hover:bg-danger/90 disabled:opacity-50"
              >
                {pendingAction
                  ? lang === "es"
                    ? "Eliminando…"
                    : "Deleting…"
                  : lang === "es"
                    ? "Eliminar"
                    : "Delete"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

type LinkEditing = {
  reportId: string;
  reportKind: ReportKind;
  title: string;
  current: string | null;
};

function SentReportsSection({
  sent,
  lang,
}: {
  sent: SentReport[];
  lang: Language;
}) {
  const [query, setQuery] = useState("");
  const [linkEditing, setLinkEditing] = useState<LinkEditing | null>(null);
  const [linkPending, startLinkTransition] = useTransition();
  const [linkError, setLinkError] = useState<string | null>(null);

  const openLink = (r: SentReport) => {
    setLinkError(null);
    setLinkEditing({
      reportId: r.reportId,
      reportKind: r.kind,
      title: r.projectName,
      current: r.reportPptUrl,
    });
  };
  const closeLink = () => {
    setLinkEditing(null);
    setLinkError(null);
  };
  const submitLink = (url: string) => {
    if (!linkEditing) return;
    setLinkError(null);
    startLinkTransition(async () => {
      const res = await setReportPptUrl({
        reportId: linkEditing.reportId,
        kind: linkEditing.reportKind,
        url,
      });
      if (!res.ok) setLinkError(res.error);
      else closeLink();
    });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sent;
    return sent.filter((r) => {
      const haystack = [
        r.projectName,
        r.projectCode ?? "",
        r.description ?? "",
        ...r.planNames,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [sent, query]);

  return (
    <section className="mt-8">
      <header className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold">
          {lang === "es" ? "Reportes enviados" : "Sent reports"}
        </h2>
        <span className="text-[11px] uppercase tracking-[0.08em] text-muted font-medium">
          {filtered.length}
          {query.trim() ? ` / ${sent.length}` : ""}
          {lang === "es"
            ? ` reporte${(query.trim() ? sent.length : filtered.length) === 1 ? "" : "s"}`
            : ` report${(query.trim() ? sent.length : filtered.length) === 1 ? "" : "s"}`}
        </span>
      </header>

      <div className="relative mb-3 max-w-sm">
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            lang === "es"
              ? "Filtrar por proyecto, campaña o nombre…"
              : "Filter by project, campaign or name…"
          }
          className="w-full rounded-md border border-line bg-white dark:bg-paper-2 pl-9 pr-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      {sent.length === 0 ? (
        <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-8 text-center text-sm text-muted">
          {lang === "es"
            ? "Todavía no hay reportes enviados. Cuando marques uno como entregado aparecerá acá."
            : "No sent reports yet. Reports marked as delivered will appear here."}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-8 text-center text-sm text-muted">
          {lang === "es"
            ? "Ningún reporte enviado coincide con el filtro."
            : "No sent report matches the filter."}
        </div>
      ) : (
        <div className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden">
          {/* Desktop: tabla. En mobile usamos tarjetas (abajo). */}
          <div className="hidden lg:block">
            <table className="w-full text-sm">
              <thead className="bg-paper-2 border-b border-line">
                <tr className="text-left text-[10px] uppercase tracking-[0.08em] text-muted font-medium">
                  <th className="px-4 py-2.5">
                    {lang === "es" ? "Reporte" : "Report"}
                  </th>
                  <th className="px-4 py-2.5">
                    {lang === "es" ? "Cliente" : "Client"}
                  </th>
                  <th className="px-4 py-2.5">
                    {lang === "es" ? "Campañas" : "Campaigns"}
                  </th>
                  <th className="px-4 py-2.5">
                    {lang === "es" ? "Enviado el" : "Sent on"}
                  </th>
                  <th className="px-4 py-2.5">
                    {lang === "es" ? "Fecha objetivo" : "Target date"}
                  </th>
                  <th className="px-4 py-2.5">
                    {lang === "es" ? "Reporte (PPT)" : "Report (PPT)"}
                  </th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.reportId}
                    className="border-t border-line-soft hover:bg-paper-2 transition-colors"
                  >
                    <td className="px-4 py-2.5">
                      {r.projectCode ? (
                        <Link
                          href={`/proyectos/${r.projectCode}`}
                          className="font-medium text-ink hover:text-accent"
                        >
                          {r.projectName}
                        </Link>
                      ) : (
                        <span className="font-medium text-ink inline-flex items-center gap-2">
                          {r.projectName}
                          <span className="text-[9px] uppercase tracking-[0.08em] font-semibold text-muted bg-paper-2 border border-line rounded px-1.5 py-0.5">
                            manual
                          </span>
                        </span>
                      )}
                      {r.projectCode && (
                        <p className="text-[11px] text-muted font-mono">
                          {r.projectCode}
                        </p>
                      )}
                      {r.description && (
                        <p className="text-[11px] text-muted line-clamp-1 mt-0.5">
                          {r.description}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-2.5">{r.clientName}</td>
                    <td className="px-4 py-2.5 text-muted">
                      {r.planNames.length > 0 ? r.planNames.join(", ") : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-muted font-mono">
                      {formatDate(r.deliveredAt.slice(0, 10), lang)}
                    </td>
                    <td className="px-4 py-2.5 text-muted font-mono">
                      {r.deliveryDate ? formatDate(r.deliveryDate, lang) : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.reportPptUrl ? (
                        <span className="inline-flex items-center gap-2">
                          <a
                            href={r.reportPptUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-accent text-xs font-medium hover:underline"
                          >
                            <ExternalLink size={12} />
                            {lang === "es" ? "Ver PPT" : "View PPT"}
                          </a>
                          <button
                            type="button"
                            onClick={() => openLink(r)}
                            title={lang === "es" ? "Editar link" : "Edit link"}
                            className="text-muted hover:text-ink"
                          >
                            <Pencil size={12} />
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openLink(r)}
                          className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink"
                        >
                          <Link2 size={12} />
                          {lang === "es" ? "Agregar link" : "Add link"}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <ReportCommentsButton
                        reportRef={{ kind: r.kind, reportId: r.reportId }}
                        title={r.projectName}
                        count={r.commentsCount}
                        lang={lang}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: tarjetas (sin scroll horizontal). */}
          <div className="lg:hidden divide-y divide-line-soft">
            {filtered.map((r) => (
              <div key={r.reportId} className="px-4 py-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    {r.projectCode ? (
                      <Link
                        href={`/proyectos/${r.projectCode}`}
                        className="font-medium text-ink hover:text-accent"
                      >
                        {r.projectName}
                      </Link>
                    ) : (
                      <span className="font-medium text-ink inline-flex items-center gap-2">
                        {r.projectName}
                        <span className="text-[9px] uppercase tracking-[0.08em] font-semibold text-muted bg-paper-2 border border-line rounded px-1.5 py-0.5">
                          manual
                        </span>
                      </span>
                    )}
                    {r.projectCode && (
                      <p className="text-[11px] text-muted font-mono mt-0.5">
                        {r.projectCode}
                      </p>
                    )}
                    {r.description && (
                      <p className="text-[11px] text-muted line-clamp-1 mt-0.5">
                        {r.description}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0">
                    <ReportCommentsButton
                      reportRef={{ kind: r.kind, reportId: r.reportId }}
                      title={r.projectName}
                      count={r.commentsCount}
                      lang={lang}
                    />
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <CalCardStat
                    label={lang === "es" ? "Cliente" : "Client"}
                    value={r.clientName}
                  />
                  <CalCardStat
                    label={lang === "es" ? "Campañas" : "Campaigns"}
                    value={r.planNames.length > 0 ? r.planNames.join(", ") : "—"}
                  />
                  <CalCardStat
                    label={lang === "es" ? "Enviado el" : "Sent on"}
                    value={formatDate(r.deliveredAt.slice(0, 10), lang)}
                    mono
                  />
                  <CalCardStat
                    label={lang === "es" ? "Fecha objetivo" : "Target date"}
                    value={r.deliveryDate ? formatDate(r.deliveryDate, lang) : "—"}
                    mono
                  />
                </div>
                <div className="mt-3">
                  {r.reportPptUrl ? (
                    <span className="inline-flex items-center gap-3">
                      <a
                        href={r.reportPptUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-accent text-xs font-medium hover:underline"
                      >
                        <ExternalLink size={12} />
                        {lang === "es" ? "Ver PPT" : "View PPT"}
                      </a>
                      <button
                        type="button"
                        onClick={() => openLink(r)}
                        title={lang === "es" ? "Editar link" : "Edit link"}
                        className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink"
                      >
                        <Pencil size={12} />
                        {lang === "es" ? "Editar link" : "Edit link"}
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openLink(r)}
                      className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink"
                    >
                      <Link2 size={12} />
                      {lang === "es" ? "Agregar link" : "Add link"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {linkEditing && (
        <Modal onClose={closeLink}>
          <LinkForm
            title={linkEditing.title}
            initialUrl={linkEditing.current}
            lang={lang}
            pending={linkPending}
            error={linkError}
            onCancel={closeLink}
            onSubmit={submitLink}
          />
        </Modal>
      )}
    </section>
  );
}

function CreateManualReportForm({
  clientOptions,
  defaultClientId,
  lang,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  clientOptions: { id: string; name: string }[];
  defaultClientId: string;
  lang: Language;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (input: {
    clientId: string;
    name: string;
    description: string;
    deliveryDate: string;
  }) => void;
}) {
  const [clientId, setClientId] = useState<string>(
    defaultClientId || (clientOptions.length === 1 ? clientOptions[0].id : ""),
  );
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [deliveryDate, setDeliveryDate] = useState<string>(defaultDate());

  const canSubmit = !!clientId && name.trim().length > 0 && !!deliveryDate;

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        onSubmit({
          clientId,
          name: name.trim(),
          description: description.trim(),
          deliveryDate,
        });
      }}
    >
      <h3 className="text-base font-semibold">
        {lang === "es" ? "Crear reporte manual" : "Create manual report"}
      </h3>

      <label className="block">
        <span className="text-[11px] uppercase tracking-[0.08em] text-muted font-medium">
          {lang === "es" ? "Cliente" : "Client"}
        </span>
        <select
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          required
          className="mt-1 block w-full rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="" disabled>
            {lang === "es" ? "Elegí un cliente…" : "Pick a client…"}
          </option>
          {clientOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-[11px] uppercase tracking-[0.08em] text-muted font-medium">
          {lang === "es" ? "Nombre" : "Name"}
        </span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          required
          placeholder={
            lang === "es"
              ? "Ej.: Recap Q2 — Always-On Performance"
              : "e.g.: Q2 Recap — Always-On Performance"
          }
          className="mt-1 block w-full rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>

      <label className="block">
        <span className="text-[11px] uppercase tracking-[0.08em] text-muted font-medium">
          {lang === "es" ? "Descripción" : "Description"}
        </span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder={
            lang === "es"
              ? "Contexto del reporte (opcional)…"
              : "Report context (optional)…"
          }
          className="mt-1 block w-full rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>

      <label className="block">
        <span className="text-[11px] uppercase tracking-[0.08em] text-muted font-medium">
          {lang === "es" ? "Fecha de entrega" : "Delivery date"}
        </span>
        <input
          type="date"
          value={deliveryDate}
          onChange={(e) => setDeliveryDate(e.target.value)}
          required
          className="mt-1 block w-full rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>

      {error && <p role="alert" className="text-xs text-danger">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-1.5 text-sm hover:bg-paper-2 disabled:opacity-50"
        >
          {lang === "es" ? "Cancelar" : "Cancel"}
        </button>
        <button
          type="submit"
          disabled={pending || !canSubmit}
          className={buttonVariants({ size: "md" })}
        >
          {pending
            ? lang === "es"
              ? "Creando…"
              : "Creating…"
            : lang === "es"
              ? "Crear"
              : "Create"}
        </button>
      </div>
    </form>
  );
}

function LinkForm({
  title,
  initialUrl,
  lang,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  title: string;
  initialUrl: string | null;
  lang: Language;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (url: string) => void;
}) {
  const [value, setValue] = useState<string>(initialUrl ?? "");

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(value);
      }}
    >
      <h3 className="text-base font-semibold">
        {lang === "es" ? "Link al reporte (PPT)" : "Report link (PPT)"}
      </h3>
      <p className="text-sm text-muted">{title}</p>
      <label className="block">
        <span className="text-[11px] uppercase tracking-[0.08em] text-muted font-medium">
          {lang === "es" ? "URL del PPT (Drive)" : "PPT URL (Drive)"}
        </span>
        <input
          type="url"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          placeholder="https://drive.google.com/…"
          className="mt-1 block w-full rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>
      <p className="text-[11px] text-muted italic">
        {lang === "es"
          ? "Opcional. Pegá el link del PPT final para encontrarlo rápido a futuro."
          : "Optional. Paste the final PPT link so it's quick to find later."}
      </p>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        {initialUrl && (
          <button
            type="button"
            onClick={() => onSubmit("")}
            disabled={pending}
            className="mr-auto rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-1.5 text-sm text-danger hover:bg-paper-2 disabled:opacity-50"
          >
            {lang === "es" ? "Quitar link" : "Remove link"}
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-1.5 text-sm hover:bg-paper-2 disabled:opacity-50"
        >
          {lang === "es" ? "Cancelar" : "Cancel"}
        </button>
        <button
          type="submit"
          disabled={pending}
          className={buttonVariants({ size: "md" })}
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

function AssignDateForm({
  title,
  initialDate,
  lang,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  title: string;
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
      <p className="text-sm text-muted">{title}</p>
      <label className="block">
        <span className="text-[11px] uppercase tracking-[0.08em] text-muted font-medium">
          {lang === "es" ? "Fecha de entrega" : "Delivery date"}
        </span>
        <input
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="mt-1 block w-full rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          required
        />
      </label>
      <p className="text-[11px] text-muted italic">
        {lang === "es"
          ? "Al guardar, el día de hoy queda registrado como el momento del compromiso."
          : "On save, today is recorded as the moment of the commitment."}
      </p>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-1.5 text-sm hover:bg-paper-2 disabled:opacity-50"
        >
          {lang === "es" ? "Cancelar" : "Cancel"}
        </button>
        <button
          type="submit"
          disabled={pending || !value}
          className={buttonVariants({ size: "md" })}
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
      <div className="w-full max-w-md rounded-lg border border-line bg-white dark:bg-paper-2 shadow-xl p-5">
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

// Par label/valor para las tarjetas mobile (reemplazan a las tablas en <lg).
function CalCardStat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
      </p>
      <p
        className={`text-xs text-ink-2 mt-0.5 truncate ${mono ? "font-mono tabular-nums" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}

// Silenciar warning si Trash2 quedara sin uso (lo deja para futuro icon
// dentro del Gantt para reportes manuales).
void Trash2;
