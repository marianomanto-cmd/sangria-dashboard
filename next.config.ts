import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Las rutas de export (PDF/XLSX) leen el logo de marca desde public/ en
  // runtime. Lo incluimos explícitamente en el file tracing para que viaje en
  // el bundle de esas funciones al desplegar.
  outputFileTracingIncludes: {
    "/api/plans/**": ["./public/sangria-logo.*"],
  },

  // `/dashboard` → `/pendientes` (05/sep/2026). La pantalla de entrada dejó de
  // ser un dashboard y pasó a ser el tablero de pendientes, pero la ruta vieja
  // está en los favoritos del equipo y en links pegados en chats, así que sigue
  // respondiendo. Next arrastra el querystring solo, así que `?client=` no se
  // pierde.
  //
  // `permanent: false` (307) A PROPÓSITO: un 308 se le queda cacheado al
  // browser para siempre y volver atrás dejaría de ser posible sin que cada
  // uno limpie su caché. Esto no es SEO — es una app interna.
  //
  // OJO: `/dashboard-legacy` NO entra acá. El matcher es exacto.
  async redirects() {
    return [
      { source: "/dashboard", destination: "/pendientes", permanent: false },
    ];
  },
};

export default nextConfig;
