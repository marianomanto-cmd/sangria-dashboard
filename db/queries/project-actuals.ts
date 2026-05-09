import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  actualSpend,
  mediaPlanLines,
  mediaPlans,
} from "@/db/schema";

function enumerateMonths(start: string, end: string): string[] {
  const out: string[] = [];
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

const OVER_TOLERANCE = 1.01; // 1% de tolerancia para no marcar borderline

export type ActualsCell = {
  real: number;
  planned: number;
  over: boolean;
  hasActive: boolean; // si esta línea estaba activa ese mes
};

export type ActualsLine = {
  id: string;
  publisher: (typeof mediaPlanLines.$inferSelect)["publisher"];
  placementName: string;
  audienceMarket: string | null;
  startDate: string | null;
  endDate: string | null;
  budgetNetUsd: number;
  cells: Record<string, ActualsCell>;
};

export type ActualsPublisherGroup = {
  publisher: ActualsLine["publisher"];
  lines: ActualsLine[];
  totals: Record<string, ActualsCell>;
  totalReal: number;
  totalPlanned: number;
};

export type ProjectActuals = {
  planId: string;
  months: string[];
  groups: ActualsPublisherGroup[];
  totalReal: number;
  totalPlanned: number;
};

export async function getProjectActuals(
  projectId: string,
): Promise<ProjectActuals | null> {
  const [plan] = await db
    .select()
    .from(mediaPlans)
    .where(
      and(
        eq(mediaPlans.projectId, projectId),
        eq(mediaPlans.status, "approved"),
      ),
    )
    .limit(1);

  if (!plan) return null;

  const lines = await db
    .select()
    .from(mediaPlanLines)
    .where(eq(mediaPlanLines.mediaPlanId, plan.id))
    .orderBy(asc(mediaPlanLines.sortOrder));

  if (lines.length === 0) {
    return {
      planId: plan.id,
      months: [],
      groups: [],
      totalReal: 0,
      totalPlanned: 0,
    };
  }

  const lineIds = lines.map((l) => l.id);
  const actuals = await db
    .select()
    .from(actualSpend)
    .where(inArray(actualSpend.mediaPlanLineId, lineIds));

  // Real lookup: lineId × month → amount
  const realLookup = new Map<string, Map<string, number>>();
  for (const a of actuals) {
    let m = realLookup.get(a.mediaPlanLineId);
    if (!m) {
      m = new Map();
      realLookup.set(a.mediaPlanLineId, m);
    }
    m.set(a.month, Number.parseFloat(a.amountUsd));
  }

  // Union de meses: de actuals + de los rangos de las líneas.
  const monthsSet = new Set<string>(actuals.map((a) => a.month));
  for (const ln of lines) {
    if (ln.startDate && ln.endDate) {
      for (const m of enumerateMonths(
        ln.startDate.slice(0, 7),
        ln.endDate.slice(0, 7),
      )) {
        monthsSet.add(m);
      }
    }
  }
  const months = Array.from(monthsSet).sort();

  // Build cells per line.
  const linesWithCells: ActualsLine[] = lines.map((ln) => {
    const monthsActive =
      ln.startDate && ln.endDate
        ? enumerateMonths(ln.startDate.slice(0, 7), ln.endDate.slice(0, 7))
        : [];
    const activeSet = new Set(monthsActive);
    const plannedMonthly =
      monthsActive.length > 0
        ? Number.parseFloat(ln.budgetNetUsd) / monthsActive.length
        : 0;

    const cells: Record<string, ActualsCell> = {};
    for (const m of months) {
      const real = realLookup.get(ln.id)?.get(m) ?? 0;
      const hasActive = activeSet.has(m);
      const planned = hasActive ? plannedMonthly : 0;
      const over = planned > 0 && real > planned * OVER_TOLERANCE;
      cells[m] = { real, planned, over, hasActive };
    }

    return {
      id: ln.id,
      publisher: ln.publisher,
      placementName: ln.placementName,
      audienceMarket: ln.audienceMarket,
      startDate: ln.startDate,
      endDate: ln.endDate,
      budgetNetUsd: Number.parseFloat(ln.budgetNetUsd),
      cells,
    };
  });

  // Group by publisher with monthly totals.
  const groupMap = new Map<string, ActualsLine[]>();
  for (const ln of linesWithCells) {
    const list = groupMap.get(ln.publisher) ?? [];
    list.push(ln);
    groupMap.set(ln.publisher, list);
  }

  const groups: ActualsPublisherGroup[] = Array.from(groupMap.entries()).map(
    ([pub, lns]) => {
      const totals: Record<string, ActualsCell> = {};
      let totalReal = 0;
      let totalPlanned = 0;
      for (const m of months) {
        let real = 0;
        let planned = 0;
        let hasActive = false;
        for (const ln of lns) {
          real += ln.cells[m].real;
          planned += ln.cells[m].planned;
          if (ln.cells[m].hasActive) hasActive = true;
        }
        totalReal += real;
        totalPlanned += planned;
        totals[m] = {
          real,
          planned,
          over: planned > 0 && real > planned * OVER_TOLERANCE,
          hasActive,
        };
      }
      return {
        publisher: pub as ActualsLine["publisher"],
        lines: lns,
        totals,
        totalReal,
        totalPlanned,
      };
    },
  );

  groups.sort((a, b) => b.totalPlanned - a.totalPlanned);

  const totalReal = groups.reduce((s, g) => s + g.totalReal, 0);
  const totalPlanned = groups.reduce((s, g) => s + g.totalPlanned, 0);

  return { planId: plan.id, months, groups, totalReal, totalPlanned };
}
