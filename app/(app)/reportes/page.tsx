import Link from "next/link";
import { BarChart3, CalendarClock, LineChart, Map, TrendingUp } from "lucide-react";
import { PageShell } from "@/components/page-shell";

const REPORTS = [
  {
    title: "CPC histórico por publisher × mercado",
    description:
      "Distribución y tendencia de CPC planeado y real para cada combinación publisher × mercado a través del tiempo. Útil para benchmark al planificar.",
    icon: TrendingUp,
  },
  {
    title: "CTR / CPV / CPM por placement",
    description:
      "Indicadores planeados vs reales (cuando los carguemos) por publisher / formato / mercado. Identifica placements que sobrecumplen vs subcumplen.",
    icon: LineChart,
  },
  {
    title: "Inversión por mercado y por publisher",
    description:
      "Heatmap de inversión Q a Q por país/mercado. Detecta sobre-concentración o brechas geográficas.",
    icon: Map,
  },
  {
    title: "Performance por proyecto a lo largo del tiempo",
    description:
      "% de cumplimiento de budget, días en cada estado del lifecycle, número de revisiones (snapshots) por plan. Métricas operativas del equipo.",
    icon: BarChart3,
  },
  {
    title: "Comparativa de fees por proyecto",
    description:
      "Management / Setup / Reporting fees como % del net media a través de proyectos y períodos. Útil para pricing y benchmark interno.",
    icon: BarChart3,
  },
  {
    title: "Histórico de gastos vs planeado por publisher",
    description:
      "% de consumo del planificado por publisher. Quién subutiliza el budget asignado, quién consume todo, quién sobrepasa.",
    icon: TrendingUp,
  },
];

export default function ReportesPage() {
  return (
    <PageShell
      eyebrow="Reportes"
      title="Insights operativos"
      subtitle="Reportes que se vuelven posibles a medida que el equipo carga planes y consume actuals. Por ahora son specs — la implementación llega después de tener data acumulada."
    >
      <Link
        href="/reportes/calendario"
        className="block rounded-lg border border-line bg-white p-5 mb-6 hover:border-accent transition-colors group"
      >
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-md bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
            <CalendarClock size={16} strokeWidth={2} className="text-accent" />
          </div>
          <div className="min-w-0">
            <h3 className="font-medium text-ink group-hover:text-accent transition-colors">
              Calendario de reportes
            </h3>
            <p className="text-xs text-muted mt-1 leading-relaxed">
              Proyectos cerrados pendientes de reporte final. Asigná fechas de
              entrega y trackeá los compromisos en un Gantt de 60 días. Al
              marcar como entregado, el proyecto pasa a estado{" "}
              <em>reportado</em>.
            </p>
          </div>
        </div>
      </Link>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {REPORTS.map((r) => {
          const Icon = r.icon;
          return (
            <div
              key={r.title}
              className="rounded-lg border border-line border-dashed bg-paper-2 p-5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="w-8 h-8 rounded-md bg-white border border-line flex items-center justify-center shrink-0">
                  <Icon size={14} strokeWidth={2} className="text-ink-2" />
                </div>
                <span className="text-[10px] uppercase tracking-[0.08em] text-muted font-medium">
                  próximamente
                </span>
              </div>
              <h3 className="font-medium text-ink mt-3">{r.title}</h3>
              <p className="text-xs text-muted mt-1 leading-relaxed">
                {r.description}
              </p>
            </div>
          );
        })}
      </div>

      <p className="mt-8 text-xs text-muted max-w-2xl">
        Toda la información cargada por el media planner (cost methods, CPC,
        CTR, est_imp, etc.) y por el AM en facturación (consumo real por
        publisher) se acumula en la DB. Una vez con N planes históricos el
        equipo va a poder benchmarkear precios, ver tendencias y detectar
        oportunidades. Los reportes se diseñan en función de lo que más se
        consulta.
      </p>
    </PageShell>
  );
}
