import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL no está definida — revisá .env.local (en dev) o las env vars del deploy.",
  );
}

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

const client =
  global.__pgClient ??
  postgres(connectionString, { prepare: false, max: 5, idle_timeout: 20 });

if (process.env.NODE_ENV !== "production") {
  global.__pgClient = client;
}

export const db = drizzle(client, { schema });
export { schema };
