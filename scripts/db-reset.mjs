// Resetea el schema public completo. Destructivo.
// Uso: `node --env-file=.env.local scripts/db-reset.mjs`
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { prepare: false });

try {
  console.log("⏳ Drop schema public + recrearlo...");
  await sql`DROP SCHEMA public CASCADE`;
  await sql`CREATE SCHEMA public`;
  await sql`GRANT ALL ON SCHEMA public TO postgres`;
  await sql`GRANT ALL ON SCHEMA public TO anon`;
  await sql`GRANT ALL ON SCHEMA public TO authenticated`;
  await sql`GRANT ALL ON SCHEMA public TO service_role`;
  console.log("✓ Schema public reseteado");
} catch (e) {
  console.error("✗", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
