import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL no está definida — revisá .env.local (en dev) o las env vars del deploy.",
  );
}

// `prepare: false` para compatibilidad con el transaction pooler de Supabase
// (puerto 6543). Sobre la conexión directa (5432) tampoco molesta.
const client = postgres(connectionString, { prepare: false });

export const db = drizzle(client);
