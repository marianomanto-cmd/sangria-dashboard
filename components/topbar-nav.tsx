"use client";

import { usePathname } from "next/navigation";

// Título de sección del topbar (h2, Archivo) derivado del pathname. El toggle
// de vistas del dashboard vive dentro del propio dashboard (cambio instantáneo,
// sin recargar), no acá.

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/proyectos": "Proyectos",
  "/planes": "Planes de Medios",
  "/billing": "Billing",
  "/billing-tracker": "Billing Tracker",
  "/campaign-tracker": "Campaign Tracker",
  "/analisis": "Análisis x mercado",
  "/reportes": "Reportes",
  "/reportes/calendario": "Calendario de reportes",
  "/reportes/simulador": "Simulador",
  "/reportes/generador": "Generador",
  "/auditoria": "Auditoría",
  "/configuracion": "Configuración",
};

function titleFor(pathname: string): string {
  if (TITLES[pathname]) return TITLES[pathname];
  if (pathname.startsWith("/clientes")) return "Clientes";
  if (pathname.startsWith("/proyectos")) return "Proyectos";
  if (pathname.startsWith("/campaign-tracker")) return "Campaign Tracker";
  if (pathname.startsWith("/billing-tracker")) return "Billing Tracker";
  if (pathname.startsWith("/billing")) return "Billing";
  if (pathname.startsWith("/configuracion")) return "Configuración";
  if (pathname.startsWith("/reportes")) return "Reportes";
  return "Sangria";
}

export function TopbarNav() {
  const pathname = usePathname() ?? "/";
  return (
    <h2 className="font-display font-extrabold text-[15px] tracking-tight text-ink truncate">
      {titleFor(pathname)}
    </h2>
  );
}
