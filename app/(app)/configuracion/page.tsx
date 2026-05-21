import Link from "next/link";
import { ArrowUpRight, Info, Tag } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { resolveClientFromSearchParams } from "@/lib/client-filter.server";

const SECTIONS: Array<{
  href: string;
  title: string;
  description: string;
  status: "ready" | "soon";
}> = [
  {
    href: "/configuracion/clientes",
    title: "Clientes",
    description: "Alta y edición de clientes (nombre, prefijo, idioma, estado). Click en el ⚙ de cada cliente para configurar sus publishers, métricas y mercados.",
    status: "ready",
  },
  {
    href: "/configuracion/markets",
    title: "Mercados (per cliente)",
    description: "Cada cliente tiene su propia lista de mercados. Click para ir al cliente y editarlos.",
    status: "ready",
  },
  {
    href: "/configuracion/metricas",
    title: "Métricas (per cliente)",
    description: "Cada cliente tiene su lista de métricas (incluyendo conversiones custom). Click para ir al cliente.",
    status: "ready",
  },
  {
    href: "/configuracion/papelera-planes",
    title: "Papelera de planes",
    description: "Planes borrados desde la vista de proyecto. Se guardan acá para siempre y se pueden restaurar.",
    status: "ready",
  },
  {
    href: "/configuracion/usuarios",
    title: "Usuarios y roles",
    description: "Gestión de usuarios (Account Manager, Media Planner, Finance, Viewer). Llega después de Auth.",
    status: "soon",
  },
];

type Props = {
  searchParams: Promise<{ client?: string }>;
};

export default async function ConfiguracionPage({ searchParams }: Props) {
  const sp = await searchParams;
  const client = await resolveClientFromSearchParams(sp);

  return (
    <PageShell
      eyebrow="Configuración"
      title={client ? `Ajustes · ${client.name}` : "Ajustes"}
      subtitle="Catálogos editables, gestión de usuarios y configuración general."
    >
      {client && (
        <div className="mb-5 rounded-lg border border-info-soft bg-info-soft/40 px-4 py-3 flex items-start gap-3">
          <Info
            size={16}
            strokeWidth={2}
            className="text-info shrink-0 mt-0.5"
          />
          <div className="text-xs leading-relaxed text-ink-2">
            <p className="font-medium text-ink">
              Configurando {client.name}
            </p>
            <p className="mt-0.5">
              Para editar publishers, métricas y mercados de este cliente entrá a{" "}
              <Link
                href={`/configuracion/clientes/${client.slug}`}
                className="text-accent hover:underline"
              >
                /configuracion/clientes/{client.slug}
              </Link>
              .
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {SECTIONS.map((s) =>
          s.status === "ready" ? (
            <Link
              key={s.href}
              href={client ? `${s.href}?client=${client.slug}` : s.href}
              className="group rounded-lg border border-line bg-white dark:bg-paper-2 p-5 hover:border-ink-2 transition-colors"
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
                <div className="w-8 h-8 rounded-md bg-white dark:bg-paper-2 border border-line flex items-center justify-center shrink-0 opacity-50">
                  <Tag size={14} strokeWidth={2} className="text-muted" />
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
