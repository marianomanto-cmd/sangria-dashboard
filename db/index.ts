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
// ════════════════════════════════════════════════════════════════════════════
// DOS RELOJES, NO UNO. Medido en prod el 03/sep/2026.
//
// Con un solo reloj de 8s era imposible distinguir estos dos casos, que piden
// respuestas opuestas:
//
//   (a) LA QUERY ESPERA TURNO. Está en la cola local de postgres.js porque las
//       hermanas de su propio `Promise.all` tienen tomada la conexión. NO llegó
//       al server. La conexión está sana; reintentar es gratis y seguro.
//   (b) LA QUERY SALIÓ Y EL SOCKET NO CONTESTA. Ahí sí la conexión es
//       inservible y hay que cerrarla (ver discardPoisonedConnection).
//
// El 03/sep se midió que el caso (a) era el 100% de lo que se veía: una carga
// de /dashboard le cuesta a Postgres 21 ms (20,48 + 0,98 medidos con
// pg_stat_statements reseteado), y aun así dos de sus cuatro queries morían a
// los 8s SIN HABERSE EJECUTADO NUNCA — no figuraban en pg_stat_statements. El
// reloj no medía la query: medía la fila.
//
// TRES ESTADOS, NO DOS. La primera versión de este arreglo usaba sólo
// `q.state` para separar "encolada" de "ejecutando", y el test local la tumbó:
// postgres.js PIPELINEA. Cuando no hay conexión libre, `handler()` no encola —
// le pasa la query a una conexión OCUPADA (`index.js:341`,
// `busy.length ? go(busy.shift(), query) : queries.push(query)`), que la
// escribe al socket igual. Y `execute()` setea `q.state = backend` al escribir
// (`connection.js:167`), así que `state != null` NO significa "el server está
// trabajando en esto": significa "ya salió por el cable".
//
// La señal que sí lo dice es `q.active`, tres líneas más abajo:
//
//     q.state = backend
//     query
//       ? sent.push(q)                      // pipelineada: active queda false
//       : (query = q, query.active = true)  // ésta es la que el server atiende
//
// y cuando la de adelante termina, el ReadyForQuery promueve a la siguiente
// (`connection.js:573`, `query.active = true`). De ahí los tres estados:
//
//   1. COLA      · !state          → en la cola LOCAL de postgres.js, nunca
//                                    salió. `cancel()` es local, la conexión
//                                    está sana, reintentar es gratis y seguro.
//   2. PIPELINE  · state && !active → escrita al socket, esperando que el
//                                    server termine con las hermanas de la
//                                    misma conexión. La conexión está SANA Y
//                                    OCUPADA: cerrarla mata a las hermanas que
//                                    están trabajando bien. NO se descarta.
//   3. EJECUCIÓN · state && active  → el server está en esta query y no
//                                    contestó ni pasado su propio
//                                    statement_timeout. Recién acá la conexión
//                                    es sospechosa de estar muerta, y recién
//                                    acá se cierra.
//
// EL RELOJ DE EJECUCIÓN CORRE DESDE QUE LA QUERY SE VUELVE `active`, no desde
// que se creó, y ES MÁS LARGO QUE EL `statement_timeout` DEL SERVER (12s > 10s).
// Así el que corta una query lenta es SIEMPRE Postgres, que responde un 57014
// por la misma conexión y la deja limpia y reusable. Si ganara nuestro reloj
// habría que cerrar el socket — que es justo lo que fabricaba zombies.
//
// PRESUPUESTO. El peor caso tiene que quedar por debajo del `maxDuration` de la
// página (45s en app/(app)/layout.tsx): si Vercel mata la función antes de que
// lancemos el error, la instancia se congela con la conexión abierta y vuelve
// la espiral del 02/sep. Sólo la fase COLA es reintentable siempre, y vence a
// los 6s, así que:
//   peor caso = cola(6s) + backoff(0,3s) + [cola(6s) + pipeline(6s) + ejec(12s)]
//             = 30,3s   + auth (8s, lib/supabase/fetch-with-timeout.ts) < 45s ✔
// ════════════════════════════════════════════════════════════════════════════
const QUEUE_TIMEOUT_MS = 6_000;
const PIPELINE_TIMEOUT_MS = 6_000;
const EXEC_TIMEOUT_MS = 12_000;
const STATEMENT_TIMEOUT_MS = 10_000;
// Cada cuánto se mira en qué estado está la query. La precisión no importa
// (±100ms sobre deadlines de 6s y 12s); lo que importa es no arrancar el reloj
// de una fase antes de que la query esté realmente en esa fase.
const DISPATCH_POLL_MS = 100;
const MAX_ATTEMPTS = 2;
const RETRY_BACKOFF_MS = [300];

// Conexiones por instancia de Lambda. Ver el bloque largo en getClient().
const MAX_CONNECTIONS = 3;

export type TimeoutPhase = "cola" | "pipeline" | "ejecucion";

const MENSAJE: Record<TimeoutPhase, (ms: number) => string> = {
  cola: (ms) =>
    `EN COLA: esperó ${ms}ms una conexión y nunca llegó a salir. No es una query ` +
    `lenta ni un problema de la DB: es contención de conexiones en esta instancia. ` +
    `Mirá cuántas queries dispara la página y si van todas en un solo Promise.all.`,
  pipeline: (ms) =>
    `EN PIPELINE: salió por el socket pero el server no llegó a empezarla en ${ms}ms ` +
    `porque está terminando las hermanas de la misma conexión. La conexión está sana ` +
    `y ocupada — no se cerró. Es contención dentro del propio render.`,
  ejecucion: (ms) =>
    `EN EJECUCIÓN: el server la empezó y no respondió en ${ms}ms. Como eso es más que ` +
    `el statement_timeout (${STATEMENT_TIMEOUT_MS}ms), Postgres tendría que haber ` +
    `contestado un 57014 antes: apunta al socket o al pooler, no a la query. La ` +
    `conexión se cerró por envenenada.`,
};

export class QueryTimeoutError extends Error {
  readonly phase: TimeoutPhase;
  constructor(phase: TimeoutPhase, ms: number, attempt: number) {
    super(`Query timeout ${MENSAJE[phase](ms)} (intento ${attempt})`);
    this.name = "QueryTimeoutError";
    this.phase = phase;
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
//
// RECIBE EL CLIENTE, no lo saca de `_rawClient`. Antes cerraba el cliente
// ACTUAL, que no tiene por qué ser el dueño de la query que venció: si otro
// timeout ya lo había reemplazado, esto cerraba una conexión SANA y dejaba la
// envenenada abierta — o sea, exactamente al revés de lo que dice hacer.
function discardPoisonedConnection(client: PgClient): void {
  if (!client) return;
  // Soltar las referencias sólo si el envenenado es el que está en uso; si ya
  // lo reemplazaron, el vigente no se toca.
  if (_rawClient === client) {
    _rawClient = null;
    _db = null;
  }
  if (global.__pgClient === client) global.__pgClient = undefined;
  try {
    // `timeout: 0` = cerrar ya, sin esperar a las queries en vuelo (que es
    // justo lo que queremos: la que está en vuelo es la que no vuelve).
    void Promise.resolve(client.end({ timeout: 0 })).catch(() => {});
  } catch {
    /* si ya estaba cerrándose, no hay nada que hacer */
  }
}

// Corre UN intento con los DOS relojes (ver arriba). Devuelve además si es
// seguro reintentarlo.
function runAttempt(
  client: PgClient,
  args: UnsafeArgs,
  mutators: readonly string[],
  attemptNumber: number,
): Promise<Attempt> {
  const query = client.unsafe(...args) as PgQuery;
  for (const m of mutators) {
    (query as unknown as Record<string, () => void>)[m]();
  }

  // Los tres estados, leídos del Query de postgres.js (ver el bloque de arriba):
  //   !state          → cola local, no salió
  //   state && !active → salió, pipelineada detrás de sus hermanas
  //   state && active  → el server está en esta query
  const leerFase = (): TimeoutPhase => {
    const q = query as unknown as { state?: unknown; active?: unknown };
    if (q.state == null) return "cola";
    return q.active === true ? "ejecucion" : "pipeline";
  };

  const LIMITE: Record<TimeoutPhase, number> = {
    cola: QUEUE_TIMEOUT_MS,
    pipeline: PIPELINE_TIMEOUT_MS,
    ejecucion: EXEC_TIMEOUT_MS,
  };

  return new Promise<Attempt>((resolve) => {
    let cerrado = false;
    // Cada fase tiene su propio reloj, que arranca cuando la query ENTRA en esa
    // fase. Si se midiera todo desde la creación, una query pipelineada detrás
    // de una hermana lenta parecería colgada cuando en realidad ni empezó.
    let fase = leerFase();
    let faseDesde = Date.now();

    const reloj = setInterval(() => {
      if (cerrado) return;

      const ahora = leerFase();
      if (ahora !== fase) {
        fase = ahora;
        faseDesde = Date.now();
        return;
      }
      if (Date.now() - faseDesde < LIMITE[fase]) return;
      vencer(fase);
    }, DISPATCH_POLL_MS);

    const terminar = () => {
      cerrado = true;
      clearInterval(reloj);
    };

    const vencer = (phase: TimeoutPhase) => {
      terminar();

      if (phase === "cola") {
        // Nunca salió: `cancel()` es puramente LOCAL — saca la query de la cola
        // y la rechaza, sin mandarle nada al server (`index.js:350-362`, rama
        // `query.state` falsy). La conexión queda intacta, así que no se
        // descarta nada y reintentar es seguro incluso para escrituras.
        try {
          const cancelando = query.cancel() as unknown;
          if (cancelando && typeof (cancelando as Promise<void>).then === "function") {
            void (cancelando as Promise<void>).catch(() => {});
          }
        } catch {
          /* puede no estar cancelable todavía */
        }
      } else if (phase === "ejecucion") {
        // El server la empezó y no contestó ni pasado su statement_timeout: no
        // hay nadie del otro lado. Abandonarla dejaría la conexión con una query
        // en vuelo, que es la fábrica de zombies `active/ClientRead` del 02/sep.
        // Se cierra ESTE cliente (no el que esté de turno). No se usa `cancel()`:
        // sobre una conexión pipelineada el cancel viaja con el backend key y
        // puede matar a una query HERMANA.
        discardPoisonedConnection(client);
      }
      // phase === "pipeline": NO se toca la conexión. Está sana y ocupada
      // atendiendo a las hermanas; cerrarla las mataría a todas. Soltamos
      // nuestra espera y postgres.js sigue leyendo la respuesta cuando llegue,
      // así que el socket no queda envenenado.

      resolve({
        ok: false,
        error: new QueryTimeoutError(phase, LIMITE[phase], attemptNumber),
        // La fase COLA es siempre segura: la query no salió. Las otras dos pueden
        // haberse ejecutado, así que sólo se reintentan las lecturas.
        retryable: phase === "cola" || isReadOnly(args[0]),
      });
    };

    // Adoptar el Query dispara su ejecución (Query.then → handle()). Pasamos
    // los DOS handlers, así el rechazo queda siempre manejado: si ganara el
    // timeout, un rechazo posterior sin handler sería un unhandled rejection
    // (los `unrecoverable error: Unhandled Rejection` que se veían en prod).
    Promise.resolve(query as unknown as Promise<unknown>).then(
      (value) => {
        if (cerrado) return;
        terminar();
        resolve({ ok: true, value });
      },
      (error: Error) => {
        if (cerrado) return;
        terminar();
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
// `resolveClient` es un GETTER, no el cliente. Es la diferencia entre que el
// reintento sirva y que no sirva para nada: si se captura el cliente y en el
// medio `discardPoisonedConnection` lo cerró, postgres.js rechaza al toque —
// `handler()` hace `if (ending) return query.reject(CONNECTION_ENDED)`
// (`index.js:329-331`) y `ending` NUNCA se resetea (`index.js:365-367`). O sea
// que el "segundo intento" fallaba en 0 ms sin tocar la red, y MAX_ATTEMPTS=2
// valía 1. Ése es el `CONNECTION_ENDED ...pooler.supabase.com:6543` de los
// logs: nos lo hacíamos solos, no lo tiraba el pooler.
function resilientQuery(
  resolveClient: () => PgClient,
  args: UnsafeArgs,
): PgQuery {
  const mutators: string[] = [];
  let settled: Promise<unknown> | null = null;

  const run = async (): Promise<unknown> => {
    let last: Attempt & { ok: false } = {
      ok: false,
      error: new QueryTimeoutError("cola", QUEUE_TIMEOUT_MS, 0),
      retryable: false,
    };
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const result = await runAttempt(
        resolveClient(),
        args,
        mutators,
        attempt + 1,
      );
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
        // Getter, no `target`: el reintento tiene que ver el cliente VIGENTE.
        return (...args: UnsafeArgs) => resilientQuery(getClient, args);
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
  // `max` por instancia. Historial: 3 → 8 (22/may) → 3 → 1 (02/sep) → 3.
  // ══════════════════════════════════════════════════════════════════════
  //
  // POR QUÉ SE HABÍA BAJADO A 1. Este pool vive en scope de módulo y sobrevive
  // entre invocaciones de la MISMA instancia de Lambda. Vercel no mata la
  // instancia al terminar el request: la CONGELA, y una instancia congelada no
  // ejecuta timers, así que `idle_timeout` nunca dispara y sus conexiones
  // quedan abiertas del lado de Supabase. Con `max: N`, cada instancia caliente
  // retiene hasta N slots; en un pico, instancias × N.
  //
  // POR QUÉ VUELVE A 3. El argumento de arriba sigue siendo cierto, pero el
  // razonamiento tenía un supuesto FALSO, escrito acá mismo hasta el 03/sep:
  //
  //     "Vercel sirve UN request por instancia a la vez, así que no se pierde
  //      concurrencia entre requests."
  //
  // Aunque eso valiera entre requests, NO vale DENTRO de uno: una página
  // dispara entre 4 y 16 queries, y con `max: 1` todas comparten un solo
  // socket. Las que no entran se encolan en la cola LOCAL de postgres.js, que
  // no tiene timeout propio, y morían contra nuestro reloj sin haber salido.
  //
  // La medición del 03/sep (pg_stat_statements reseteado + una carga de
  // /dashboard) no deja lugar a dudas:
  //
  //   | query de /dashboard                          | calls | ms    |
  //   |----------------------------------------------|-------|-------|
  //   | projects ⋈ clients ⋈ plans ⋈ billings ⋈ pubs |   1   | 20,48 |
  //   | facturación por mes                          |   1   |  0,98 |
  //   | las otras dos de getDashboardV2              |   0   |   —   |
  //
  // 21 ms de trabajo real, y aun así la vista fallaba: las otras dos NUNCA
  // llegaron a Postgres. No aparecen porque no se ejecutaron. Ahí se iban los
  // 8 segundos — en la fila, no en la base.
  //
  // EL TECHO NO ESTÁ ACÁ: es el "Connection pool size" de Supavisor (Supabase →
  // Settings → Database → Connection pooling), en 25 desde el 02/sep. En modo
  // transacción cada query EN VUELO ocupa uno de esos slots, y como las queries
  // duran ~20 ms, se liberan enseguida. Con `max: 3` una instancia retiene como
  // mucho 3 y hacen falta 9 instancias calientes simultáneas para agotar los 25.
  // `max_connections` (60) es de Postgres y NO es el techo; pg_stat_activity no
  // ve las conexiones de la app, ve las de Supavisor.
  //
  // Si hay que volver a bajarlo, la contrapartida es reducir el fan-out por
  // página (menos round-trips, más `Promise.all`), no dejar la cola sin salida.
  //
  // `connect_timeout: 10` evita que cuelgue indefinido al levantar la conn.
  // `connection.statement_timeout` pone el tope server-side desde el código, y
  // es DELIBERADAMENTE menor que EXEC_TIMEOUT_MS para que el que corte una
  // query lenta sea Postgres y no nosotros (ver "DOS RELOJES" arriba).
  const client = postgres(connectionString, {
    prepare: false,
    max: MAX_CONNECTIONS,
    idle_timeout: 20,
    connect_timeout: 10,
    connection: { statement_timeout: STATEMENT_TIMEOUT_MS },
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
