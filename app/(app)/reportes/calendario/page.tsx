import { PageShell } from "@/components/page-shell";
import { ReportingCalendarClient } from "@/components/reporting-calendar-client";
import type { ReportingCalendarData, SentReport } from "@/db/queries/reports";
import {
  cachedClientOptions,
  cachedReportingCalendar,
  cachedSentReports,
} from "@/db/queries/cached";
import {
  resolveClientFromSearchParams,
  type ResolvedClientFilter,
} from "@/lib/client-filter.server";
import { DEFAULT_LANGUAGE, type Language } from "@/lib/i18n";

type Props = {
  searchParams: Promise<{ client?: string | string[] }>;
};

// Fallbacks por sección: si una lectura falla (timeout del pooler), degradamos
// ESA parte en vez de tumbar toda la vista con el error boundary de ruta. Es el
// mismo patrón que `app/(app)/page.tsx`; el calendario no lo tenía y por eso un
// solo `getSentReports` vencido dejaba la pantalla en "Algo salió mal".
const EMPTY_CALENDAR: ReportingCalendarData = { pending: [], inProgress: [] };

function unwrap<T>(r: PromiseSettledResult<T>, fallback: T, label: string): T {
  if (r.status === "fulfilled") return r.value;
  const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
  console.error(`CALQ[${label}]:${msg.slice(0, 80)}`, r.reason);
  return fallback;
}

export default async function ReportingCalendarPage({ searchParams }: Props) {
  const sp = await searchParams;

  // Resolver el cliente del filtro no debe tumbar la página: si falla, seguimos
  // sin filtro ("todos") en vez de tirar el error boundary.
  let client: ResolvedClientFilter = null;
  try {
    client = await resolveClientFromSearchParams(sp);
  } catch (e) {
    console.error("CALQ[client]:", e instanceof Error ? e.message : e);
  }
  const lang: Language = client?.language ?? DEFAULT_LANGUAGE;

  const [dataR, sentR, clientOptionsR] = await Promise.allSettled([
    cachedReportingCalendar(client?.id ?? null),
    cachedSentReports(client?.id ?? null),
    cachedClientOptions(),
  ]);

  const data = unwrap(dataR, EMPTY_CALENDAR, "calendar");
  const sent = unwrap<SentReport[]>(sentR, [], "sent");
  const clientOptions = unwrap<{ id: string; name: string }[]>(
    clientOptionsR,
    [],
    "clientOptions",
  );

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
        sent={sent}
        lang={lang}
        currentClient={
          client ? { id: client.id, name: client.name } : null
        }
        clientOptions={clientOptions}
      />
    </PageShell>
  );
}
