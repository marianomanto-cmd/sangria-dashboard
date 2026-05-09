// Verifica que la connection string está bien y la DB responde.
// También lista las tablas del schema `public` para confirmar las migraciones.
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

  const tables = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `;
  console.log(`\n  Tablas en public (${tables.length}):`);
  for (const { table_name } of tables) {
    const [{ count }] = await sql`SELECT count(*)::int as count FROM ${sql(table_name)}`;
    console.log(`    · ${table_name.padEnd(20)} ${count} filas`);
  }
} catch (err) {
  console.error("✗ No se pudo conectar:");
  console.error(`  ${err.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
