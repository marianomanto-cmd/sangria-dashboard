"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { buildHrefWithClient } from "@/lib/client-filter";
import {
  LayoutGrid,
  Briefcase,
  FileText,
  FileCheck,
  History,
  Settings,
  BarChart3,
  CalendarClock,
  FlaskConical,
  Receipt,
  LineChart,
  ChevronsLeft,
  ChevronsRight,
  type LucideIcon,
} from "lucide-react";
import { SangriaMark } from "@/components/sangria-mark";

type NavEntry = {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
};

// Subset serializable del user logueado (lo pasa el layout server-side desde
// getCurrentUser). Tipado estructural para no importar lib/auth — que tira de
// supabase/server — dentro de este client component.
type SidebarUser = {
  name: string | null;
  email: string;
  avatarUrl: string | null;
} | null;

const PRIMARY: NavEntry[] = [
  { href: "/", label: "Dashboard", icon: LayoutGrid },
  { href: "/proyectos", label: "Proyectos", icon: Briefcase },
  { href: "/planes", label: "Planes de Medios", icon: FileText },
  { href: "/billing", label: "Billing", icon: FileCheck },
  { href: "/reportes/calendario", label: "Calendario de reportes", icon: CalendarClock },
  { href: "/reportes", label: "Reportes", icon: BarChart3, exact: true },
  { href: "/billing-tracker", label: "Billing Tracker", icon: Receipt },
  { href: "/campaign-tracker", label: "Campaign Tracker", icon: LineChart },
  { href: "/reportes/simulador", label: "Simulador", icon: FlaskConical },
];

const FOOTER: NavEntry[] = [
  { href: "/auditoria", label: "Auditoría", icon: History },
  { href: "/configuracion", label: "Configuración", icon: Settings },
];

export function Sidebar({ user = null }: { user?: SidebarUser }) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const clientSlug = searchParams?.get("client") ?? null;

  return (
    <aside
      data-collapsed={collapsed}
      // Gradiente vertical sutil de rail-2 → rail (más oscuro abajo) para
      // darle profundidad al sidebar sin separarse del tono del producto.
      // bg-rail nunca swappea en dark mode (definido fijo en globals.css).
      // z-20 para que el botón de colapsar (que sobresale con -right-3)
      // quede por encima del topbar, que también es sticky y tiene z-10.
      // Sin esto, el topbar tapa la mitad derecha del botón.
      className="bg-gradient-to-b from-rail-2 to-rail text-white flex flex-col data-[collapsed=true]:w-14 data-[collapsed=false]:w-[220px] transition-[width] duration-200 ease-out shrink-0 sticky top-0 h-screen z-20 border-r border-black/40"
    >
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <SangriaMark size={22} />
        {!collapsed && (
          <span className="text-sm font-semibold tracking-tight">
            Sangria <span className="text-muted font-normal">/ OS</span>
          </span>
        )}
      </div>

      <nav className="flex-1 px-2 mt-2 flex flex-col gap-0.5 overflow-y-auto">
        {PRIMARY.map((entry) => (
          <NavItem
            key={entry.href}
            entry={entry}
            href={buildHrefWithClient(entry.href, clientSlug)}
            active={isActive(pathname, entry.href, entry.exact)}
            collapsed={collapsed}
          />
        ))}
      </nav>

      <div
        aria-hidden
        className="mx-3 my-2 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent"
      />

      <div className="px-2 flex flex-col gap-0.5">
        {FOOTER.map((entry) => (
          <NavItem
            key={entry.href}
            entry={entry}
            href={buildHrefWithClient(entry.href, clientSlug)}
            active={isActive(pathname, entry.href, entry.exact)}
            collapsed={collapsed}
          />
        ))}
      </div>

      <div className="px-2 pb-3 pt-2 flex items-center gap-2">
        <div className="w-7 h-7 rounded-full overflow-hidden bg-gradient-to-br from-stone-500 to-stone-700 ring-1 ring-white/10 shrink-0 flex items-center justify-center text-[10px] font-semibold text-white">
          {user?.avatarUrl ? (
            // Avatar de Google. <img> directo: su dominio no está en la
            // allowlist de next/image y no vale la pena por 28px (mismo
            // criterio que TopbarUser).
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.avatarUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          ) : (
            <span>{sidebarInitials(user?.name ?? user?.email ?? null)}</span>
          )}
        </div>
        {!collapsed && (
          <div className="text-xs leading-tight min-w-0">
            <div className="truncate font-medium">
              {user?.name ?? user?.email ?? "—"}
            </div>
            {user?.email && (
              <span className="text-muted truncate block">{user.email}</span>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-label={collapsed ? "Expandir sidebar" : "Colapsar sidebar"}
        className="absolute -right-3 top-6 w-6 h-6 rounded-full bg-rail border border-white/15 flex items-center justify-center text-line hover:text-white hover:border-white/40 hover:scale-110 active:scale-95 transition-all duration-150 shadow-sm"
      >
        {collapsed ? (
          <ChevronsRight size={12} />
        ) : (
          <ChevronsLeft size={12} />
        )}
      </button>
    </aside>
  );
}

function NavItem({
  entry,
  href,
  active,
  collapsed,
}: {
  entry: NavEntry;
  href: string;
  active: boolean;
  collapsed: boolean;
}) {
  const Icon = entry.icon;
  return (
    <Link
      href={href}
      data-active={active}
      data-collapsed={collapsed}
      className="group relative flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-muted hover:bg-white/5 hover:text-white data-[active=true]:bg-white/[0.08] data-[active=true]:text-white data-[collapsed=true]:justify-center data-[collapsed=true]:px-0 data-[collapsed=true]:w-9 data-[collapsed=true]:h-9 transition-colors duration-150"
      title={collapsed ? entry.label : undefined}
    >
      <span
        aria-hidden
        className="w-[3px] h-4 rounded-sm shrink-0 bg-transparent group-data-[active=true]:bg-accent group-data-[collapsed=true]:hidden transition-colors"
      />
      <Icon
        size={16}
        strokeWidth={2}
        className="shrink-0 transition-transform group-hover:scale-105"
      />
      {!collapsed && <span className="truncate">{entry.label}</span>}
    </Link>
  );
}

function isActive(pathname: string, href: string, exact = false) {
  if (href === "/" || exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

// "Mariano Manto" → "MM"; "mariano.manto@sangria.agency" → "MM".
function sidebarInitials(s: string | null): string {
  if (!s) return "·";
  const cleaned = s.includes("@") ? s.split("@")[0].replace(/[._-]+/g, " ") : s;
  const parts = cleaned.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "·";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
