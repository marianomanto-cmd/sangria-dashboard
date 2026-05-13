// Backfill de project_reports para proyectos que ya están en status 'closed'
// cuando ship-eamos la feature de Reporting Calendar.
//
// Idempotente: insertar una fila por proyecto closed que aún no tenga una.
// El closed_at se deriva del audit_log (último status_change a 'closed') si
// existe, y como fallback usa projects.created_at.
//
// Uso (después de `npm run db:push` para crear la tabla):
//   node --env-file=.env.local scripts/backfill-reports.mjs

import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("✗ DATABASE_URL no está definida (revisá .env.local)");
  process.exit(1);
}

const sql = postgres(connectionString, { prepare: false });

try {
  // Proyectos closed sin fila en project_reports.
  const orphans = await sql`
    SELECT p.id, p.code, p.created_at
    FROM projects p
    LEFT JOIN project_reports r ON r.project_id = p.id
    WHERE p.status = 'closed'
      AND r.id IS NULL
    ORDER BY p.created_at
  `;

  if (orphans.length === 0) {
    console.log("✓ No hay proyectos closed sin report. Nada que hacer.");
    process.exit(0);
  }

  console.log(`Encontrados ${orphans.length} proyectos closed sin report:`);
  for (const p of orphans) console.log(`  · ${p.code}`);

  let inserted = 0;
  for (const p of orphans) {
    // Intentamos derivar closed_at del último status_change a 'closed' en audit_log.
    const [last] = await sql`
      SELECT created_at
      FROM audit_log
      WHERE entity_type = 'project'
        AND entity_id = ${p.id}
        AND action = 'status_change'
        AND after_json ->> 'status' = 'closed'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const closedAt = last?.created_at ?? p.created_at;

    await sql`
      INSERT INTO project_reports (project_id, closed_at)
      VALUES (${p.id}, ${closedAt})
      ON CONFLICT (project_id) DO NOTHING
    `;
    inserted++;
  }

  console.log(`\n✓ Backfill completo. ${inserted} filas insertadas en project_reports.`);
} catch (e) {
  console.error("✗ Error durante el backfill:");
  console.error(e);
  process.exit(1);
} finally {
  await sql.end();
}
