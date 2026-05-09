// Verifica que la connection string de Postgres está bien y la DB responde.
// Uso: `npm run db:check`
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("✗ DATABASE_URL no está definida (revisá .env.local)");
  process.exit(1);
}

const sql = postgres(connectionString, { prepare: false });

try {
  const [{ now, version }] = await sql`SELECT NOW() as now, version() as version`;
  console.log("✓ Conectado a Postgres");
  console.log(`  now:     ${now.toISOString()}`);
  console.log(`  version: ${version.split(" ").slice(0, 2).join(" ")}`);
} catch (err) {
  console.error("✗ No se pudo conectar:");
  console.error(`  ${err.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
