import dns from "node:dns";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";

// Forzar IPv4-first en DNS. En Vercel (y otros serverless) la resolución a
// IPv6 del pooler de Supabase frecuentemente cae en ENETUNREACH; preferir
// IPv4 evita ese problema. Node ≥18 soporta esta API.
dns.setDefaultResultOrder("ipv4first");

// ════════════════════════════════════════════════════════════════════════════
// Timeout de cliente por query — la protección que faltaba
// ════════════════════════════════════════════════════════════════════════════
//
// postgres.js ENCOLA las queries cuando todas las conexiones del pool están
// ocupadas, y esa cola NO tiene timeout: la promesa espera indefinidamente
// hasta que se libere una conexión (`src/index.js`, función `handler`). Lo
// mismo pasa cuando el Transaction Pooler de Supabase acepta la conexión TCP
// pero no tiene backend libre para atenderla: la conexión está "abierta", así
// que `connect_timeout` no aplica, y el statement nunca llega a ejecutarse, así
// que el `statement_timeout` del server tampoco — es exclusivamente un
// parámetro server-side, sin lógica de timeout del lado del cliente.
//
// Resultado: bajo saturación del pooler el render se colgaba SIN error hasta
// que Vercel mataba la función (300s por defecto), y cada función muerta dejaba
// su conexión trabada en el pooler → más saturación → espiral de horas. Es el
// mecanismo detrás de los `Vercel Runtime Timeout Error` y de los `57014` en
// queries triviales.
//
// Con este tope, una query que no consigue conexión falla rápido y explícito:
// la página cae en su error boundary (recargable) en vez de quedarse en el
// skeleton, y la conexión se libera enseguida en vez de quedar tomada 5 min.
const QUERY_TIMEOUT_MS = 15_000;

export class QueryTimeoutError extends Error {
  constructor(ms: number) {
    super(
      `Query timeout: la DB no respondió en ${ms}ms. Suele ser saturación del ` +
        `pooler de Supabase (sin conexión libre), no una query lenta.`,
    );
    this.name = "QueryTimeoutError";
  }
}

// postgres.js devuelve un `Query`, que extiende Promise y además es mutable:
// `.values()` / `.raw()` / `.simple()` devuelven `this`. El proxy respeta eso
// (re-envuelve cuando el método devuelve el mismo objeto) y sólo intercepta el
// consumo de la promesa para correrla contra el reloj.
type PgQuery = ReturnType<ReturnType<typeof postgres>["unsafe"]>;

function withQueryTimeout(query: PgQuery): PgQuery {
  let settled: Promise<unknown> | null = null;

  const settle = () => {
    if (settled) return settled;
    let timer: ReturnType<typeof setTimeout>;
    settled = Promise.race([
      // Adoptar el Query dispara su ejecución (Query.then → handle()).
      Promise.resolve(query as unknown as Promise<unknown>),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          // Cancelar libera la conexión si la query ya estaba en vuelo; si
          // seguía encolada no hay nada que cancelar y `cancel()` no hace nada.
          try {
            query.cancel();
          } catch {
            /* la query puede no estar activa todavía */
          }
          reject(new QueryTimeoutError(QUERY_TIMEOUT_MS));
        }, QUERY_TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
    return settled;
  };

  const proxy: PgQuery = new Proxy(query, {
    get(target, prop, receiver) {
      if (prop === "then" || prop === "catch" || prop === "finally") {
        const raced = settle() as unknown as Record<string, unknown>;
        return (raced[prop as string] as (...a: unknown[]) => unknown).bind(raced);
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const out = (value as (...a: unknown[]) => unknown).apply(target, args);
        // `.values()` y compañía devuelven el mismo Query: re-envolver para no
        // perder el timeout al encadenar.
        return out === target ? proxy : out;
      };
    },
  }) as PgQuery;

  return proxy;
}

// Envuelve el cliente postgres.js para que TODA query que dispare drizzle pase
// por el timeout. drizzle-orm/postgres-js sólo usa `client.unsafe(...)` (con y
// sin `.values()`) para queries, y `client.begin()` para transacciones.
//
// Las transacciones quedan fuera del tope a propósito: `begin` entrega una
// conexión reservada, viven sólo en server actions (mutaciones puntuales, no en
// el fan-out de lectura que causaba el cuelgue) y cortarlas por la mitad es peor
// que dejarlas terminar.
type PgClient = ReturnType<typeof postgres>;

function clientWithQueryTimeout(client: PgClient): PgClient {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "unsafe") {
        return (...args: Parameters<PgClient["unsafe"]>) =>
          withQueryTimeout(target.unsafe(...args));
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
  if (global.__pgClient) return global.__pgClient;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL no está definida — revisá .env.local (en dev) o las env vars del deploy.",
    );
  }
  // `max: 8` por warm-instance. El motivo original para bajarlo a 3 era la
  // fuga de conexiones, pero esa fuga la causaba un loop infinito en
  // enumerateMonths (ya arreglado): una función que colgaba 300s, se mataba por
  // timeout y dejaba conexiones trabadas. Sin ese loop, conviene MÁS pool para
  // que las ~12 queries concurrentes del dashboard no queueen ni se traben si
  // alguna conexión queda lenta.
  // `connect_timeout: 10` evita que cuelgue indefinido al levantar la conn.
  // `connection.statement_timeout` pone el tope server-side desde el código:
  // antes dependía de un `ALTER ROLE ... SET statement_timeout` manual en
  // Supabase, que si no se corrió (o se pierde al recrear el rol) deja a la app
  // sin ninguna red de contención. La red de contención real del lado del
  // cliente es QUERY_TIMEOUT_MS, arriba.
  const client = postgres(connectionString, {
    prepare: false,
    max: 8,
    idle_timeout: 20,
    connect_timeout: 10,
    connection: { statement_timeout: 12_000 },
  });
  if (process.env.NODE_ENV !== "production") {
    global.__pgClient = client;
  }
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
