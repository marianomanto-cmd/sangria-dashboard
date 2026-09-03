-- ════════════════════════════════════════════════════════════════════════════
-- CONTROL (read-only): la estructura completa de la base, tal como está HOY.
--
-- No escribe nada. Se corre en el SQL Editor de Supabase, UN BLOQUE POR VEZ
-- (el editor sólo muestra el resultado del último statement).
--
-- Creado el 03/sep/2026 para diagnosticar las caídas de dashboard, billing
-- tracker y calendario de reportes ("No se pudo leer la base"). Los bloques 1
-- a 4 son la foto de la estructura; los bloques 5 a 8 son medición, y los que
-- hay que correr MIENTRAS la app está caída.
--
-- Probado contra el Postgres 16 local del contenedor antes de entregarse.
-- ════════════════════════════════════════════════════════════════════════════


-- ── BLOQUE 1 · Tablas y columnas ────────────────────────────────────────────
-- Una fila por tabla, con todas sus columnas, tipos, NOT NULL y DEFAULT.
-- Sirve para contrastar contra db/schema.ts y detectar drift.

select
  c.relname                                        as tabla,
  count(*)                                         as columnas,
  string_agg(
    a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
      || case when a.attnotnull then ' NOT NULL' else '' end
      || coalesce(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), ''),
    e' | ' order by a.attnum
  )                                                as definicion
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
group by c.relname
order by c.relname;


-- ── BLOQUE 2 · Constraints, índices, RLS y tamaño ───────────────────────────
-- `filas_aprox = -1` significa que la tabla nunca fue analizada (no que esté
-- vacía). El conteo real está en el bloque 5.

select
  c.relname                                          as tabla,
  pg_size_pretty(pg_total_relation_size(c.oid))      as tamano,
  c.reltuples::bigint                                as filas_aprox,
  c.relrowsecurity                                   as rls,
  (select count(*) from pg_policy p where p.polrelid = c.oid) as policies,
  coalesce((
    select string_agg(k.conname || ': ' || pg_get_constraintdef(k.oid), e' | ' order by k.contype, k.conname)
    from pg_constraint k where k.conrelid = c.oid
  ), '—')                                            as constraints,
  coalesce((
    select string_agg(i.indexname || ': ' || i.indexdef, e' | ' order by i.indexname)
    from pg_indexes i where i.schemaname = 'public' and i.tablename = c.relname
  ), '—')                                            as indices
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by pg_total_relation_size(c.oid) desc, c.relname;


-- ── BLOQUE 3 · Enums, vistas, triggers, funciones, extensiones ──────────────

select 'enum' as tipo, t.typname as nombre,
       string_agg(e.enumlabel, ', ' order by e.enumsortorder) as detalle
  from pg_type t
  join pg_enum e on e.enumtypid = t.oid
  join pg_namespace n on n.oid = t.typnamespace
 where n.nspname = 'public'
 group by t.typname
union all
select 'vista', c.relname,
       case c.relkind when 'm' then 'materializada' else 'normal' end
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('v', 'm')
union all
select 'trigger', t.tgname, c.relname || ' -> ' || p.proname
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_proc p on p.oid = t.tgfoid
 where n.nspname = 'public' and not t.tgisinternal
union all
select 'funcion', p.proname, pg_get_function_identity_arguments(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
union all
select 'extension', e.extname, e.extversion
  from pg_extension e
union all
select 'secuencia', c.relname, ''
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'S'
order by 1, 2;


-- ── BLOQUE 4 · Foreign keys SIN índice ──────────────────────────────────────
-- Postgres NO crea índices para las FK. Sin ellos, cada join de los que hace
-- el dashboard es un seq scan. La columna `sugerencia` trae el DDL listo.
-- Devuelve 0 filas si no falta ninguno.

select
  con.conrelid::regclass::text                         as tabla,
  con.conname                                          as fk,
  a.attname                                            as columna_1,
  pg_size_pretty(pg_total_relation_size(con.conrelid)) as tamano_tabla,
  'create index if not exists idx_' || con.conrelid::regclass::text || '_' || a.attname
    || ' on public.' || quote_ident(con.conrelid::regclass::text)
    || ' (' || quote_ident(a.attname) || ');'          as sugerencia
from pg_constraint con
join lateral unnest(con.conkey) with ordinality as k(attnum, ord) on k.ord = 1
join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
where con.contype = 'f'
  and con.connamespace = 'public'::regnamespace
  and not exists (
    select 1 from pg_index i
     where i.indrelid = con.conrelid
       and i.indkey[0] = k.attnum
  )
order by pg_total_relation_size(con.conrelid) desc, tabla;


-- ── BLOQUE 5 · Volumen real ─────────────────────────────────────────────────
-- Conteo exacto por tabla. Confirma o descarta que el problema sea el volumen.

select
  c.relname as tabla,
  (xpath('/row/c/text()',
         query_to_xml(format('select count(*) as c from public.%I', c.relname), false, true, '')
  ))[1]::text::bigint as filas,
  pg_size_pretty(pg_total_relation_size(c.oid)) as tamano
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by 2 desc, 1;


-- ── BLOQUE 6 · Salud en vivo (CORRER CON LA APP CAÍDA) ──────────────────────
-- El triage del README. Lee así:
--   activas_mas_30s > 0 o zombies_clientread > 0 → el pooler está tapado.
--   activas ~0 y query_activa_mas_vieja_seg ~0   → Postgres está OCIOSO: el
--     cuello está en Supavisor o en la red, no en la base.
--   cache_hit_pct < 95                           → recién ahí es I/O.
-- Ojo: pg_stat_activity ve las conexiones de Supavisor, NO las de la app.

select
  (select count(*) from pg_stat_activity where datname = current_database())                       as conexiones_total,
  (select count(*) from pg_stat_activity where datname = current_database() and state = 'active')  as activas,
  (select count(*) from pg_stat_activity where datname = current_database() and state = 'idle in transaction') as idle_in_tx,
  (select count(*) from pg_stat_activity
    where datname = current_database() and state = 'active'
      and now() - query_start > interval '30 seconds')                                             as activas_mas_30s,
  (select count(*) from pg_stat_activity where wait_event = 'ClientRead' and state = 'active')     as zombies_clientread,
  (select count(*) from pg_locks where not granted)                                                as esperando_lock,
  current_setting('max_connections')                                                               as max_connections,
  (select round(100.0 * sum(blks_hit) / nullif(sum(blks_hit) + sum(blks_read), 0), 1)
     from pg_stat_database where datname = current_database())                                     as cache_hit_pct,
  (select max(extract(epoch from now() - query_start))::int from pg_stat_activity
    where datname = current_database() and state = 'active')                                       as query_activa_mas_vieja_seg,
  pg_size_pretty(pg_database_size(current_database()))                                             as tamano_db;


-- ── BLOQUE 7 · Qué query se come el tiempo ──────────────────────────────────
-- Necesita pg_stat_statements (viene activada en Supabase). Si tira
-- "relation does not exist", saltear este bloque.
-- Es la única medición que distingue "la query es lenta" de "la query espera".

select
  round(total_exec_time)::bigint  as ms_total,
  calls,
  round(mean_exec_time)::bigint   as ms_promedio,
  round(max_exec_time)::bigint    as ms_peor,
  rows,
  left(query, 300)                as query
from pg_stat_statements
where dbid = (select oid from pg_database where datname = current_database())
order by total_exec_time desc
limit 20;


-- ── BLOQUE 8 · EXPLAIN de la query que rompe el dashboard ───────────────────
-- Es literalmente la que aparece en el error de /dashboard (DASH2[data]).
-- `Execution Time` acá es cuánto tarda la base SOLA, sin pooler de por medio.
-- Si da milisegundos, la query no es el problema: el problema es el transporte.

explain (analyze, buffers, timing)
select "projects"."id", "projects"."code", "projects"."name", "clients"."name", "clients"."slug",
       "projects"."status", "projects"."total_gross_budget_usd",
       coalesce(sum("plan_billing_publishers"."amount_real_usd"), 0),
       count(distinct "media_plans"."id")::int, "projects"."client_id"
  from "projects"
 inner join "clients" on "projects"."client_id" = "clients"."id"
  left join "media_plans" on ("media_plans"."project_id" = "projects"."id" and "media_plans"."deleted_at" is null)
  left join "plan_billings" on "plan_billings"."media_plan_id" = "media_plans"."id"
  left join "plan_billing_publishers" on "plan_billing_publishers"."plan_billing_id" = "plan_billings"."id"
 group by "projects"."id", "clients"."name", "clients"."slug"
 order by coalesce(sum("plan_billing_publishers"."amount_real_usd"), 0) desc;
