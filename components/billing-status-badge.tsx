import type { Language } from "@/lib/i18n";

// Badge del estado de un BILLING mensual (draft → ready → sent → invoiced →
// paid). Fuente de verdad ÚNICA del label + color: antes el mapa vivía
// duplicado en 3 lugares (lista de meses del plan, detalle del editor y la
// vista global /billing) y un estado faltante (invoiced) hacía que un billing
// facturado se mostrara como "draft". Lang-aware (es/en) porque /billing
// respeta el idioma del cliente; las pantallas del plan usan es por default.
type BillingStatus = "draft" | "ready" | "sent" | "invoiced" | "paid";

const STYLES: Record<
  Language,
  Record<BillingStatus, { label: string; cls: string; dot: string }>
> = {
  es: {
    draft: { label: "borrador", cls: "bg-paper-2 text-muted border-line", dot: "bg-muted" },
    ready: { label: "listo", cls: "bg-warn-soft text-warn border-warn-soft", dot: "bg-warn" },
    sent: { label: "reportado", cls: "bg-info-soft text-info border-info-soft", dot: "bg-info" },
    invoiced: { label: "facturado", cls: "bg-accent-soft text-accent border-accent-soft", dot: "bg-accent" },
    paid: { label: "pagado", cls: "bg-success-soft text-success border-success-soft", dot: "bg-success" },
  },
  en: {
    draft: { label: "draft", cls: "bg-paper-2 text-muted border-line", dot: "bg-muted" },
    ready: { label: "ready", cls: "bg-warn-soft text-warn border-warn-soft", dot: "bg-warn" },
    sent: { label: "reported", cls: "bg-info-soft text-info border-info-soft", dot: "bg-info" },
    invoiced: { label: "invoiced", cls: "bg-accent-soft text-accent border-accent-soft", dot: "bg-accent" },
    paid: { label: "paid", cls: "bg-success-soft text-success border-success-soft", dot: "bg-success" },
  },
};

const SIZES = {
  md: "px-2 py-0.5 text-[11px]",
  sm: "px-1.5 py-0.5 text-[10px]",
} as const;

// Orden canónico del lifecycle, para poblar dropdowns/filtros sin redefinir la
// lista en cada lugar.
export const BILLING_STATUSES: BillingStatus[] = [
  "draft",
  "ready",
  "sent",
  "invoiced",
  "paid",
];

// Label lang-aware de un estado (mismo texto que el badge). Útil para filtros.
export function billingStatusLabel(status: string, lang: Language = "es"): string {
  const map = STYLES[lang] ?? STYLES.es;
  return (map[status as BillingStatus] ?? map.draft).label;
}

export function BillingStatusBadge({
  status,
  lang = "es",
  size = "md",
}: {
  status: string;
  lang?: Language;
  size?: keyof typeof SIZES;
}) {
  const map = STYLES[lang] ?? STYLES.es;
  const s = map[status as BillingStatus] ?? map.draft;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm border font-medium ${SIZES[size]} ${s.cls}`}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}
