<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Las queries se entregan EN EL CHAT, para copy-paste (regla dura)

> **Sin excepciones, y vale para TODA query que haya que correr en Supabase:**
> migración, backfill, corrección de datos, diagnóstico o control. Va **pegada
> en la respuesta del chat**, en un bloque ```sql listo para copiar y pegar en
> el SQL Editor. Dejarla en un archivo y nombrarlo NO cuenta como entregarla.
> El dueño del repo la corre a mano: si no está en el chat, no existe.

En este proyecto **nadie aplica cambios a Supabase por su cuenta**: los corre el
dueño del repo a mano, en el SQL Editor. Toda migración, backfill, corrección de
datos o query de diagnóstico se entrega **pegada en la respuesta del chat**, en
un bloque ```sql listo para copiar — no alcanza con dejarla en un archivo de
`db/` y avisar que está ahí, ni con decir el nombre del archivo.

Cómo entregarlas:

- **En el chat, completa.** El archivo en `db/*.sql` se sigue commiteando (es el
  registro), pero la copia del chat es la que se usa. Si son largas, se puede
  recortar el comentario de cabecera, nunca el SQL.
- **Separá la migración de la verificación** en dos bloques: el SQL Editor
  muestra el resultado del último statement, así que los `select` de control van
  aparte para poder verlos.
- **Decí qué tiene que devolver** la verificación para considerarla exitosa.
- **Nunca las apliques vos** — ni con el MCP de Supabase ni de ninguna otra
  forma. Tampoco `db:push` ni `db:migrate` contra prod.
- **Probalas antes de entregarlas.** Hay un Postgres 16 local en el contenedor
  (`/usr/lib/postgresql/16/bin`); ver el gotcha de `initdb` en HANDOFF. Ya pasó
  una vez que una migración sin probar rebotó con un error de sintaxis.
- **Hacelas idempotentes** (`if not exists`, `do $$ ... end $$` sobre
  `pg_constraint` / `pg_type`) para que se puedan recorrer si algo se corta.
- **Si el código depende de la migración, decilo con todas las letras**: qué se
  rompe si se deploya el código sin correr el SQL, y en qué orden va cada cosa.

# La documentación SIEMPRE tiene que estar al día (regla dura)

En este proyecto, mantener la documentación actualizada NO es opcional: es
parte de "terminar" cualquier cambio. `README.md`, `HANDOFF.md` y este
`AGENTS.md` deben reflejar siempre el estado real del código y de prod. Si
tocás algo que un doc ya describe (schema, convenciones, estructura, issues,
acciones de prod), actualizá el doc en la misma sesión — nunca dejes la
documentación desincronizada del código.

## Doc upkeep on merges to main

Whenever a change is merged to `main`, update the documentation in the same
session so the repo reflects the new state. Concretely:

- Update `HANDOFF.md` with the new commit in "Commits recientes" and a brief
  bullet under "Cambios de la sesión" describing what changed and why.
- Update `README.md` if the change touches:
  - Schema (`db/schema.ts`), conventions in "Arquitectura: convenciones clave",
    or any pattern the existing docs already document.
  - The project tree under "Estructura del proyecto" (new files/folders).
  - Anything in "Issues conocidos / a resolver" that gets resolved or scoped.
- Add a row to HANDOFF's "Donde están las cosas" table when a new area
  becomes a likely place future sessions will need to touch.
- If the change requires a runtime action in prod (db migration, seed,
  manual SQL), call it out explicitly in HANDOFF.

Push the doc update on a fresh feature branch and merge via PR (do not commit
docs directly to main).

# Los exports a Excel espejan la pantalla (regla dura)

Todo export a Excel (y a PDF) tiene que mostrar TODO lo que se ve en la pantalla
desde donde se descarga: si un dato o desglose es visible en la vista —incluida
la data detrás de desplegables/expandibles— tiene que estar también en el
archivo. El export es un espejo descargable de la vista, nunca un subconjunto.
Al tocar una vista con export (o su export), verificá la paridad
pantalla↔archivo en la misma sesión y sumá las columnas/hojas que falten.

Ejemplo (tab Estimación): la vista muestra estimado y **facturado real** con su
desglose media/fees/bruto y, en el desplegable de cada proyecto, la proyección
por plan (facturas emitidas + lo que falta por mes). El Excel replica todo eso
en tres hojas (Resumen · Detalle · Proyección) —
`lib/portal-estimate-xlsx.ts`.

Ejemplo (detalle del plan): el historial de versiones se despliega por versión y
muestra qué cambió contra la anterior; el Excel del plan lo replica en la hoja
"Historial de versiones" — `buildVersionHistorySheet` en
`app/api/plans/[planId]/export.xlsx/route.ts`.

**Única excepción — el PDF del plan**: es el documento que se manda al cliente a
firmar (bloque de firma + disclaimer legal), no una copia de la pantalla. El
proceso interno (historial de versiones, QA) va al Excel y **no** al PDF. La
regla de paridad sigue aplicando a todo lo demás.
