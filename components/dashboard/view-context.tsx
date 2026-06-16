"use client";

import { createContext, useContext } from "react";
import type { DashView } from "./types";

// Permite que cualquier hijo de DashboardView (ej. el botón "Ver todos →" de
// las vistas Cuentas/Ejecutivo) cambie de vista al instante, sin recargar.
export const DashViewContext = createContext<(v: DashView) => void>(() => {});

export function useSetDashView() {
  return useContext(DashViewContext);
}
