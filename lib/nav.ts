// Entradas de navegación compartidas entre la chrome desktop (TopNav, en el
// header) y el drawer mobile (Sidebar). Una sola fuente de verdad para que
// ambas vistas no se desincronicen.

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
  Palette,
  type LucideIcon,
} from "lucide-react";

export type NavEntry = {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
};

export const PRIMARY_NAV: NavEntry[] = [
  // El dashboard es `/dashboard` (db/queries/dashboard-v2.ts). La home `/`
  // redirige acá. El viejo quedó en `/dashboard-legacy`, fuera de la nav.
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { href: "/proyectos", label: "Proyectos", icon: Briefcase },
  { href: "/planes", label: "Planes de Medios", icon: FileText },
  { href: "/billing", label: "Billing", icon: FileCheck },
  { href: "/reportes/calendario", label: "Calendario de reportes", icon: CalendarClock },
  { href: "/reportes", label: "Reportes", icon: BarChart3, exact: true },
  { href: "/billing-tracker", label: "Billing Tracker", icon: Receipt },
  { href: "/creative", label: "Creative", icon: Palette },
  { href: "/campaign-tracker", label: "Campaign Tracker", icon: LineChart },
  { href: "/analisis", label: "Análisis x mercado", icon: Globe2 },
  { href: "/reportes/simulador", label: "Simulador", icon: FlaskConical },
];

export const FOOTER_NAV: NavEntry[] = [
  { href: "/auditoria", label: "Auditoría", icon: History },
  { href: "/configuracion", label: "Configuración", icon: Settings },
];

export function isNavActive(pathname: string, href: string, exact = false) {
  if (href === "/" || exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
