// Helpers de internacionalización para los idiomas que soporta la app.
//
// El idioma se determina por el filtro global de cliente: si hay un cliente
// seleccionado se usa su `language` (default 'en' para todos los clientes).
// Cuando NO hay cliente seleccionado ("Todos"), se usa 'en'.
//
// Métricas (clicks, views, impressions, cpm, etc.) NUNCA se traducen — se
// mantienen como anglicismos por convención de la industria.

export type Language = "en" | "es";

export const DEFAULT_LANGUAGE: Language = "en";

const LOCALE_BY_LANG: Record<Language, string> = {
  en: "en-US",
  es: "es-AR",
};

export function localeForLanguage(lang: Language): string {
  return LOCALE_BY_LANG[lang] ?? LOCALE_BY_LANG.en;
}

// ────────────────────────────────────────────────────────────────────────────
// Fechas
// ────────────────────────────────────────────────────────────────────────────
//
// Acá tenemos un cuidado importante: una fecha "YYYY-MM-DD" (date column
// de Postgres) NO debe pasarse a `new Date(string)` directo porque JS la
// interpreta como UTC y al renderizar con un timezone negativo te da el día
// anterior. La parseamos manual para evitar ese off-by-one.

function parseISODate(iso: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(
    Number.parseInt(m[1], 10),
    Number.parseInt(m[2], 10) - 1,
    Number.parseInt(m[3], 10),
  );
}

// Fecha corta: "12 may 2026" (es) | "May 12, 2026" (en).
export function formatDate(iso: string | null | undefined, lang: Language): string {
  if (!iso) return "—";
  const d = parseISODate(iso);
  if (!d) return iso;
  return new Intl.DateTimeFormat(localeForLanguage(lang), {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

// Fecha larga: "12 de mayo de 2026" (es) | "May 12, 2026" (en).
export function formatDateLong(
  iso: string | null | undefined,
  lang: Language,
): string {
  if (!iso) return "—";
  const d = parseISODate(iso);
  if (!d) return iso;
  return new Intl.DateTimeFormat(localeForLanguage(lang), {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
}

// Rango "12 may 2026 → 30 sep 2026" / "May 12, 2026 → Sep 30, 2026".
// Cuando alguna fecha falta, se muestra "—" del lado correspondiente.
export function formatDateRange(
  start: string | null | undefined,
  end: string | null | undefined,
  lang: Language,
): string {
  const a = formatDate(start, lang);
  const b = formatDate(end, lang);
  return `${a} → ${b}`;
}

// Mes largo a partir de "YYYY-MM": "Mayo 2026" (es) | "May 2026" (en).
export function formatMonth(yyyymm: string, lang: Language): string {
  const [y, m] = yyyymm.split("-").map(Number);
  if (!y || !m) return yyyymm;
  const d = new Date(y, m - 1, 1);
  const fmt = new Intl.DateTimeFormat(localeForLanguage(lang), {
    year: "numeric",
    month: "long",
  }).format(d);
  // Intl en es-AR devuelve "mayo de 2026" en lowercase — capitalizamos la
  // primera letra para que se vea como label.
  return capitalize(fmt);
}

// Mes corto + año 2 dígitos a partir de "YYYY-MM": "May 26" | "may 26".
// Usado por charts y timelines donde el espacio es ajustado.
export function formatMonthShort(yyyymm: string, lang: Language): string {
  const [y, m] = yyyymm.split("-").map(Number);
  if (!y || !m) return yyyymm;
  const d = new Date(y, m - 1, 1);
  const fmt = new Intl.DateTimeFormat(localeForLanguage(lang), {
    month: "short",
    year: "2-digit",
  }).format(d);
  return capitalize(fmt);
}

// Mes corto solo (sin año). Usado por headers de gantt.
export function shortMonthName(monthIdx0: number, lang: Language): string {
  const d = new Date(2000, monthIdx0, 1);
  const fmt = new Intl.DateTimeFormat(localeForLanguage(lang), {
    month: "short",
  }).format(d);
  return capitalize(fmt).replace(".", "");
}

function capitalize(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// ────────────────────────────────────────────────────────────────────────────
// Dictionary
// ────────────────────────────────────────────────────────────────────────────
//
// Mapa de keys → traducciones. Las keys son strings cortas que describen el
// contexto, no la copia. Mantener ordenadas por dominio.

const DICT: Record<string, Record<Language, string>> = {
  // Generales
  "common.all": { en: "All", es: "Todos" },
  "common.client": { en: "Client", es: "Cliente" },
  "common.clients": { en: "Clients", es: "Clientes" },
  "common.project": { en: "Project", es: "Proyecto" },
  "common.projects": { en: "Projects", es: "Proyectos" },
  "common.status": { en: "Status", es: "Estado" },
  "common.period": { en: "Period", es: "Período" },
  "common.start": { en: "Start", es: "Inicio" },
  "common.end": { en: "End", es: "Fin" },
  "common.startDate": { en: "Start date", es: "Fecha de inicio" },
  "common.endDate": { en: "End date", es: "Fecha de fin" },
  "common.budget": { en: "Budget", es: "Presupuesto" },
  "common.spent": { en: "Spent", es: "Gastado" },
  "common.progress": { en: "Progress", es: "Avance" },
  "common.summary": { en: "Summary", es: "Resumen" },
  "common.timeline": { en: "Timeline", es: "Línea de tiempo" },
  "common.audience": { en: "Audience", es: "Audiencia" },
  "common.notes": { en: "Notes", es: "Notas" },
  "common.market": { en: "Market", es: "Mercado" },
  "common.publisher": { en: "Publisher", es: "Publisher" },
  "common.publishers": { en: "Publishers", es: "Publishers" },
  "common.placements": { en: "Placements", es: "Placements" },
  "common.fees": { en: "Fees", es: "Fees" },
  "common.total": { en: "Total", es: "Total" },
  "common.media": { en: "Media", es: "Media" },
  "common.investment": { en: "Investment", es: "Inversión" },
  "common.amount": { en: "Amount", es: "Monto" },
  "common.rate": { en: "Rate", es: "Tarifa" },
  "common.type": { en: "Type", es: "Tipo" },
  "common.name": { en: "Name", es: "Nombre" },
  "common.language": { en: "Language", es: "Idioma" },
  "common.create": { en: "Create", es: "Crear" },
  "common.save": { en: "Save", es: "Guardar" },
  "common.cancel": { en: "Cancel", es: "Cancelar" },
  "common.delete": { en: "Delete", es: "Eliminar" },
  "common.edit": { en: "Edit", es: "Editar" },
  "common.new": { en: "New", es: "Nuevo" },
  "common.signature": { en: "Client signature", es: "Firma del cliente" },
  "common.date": { en: "Date", es: "Fecha" },
  "common.generated": { en: "Generated", es: "Generado" },
  "common.version": { en: "Version", es: "Versión" },
  "common.invoiced": { en: "Invoiced", es: "Facturado" },
  "common.estimated": { en: "Estimated", es: "Estimado" },
  "common.gross": { en: "Gross", es: "Bruto" },
  "common.leftToInvoice": { en: "Left to invoice", es: "Falta facturar" },
  "common.variance": { en: "Variance", es: "Variación" },
  "common.closed": { en: "closed", es: "cerrado" },
  "common.real": { en: "Real (sent/paid)", es: "Real (sent/paid)" },
  "common.alreadyInvoiced": { en: "Already invoiced", es: "Ya facturado" },
  "common.costMethod": { en: "Cost method", es: "Cost method" },
  "common.primaryMetric": { en: "Primary metric", es: "Métrica principal" },
  "common.notesFormats": {
    en: "Notes / formats / details",
    es: "Notas / formatos / detalles",
  },
  "common.budgetOrigin": { en: "Budget origin", es: "Budget Origin" },
  "common.totalMedia": { en: "TOTAL MEDIA", es: "TOTAL MEDIA" },
  "common.totalFees": { en: "TOTAL FEES", es: "TOTAL FEES" },
  "common.grandTotal": { en: "GRAND TOTAL", es: "GRAND TOTAL" },
  "common.publisherPlacement": {
    en: "Publisher / Placement",
    es: "Publisher / Placement",
  },
  "common.noPlacements": { en: "(no placements)", es: "(sin placements)" },
  "common.noFees": { en: "(no fees)", es: "(sin fees)" },
  "common.auto": { en: "Auto", es: "Auto" },
  "common.yes": { en: "yes", es: "sí" },
  "common.no": { en: "no", es: "no" },
  "common.agencyPays": { en: "agency pays", es: "agencia paga" },
  "common.clientPays": { en: "client pays directly", es: "cliente paga directo" },
  // Plan / project status
  "status.draft": { en: "draft", es: "borrador" },
  "status.ready_to_send": { en: "ready to send", es: "listo para enviar" },
  "status.approved": { en: "approved", es: "aprobado" },
  "status.archived": { en: "archived", es: "archivado" },
  "status.planning": { en: "planning", es: "planificación" },
  "status.active": { en: "active", es: "activo" },
  "status.paused": { en: "paused", es: "pausado" },
  "status.closed": { en: "closed", es: "cerrado" },
  // PDF/Excel export labels
  "export.mediaPlan": { en: "MEDIA PLAN", es: "PLAN DE MEDIOS" },
  "export.totals": { en: "Totals", es: "Totales" },
  "export.publishersPlacements": {
    en: "Publishers & Placements",
    es: "Publishers y Placements",
  },
  "export.auxSheet": { en: "Auxiliary sheet", es: "Hoja auxiliar" },
  "export.signaturePrompt": {
    en: "Signature: ____________________",
    es: "Firma: ____________________",
  },
  "export.dateLabel": {
    en: "Date: ____________________",
    es: "Fecha: ____________________",
  },
  "export.initials": {
    en: "Client initials: ______________",
    es: "Iniciales del cliente: ______________",
  },
  // Texto legal exacto provisto por el cliente; se mantiene en inglés en ambos
  // idiomas (nombra a "Sangria, LLC" e "Insertion Order"). No traducir sin
  // aprobación legal.
  "export.signatureDisclaimer": {
    en: "By signing this agreement, the Client named on this agreement agrees to be solely liable for payment of all amounts due to Sangria, LLC for the execution of this Insertion Order.",
    es: "By signing this agreement, the Client named on this agreement agrees to be solely liable for payment of all amounts due to Sangria, LLC for the execution of this Insertion Order.",
  },
};

export function t(key: keyof typeof DICT | string, lang: Language): string {
  const entry = DICT[key];
  if (!entry) return key;
  return entry[lang] ?? entry.en ?? key;
}
