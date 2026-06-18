"use client";

// Navegación principal en el HEADER (solo desktop, ≥ lg). Reemplaza al sidebar
// vertical para liberar todo el ancho de la ventana al contenido. En mobile no
// se renderiza: ahí sigue mandando el drawer (Sidebar) + hamburguesa.
//
// Es una tira horizontal: ícono + label, con scroll horizontal (scrollbar
// oculto) como red de seguridad si las entradas no entran en pantallas
// angostas. El item activo se resalta con el acento de marca.

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { buildHrefWithClient } from "@/lib/client-filter";
import { FOOTER_NAV, isNavActive, PRIMARY_NAV } from "@/lib/nav";

export function TopNav() {
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  const clientSlug = searchParams?.get("client") ?? null;

  const renderItem = (entry: (typeof PRIMARY_NAV)[number]) => {
    const Icon = entry.icon;
    const active = isNavActive(pathname, entry.href, entry.exact);
    return (
      <Link
        key={entry.href}
        href={buildHrefWithClient(entry.href, clientSlug)}
        data-active={active}
        title={entry.label}
        className="group inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] whitespace-nowrap text-ink-2 hover:bg-paper-2 hover:text-ink data-[active=true]:bg-accent-soft data-[active=true]:text-accent data-[active=true]:font-medium transition-colors"
      >
        <Icon size={15} strokeWidth={1.9} className="shrink-0" />
        <span className="hidden xl:inline truncate">{entry.label}</span>
      </Link>
    );
  };

  return (
    <nav
      aria-label="Navegación principal"
      className="hidden lg:flex flex-1 min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
    >
      {PRIMARY_NAV.map(renderItem)}
      <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line" />
      {FOOTER_NAV.map(renderItem)}
    </nav>
  );
}
