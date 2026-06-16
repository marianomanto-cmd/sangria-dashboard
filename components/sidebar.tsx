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
  Globe2,
  ChevronsLeft,
  ChevronsRight,
  type LucideIcon,
} from "lucide-react";
import { useMobileNav } from "@/components/mobile-nav";

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
  { href: "/analisis", label: "Análisis x mercado", icon: Globe2 },
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
  const { open: mobileOpen, setOpen: setMobileOpen } = useMobileNav();

  return (
    <>
      {/* Backdrop del drawer en mobile */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-30 bg-ink/50 animate-fade-in"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}
      <aside
        data-collapsed={collapsed}
        // En < lg el sidebar es un drawer fijo que se desliza (translate-x)
        // controlado por useMobileNav; en ≥ lg vuelve a su comportamiento
        // sticky con ancho colapsable. bg-rail nunca swappea en dark mode.
        className={`bg-gradient-to-b from-rail-2 to-rail text-white flex flex-col h-screen border-r border-black/40 fixed inset-y-0 left-0 z-40 w-[228px] transition-transform duration-200 ease-out ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } lg:sticky lg:top-0 lg:z-20 lg:translate-x-0 lg:shrink-0 lg:transition-[width] lg:data-[collapsed=true]:w-14 lg:data-[collapsed=false]:w-[228px]`}
      >
      <div className="flex items-center gap-2.5 px-3.5 pt-4 pb-3">
        <span
          aria-hidden
          className="w-[22px] h-[22px] rounded-full shrink-0"
          style={{
            background:
              "radial-gradient(circle at 38% 32%, #d8587e, #a8345f 55%, #5e1730)",
          }}
        />
        {!collapsed && (
          <span className="font-display font-black text-[15px] tracking-[0.1em] text-white leading-none">
            SANGRIA{" "}
            <span className="align-middle text-[10px] font-semibold tracking-[0.18em] text-white/45">
              OS
            </span>
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
            onNavigate={() => setMobileOpen(false)}
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
            onNavigate={() => setMobileOpen(false)}
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
              <span className="text-white/45 truncate block">{user.email}</span>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-label={collapsed ? "Expandir sidebar" : "Colapsar sidebar"}
        className="hidden lg:flex absolute -right-3 top-6 w-6 h-6 rounded-full bg-rail border border-white/15 items-center justify-center text-line hover:text-white hover:border-white/40 hover:scale-110 active:scale-95 transition-all duration-150 shadow-sm"
      >
        {collapsed ? (
          <ChevronsRight size={12} />
        ) : (
          <ChevronsLeft size={12} />
        )}
      </button>
      </aside>
    </>
  );
}

function NavItem({
  entry,
  href,
  active,
  collapsed,
  onNavigate,
}: {
  entry: NavEntry;
  href: string;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const Icon = entry.icon;
  return (
    <Link
      href={href}
      onClick={onNavigate}
      data-active={active}
      data-collapsed={collapsed}
      className="group relative flex items-center gap-2.5 rounded-md px-2 py-2 text-[13px] text-white/[0.62] hover:bg-white/5 hover:text-white data-[active=true]:bg-white/[0.09] data-[active=true]:text-white data-[collapsed=true]:justify-center data-[collapsed=true]:px-0 data-[collapsed=true]:w-9 data-[collapsed=true]:h-9 transition-colors duration-150"
      title={collapsed ? entry.label : undefined}
    >
      <span
        aria-hidden
        className="w-[5px] h-5 rounded-r-sm shrink-0 -ml-2 bg-transparent group-data-[active=true]:bg-accent group-data-[collapsed=true]:hidden transition-colors"
      />
      <Icon
        size={16}
        strokeWidth={1.8}
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
