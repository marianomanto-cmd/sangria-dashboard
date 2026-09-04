// ════════════════════════════════════════════════════════════════════════════
// Sesión de AUDITORÍA — acceso externo de SOLO LECTURA a la app interna.
//
// Este módulo NO importa nada server-only (db, next/headers): lo usa también el
// proxy (`lib/supabase/middleware.ts`), que corre en el edge runtime. La
// lectura/escritura del cookie vive en `lib/audit-session.server.ts`.
//
// ── Por qué existe ──────────────────────────────────────────────────────────
// La app interna se entra con Google OAuth y SOLO con cuentas @sangria.agency
// (ver `updateSession`). Una auditora externa no tiene esa cuenta, así que
// necesita otra puerta. Ésta.
//
// ── Modelo de acceso ────────────────────────────────────────────────────────
//   • Usuario + contraseña fijos (abajo), no Google.
//   • Ve TODA la app interna, en modo solo lectura.
//   • Tres barreras encadenadas, en este orden:
//       1. El proxy sólo la deja pasar en GET. Los Server Actions se despachan
//          por POST, así que con una sesión de auditoría NO se pueden invocar.
//          Ésta es la garantía estructural: no depende de acordarse de nada.
//       2. Cada server action que muta llama a `assertCanWrite()`
//          (`lib/read-only.ts`) y devuelve un error legible. Red de seguridad
//          por si mañana el proxy dejara pasar un POST.
//       3. La UI marca cada control que escribe con `data-audit-hint` y, en
//          modo auditoría, lo desactiva y explica al pasar el mouse qué
//          cambiaría y a qué áreas afecta (`components/audit-mode.tsx`).
//
// ── Por qué el cookie va FIRMADO (y el del portal no) ───────────────────────
// El cookie del portal de cliente guarda un slug en texto plano: si alguien lo
// falsea, se abre el portal de UN cliente, que ya es público con password
// compartido. Acá el premio es distinto — la app interna entera, todos los
// clientes, la facturación — así que el cookie se firma con HMAC-SHA256 y el
// proxy lo verifica en cada request. Sin firma válida, no hay sesión.
// ════════════════════════════════════════════════════════════════════════════

// Credenciales de la sesión de auditoría. Están en el código a propósito, igual
// que `CLIENT_PORTAL_PASSWORD`: no hay alta de usuarios externos en la app y el
// acceso se revoca borrando estas constantes y redeployando.
export const AUDIT_EMAIL = "anainesmartins0611@gmail.com";
export const AUDIT_PASSWORD = "sangriaagency";
export const AUDIT_DISPLAY_NAME = "Ana Inés Martins";
export const AUDIT_ROLE_LABEL = "Auditoría externa";

export const AUDIT_COOKIE_NAME = "sangria_audit";

// Usuario sintético para la chrome de la app (sidebar + topbar). La sesión de
// auditoría no pasa por Supabase Auth, así que `getCurrentUser()` devuelve
// null y sin esto el layout renderizaría sin identidad. NO se usa para
// autorizar nada: quién puede escribir lo decide `lib/read-only.ts`.
export const AUDIT_SHELL_USER = {
  id: "audit-session",
  email: AUDIT_EMAIL,
  name: AUDIT_DISPLAY_NAME,
  avatarUrl: null as string | null,
};

// A dónde postea "Cerrar sesión" en el menú del topbar. Las cuentas de Google
// van a /auth/signout; la auditoría tiene el suyo porque no hay sesión de
// Supabase que cerrar.
export const AUDIT_SIGNOUT_PATH = "/api/audit/logout";

// Cuánto dura la sesión. Una auditoría es un trabajo acotado: 30 días y a
// renovar. El vencimiento va DENTRO de la firma, así que no se puede estirar
// editando el cookie.
export const AUDIT_SESSION_DAYS = 30;
const AUDIT_SESSION_MS = AUDIT_SESSION_DAYS * 24 * 60 * 60 * 1000;

// ── Firma ───────────────────────────────────────────────────────────────────
// El secreto sale de `AUDIT_SESSION_SECRET` si está seteado. Si no, cae a
// `DATABASE_URL`, que en esta app siempre existe, es server-only y es secreto
// (lleva el password de la base). Es una clave de HMAC: nunca se emite ni se
// puede derivar de la firma.
//
// Si no hay ninguno de los dos, `auditSecret()` devuelve null y TODO acá falla
// cerrado: no se emite ni se acepta ninguna sesión de auditoría. Preferimos
// dejar afuera a la auditora antes que aceptar un cookie sin verificar.
export function auditSecret(): string | null {
  const explicit = process.env.AUDIT_SESSION_SECRET;
  if (explicit && explicit.length >= 16) return explicit;
  const fallback = process.env.DATABASE_URL;
  if (fallback && fallback.length >= 16) return fallback;
  return null;
}

export function isAuditLoginEnabled(): boolean {
  return auditSecret() !== null;
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(payload: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return b64url(new Uint8Array(sig));
}

// Comparación en tiempo constante: comparar con === filtra por el primer byte
// distinto y filtra timing.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Token = "<expiraEnMs>.<hmac(audit:<expiraEnMs>)>".
// `now` se pasa por parámetro y no se toma acá adentro para que el módulo sea
// testeable y para no atar el edge a un reloj implícito.
export async function mintAuditToken(now: number): Promise<string | null> {
  const secret = auditSecret();
  if (!secret) return null;
  const exp = now + AUDIT_SESSION_MS;
  const sig = await sign(`audit:${exp}`, secret);
  return `${exp}.${sig}`;
}

export async function verifyAuditToken(
  token: string | null | undefined,
  now: number,
): Promise<boolean> {
  if (!token) return false;
  const secret = auditSecret();
  if (!secret) return false;

  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expRaw = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(expRaw) || !sig) return false;

  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp <= now) return false;

  const expected = await sign(`audit:${exp}`, secret);
  return safeEqual(sig, expected);
}

// ── Qué puede hacer una sesión de auditoría en el proxy ──────────────────────
// SOLO GET. Los Server Actions de Next se despachan por POST a la ruta actual
// sin importar el path, así que cerrando todo lo que no sea GET queda cerrada
// de raíz cualquier escritura — incluidas las actions que todavía no existen.
//
// HEAD y OPTIONS también pasan: no mutan y los usa el runtime.
const AUDIT_SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function auditMethodAllowed(method: string): boolean {
  return AUDIT_SAFE_METHODS.has(method.toUpperCase());
}

// La auditoría ve la app COMPLETA: no hay lista de rutas vedadas. Configuración
// incluida — que es donde se ven los roles y los catálogos por cliente, o sea
// justo lo que una auditoría querría revisar. Lo único que no puede es escribir.
