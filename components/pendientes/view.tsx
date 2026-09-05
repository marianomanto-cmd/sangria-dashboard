import { AlertTriangle } from "lucide-react";
import {
  EmptyRow,
  Panel,
  PendingRow,
  type Tone,
} from "@/components/pendientes/pieces";
import type { Language } from "@/lib/i18n";
import type { Pendientes, PendingPlan } from "@/db/queries/pendientes";

// ════════════════════════════════════════════════════════════════════════════
// Pendientes (`/pendientes`). Cuatro listas y nada más; el porqué está en
// db/queries/pendientes.ts.
//
// Todo server component: esta vista no manda un solo byte de JS al browser.
// ════════════════════════════════════════════════════════════════════════════

type ViewProps = {
  data: Pendientes;
  lang: Language;
};

// Umbrales de urgencia, en días. Están acá juntos a propósito: son criterio de
// negocio, no detalle de cada panel.
//   • Tracking: el cierre es DIARIO, así que a los 3 días sin cerrar la campaña
//     ya perdió la serie de la semana.
//   • QA: un plan firmado no puede ir a live hasta que se controle; una semana
//     parado es una campaña que arrancó sin verificar.
//   • Aprobación: la pelota está del lado del cliente, así que se le da más
//     aire — dos semanas sin firma sí es un problema.
const URGENT_TRACKING_DAYS = 3;
const URGENT_QA_DAYS = 7;
const URGENT_APPROVAL_DAYS = 14;

function waitTone(days: number | null, urgentAt: number): Tone {
  if (days === null) return "warn";
  return days >= urgentAt ? "danger" : "warn";
}

function waitBadge(days: number | null, es: boolean): string {
  if (days === null) return es ? "sin fecha" : "no date";
  if (days === 0) return es ? "hoy" : "today";
  return es ? `hace ${days}d` : `${days}d waiting`;
}

// Las dos listas de planes son la misma fila con distinto umbral y distinto
// texto de vacío, así que comparten componente.
function PlanList({
  plans,
  urgentAt,
  emptyText,
  es,
}: {
  plans: PendingPlan[];
  urgentAt: number;
  emptyText: string;
  es: boolean;
}) {
  if (plans.length === 0) return <EmptyRow text={emptyText} />;
  return (
    <ul className="divide-y divide-line max-h-[24rem] overflow-y-auto">
      {plans.map((p) => (
        <PendingRow
          key={p.id}
          href={p.href}
          title={p.name}
          sub={`${p.clientName} · ${p.projectName} · v${p.version}`}
          badge={waitBadge(p.waitingDays, es)}
          tone={waitTone(p.waitingDays, urgentAt)}
        />
      ))}
    </ul>
  );
}

function Board({ data, lang }: ViewProps) {
  const es = lang === "es";
  const { pendingBillings, pendingTracking, plansPendingQa, plansPendingApproval } =
    data;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Panel
        title={es ? "Billings pendientes" : "Pending billings"}
        count={pendingBillings.length}
        action={{ href: "/billing", label: es ? "Ir a Billing" : "Go to Billing" }}
      >
        {pendingBillings.length === 0 ? (
          <EmptyRow
            text={
              es
                ? "No hay meses cerrados sin facturar."
                : "No closed months left to bill."
            }
          />
        ) : (
          <ul className="divide-y divide-line max-h-[24rem] overflow-y-auto">
            {pendingBillings.map((b) => (
              <PendingRow
                key={`${b.planId}-${b.month}`}
                href={b.href}
                title={`${b.planName} · ${b.month}`}
                sub={`${b.clientName} · ${b.projectCode}`}
                badge={es ? "sin facturar" : "not billed"}
                tone="warn"
              />
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title={es ? "Trackings pendientes" : "Pending tracking"}
        count={pendingTracking.length}
        action={{ href: "/campaign-tracker", label: "Campaign Tracker" }}
      >
        {pendingTracking.length === 0 ? (
          <EmptyRow
            text={
              es
                ? "Todas las campañas al aire tienen el cierre de hoy."
                : "Every live campaign is closed for today."
            }
          />
        ) : (
          <ul className="divide-y divide-line max-h-[24rem] overflow-y-auto">
            {pendingTracking.map((t) => {
              const never = t.daysSinceClose === null;
              return (
                <PendingRow
                  key={t.planId}
                  href={t.href}
                  title={t.planName}
                  sub={
                    never
                      ? t.clientName
                      : `${t.clientName} · ${es ? "último cierre" : "last close"} ${t.lastCloseDate}`
                  }
                  badge={
                    never
                      ? es
                        ? "nunca cerrado"
                        : "never closed"
                      : waitBadge(t.daysSinceClose, es)
                  }
                  tone={
                    never ? "danger" : waitTone(t.daysSinceClose, URGENT_TRACKING_DAYS)
                  }
                />
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel
        title={es ? "Planes pendientes de QA" : "Plans pending QA"}
        count={plansPendingQa.length}
        action={{
          href: "/planes?status=approved",
          label: es ? "Ver todos" : "See all",
        }}
      >
        <PlanList
          plans={plansPendingQa}
          urgentAt={URGENT_QA_DAYS}
          es={es}
          emptyText={
            es
              ? "Ningún plan firmado esperando QA."
              : "No signed plan waiting for QA."
          }
        />
      </Panel>

      <Panel
        title={es ? "Planes pendientes de aprobar" : "Plans pending approval"}
        count={plansPendingApproval.length}
        action={{
          href: "/planes?status=ready_to_send",
          label: es ? "Ver todos" : "See all",
        }}
      >
        <PlanList
          plans={plansPendingApproval}
          urgentAt={URGENT_APPROVAL_DAYS}
          es={es}
          emptyText={
            es ? "Ningún plan esperando firma." : "No plan waiting for signature."
          }
        />
      </Panel>
    </div>
  );
}

// ── Raíz ────────────────────────────────────────────────────────────────────

export function PendientesView({
  data,
  failed,
  lang,
}: ViewProps & { failed: string | null }) {
  const es = lang === "es";
  if (failed) {
    return (
      <div className="rounded-lg border border-danger/30 bg-danger-soft/40 px-5 py-6 flex items-start gap-3">
        <AlertTriangle size={18} className="text-danger shrink-0 mt-0.5" />
        <div className="text-[13px] leading-relaxed text-ink-2">
          <p className="font-semibold text-ink">
            {es ? "No se pudo leer la base" : "Could not read the database"}
          </p>
          <p className="mt-1">
            {es
              ? "La vista no muestra listas vacías en vez de las de verdad: un tablero sin pendientes se lee como que no hay nada que hacer, y no es eso. Recargá en unos segundos."
              : "Showing nothing instead of empty lists: a board with no pendings reads as nothing to do, and that isn't it. Reload in a few seconds."}
          </p>
          <p className="mt-2 font-mono text-[11px] text-muted whitespace-pre-wrap">
            {failed}
          </p>
        </div>
      </div>
    );
  }

  return <Board data={data} lang={lang} />;
}
