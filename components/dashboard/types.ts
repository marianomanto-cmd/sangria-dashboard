// Tipo + normalizador de la vista del dashboard. Módulo plano (sin "use
// client") para que lo pueda importar el server component de la página.

export type DashView = "cuentas" | "operaciones" | "ejecutivo";

export function normalizeDashView(raw: string | undefined): DashView {
  return raw === "operaciones" || raw === "ejecutivo" ? raw : "cuentas";
}
