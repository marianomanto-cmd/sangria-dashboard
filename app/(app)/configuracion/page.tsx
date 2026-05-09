import Link from "next/link";
import { ArrowUpRight, Tag } from "lucide-react";
import { PageShell } from "@/components/page-shell";

const SECTIONS: Array<{
  href: string;
  title: string;
  description: string;
  status: "ready" | "soon";
}> = [
  {
    href: "/configuracion/publishers",
    title: "Publishers",
    description: "Catálogo editable de publishers (YouTube, Meta, TikTok, etc.) que el media planner puede usar al armar un plan.",
    status: "ready",
  },
  {
    href: "/configuracion/markets",
    title: "Mercados",
    description: "Países y agrupaciones (Centroamérica, LATAM) que el planner asigna a cada placement.",
    status: "ready",
  },
  {
    href: "/configuracion/metricas",
    title: "Métricas e indicadores",
    description: "KPIs direct (views, clicks, impressions) y calculated (cpc, ctr, cpm — derivadas con fórmula).",
    status: "ready",
  },
  {
    href: "/configuracion/usuarios",
    title: "Usuarios y roles",
    description: "Gestión de usuarios (Account Manager, Media Planner, Finance, Viewer). Llega después de Auth.",
    status: "soon",
  },
  {
    href: "/configuracion/clientes",
    title: "Clientes",
    description: "Gestión de clientes y sus budget origins.",
    status: "soon",
  },
];

export default function ConfiguracionPage() {
  return (
    <PageShell
      eyebrow="Configuración"
      title="Ajustes"
      subtitle="Catálogos editables, gestión de usuarios y configuración general."
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {SECTIONS.map((s) =>
          s.status === "ready" ? (
            <Link
              key={s.href}
              href={s.href}
              className="group rounded-lg border border-line bg-white p-5 hover:border-ink-2 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="w-8 h-8 rounded-md bg-paper-2 border border-line flex items-center justify-center shrink-0">
                  <Tag size={14} strokeWidth={2} className="text-ink-2" />
                </div>
                <ArrowUpRight
                  size={14}
                  className="text-muted group-hover:text-ink shrink-0"
                />
              </div>
              <h3 className="font-semibold text-ink mt-3">{s.title}</h3>
              <p className="text-xs text-muted mt-1">{s.description}</p>
            </Link>
          ) : (
            <div
              key={s.href}
              className="rounded-lg border border-line border-dashed bg-paper-2 p-5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="w-8 h-8 rounded-md bg-white border border-line flex items-center justify-center shrink-0 opacity-50">
                  <Tag size={14} strokeWidth={2} className="text-stone-400" />
                </div>
                <span className="text-[10px] uppercase tracking-[0.08em] text-muted font-medium">
                  próximamente
                </span>
              </div>
              <h3 className="font-medium text-ink-2 mt-3">{s.title}</h3>
              <p className="text-xs text-muted mt-1">{s.description}</p>
            </div>
          ),
        )}
      </div>
    </PageShell>
  );
}
