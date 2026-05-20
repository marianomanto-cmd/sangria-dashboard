<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

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
