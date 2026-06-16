"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

// Título de sección (h2, Archivo) + toggle de 3 vistas del dashboard.
// El toggle solo aparece en "/" y conmuta la vista vía ?view= (URL-based, así
// el topbar —server— y el contenido del dashboard se comunican sin estado
// compartido). Default: cuentas (sin param).

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

const VIEWS: ReadonlyArray<readonly [string, string]> = [
  ["cuentas", "Cuentas"],
  ["operaciones", "Operaciones"],
  ["ejecutivo", "Ejecutivo"],
];

export function TopbarNav() {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const sp = useSearchParams();
  const onDash = pathname === "/";
  const raw = sp?.get("view") ?? "cuentas";
  const active = VIEWS.some(([id]) => id === raw) ? raw : "cuentas";

  const go = (id: string) => {
    const next = new URLSearchParams(sp?.toString() ?? "");
    if (id === "cuentas") next.delete("view");
    else next.set("view", id);
    const qs = next.toString();
    router.push(qs ? `/?${qs}` : "/");
  };

  return (
    <div className="flex items-center gap-3 min-w-0">
      <h2 className="font-display font-extrabold text-[15px] tracking-tight text-ink truncate">
        {titleFor(pathname)}
      </h2>
      {onDash && (
        <div className="hidden md:flex items-center gap-0.5 rounded-[10px] border border-line bg-paper-2 p-[3px]">
          {VIEWS.map(([id, label]) => {
            const on = id === active;
            return (
              <button
                key={id}
                type="button"
                onClick={() => go(id)}
                aria-pressed={on}
                className={`px-3 py-1 rounded-lg text-[13px] transition-colors ${
                  on
                    ? "bg-surface text-ink shadow-sm font-medium"
                    : "text-muted hover:text-ink"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
