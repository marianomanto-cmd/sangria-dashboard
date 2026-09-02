import dns from "node:dns";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";

// Forzar IPv4-first en DNS. En Vercel (y otros serverless) la resolución a
// IPv6 del pooler de Supabase frecuentemente cae en ENETUNREACH; preferir
// IPv4 evita ese problema. Node ≥18 soporta esta API.
dns.setDefaultResultOrder("ipv4first");

// ════════════════════════════════════════════════════════════════════════════
// Resiliencia de queries: timeout de cliente + reintento seguro
// ════════════════════════════════════════════════════════════════════════════
//
// EL PROBLEMA. postgres.js ENCOLA las queries cuando todas las conexiones del
// pool están ocupadas, y esa cola NO tiene timeout: la promesa espera
// indefinidamente hasta que se libere una conexión (`src/index.js`, `handler`).
// Lo mismo pasa cuando el Transaction Pooler de Supabase acepta la conexión TCP
// pero no tiene backend libre para atenderla: la conexión está "abierta", así
// que `connect_timeout` no aplica, y el statement nunca llega a ejecutarse, así
// que el `statement_timeout` del server tampoco — es exclusivamente un
// parámetro server-side, sin lógica de timeout del lado del cliente.
//
// Resultado: bajo saturación del pooler el render se colgaba SIN error hasta
// que Vercel mataba la función, y cada función muerta dejaba su conexión trabada
// en el pooler → más saturación → espiral de horas.
//
// LA SOLUCIÓN, EN DOS CAPAS.
//
// 1. REINTENTO (lo que evita que el usuario vea un error). Un pico de carga es
//    transitorio: si la query no consiguió conexión, esperar un momento y
//    reintentar la resuelve sin que se entere nadie. Se reintenta sólo cuando es
//    demostrablemente seguro — ver `retryable` abajo.
//
// 2. TIMEOUT (la red de contención, si el reintento tampoco alcanza). Falla
//    rápido y explícito: la página cae en su error boundary (recargable) en vez
//    de quedarse en el skeleton, y la conexión se libera enseguida en vez de
//    quedar tomada hasta que muere la función.
//
// PRESUPUESTO TOTAL: el peor caso (todos los intentos vencidos) tiene que quedar
// MUY por debajo del `maxDuration` de la página (45s en app/(app)/layout.tsx).
// Si la suma se pasa, Vercel mata la función antes de que lleguemos a lanzar el
// error: no se ve nada en los logs (sólo "Task timed out"), el error boundary no
// se renderiza y —lo peor— la función muere con sus conexiones abiertas, que
// quedan colgadas en el pooler de Supabase esperando a un cliente que ya no
// existe (`active` / `Client:ClientRead` en pg_stat_activity). Cada una ocupa un
// slot para siempre. Se vio en prod el 02/sep/2026 con 3 × 15s + backoff =
// 45,8s > 45s: el reintento fabricaba las zombies que después saturaban todo.
//
// Hoy: 2 × 8s + 0,3s ≈ 16,3s. Deja margen para el auth y el render.
const QUERY_TIMEOUT_MS = 8_000;
const MAX_ATTEMPTS = 2;
const RETRY_BACKOFF_MS = [300];

export class QueryTimeoutError extends Error {
  constructor(ms: number, attempts: number) {
    super(
      `Query timeout: la DB no respondió en ${ms}ms tras ${attempts} intento(s). ` +
        `Suele ser saturación del pooler de Supabase (sin conexión libre), no una query lenta.`,
    );
    this.name = "QueryTimeoutError";
  }
}

// Errores de conexión de postgres.js (`Errors.connection`). Son fallas de
// transporte, no respuestas de Postgres: la query pudo no haberse ejecutado.
const CONNECTION_ERROR_CODES = new Set([
  "CONNECTION_CLOSED",
  "CONNECTION_DESTROYED",
  "CONNECTION_ENDED",
  "CONNECT_TIMEOUT",
]);

function isConnectionError(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" && CONNECTION_ERROR_CODES.has(code);
}

// Un `select` no tiene efectos: repetirlo siempre da lo mismo. Deliberadamente
// conservador — un CTE que escribe empieza con `with`, no con `select`, así que
// no entra acá.
function isReadOnly(sqlText: unknown): boolean {
  return typeof sqlText === "string" && /^\s*select\b/i.test(sqlText);
}

type PgClient = ReturnType<typeof postgres>;
type PgQuery = ReturnType<PgClient["unsafe"]>;
type UnsafeArgs = Parameters<PgClient["unsafe"]>;

type Attempt =
  | { ok: true; value: unknown }
  | { ok: false; error: Error; retryable: boolean };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Referencia al cliente crudo, para poder descartarlo cuando se envenena. Se
// puebla en getClient(); `_db` (el drizzle que lo envuelve) se declara más
// abajo y se resetea junto con él.
let _rawClient: PgClient | null = null;

// ════════════════════════════════════════════════════════════════════════════
// Descartar la conexión envenenada. ESTO ES LA CURA DE LOS ZOMBIES.
//
// Cuando una query YA SALIÓ y vence nuestro reloj, abandonarla deja la conexión
// con una query en vuelo. El render falla, la función responde, y Vercel
// CONGELA la instancia con esa conexión abierta y a medio consumir. Del lado de
// Supabase queda para siempre así:
//
//     Supavisor | active | Client:ClientRead | 233 segundos
//
// El `statement_timeout` del server NO la rescata: mata el STATEMENT, pero el
// backend se queda esperando que el cliente lea el error. El cliente está
// congelado y no va a leer nunca. (El comentario que decía lo contrario acá
// estaba mal; se comprobó en prod el 02/sep/2026 viendo un zombie de 233s, muy
// por encima del statement_timeout de 12s.)
//
// Y una sola alcanza para tapar todo: se midió que Supavisor mantiene UNA
// conexión contra Postgres. Cada timeout se comía la única que había → más
// timeouts → más zombies. Ésa es la espiral que obligaba a reiniciar el
// proyecto en Supabase, que es literalmente "tirar las conexiones colgadas".
//
// Cerrar el socket sí lo resuelve: Postgres ve la desconexión y da de baja el
// backend. Con `max: 1` la que se cierra es exactamente la envenenada, y la
// próxima query levanta uno nuevo.
//
// Costo: las queries hermanas que iban por esa conexión mueren. Es un mal
// negocio sólo en apariencia — ya estaban sobre una conexión comprometida, y
// perder un render es infinitamente más barato que perder la conexión para
// siempre. Además fallan con error de conexión, que sí es reintentable.
// ════════════════════════════════════════════════════════════════════════════
function discardPoisonedConnection(): void {
  const client = _rawClient;
  if (!client) return;
  // Primero soltamos las referencias: si el cierre tarda, la próxima query ya
  // construye un cliente nuevo en vez de esperar a éste.
  _rawClient = null;
  _db = null;
  if (global.__pgClient === client) global.__pgClient = undefined;
  try {
    // `timeout: 0` = cerrar ya, sin esperar a las queries en vuelo (que es
    // justo lo que queremos: la que está en vuelo es la que no vuelve).
    void Promise.resolve(client.end({ timeout: 0 })).catch(() => {});
  } catch {
    /* si ya estaba cerrándose, no hay nada que hacer */
  }
}

// Corre UN intento contra el reloj. Devuelve además si es seguro reintentarlo.
function runAttempt(
  client: PgClient,
  args: UnsafeArgs,
  mutators: readonly string[],
): Promise<Attempt> {
  const query = client.unsafe(...args) as PgQuery;
  for (const m of mutators) {
    (query as unknown as Record<string, () => void>)[m]();
  }

  return new Promise<Attempt>((resolve) => {
    const timer = setTimeout(() => {
      // `state` lo setea la conexión al tomar la query (`connection.js`,
      // `q.state = backend`). Si sigue en null, la query NUNCA salió de la cola
      // local de postgres.js: no llegó al server, así que se la puede sacar y
      // reintentar con total seguridad, incluso si escribe.
      const neverSent = (query as unknown as { state: unknown }).state == null;

      if (neverSent) {
        // Para una query encolada, `cancel()` es puramente local: la saca de la
        // cola y la rechaza, sin tocar el server (`index.js`, `cancel`).
        try {
          const cancelling = query.cancel() as unknown;
          if (cancelling && typeof (cancelling as Promise<void>).then === "function") {
            void (cancelling as Promise<void>).catch(() => {});
          }
        } catch {
          /* puede no estar cancelable todavía */
        }
      }
      // Si YA salió, no alcanza con abandonarla: hay que CERRAR la conexión.
      // Dejarla abierta con la query en vuelo es exactamente lo que produce los
      // zombies `active/ClientRead` (ver discardPoisonedConnection). No se usa
      // `cancel()`: postgres.js pipelinea sobre una misma conexión y el cancel
      // se manda con el backend key de la conexión, así que puede matar a una
      // query HERMANA (verificado en test local). Cerrar el socket es más
      // contundente y no necesita adivinar a quién apuntar.
      if (!neverSent) discardPoisonedConnection();

      resolve({
        ok: false,
        error: new QueryTimeoutError(QUERY_TIMEOUT_MS, 1),
        retryable: neverSent,
      });
    }, QUERY_TIMEOUT_MS);

    // Adoptar el Query dispara su ejecución (Query.then → handle()). Pasamos
    // los DOS handlers, así el rechazo queda siempre manejado: si ganara el
    // timeout, un rechazo posterior sin handler sería un unhandled rejection
    // (los `unrecoverable error: Unhandled Rejection` que se veían en prod).
    Promise.resolve(query as unknown as Promise<unknown>).then(
      (value) => {
        clearTimeout(timer);
        resolve({ ok: true, value });
      },
      (error: Error) => {
        clearTimeout(timer);
        resolve({
          ok: false,
          error,
          retryable: isConnectionError(error) && isReadOnly(args[0]),
        });
      },
    );
  });
}

// postgres.js devuelve un `Query`, que extiende Promise y además es mutable:
// `.values()` / `.raw()` / `.simple()` devuelven `this`. Como el reintento tiene
// que construir un Query nuevo (uno ya usado no se puede re-ejecutar), el proxy
// ANOTA esos mutadores y los reaplica en cada intento. Sólo se toca el consumo
// de la promesa; todo lo demás pasa derecho.
function resilientQuery(client: PgClient, args: UnsafeArgs): PgQuery {
  const mutators: string[] = [];
  let settled: Promise<unknown> | null = null;

  const run = async (): Promise<unknown> => {
    let last: Attempt & { ok: false } = {
      ok: false,
      error: new QueryTimeoutError(QUERY_TIMEOUT_MS, 0),
      retryable: false,
    };
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const result = await runAttempt(client, args, mutators);
      if (result.ok) return result.value;
      last = result;
      if (!result.retryable || attempt === MAX_ATTEMPTS - 1) break;
      await sleep(RETRY_BACKOFF_MS[attempt] ?? 600);
    }
    throw last.error;
  };

  const settle = () => (settled ??= run());

  const proxy: PgQuery = new Proxy({} as PgQuery, {
    get(_t, prop) {
      if (prop === "then" || prop === "catch" || prop === "finally") {
        const raced = settle() as unknown as Record<string, unknown>;
        return (raced[prop as string] as (...a: unknown[]) => unknown).bind(raced);
      }
      // `.values()` / `.raw()` / `.simple()`: se anotan para reaplicarlos en
      // cada intento y se devuelve el proxy, igual que hace postgres.js.
      if (prop === "values" || prop === "raw" || prop === "simple") {
        return () => {
          if (!mutators.includes(prop)) mutators.push(prop);
          return proxy;
        };
      }
      return undefined;
    },
  });

  return proxy;
}

// Envuelve el cliente postgres.js para que TODA query que dispare drizzle pase
// por el timeout + reintento. drizzle-orm/postgres-js sólo usa
// `client.unsafe(...)` (con y sin `.values()`) para queries, y `client.begin()`
// para transacciones.
//
// Las transacciones quedan fuera a propósito: `begin` entrega una conexión
// reservada, viven sólo en server actions (mutaciones puntuales, no en el
// fan-out de lectura que causaba el cuelgue) y reintentarlas o cortarlas por la
// mitad es peor que dejarlas terminar.
function clientWithQueryTimeout(client: PgClient): PgClient {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "unsafe") {
        return (...args: UnsafeArgs) => resilientQuery(target, args);
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

// `prepare: false` para compatibilidad con el transaction pooler de Supabase
// (puerto 6543). Sobre la session pooler (5432) tampoco molesta.
//
// Cacheamos el cliente en globalThis para que HMR no cree clientes nuevos en
// cada hot-reload.

declare global {
  var __pgClient: PgClient | undefined;
}

function getClient(): PgClient {
  if (_rawClient) return _rawClient;
  if (global.__pgClient) {
    _rawClient = global.__pgClient;
    return global.__pgClient;
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL no está definida — revisá .env.local (en dev) o las env vars del deploy.",
    );
  }
  // ══════════════════════════════════════════════════════════════════════
  // `max: 1` por instancia. NO subirlo sin leer esto entero.
  // ══════════════════════════════════════════════════════════════════════
  //
  // EL PROBLEMA DE FONDO en serverless: este pool vive en scope de módulo, o
  // sea que sobrevive entre invocaciones de la MISMA instancia de Lambda. Y
  // Vercel no mata la instancia al terminar el request: la CONGELA. Una
  // instancia congelada no ejecuta timers, así que `idle_timeout` nunca
  // dispara y sus conexiones quedan abiertas del lado de Supabase — visibles
  // como `ClientRead` en pg_stat_activity, esperando a un cliente que no va a
  // hablar hasta que llegue otro request (o nunca, si Vercel la recicla).
  //
  // Con `max: N`, cada instancia caliente retiene hasta N slots del pooler. En
  // un pico Vercel levanta varias instancias, y el total retenido es
  // instancias × N. Ése es el goteo que obligaba a reiniciar el proyecto en
  // Supabase: no es una fuga por funciones muertas, es el modelo de conexiones
  // persistentes chocando con el ciclo de vida serverless.
  //
  // Con 1, cada instancia retiene exactamente una. No perdemos throughput:
  // Vercel sirve UN request por instancia a la vez, y postgres.js pipelinea
  // varias queries sobre la misma conexión (no las serializa), así que las ~24
  // round-trips del dashboard salen igual. Es además la recomendación estándar
  // para serverless contra un pooler en modo transacción.
  //
  // Historial: 3 → 8 (22/may/2026) → 3 (02/sep/2026, PR #248) → 1.
  //
  // EL TECHO NO ESTÁ ACÁ: es el "Connection pool size" de Supavisor (Supabase →
  // Settings → Database → Connection pooling), 25 desde el 02/sep/2026 (era
  // 15). En modo transacción cada query en vuelo ocupa uno de esos slots, así
  // que con `max: 1` la concurrencia de la app ES ese número; con `max: N`
  // sería 25/N. Ojo: `max_connections` (60) es de Postgres y no es el techo, y
  // pg_stat_activity NO ve las conexiones de la app (ve las de Supavisor).
  //
  // `connect_timeout: 10` evita que cuelgue indefinido al levantar la conn.
  // `connection.statement_timeout` pone el tope server-side desde el código,
  // sin depender del `ALTER ROLE` manual. La red de contención del lado del
  // cliente es QUERY_TIMEOUT_MS, arriba.
  const client = postgres(connectionString, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    connection: { statement_timeout: 12_000 },
  });
  if (process.env.NODE_ENV !== "production") {
    global.__pgClient = client;
  }
  _rawClient = client;
  return client;
}

// `db` es un Proxy: difiere la creación del cliente postgres + drizzle hasta
// el primer acceso a una propiedad/método. Esto permite que el build de
// Next.js (que carga los módulos durante "Collecting page data") no requiera
// DATABASE_URL — sólo se necesita en runtime, cuando hay un request real.
type DbInstance = ReturnType<typeof drizzle<typeof schema>>;
let _db: DbInstance | null = null;
function getDb(): DbInstance {
  if (_db) return _db;
  _db = drizzle(clientWithQueryTimeout(getClient()), { schema });
  return _db;
}

export const db = new Proxy({} as DbInstance, {
  get(_t, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
}) as DbInstance;

export { schema };
