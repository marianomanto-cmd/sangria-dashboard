/**
 * Chequeo de la sesión de auditoría — `npm run check:audit`.
 *
 * La sesión de auditoría abre la app interna ENTERA a alguien de afuera, así
 * que el cookie va firmado y el proxy verifica esa firma en cada request. Todo
 * eso vive en `lib/audit-session.ts`, un módulo puro (sin DB, sin next/headers)
 * justamente para poder correrlo así, sin levantar la app.
 *
 * Lo que se controla acá es lo que rompería la garantía:
 *   1. un token recién emitido verifica;
 *   2. un token vencido NO verifica;
 *   3. un token con la firma tocada NO verifica;
 *   4. un token con el vencimiento estirado NO verifica (la fecha está DENTRO
 *      de lo firmado, no al lado);
 *   5. un token firmado con otro secreto NO verifica;
 *   6. sin secreto no se emite ni se acepta nada (falla cerrado);
 *   7. sólo GET/HEAD/OPTIONS pasan — que es lo que cierra toda escritura, ya
 *      que los Server Actions van por POST.
 */

const SECRET_A = "un-secreto-de-prueba-suficientemente-largo";
const SECRET_B = "otro-secreto-de-prueba-distinto-y-largo!!";

let failures = 0;

function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FALLA ${name}`);
  }
}

async function main() {
  // El módulo lee el secreto de process.env en cada llamada, así que alcanza con
  // setearlo antes de importar y cambiarlo entre casos.
  process.env.AUDIT_SESSION_SECRET = SECRET_A;
  delete process.env.DATABASE_URL;

  const {
    mintAuditToken,
    verifyAuditToken,
    auditMethodAllowed,
    isAuditLoginEnabled,
    AUDIT_SESSION_DAYS,
  } = await import("../lib/audit-session");

  const NOW = 1_800_000_000_000; // fijo, para que el chequeo sea determinístico
  const DAY = 24 * 60 * 60 * 1000;

  console.log("Sesión de auditoría\n");

  const token = await mintAuditToken(NOW);
  check("emite un token con secreto presente", typeof token === "string" && !!token);
  check("el login queda habilitado", isAuditLoginEnabled() === true);

  check("token recién emitido verifica", await verifyAuditToken(token, NOW));
  check(
    "sigue válido dentro de la ventana",
    await verifyAuditToken(token, NOW + (AUDIT_SESSION_DAYS - 1) * DAY),
  );
  check(
    "vencido NO verifica",
    !(await verifyAuditToken(token, NOW + (AUDIT_SESSION_DAYS + 1) * DAY)),
  );

  // Firma alterada: se cambia el último caracter.
  const tampered = token!.slice(0, -1) + (token!.slice(-1) === "A" ? "B" : "A");
  check("firma alterada NO verifica", !(await verifyAuditToken(tampered, NOW)));

  // Vencimiento estirado conservando la firma original.
  const [exp, sig] = token!.split(".");
  const stretched = `${Number(exp) + 365 * DAY}.${sig}`;
  check(
    "vencimiento estirado NO verifica",
    !(await verifyAuditToken(stretched, NOW)),
  );

  check("token vacío NO verifica", !(await verifyAuditToken("", NOW)));
  check("token sin punto NO verifica", !(await verifyAuditToken("abc", NOW)));
  check("token sin firma NO verifica", !(await verifyAuditToken(`${exp}.`, NOW)));
  check(
    "exp no numérico NO verifica",
    !(await verifyAuditToken(`abc.${sig}`, NOW)),
  );

  // Otro secreto: el token de A no puede verificar bajo B.
  process.env.AUDIT_SESSION_SECRET = SECRET_B;
  check("token de otro secreto NO verifica", !(await verifyAuditToken(token, NOW)));

  // Sin secreto de ningún tipo: falla cerrado en las dos direcciones.
  delete process.env.AUDIT_SESSION_SECRET;
  delete process.env.DATABASE_URL;
  check("sin secreto no se emite", (await mintAuditToken(NOW)) === null);
  check("sin secreto no se acepta", !(await verifyAuditToken(token, NOW)));
  check("sin secreto el login queda deshabilitado", isAuditLoginEnabled() === false);

  // Fallback a DATABASE_URL cuando no hay var explícita.
  process.env.DATABASE_URL = SECRET_A;
  check("cae a DATABASE_URL como secreto", isAuditLoginEnabled() === true);
  check(
    "y el token emitido con esa clave verifica",
    await verifyAuditToken(await mintAuditToken(NOW), NOW),
  );

  // Un secreto demasiado corto no cuenta como secreto.
  process.env.AUDIT_SESSION_SECRET = "corto";
  delete process.env.DATABASE_URL;
  check("un secreto corto no habilita nada", isAuditLoginEnabled() === false);

  console.log("\nMétodos que deja pasar el proxy");
  for (const m of ["GET", "HEAD", "OPTIONS", "get"]) {
    check(`${m} pasa`, auditMethodAllowed(m));
  }
  for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
    check(`${m} NO pasa (así se cierran los Server Actions)`, !auditMethodAllowed(m));
  }

  console.log(
    failures === 0
      ? "\nTodo en orden."
      : `\n${failures} chequeo(s) fallaron.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
