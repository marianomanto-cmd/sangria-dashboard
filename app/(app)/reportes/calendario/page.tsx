import { PageShell } from "@/components/page-shell";
import { ReportingCalendarClient } from "@/components/reporting-calendar-client";
import { getReportingCalendar } from "@/db/queries/reports";
import { resolveClientFromSearchParams } from "@/lib/client-filter.server";
import { DEFAULT_LANGUAGE, type Language } from "@/lib/i18n";

type Props = {
  searchParams: Promise<{ client?: string | string[] }>;
};

export default async function ReportingCalendarPage({ searchParams }: Props) {
  const sp = await searchParams;
  const client = await resolveClientFromSearchParams(sp);
  const lang: Language = client?.language ?? DEFAULT_LANGUAGE;

  const data = await getReportingCalendar(client?.id ?? null);

  return (
    <PageShell
      eyebrow={lang === "es" ? "Reportes" : "Reports"}
      title={lang === "es" ? "Calendario de reportes" : "Reporting calendar"}
      subtitle={
        lang === "es"
          ? "Proyectos cerrados pendientes de reporte final. Asignales una fecha de entrega y trackeá los compromisos abiertos. Al marcar como entregado el proyecto pasa a 'reportado' y desaparece del calendario."
          : "Closed projects pending their final report. Assign delivery dates and track open commitments. Marking as delivered moves the project to 'reported' status and removes it from the calendar."
      }
    >
      <ReportingCalendarClient
        pending={data.pending}
        inProgress={data.inProgress}
        lang={lang}
      />
    </PageShell>
  );
}
