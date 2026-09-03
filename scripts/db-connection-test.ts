// ════════════════════════════════════════════════════════════════════════════
// TEST del ciclo de vida de conexión de `db/index.ts`.
//
// No es un unit test: levanta el cliente REAL contra un Postgres REAL y mide
// comportamiento. Existe porque los tres bugs que arregló el PR de 03/sep no se
// veían leyendo el código —- dependen de cómo pipelinea postgres.js—- y porque
// la primera versión del arreglo pasaba la revisión y fallaba este test.
//
// CÓMO CORRERLO. Necesita un Postgres local (hay uno en el contenedor, en
// /usr/lib/postgresql/16/bin; ver el gotcha de initdb en HANDOFF) escuchando
// por TCP, y DATABASE_URL apuntándole:
//
//   npm run test:db
//
// NUNCA contra prod: el caso 5 congela el server con SIGSTOP.
//
// QUÉ FIJA (si algo de esto se rompe, volvieron los cuelgues):
//   1. Un lote de queries usa más de una conexión  → `max` > 1.
//   2. Una query lenta la corta POSTGRES con 57014, no nuestro reloj, y la
//      conexión sigue usable → EXEC_TIMEOUT_MS > STATEMENT_TIMEOUT_MS.
//   3. Bajo contención, las que esperan turno vencen en fase "pipeline" y NO
//      cierran el socket → no se llevan puestas a las hermanas sanas.
//   4. El error dice la fase y el número de intento REAL.
//   5. Sólo un socket MUERTO vence en fase "ejecucion" y cierra la conexión, y
//      la app se recupera sola sobre una conexión nueva.
//
// Con el código anterior a este PR: 10 de las 16 aserciones fallan, y en el
// caso 3 morían LAS CINCO queries en vez de una.
// ════════════════════════════════════════════════════════════════════════════
import { execFileSync } from "node:child_process";
import { sql, type SQL } from "drizzle-orm";
import { db, QueryTimeoutError } from "@/db";

type Fila = Record<string, unknown>;

const q = async (s: SQL): Promise<Fila[]> =>
  (await db.execute(s)) as unknown as Fila[];

const num = (v: unknown): number => Number(v);

let fallas = 0;
function check(nombre: string, cond: boolean, extra = ""): void {
  if (!cond) fallas++;
  console.log(`  ${cond ? "PASA" : "FALLA"}  ${nombre}${extra ? " — " + extra : ""}`);
}

// El error real viaja envuelto por drizzle en un DrizzleQueryError.
function causa(e: unknown): unknown {
  const c = (e as { cause?: unknown } | null)?.cause;
  return c ?? e;
}
function comoTimeout(e: unknown): QueryTimeoutError | null {
  const c = causa(e);
  return c instanceof QueryTimeoutError ? c : null;
}
function codigoPg(e: unknown): string | undefined {
  const c = causa(e) as { code?: unknown } | null;
  return typeof c?.code === "string" ? c.code : undefined;
}
function nombreDe(e: unknown): string {
  const c = causa(e) as { name?: unknown } | null;
  return typeof c?.name === "string" ? c.name : String(c);
}

async function conexionesAbiertas(): Promise<number> {
  const r = await q(sql`select count(*)::int as n from pg_stat_activity
      where datname = current_database() and pid <> pg_backend_pid()`);
  return num(r[0].n);
}

async function backendPids(): Promise<number[]> {
  const r = await q(sql`select pid from pg_stat_activity
      where datname = current_database() and backend_type = 'client backend'`);
  return r.map((f) => num(f.pid));
}

function senal(sig: "-STOP" | "-CONT", pids: readonly number[]): void {
  for (const pid of pids) {
    try {
      execFileSync("kill", [sig, String(pid)]);
    } catch {
      /* pudo haber muerto ya */
    }
  }
}

async function main(): Promise<void> {
  // ── 1. El patrón de una página: un lote en Promise.all ──────────────────
  console.log("\n1) Lote de 8 queries en un Promise.all (el patrón de una página)");
  const antes = await conexionesAbiertas();
  const t0 = Date.now();
  const lote = await Promise.all(
    Array.from({ length: 8 }, (_, i) => q(sql`select ${i}::int as n, pg_backend_pid() as pid`)),
  );
  const backends = new Set(lote.map((r) => String(r[0].pid)));
  check("las 8 vuelven", lote.length === 8);
  check(
    "usan más de una conexión (max:3; con max:1 era imposible)",
    backends.size > 1,
    `${backends.size} backends distintos, ${Date.now() - t0}ms`,
  );
  console.log(`     conexiones al server: ${antes} → ${await conexionesAbiertas()}`);

  // ── 2. Que la query lenta la corte POSTGRES, no nuestro reloj ───────────
  //     EXEC_TIMEOUT_MS (12s) > STATEMENT_TIMEOUT_MS (10s) a propósito: así el
  //     57014 vuelve por la misma conexión y la deja reusable, en vez de
  //     obligarnos a cerrar el socket (que es lo que fabricaba zombies).
  console.log("\n2) Query más lenta que statement_timeout (10s)");
  let e2: unknown = null;
  const t1 = Date.now();
  try {
    await q(sql`select pg_sleep(20)`);
  } catch (e) {
    e2 = e;
  }
  const ms1 = Date.now() - t1;
  check(
    "la corta Postgres con 57014, no nuestro reloj",
    codigoPg(e2) === "57014",
    `code=${codigoPg(e2)} name=${nombreDe(e2)} en ${ms1}ms`,
  );
  check("no es QueryTimeoutError (nuestro reloj no ganó)", comoTimeout(e2) === null);
  check("cortó cerca de los 10s, no de los 12", ms1 > 8_000 && ms1 < 11_500, `${ms1}ms`);
  check("la conexión sigue usable después del 57014", num((await q(sql`select 42::int as n`))[0].n) === 42);

  // ── 3. Contención: las que esperan turno NO deben cerrar el socket ──────
  console.log("\n3) 5 queries lentas con max:3 → las que esperan turno");
  const antes3 = await conexionesAbiertas();
  const res = await Promise.allSettled(
    Array.from({ length: 5 }, () => q(sql`select pg_sleep(9)`)),
  );
  const fases = res.map((r) => {
    if (r.status === "fulfilled") return "ok";
    const t = comoTimeout(r.reason);
    return t ? `timeout:${t.phase}` : `pg:${codigoPg(r.reason) ?? nombreDe(r.reason)}`;
  });
  console.log(`     ${JSON.stringify(fases)}`);
  check(
    "las que esperan mueren en fase 'pipeline', no 'ejecucion'",
    !fases.includes("timeout:ejecucion"),
    "'ejecucion' cerraría el socket y mataría a las hermanas sanas",
  );
  check(
    "al menos 3 corren en paralelo de verdad (max:3)",
    fases.filter((f) => f === "ok").length >= 3,
    JSON.stringify(fases),
  );
  check("el pool sobrevive la contención", num((await q(sql`select 1::int as n`))[0].n) === 1);
  console.log(`     conexiones al server: ${antes3} → ${await conexionesAbiertas()}`);

  // ── 4. Que el error diga la fase y el intento REAL ──────────────────────
  //     Antes reportaba siempre "1 intento(s)", así que desde los logs de
  //     Vercel era imposible ver que el reintento nunca funcionaba.
  console.log("\n4) Mensajes de error");
  const e4 = new QueryTimeoutError("cola", 6_000, 2);
  check("dice la fase", e4.message.includes("EN COLA"), e4.message.slice(0, 58) + "…");
  check("dice el intento real", e4.message.includes("intento 2"));
  check("expone .phase", e4.phase === "cola");

  // ── 5. Socket muerto: EL ÚNICO caso que debe cerrar la conexión ─────────
  //     SIGSTOP al server: la query se escribe al socket y postgres.js la marca
  //     `active` del lado del cliente, pero no llega ni la respuesta ni el
  //     57014 porque el server no corre. Ése es el socket muerto de verdad.
  console.log("\n5) Server congelado (SIGSTOP) → socket muerto");
  await q(sql`select 1::int as n`); // pool caliente
  const congelados = await backendPids();
  senal("-STOP", congelados);

  // (a) Una sentencia que NO es select: isReadOnly da false, así que no se
  //     reintenta y el error llega crudo. Sirve para OBSERVAR la fase.
  let e5: unknown = null;
  const t5 = Date.now();
  try {
    await q(sql`create temp table t_probe (x int)`);
  } catch (e) {
    e5 = e;
  }
  const ms5 = Date.now() - t5;
  const t5err = comoTimeout(e5);
  check(
    "vence en fase 'ejecucion' (la única que cierra el socket)",
    t5err?.phase === "ejecucion",
    `${nombreDe(e5)}/${t5err?.phase ?? "-"} en ${ms5}ms`,
  );
  check("vence con el reloj de ejecución (12s)", ms5 > 11_000 && ms5 < 15_000, `${ms5}ms`);
  check("no se reintenta una escritura", (t5err?.message ?? "").includes("intento 1"));

  // (b) LA REGRESIÓN DEL BUG DEL CLOSURE. Acá el cliente ya lo cerró
  //     discardPoisonedConnection. Con el cliente capturado en el closure,
  //     todo lo que viniera después rebotaba en 0ms con CONNECTION_ENDED
  //     (postgres.js: `if (ending) return query.reject(...)`, y `ending` no se
  //     resetea nunca). Con el getter, resuelve el cliente NUEVO.
  senal("-CONT", congelados);
  const revive = await q(sql`select 7::int as n, pg_backend_pid() as pid`);
  check("la app se recupera sola tras el descarte", num(revive[0].n) === 7);
  check(
    "y lo hace sobre una conexión NUEVA",
    !congelados.includes(num(revive[0].pid)),
    `pid ${revive[0].pid} vs los congelados ${JSON.stringify(congelados)}`,
  );

  console.log(fallas === 0 ? "\n✔ TODO PASA\n" : `\n✘ ${fallas} FALLA(S)\n`);
  process.exit(fallas === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error("El test explotó:", e);
  process.exit(1);
});
