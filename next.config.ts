import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Las rutas de export (PDF/XLSX) leen el logo de marca desde public/ en
  // runtime. Lo incluimos explícitamente en el file tracing para que viaje en
  // el bundle de esas funciones al desplegar.
  outputFileTracingIncludes: {
    "/api/plans/**": ["./public/sangria-logo.*"],
  },
};

export default nextConfig;
