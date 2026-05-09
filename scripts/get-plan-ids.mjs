import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
const r = await sql`select p.code as project_code, mp.name as plan_name, mp.id as plan_id, mp.status from media_plans mp join projects p on mp.project_id = p.id order by p.code, mp.name`;
for (const row of r) console.log(`${row.status.padEnd(15)} ${row.plan_name.padEnd(25)} ${row.plan_id}  ${row.project_code}`);
await sql.end();
