// Param `?v=N` de los exports del plan (Excel / PDF).
//
// Sin el param → se exporta el plan VIGENTE (comportamiento histórico).
// Con `?v=N`   → se exporta la versión APROBADA N, reconstruida desde su
//                snapshot (`getPlanDetailAtVersion`).
//
// Devuelve null si no vino el param, el número si es válido, o "invalid" para
// que la route responda 400 en vez de exportar silenciosamente el plan actual
// (un `?v=abc` que se ignora es un download equivocado sin aviso).
export function parseVersionParam(req: Request): number | null | "invalid" {
  const raw = new URL(req.url).searchParams.get("v");
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return "invalid";
  return n;
}

// Sufijo del nombre de archivo. Una versión vieja se marca explícitamente para
// que no se confunda con el plan vigente al abrirla desde Descargas.
export function versionFilenameSuffix(version: number | null): string {
  return version == null ? "" : "-historico";
}
