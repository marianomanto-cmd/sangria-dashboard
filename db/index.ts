import dns from "node:dns";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";

// Forzar IPv4-first en DNS. En Vercel (y otros serverless) la resolución a
// IPv6 del pooler de Supabase frecuentemente cae en ENETUNREACH; preferir
// IPv4 evita ese problema. Node ≥18 soporta esta API.
dns.setDefaultResultOrder("ipv4first");

// `prepare: false` para compatibilidad con el transaction pooler de Supabase
// (puerto 6543). Sobre la session pooler (5432) tampoco molesta.
//
// `max: 5` para no saturar el session pool de Supabase (límite 15) cuando
// HMR de Next.js recarga módulos y crea clientes nuevos. En prod con
// transaction pooler se puede subir.
//
// Cacheamos el cliente en globalThis para que HMR no cree clientes nuevos en
// cada hot-reload.

declare global {
  var __pgClient: ReturnType<typeof postgres> | undefined;
}

function getClient(): ReturnType<typeof postgres> {
  if (global.__pgClient) return global.__pgClient;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL no está definida — revisá .env.local (en dev) o las env vars del deploy.",
    );
  }
  // `max: 3` por warm-instance. En serverless (Vercel) Next escala a muchas
  // Lambdas en paralelo; si cada una abre demasiadas conexiones, se satura el
  // Transaction Pooler de Supabase. Cuando una Lambda se mata por timeout (504)
  // deja conexiones colgadas en `active/ClientRead` que ocupan slots del pooler
  // hasta que un statement_timeout del lado del server las cancela — bajar el
  // max reduce cuántas se filtran por cada Lambda muerta. El dashboard ahora
  // cachea sus datos (ver app/(app)/page.tsx), así que casi nunca dispara las
  // ~15-20 queries en paralelo que motivaban un pool más grande.
  // `connect_timeout: 10` evita que cuelgue indefinido al levantar la conn.
  const client = postgres(connectionString, {
    prepare: false,
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
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
  _db = drizzle(getClient(), { schema });
  return _db;
}

export const db = new Proxy({} as DbInstance, {
  get(_t, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
}) as DbInstance;

export { schema };
