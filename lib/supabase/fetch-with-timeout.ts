// `fetch` con tope de tiempo para el cliente de Supabase Auth.
//
// `supabase.auth.getUser()` pega contra Supabase Auth por HTTPS en CADA request
// (dos veces: proxy + layout) y no tiene timeout propio. Es la única llamada de
// red del render que no pasa por el timeout de queries de db/index.ts: si Auth
// tarda, se come el presupuesto entero de la función (45s) sin que nada lo
// corte, y la función muere con sus conexiones a la DB abiertas — que quedan
// colgadas en el pooler. Con esto falla rápido y explícito.
//
// Se respeta un `signal` que ya venga en el init (se combinan con
// AbortSignal.any, disponible en Node ≥ 20, que es lo que corre Vercel).
export const AUTH_FETCH_TIMEOUT_MS = 8_000;

export function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const timeout = AbortSignal.timeout(AUTH_FETCH_TIMEOUT_MS);
  const signal = init?.signal
    ? AbortSignal.any([init.signal, timeout])
    : timeout;
  return fetch(input, { ...init, signal });
}
