-- ════════════════════════════════════════════════════════════════════════════
-- CHEQUEO DE SALUD de los planes — diagnóstico READ-ONLY, no escribe nada.
-- ════════════════════════════════════════════════════════════════════════════
--
-- Devuelve UNA FILA POR CONTROL, siempre las 7, aunque den 0. Eso es a
-- propósito: si sólo se listaran los que fallan, no habría forma de distinguir
-- "no hay problema" de "el control no corrió".
--
-- Columna `casos` = cuántos planes caen en cada
-- control. Todo en 0 en REVISAR = está sano.
--
-- Los niveles:
--   REVISAR   → algo que no debería poder pasar. Mirar sí o sí.
--   ATENCION  → no rompe nada, pero conviene saberlo.
--   INFO      → contexto, sin acción.
--
-- Los controles de tráfico (adsets, ads, tipos de ad) se sacaron cuando la
-- sección Tráfico salió de la app — ver db/drop-plan-traffic.sql.
--
-- Validado contra un Postgres 16 local con un fixture de planes sembrados con
-- problemas a propósito: cada problema aparece en el control que le toca.
--
-- CÓMO CORRERLO: pegar entero en el SQL Editor de Supabase.
-- ════════════════════════════════════════════════════════════════════════════

with plan_base as (
  select p.id, p.name, p.status::text as status, p.created_at,
         pr.client_id, pr.code as project_code
    from public.media_plans p
    join public.projects pr on pr.id = p.project_id
   where p.deleted_at is null
),
-- Período derivado de los placements + cantidad de placements
plan_period as (
  select b.id,
         min(pl.start_date) as period_start,
         max(pl.end_date)   as period_end,
         count(pl.id)       as placements
    from plan_base b
    left join public.media_plan_publishers mp on mp.media_plan_id = b.id
    left join public.media_plan_placements pl on pl.media_plan_publisher_id = mp.id
   group by b.id
),
plan_billing as (
  select media_plan_id as id, min(month) as first_month, max(month) as last_month
    from public.plan_billings group by media_plan_id
),
plan as (
  select b.*, pp.period_start, pp.period_end, pp.placements,
         pb.first_month, pb.last_month
    from plan_base b
    join plan_period pp on pp.id = b.id
    left join plan_billing pb on pb.id = b.id
),
-- Catálogo de controles: se listan TODOS, aunque den 0, para que se vea que
-- cada uno corrió y no confundir "no hay problema" con "no se chequeó".
controles (orden, nivel, control) as (values
  ( 1, 'REVISAR',  'Status fuera del lifecycle que conoce el codigo'),
  ( 2, 'REVISAR',  'Planes firmados o live SIN ningun placement'),
  (21, 'ATENCION', 'live cuyo periodo termino hace mas de 60 dias: candidato a Marcar terminada'),
  (22, 'ATENCION', 'Planes sin fechas Y sin billing: caen en el anio actual del filtro'),
  (23, 'ATENCION', 'Tarifa en metrics_json con un slug que no esta en el catalogo del cliente'),
  (30, 'INFO',     'Historicos sin placements con billing que NO estan en finished'),
  (31, 'INFO',     'Planes ubicados en el tiempo por su billing (sin fechas de placement)')
),
hits (orden, quien) as (
  select 1, name from plan
   where status not in ('draft','ready_to_send','approved','qa_done','live','finished','archived')
  union all select 2, name from plan where placements = 0 and status in ('approved','qa_done','live')
  union all select 21, name from plan
   where status = 'live' and period_end is not null and period_end < current_date - 60
  union all select 22, name from plan
   where period_start is null and period_end is null and first_month is null
     and status <> 'archived'
  union all select 23, name from plan p2
   where exists (
     select 1
       from public.media_plan_publishers mp
       join public.media_plan_placements pl on pl.media_plan_publisher_id = mp.id
       cross join lateral jsonb_object_keys(coalesce(pl.metrics_json, '{}'::jsonb)) as k(key)
      where mp.media_plan_id = p2.id
        and not exists (select 1 from public.metrics_catalog mc
                         where mc.client_id = p2.client_id and mc.slug = k.key))
  union all select 30, name from plan
   where placements = 0 and first_month is not null and status <> 'finished'
  union all select 31, name || ' (' || first_month || '..' || last_month || ')' from plan
   where period_start is null and period_end is null and first_month is not null
)
select c.nivel,
       count(h.quien)                                              as casos,
       c.control,
       left(string_agg(h.quien, ', ' order by h.quien), 110)        as ejemplos
  from controles c
  left join hits h on h.orden = c.orden
 group by c.orden, c.nivel, c.control
 order by c.orden;
