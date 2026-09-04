/**
 * Chequeo del modo solo lectura — `npm run check:read-only`.
 *
 * La app tiene tres barreras para que una sesión de auditoría (o un usuario con
 * rol Viewer) no pueda escribir nada. Dos se sostienen solas:
 *
 *   1. el proxy sólo la deja pasar en GET, y los Server Actions van por POST
 *      (`lib/supabase/middleware.ts`, cubierto por `npm run check:audit`);
 *   3. la UI apaga y explica los controles marcados.
 *
 * La segunda —`assertCanWrite()` al principio de cada action que escribe— es la
 * única que depende de que alguien se acuerde. Este script la controla: recorre
 * `app/actions/*.ts`, encuentra cada función exportada, decide si escribe y
 * verifica que el guard esté Y que esté ANTES de tocar la base.
 *
 * Falla si:
 *   • una función que escribe no tiene `assertCanWrite()`;
 *   • lo tiene, pero después de la primera consulta a la base (ahí ya pudo
 *     filtrar información o disparar un efecto);
 *   • una función de sólo lectura lo tiene de más (ruido: cuesta una consulta
 *     de rol por llamada y confunde sobre qué escribe y qué no).
 *
 * Es análisis estático a propósito: no necesita DB, ni app levantada, ni env.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ACTIONS_DIR = join(process.cwd(), "app", "actions");

// Cómo se reconoce una escritura. `db.insert/update/delete/transaction` cubre
// todo lo que hace Drizzle en este repo; `recordAudit` no cuenta por sí solo
// (una lectura no lo llama, pero tampoco es la escritura en sí).
const WRITE_RX = /\bdb\s*\.\s*(insert|update|delete|transaction)\b/;
// Cualquier toque a la base, para saber dónde empieza el trabajo real.
const DB_TOUCH_RX = /\bdb\s*\.\s*\w+/;
const GUARD_RX = /const\s+denied\s*=\s*await\s+assertCanWrite\s*\(\s*\)\s*;/;
const GUARD_RETURN_RX = /if\s*\(\s*denied\s*\)\s*return\s+denied\s*;/;

type Fn = { name: string; body: string; exported: boolean };

// Extrae cada `export async function NAME(...) { ... }` de nivel superior.
//
// El detalle que hay que tener en cuenta: la primera `{` después del nombre NO
// es el cuerpo. Casi todas estas actions reciben un objeto —
// `createMarket(input: { clientId: string })`— y varias declaran un retorno
// genérico con llaves —`: Promise<Result<{ id: string }>>`—. Así que primero
// se cierra el paréntesis de los parámetros y después se busca la `{` que esté
// fuera de todo `<...>`: ésa es la del cuerpo.
function bodyStart(src: string, afterOpenParen: number): number {
  let paren = 1;
  let i = afterOpenParen;
  for (; i < src.length && paren > 0; i++) {
    if (src[i] === "(") paren++;
    else if (src[i] === ")") paren--;
  }
  // Ojo con el tipo de retorno: `Promise<Result<{ id: string }>>` trae llaves
  // Y punto y coma adentro. Hay que llevar las dos profundidades para no
  // confundir esa `{` con la del cuerpo ni ese `;` con un final de declaración.
  let angle = 0;
  let brace = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "<") angle++;
    else if (c === ">") angle = Math.max(0, angle - 1);
    else if (c === "{") {
      if (angle === 0 && brace === 0) return i;
      brace++;
    } else if (c === "}") brace = Math.max(0, brace - 1);
    else if (c === ";" && angle === 0 && brace === 0) return -1;
  }
  return -1;
}

// Se levantan TODAS las funciones del módulo, exportadas o no: varias actions
// no escriben en su propio cuerpo sino a través de un helper local del archivo
// (`applyBillingUpdate` en plan-billing.ts es el caso). Sin eso, se las
// clasificaría como de sólo lectura y el chequeo miraría para otro lado
// justo donde importa.
function topLevelFunctions(src: string): Fn[] {
  const out: Fn[] = [];
  const rx = /(export\s+)?async\s+function\s+([A-Za-z0-9_]+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(src)) !== null) {
    const open = bodyStart(src, rx.lastIndex);
    if (open === -1) continue;
    let depth = 0;
    let i = open;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push({ name: m[2], body: src.slice(open, i + 1), exported: !!m[1] });
  }
  return out;
}

let problems = 0;
let writers = 0;
let readers = 0;

function fail(file: string, fn: string, msg: string) {
  problems++;
  console.log(`  FALLA  ${file} · ${fn}\n         ${msg}`);
}

const files = readdirSync(ACTIONS_DIR)
  .filter((f) => f.endsWith(".ts"))
  .sort();

console.log("Guard de escritura en las server actions\n");

for (const file of files) {
  const src = readFileSync(join(ACTIONS_DIR, file), "utf8");
  const fns = topLevelFunctions(src);
  const importsGuard = src.includes(
    'import { assertCanWrite } from "@/lib/read-only"',
  );

  // Propagación: una función escribe si lo hace ella misma o si llama a otra
  // del mismo archivo que escribe. Se itera hasta que deja de cambiar.
  const writesSet = new Set(
    fns.filter((f) => WRITE_RX.test(f.body)).map((f) => f.name),
  );
  for (let pass = 0; pass < fns.length; pass++) {
    let grew = false;
    for (const fn of fns) {
      if (writesSet.has(fn.name)) continue;
      for (const other of fns) {
        if (other.name === fn.name || !writesSet.has(other.name)) continue;
        if (new RegExp(`\\b${other.name}\\s*\\(`).test(fn.body)) {
          writesSet.add(fn.name);
          grew = true;
          break;
        }
      }
    }
    if (!grew) break;
  }

  for (const fn of fns) {
    if (!fn.exported) continue;
    const writes = writesSet.has(fn.name);
    const hasGuard = GUARD_RX.test(fn.body) && GUARD_RETURN_RX.test(fn.body);

    if (writes) {
      writers++;
      if (!hasGuard) {
        fail(
          file,
          fn.name,
          "escribe en la base y no llama a assertCanWrite(). Agregá al principio del cuerpo:\n         const denied = await assertCanWrite();\n         if (denied) return denied;",
        );
        continue;
      }
      // El guard tiene que estar ANTES del primer toque a la base.
      const guardAt = fn.body.search(GUARD_RX);
      const dbAt = fn.body.search(DB_TOUCH_RX);
      if (dbAt !== -1 && guardAt > dbAt) {
        fail(
          file,
          fn.name,
          "tiene el guard DESPUÉS de la primera consulta a la base. Tiene que ser la primera sentencia del cuerpo.",
        );
      }
    } else {
      readers++;
      if (hasGuard) {
        fail(
          file,
          fn.name,
          "es de sólo lectura y tiene assertCanWrite() de más: cuesta una consulta de rol por llamada y confunde sobre qué escribe.",
        );
      }
    }
  }

  const fileWrites = fns.some((f) => f.exported && writesSet.has(f.name));
  if (fileWrites && !importsGuard) {
    fail(file, "(archivo)", "tiene actions que escriben y no importa assertCanWrite.");
  }
}

console.log(
  `\n${writers} actions que escriben · ${readers} de sólo lectura · ${files.length} archivos`,
);
console.log(
  problems === 0
    ? "Todo en orden."
    : `\n${problems} problema(s). Ver lib/read-only.ts.`,
);
process.exit(problems === 0 ? 0 : 1);
