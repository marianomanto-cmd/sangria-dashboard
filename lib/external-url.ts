// ════════════════════════════════════════════════════════════════════════════
// Normalización de URLs que el usuario pega a mano y la app después renderiza
// como link (hoy: la carpeta de Drive del proyecto).
//
// Dos cosas que resuelve:
//   • Comodidad: el que pega "drive.google.com/drive/folders/abc" no tiene que
//     acordarse del https:// — se lo ponemos nosotros. Sin eso el navegador lo
//     trata como path relativo y el botón lleva a /proyectos/drive.google.com/…
//   • Seguridad: un href sólo puede ser http/https. Guardar "javascript:…" en
//     un campo que después sale como <a href> es XSS al primer click, así que
//     el esquema se valida ACÁ y no en el render.
//
// Puro y client-safe: lo usan las server actions (barrera real) y los forms
// (feedback inmediato) para que la regla no se bifurque.
// ════════════════════════════════════════════════════════════════════════════

export type NormalizedUrl =
  | { ok: true; url: string | null }   // null = campo vacío (se limpia)
  | { ok: false; error: string };

export function normalizeExternalUrl(
  raw: string | null | undefined,
): NormalizedUrl {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: true, url: null };

  // Sin esquema asumimos https (lo normal al copiar de la barra del navegador
  // o de un mail). Ojo: "mailto:x" y "javascript:x" SÍ tienen esquema, así que
  // caen abajo y los rebota la validación.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { ok: false, error: "El link no es una URL válida" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "El link tiene que empezar con http:// o https://" };
  }
  if (!parsed.hostname) {
    return { ok: false, error: "El link no tiene dominio" };
  }

  return { ok: true, url: parsed.toString() };
}
