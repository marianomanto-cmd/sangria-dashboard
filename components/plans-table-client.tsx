"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import {
  AlignJustify,
  AlignLeft,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  FolderTree,
  LayoutList,
  Search,
} from "lucide-react";
import { formatUsd, formatUsdCompact } from "@/lib/format";
import { formatDate, type Language } from "@/lib/i18n";
import { PlanStatusBadge } from "@/components/plan-status-badge";

export type PlanRow = {
  id: string;
  name: string;
  status: string;
  currentVersion: number;
  periodStart: string | null;
  periodEnd: string | null;
  projectId: string;
  projectCode: string;
  projectName: string;
  clientName: string;
  clientSlug: string;
  budgetOriginName: string;
  totalMediaUsd: string;
  spentMediaUsd: string;
};

type SortCol = "name" | "project" | "client" | "status" | "period" | "media" | "spent";
type SortDir = "asc" | "desc";

// ── Preferencias en localStorage ────────────────────────────────────────────
// Mismo patrón que pending-board / theme-toggle: useSyncExternalStore para
// arrancar consistente en SSR sin disparar setState en effect.

const DENSITY_KEY = "sangria:planes:density";
const VIEW_KEY = "sangria:planes:view";
const prefListeners = new Set<() => void>();
function subscribePrefs(cb: () => void): () => void {
  prefListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    prefListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}
function getDensity(): "compact" | "comfortable" {
  return localStorage.getItem(DENSITY_KEY) === "compact" ? "compact" : "comfortable";
}
function setDensity(d: "compact" | "comfortable"): void {
  localStorage.setItem(DENSITY_KEY, d);
  prefListeners.forEach((cb) => cb());
}
function getView(): "list" | "project" {
  return localStorage.getItem(VIEW_KEY) === "project" ? "project" : "list";
}
function setView(v: "list" | "project"): void {
  localStorage.setItem(VIEW_KEY, v);
  prefListeners.forEach((cb) => cb());
}

function sortPlans(plans: PlanRow[], col: SortCol, dir: SortDir): PlanRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const cmpStr = (a: string, b: string) =>
    a.localeCompare(b, undefined, { sensitivity: "base" });
  const cmpNum = (a: number, b: number) => a - b;
  return [...plans].sort((a, b) => {
    switch (col) {
      case "name":
        return cmpStr(a.name, b.name) * sign;
      case "project":
        return cmpStr(a.projectName, b.projectName) * sign;
      case "client":
        return cmpStr(a.clientName, b.clientName) * sign;
      case "status":
        return cmpStr(a.status, b.status) * sign;
      case "period":
        return cmpStr(a.periodStart ?? "", b.periodStart ?? "") * sign;
      case "media":
        return (
          cmpNum(
            Number.parseFloat(a.totalMediaUsd),
            Number.parseFloat(b.totalMediaUsd),
          ) * sign
        );
      case "spent":
        return (
          cmpNum(
            Number.parseFloat(a.spentMediaUsd),
            Number.parseFloat(b.spentMediaUsd),
          ) * sign
        );
    }
  });
}

export function PlansTableClient({ plans, lang }: { plans: PlanRow[]; lang: Language }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ col: SortCol; dir: SortDir }>({
    col: "name",
    dir: "asc",
  });
  // SSR-safe: server arranca con "comfortable" / "list"; el cliente hidrata.
  const density = useSyncExternalStore(
    subscribePrefs,
    getDensity,
    () => "comfortable" as const,
  );
  const view = useSyncExternalStore(
    subscribePrefs,
    getView,
    () => "list" as const,
  );

  const sorted = useMemo(() => sortPlans(plans, sort.col, sort.dir), [
    plans,
    sort,
  ]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.projectCode.toLowerCase().includes(q),
    );
  }, [sorted, query]);

  const toggleSort = (col: SortCol) => {
    setSort((cur) =>
      cur.col === col
        ? { col, dir: cur.dir === "asc" ? "desc" : "asc" }
        : { col, dir: col === "media" || col === "spent" ? "desc" : "asc" },
    );
  };

  const compact = density === "compact";

  return (
    <div className="space-y-3">
      <Toolbar
        query={query}
        onQueryChange={setQuery}
        density={density}
        onDensityChange={setDensity}
        view={view}
        onViewChange={setView}
        lang={lang}
      />

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-12 text-center text-sm text-muted">
          {lang === "es"
            ? "Ningún plan coincide con la búsqueda."
            : "No plans match your search."}
        </div>
      ) : view === "project" ? (
        <GroupedByProject plans={filtered} compact={compact} lang={lang} />
      ) : (
        <FlatTable
          plans={filtered}
          compact={compact}
          lang={lang}
          sort={sort}
          onSort={toggleSort}
        />
      )}
    </div>
  );
}

// ── Toolbar ────────────────────────────────────────────────────────────────

function Toolbar({
  query,
  onQueryChange,
  density,
  onDensityChange,
  view,
  onViewChange,
  lang,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  density: "compact" | "comfortable";
  onDensityChange: (d: "compact" | "comfortable") => void;
  view: "list" | "project";
  onViewChange: (v: "list" | "project") => void;
  lang: Language;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative max-w-sm flex-1 min-w-[220px]">
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={
            lang === "es"
              ? "Buscar por nombre o código…"
              : "Search by name or code…"
          }
          className="w-full rounded-md border border-line bg-white dark:bg-paper-2 pl-9 pr-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      <SegmentedToggle
        ariaLabel={lang === "es" ? "Vista" : "View"}
        options={[
          {
            value: "list",
            label: lang === "es" ? "Lista" : "List",
            icon: LayoutList,
          },
          {
            value: "project",
            label: lang === "es" ? "Por proyecto" : "By project",
            icon: FolderTree,
          },
        ]}
        current={view}
        onChange={(v) => onViewChange(v as "list" | "project")}
      />

      <SegmentedToggle
        ariaLabel={lang === "es" ? "Densidad" : "Density"}
        options={[
          {
            value: "comfortable",
            label: lang === "es" ? "Normal" : "Normal",
            icon: AlignLeft,
          },
          {
            value: "compact",
            label: lang === "es" ? "Compacta" : "Compact",
            icon: AlignJustify,
          },
        ]}
        current={density}
        onChange={(v) => onDensityChange(v as "compact" | "comfortable")}
      />
    </div>
  );
}

function SegmentedToggle<T extends string>({
  ariaLabel,
  options,
  current,
  onChange,
}: {
  ariaLabel: string;
  options: { value: T; label: string; icon: typeof LayoutList }[];
  current: T;
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex items-center rounded-md border border-line bg-white dark:bg-paper-2 p-0.5 text-xs"
    >
      {options.map((o) => {
        const Icon = o.icon;
        const active = current === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`inline-flex items-center gap-1.5 rounded px-2 py-1 transition-colors ${
              active
                ? "bg-paper-2 dark:bg-paper text-ink shadow-sm"
                : "text-muted hover:text-ink-2"
            }`}
            title={o.label}
          >
            <Icon size={13} strokeWidth={2} />
            <span className="hidden sm:inline">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Flat table (sortable) ──────────────────────────────────────────────────

function FlatTable({
  plans,
  compact,
  lang,
  sort,
  onSort,
}: {
  plans: PlanRow[];
  compact: boolean;
  lang: Language;
  sort: { col: SortCol; dir: SortDir };
  onSort: (col: SortCol) => void;
}) {
  return (
    <section className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-x-auto">
      <table className={`w-full min-w-[720px] ${compact ? "text-xs" : "text-sm"}`}>
        <thead className="bg-paper">
          <tr className="text-[11px] uppercase tracking-[0.06em] text-muted">
            <SortableTh col="name" sort={sort} onSort={onSort} label="Plan" compact={compact} />
            <SortableTh
              col="project"
              sort={sort}
              onSort={onSort}
              label={lang === "es" ? "Proyecto" : "Project"}
              compact={compact}
            />
            <SortableTh
              col="client"
              sort={sort}
              onSort={onSort}
              label={lang === "es" ? "Cliente" : "Client"}
              compact={compact}
            />
            <Th compact={compact}>{lang === "es" ? "Origen" : "Origin"}</Th>
            <SortableTh
              col="status"
              sort={sort}
              onSort={onSort}
              label={lang === "es" ? "Estado" : "Status"}
              compact={compact}
            />
            <SortableTh
              col="period"
              sort={sort}
              onSort={onSort}
              label={lang === "es" ? "Período" : "Period"}
              compact={compact}
            />
            <SortableTh
              col="media"
              sort={sort}
              onSort={onSort}
              label={lang === "es" ? "Media · Consumido" : "Media · Consumed"}
              align="right"
              compact={compact}
            />
          </tr>
        </thead>
        <tbody>
          {plans.map((p) => (
            <PlanRowCells key={p.id} plan={p} compact={compact} lang={lang} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ── Grouped by project view ────────────────────────────────────────────────

function GroupedByProject({
  plans,
  compact,
  lang,
}: {
  plans: PlanRow[];
  compact: boolean;
  lang: Language;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, PlanRow[]>();
    for (const p of plans) {
      const arr = map.get(p.projectId) ?? [];
      arr.push(p);
      map.set(p.projectId, arr);
    }
    const list = [...map.entries()].map(([projectId, planList]) => ({
      projectId,
      projectCode: planList[0].projectCode,
      projectName: planList[0].projectName,
      clientName: planList[0].clientName,
      clientSlug: planList[0].clientSlug,
      plans: planList,
    }));
    list.sort((a, b) =>
      a.projectName.localeCompare(b.projectName, undefined, { sensitivity: "base" }),
    );
    return list;
  }, [plans]);

  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => {
        const projectMedia = g.plans.reduce(
          (s, p) => s + Number.parseFloat(p.totalMediaUsd),
          0,
        );
        const projectSpent = g.plans.reduce(
          (s, p) => s + Number.parseFloat(p.spentMediaUsd),
          0,
        );
        return (
          <section
            key={g.projectId}
            className="rounded-lg border border-line bg-white dark:bg-paper-2 overflow-hidden"
          >
            <header className="flex items-center justify-between gap-4 px-5 py-3 border-b border-line bg-paper">
              <div className="min-w-0">
                <Link
                  href={`/proyectos/${g.projectCode}`}
                  className="font-semibold text-ink hover:text-accent transition-colors"
                >
                  {g.projectName}
                </Link>
                <p className="text-[11px] text-muted font-mono mt-0.5">
                  {g.projectCode}{" "}
                  <span className="text-line">·</span>{" "}
                  <Link
                    href={`/clientes/${g.clientSlug}`}
                    className="hover:text-ink transition-colors"
                  >
                    {g.clientName}
                  </Link>
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
                  {lang === "es"
                    ? `${g.plans.length} plan${g.plans.length === 1 ? "" : "es"}`
                    : `${g.plans.length} plan${g.plans.length === 1 ? "" : "s"}`}
                </p>
                <p className="font-mono text-sm font-semibold text-ink tabular-nums">
                  {formatUsd(projectMedia)}
                </p>
                <p className="font-mono text-[11px] text-muted tabular-nums">
                  {formatUsdCompact(projectSpent)}{" "}
                  {lang === "es" ? "consumido" : "consumed"}
                </p>
              </div>
            </header>
            <table className={`w-full ${compact ? "text-xs" : "text-sm"}`}>
              <tbody>
                {g.plans.map((p) => (
                  <PlanRowCells
                    key={p.id}
                    plan={p}
                    compact={compact}
                    lang={lang}
                    hideProject
                  />
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}

// ── Row + cell helpers ─────────────────────────────────────────────────────

function Th({
  children,
  align,
  compact,
}: {
  children: React.ReactNode;
  align?: "right";
  compact: boolean;
}) {
  return (
    <th
      className={`font-medium ${compact ? "px-3 py-1.5" : "px-5 py-2.5"} ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function SortableTh({
  col,
  sort,
  onSort,
  label,
  align,
  compact,
}: {
  col: SortCol;
  sort: { col: SortCol; dir: SortDir };
  onSort: (col: SortCol) => void;
  label: string;
  align?: "right";
  compact: boolean;
}) {
  const active = sort.col === col;
  const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th
      className={`font-medium ${compact ? "px-3 py-1.5" : "px-5 py-2.5"} ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      <button
        type="button"
        onClick={() => onSort(col)}
        className={`inline-flex items-center gap-1 hover:text-ink ${
          active ? "text-ink" : "text-muted"
        }`}
        aria-label={`Sort by ${label}`}
      >
        {label}
        <Icon size={11} strokeWidth={2.5} />
      </button>
    </th>
  );
}

function PlanRowCells({
  plan: p,
  compact,
  lang,
  hideProject,
}: {
  plan: PlanRow;
  compact: boolean;
  lang: Language;
  hideProject?: boolean;
}) {
  const total = Number.parseFloat(p.totalMediaUsd);
  const spent = Number.parseFloat(p.spentMediaUsd);
  const pct = total > 0 ? Math.max(0, Math.min(100, (spent / total) * 100)) : 0;
  const cellPad = compact ? "px-3 py-1.5" : "px-5 py-2.5";

  return (
    <tr className="border-t border-line-soft hover:bg-paper-2 transition-colors">
      <td className={cellPad}>
        <Link
          href={`/proyectos/${p.projectCode}/planes/${p.id}`}
          className="font-medium text-ink hover:underline"
        >
          {p.name}
        </Link>
        {p.currentVersion > 0 && (
          <span className="ml-2 font-mono text-[10px] text-muted">
            v{p.currentVersion}
          </span>
        )}
      </td>
      {!hideProject && (
        <td className={cellPad}>
          <Link
            href={`/proyectos/${p.projectCode}`}
            className="text-ink-2 hover:underline"
          >
            {p.projectName}
          </Link>
          <div className="font-mono text-[11px] text-muted">{p.projectCode}</div>
        </td>
      )}
      {!hideProject && (
        <td className={cellPad}>
          <Link
            href={`/clientes/${p.clientSlug}`}
            className="text-ink-2 hover:underline"
          >
            {p.clientName}
          </Link>
        </td>
      )}
      {!hideProject && (
        <td className={`${cellPad} text-ink-2`}>{p.budgetOriginName}</td>
      )}
      <td className={cellPad}>
        <PlanStatusBadge status={p.status} />
      </td>
      <td className={`${cellPad} font-mono text-[11px] text-ink-2`}>
        {formatDate(p.periodStart, lang)}
        <span className="text-line"> → </span>
        {formatDate(p.periodEnd, lang)}
      </td>
      <td className={`${cellPad} text-right`}>
        {total > 0 ? (
          <div className="flex flex-col items-end gap-1 min-w-[140px]">
            <div className="font-mono text-ink tabular-nums">
              {formatUsd(total)}
            </div>
            <div className="w-full h-1.5 rounded-full bg-paper overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-accent to-accent-2"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="font-mono text-[10px] text-muted tabular-nums">
              {formatUsdCompact(spent)} · {pct.toFixed(0)}%
            </div>
          </div>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
    </tr>
  );
}
