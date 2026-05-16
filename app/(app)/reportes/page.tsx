import Link from "next/link";
import { CalendarClock, FlaskConical } from "lucide-react";
import { PageShell } from "@/components/page-shell";

export default function ReportesPage() {
  return (
    <PageShell
      eyebrow="Reportes"
      title="Insights operativos"
      subtitle="Herramientas que consolidan la data acumulada de planes y campaign tracker para soportar nuevas planificaciones y análisis de performance."
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link
          href="/reportes/calendario"
          className="block rounded-lg border border-line bg-white dark:bg-paper-2 p-5 hover:border-accent transition-colors group"
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
                Proyectos cerrados pendientes de reporte final. Asigná fechas
                de entrega y trackeá los compromisos en un Gantt de 60 días.
                Al marcar como entregado, el proyecto pasa a estado{" "}
                <em>reportado</em>.
              </p>
            </div>
          </div>
        </Link>

        <Link
          href="/reportes/simulador"
          className="block rounded-lg border border-line bg-white dark:bg-paper-2 p-5 hover:border-accent transition-colors group"
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-md bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
              <FlaskConical size={16} strokeWidth={2} className="text-accent" />
            </div>
            <div className="min-w-0">
              <h3 className="font-medium text-ink group-hover:text-accent transition-colors">
                Simulador
              </h3>
              <p className="text-xs text-muted mt-1 leading-relaxed">
                Benchmark de CPM/CPC/CPV/CTR históricos por{" "}
                <em>publisher × mercado × cost method</em>, builder de
                escenarios con autocompletado desde el histórico y comparativa
                lado a lado para evaluar distintos niveles de inversión.
              </p>
            </div>
          </div>
        </Link>
      </div>

      <p className="mt-8 text-xs text-muted max-w-2xl">
        Ambas herramientas se alimentan automáticamente de lo que el equipo
        carga en planes y de lo que la trafficker reporta como real en el
        Campaign Tracker. Cuanta más data acumulada, mejores los benchmarks.
      </p>
    </PageShell>
  );
}
