"use client";

import { useState } from "react";
import { BarChart3, FlaskConical, GitCompareArrows } from "lucide-react";
import type {
  ScenarioSummary,
  SimulatorCatalogs,
} from "@/db/queries/simulator";
import type { BenchmarkRow } from "@/lib/simulator-types";
import { BenchmarksTab } from "./benchmarks-tab";
import { BuilderTab } from "./builder-tab";
import { CompareTab } from "./compare-tab";

type Tab = "benchmarks" | "builder" | "compare";

const TABS: Array<{ id: Tab; label: string; icon: typeof BarChart3 }> = [
  { id: "benchmarks", label: "Benchmarks", icon: BarChart3 },
  { id: "builder", label: "Builder", icon: FlaskConical },
  { id: "compare", label: "Comparativa", icon: GitCompareArrows },
];

export function SimulatorClient({
  clientId,
  initialBenchmarks,
  catalogs,
  initialScenarios,
}: {
  clientId: string;
  initialBenchmarks: BenchmarkRow[];
  catalogs: SimulatorCatalogs;
  initialScenarios: ScenarioSummary[];
}) {
  const [tab, setTab] = useState<Tab>("benchmarks");
  // Estado compartido: lista de escenarios. Builder y Compare la leen y el
  // Builder la muta cuando se guarda/borra un escenario para que Compare
  // refleje el cambio sin recargar la página.
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>(initialScenarios);

  return (
    <div>
      <div className="border-b border-line mb-6 flex gap-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm flex items-center gap-2 border-b-2 -mb-px transition-colors ${
                active
                  ? "border-accent text-ink font-medium"
                  : "border-transparent text-muted hover:text-ink-2"
              }`}
            >
              <Icon size={14} strokeWidth={2} />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "benchmarks" && (
        <BenchmarksTab
          clientId={clientId}
          initialRows={initialBenchmarks}
          catalogs={catalogs}
        />
      )}
      {tab === "builder" && (
        <BuilderTab
          clientId={clientId}
          benchmarks={initialBenchmarks}
          catalogs={catalogs}
          scenarios={scenarios}
          onScenariosChange={setScenarios}
        />
      )}
      {tab === "compare" && (
        <CompareTab
          scenarios={scenarios}
          catalogs={catalogs}
          benchmarks={initialBenchmarks}
        />
      )}
    </div>
  );
}
