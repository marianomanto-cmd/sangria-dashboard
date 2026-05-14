import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getCampaignTrackerPlan } from "@/db/queries/campaign-tracker";
import { buildHrefWithClient } from "@/lib/client-filter";
import { resolveClientFromSearchParams } from "@/lib/client-filter.server";
import { parseLocalDate } from "@/lib/campaign-metrics";
import { formatUsd } from "@/lib/format";
import { formatDate } from "@/lib/i18n";
import { relativeUpdateLabel } from "@/components/campaign-tracker-bits";
import { CampaignTrackerEditor } from "./tracker-editor";

type Props = {
  params: Promise<{ planId: string }>;
  searchParams: Promise<{ client?: string }>;
};

export default async function CampaignTrackerPlanPage({
  params,
  searchParams,
}: Props) {
  const { planId } = await params;
  const sp = await searchParams;
  const client = await resolveClientFromSearchParams(sp);

  const data = await getCampaignTrackerPlan(planId);
  if (!data) notFound();

  const lang = data.client.language;
  const hubHref = buildHrefWithClient("/campaign-tracker", client?.slug ?? null);

  // KPIs del header — snapshot al cargar la página.
  const nowMs = new Date().getTime();
  const start = parseLocalDate(data.periodStart ?? "");
  const end = parseLocalDate(data.periodEnd ?? "");
  let daysElapsed = 0;
  let daysTotal = 0;
  if (start && end) {
    const dayMs = 86_400_000;
    daysTotal = Math.max(1, Math.round((end.getTime() - start.getTime()) / dayMs) + 1);
    daysElapsed = Math.min(
      daysTotal,
      Math.max(0, Math.round((nowMs - start.getTime()) / dayMs)),
    );
  }
  const progressPct =
    data.goalInvestmentUsd > 0
      ? (data.actualInvestmentUsd / data.goalInvestmentUsd) * 100
      : 0;
  const deltaVsPace = progressPct - data.pacePct;

  return (
    <main className="px-8 py-10 max-w-[1380px] mx-auto w-full">
      <nav
        aria-label="Breadcrumb"
        className="text-xs text-muted flex items-center gap-1.5 mb-3"
      >
        <Link href={hubHref} className="hover:text-ink">
          Campaign Tracker
        </Link>
        <span className="text-stone-300">/</span>
        <span className="hover:text-ink">{data.client.name}</span>
        <span className="text-stone-300">/</span>
        <Link
          href={`/proyectos/${data.project.code}`}
          className="hover:text-ink"
        >
          {data.project.name}
        </Link>
        <span className="text-stone-300">/</span>
        <span className="text-ink font-medium">{data.plan.name}</span>
      </nav>

      {/* Header del plan */}
      <header className="rounded-lg border border-line bg-white px-6 py-5 mb-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-semibold tracking-tight">
                {data.plan.name}
              </h1>
              <span className="inline-flex items-center rounded-sm border border-accent-soft bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
                {data.plan.currentVersion > 0
                  ? `Plan v${data.plan.currentVersion}`
                  : "Plan"}{" "}
                · vigente
              </span>
              <span className="inline-flex items-center rounded-sm border border-line bg-paper-2 px-2 py-0.5 text-[11px] font-medium text-muted">
                {data.budgetOriginName} · {data.client.name}
              </span>
            </div>
            <p className="text-xs text-muted mt-1.5 font-mono">
              {formatDate(data.periodStart, lang)} →{" "}
              {formatDate(data.periodEnd, lang)} · {data.publishers.length}{" "}
              publishers ·{" "}
              {data.publishers.reduce((s, p) => s + p.placements.length, 0)}{" "}
              placements · {formatUsd(data.goalInvestmentUsd)} goal
            </p>
          </div>

          {/* Date stepper — visual / próximamente (no hay histórico diario) */}
          <div className="flex items-center gap-2">
            <div
              className="flex items-center gap-1 rounded-md border border-dashed border-line bg-paper-2 p-1"
              title="Próximamente — esta entrega no maneja histórico diario"
            >
              <button
                type="button"
                disabled
                className="px-1.5 py-0.5 text-muted disabled:opacity-50"
              >
                ‹
              </button>
              <span className="text-xs font-medium px-1 text-ink-2">
                {new Date().toLocaleDateString("es-AR", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                })}
              </span>
              <button
                type="button"
                disabled
                className="px-1.5 py-0.5 text-muted disabled:opacity-50"
              >
                ›
              </button>
            </div>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-5">
          <Kpi
            label="Días corridos"
            value={`${daysElapsed}/${daysTotal}`}
            hint={`${data.pacePct.toFixed(0)}% del período`}
          />
          <Kpi
            label="Consumo (USD)"
            value={formatUsd(data.actualInvestmentUsd)}
            hint={`${progressPct.toFixed(0)}% del goal`}
          />
          <Kpi
            label="Avance vs pace"
            value={`${deltaVsPace >= 0 ? "+" : ""}${deltaVsPace.toFixed(0)}%`}
            hint={deltaVsPace >= 0 ? "adelantado" : "atrasado"}
            tone={
              deltaVsPace < -10
                ? "warn"
                : deltaVsPace > 25 || progressPct > 90
                  ? "danger"
                  : "good"
            }
          />
          <Kpi
            label="Goal del plan"
            value={formatUsd(data.goalInvestmentUsd)}
            hint={`${data.publishers.reduce((s, p) => s + p.placements.length, 0)} placements`}
          />
          <Kpi
            label="Última carga"
            value={relativeUpdateLabel(data.lastUpdateAt)}
            hint={data.lastUpdateAt ? "autosave activo" : "sin datos cargados"}
          />
        </div>
      </header>

      {!data.hasGoals && (
        <div className="rounded-lg border border-warn-soft bg-warn-soft/50 px-5 py-3 mb-5 text-sm text-warn">
          Este plan no tiene goals definidos en sus placements. Cargá montos y
          métricas en el{" "}
          <Link
            href={`/proyectos/${data.project.code}/planes/${data.plan.id}`}
            className="underline font-medium"
          >
            editor del plan
          </Link>{" "}
          para habilitar la comparación contra goal.
        </div>
      )}

      <CampaignTrackerEditor
        planId={data.plan.id}
        pacePct={data.pacePct}
        publishers={data.publishers}
      />

      <div className="mt-5">
        <Link
          href={hubHref}
          className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink"
        >
          <ChevronLeft size={14} />
          Volver al hub de planes
        </Link>
      </div>
    </main>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "warn" | "danger";
}) {
  const hintCls =
    tone === "good"
      ? "text-success"
      : tone === "warn"
        ? "text-warn"
        : tone === "danger"
          ? "text-danger"
          : "text-muted";
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
        {label}
      </p>
      <p className="font-mono text-lg font-semibold mt-0.5 tabular-nums">
        {value}
      </p>
      {hint && <p className={`text-xs ${hintCls}`}>{hint}</p>}
    </div>
  );
}
