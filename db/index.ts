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
  const client = postgres(connectionString, {
    prepare: false,
    max: 5,
    idle_timeout: 20,
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
