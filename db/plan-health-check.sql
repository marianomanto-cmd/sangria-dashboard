-- ════════════════════════════════════════════════════════════════════════════
-- CHEQUEO DE SALUD de los planes — diagnóstico READ-ONLY, no escribe nada.
-- ════════════════════════════════════════════════════════════════════════════
--
-- Devuelve UNA FILA POR CONTROL, siempre las 14, aunque den 0. Eso es a
-- propósito: si sólo se listaran los que fallan, no habría forma de distinguir
-- "no hay problema" de "el control no corrió".
--
-- Columna `casos` = cuántos planes (o clientes, en el control 3) caen en cada
-- control. Todo en 0 en REVISAR y BLOQUEA = está sano.
--
-- Los niveles:
--   REVISAR   → algo que no debería poder pasar. Mirar sí o sí.
--   BLOQUEA   → el plan no va a poder avanzar de estado hasta arreglarlo.
--               Son los gates de tráfico (adsets → Listo para enviar,
--               ads → cerrar el QA), ver lib/plan-traffic.ts.
--   ATENCION  → no rompe nada, pero conviene saberlo.
--   INFO      → contexto, sin acción.
--
-- Las reglas de completitud espejan lib/plan-traffic.ts. Si esa regla cambia,
-- este archivo hay que actualizarlo también.
--
-- Validado contra un Postgres 16 local con un fixture de 10 planes sembrados
-- con problemas a propósito: los 14 controles corren y cada problema aparece
-- en el control que le corresponde.
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
-- Adsets y ads del plan, con su completitud (espejo de lib/plan-traffic.ts)
adset_roll as (
  select b.id,
         count(distinct s.id) as adsets,
         count(distinct s.id) filter (where
            s.audience is null or btrim(s.audience) = ''
         or s.budget_usd is null or s.budget_usd <= 0
         or s.creative_pillar is null or btrim(s.creative_pillar) = ''
         or s.start_date is null or s.end_date is null
         or s.end_date < s.start_date) as adsets_incompletos,
         count(distinct s.id) filter (where a.id is null) as adsets_sin_ads,
         count(a.id) as ads,
         count(a.id) filter (where
            a.ad_type_id is null
         or (t.requires_detail and (a.ad_type_other is null or btrim(a.ad_type_other) = ''))
         or a.creative_url is null or btrim(a.creative_url) = ''
         or a.copy        is null or btrim(a.copy) = ''
         or a.headline    is null or btrim(a.headline) = ''
         or a.subheadline is null or btrim(a.subheadline) = ''
         or a.click_url   is null or btrim(a.click_url) = ''
         or a.landing_url is null or btrim(a.landing_url) = '') as ads_incompletos,
         count(a.id) filter (where a.loaded_at is null) as ads_sin_cargar,
         count(a.id) filter (where t.id is not null and t.client_id <> b.client_id) as ads_tipo_ajeno
    from plan_base b
    left join public.media_plan_publishers    mp on mp.media_plan_id = b.id
    left join public.media_plan_placements    pl on pl.media_plan_publisher_id = mp.id
    left join public.media_plan_traffic_briefs br on br.placement_id = pl.id
    left join public.media_plan_traffic_adsets s  on s.brief_id = br.id
    left join public.media_plan_traffic_ads    a  on a.adset_id = s.id
    left join public.ad_types                  t  on t.id = a.ad_type_id
   group by b.id, b.client_id
),
plan as (
  select b.*, pp.period_start, pp.period_end, pp.placements,
         pb.first_month, pb.last_month,
         ar.adsets, ar.adsets_incompletos, ar.adsets_sin_ads,
         ar.ads, ar.ads_incompletos, ar.ads_sin_cargar, ar.ads_tipo_ajeno
    from plan_base b
    join plan_period pp on pp.id = b.id
    join adset_roll  ar on ar.id = b.id
    left join plan_billing pb on pb.id = b.id
),
-- Catálogo de controles: se listan TODOS, aunque den 0, para que se vea que
-- cada uno corrió y no confundir "no hay problema" con "no se chequeó".
controles (orden, nivel, control) as (values
  ( 1, 'REVISAR',  'Ads con un tipo de ad de OTRO cliente (la FK no lo valida)'),
  ( 2, 'REVISAR',  'Status fuera del lifecycle que conoce el codigo'),
  ( 3, 'REVISAR',  'Clientes sin tipos de ad habilitados (el desplegable del AM/PM queda vacio)'),
  ( 4, 'REVISAR',  'Planes firmados o live SIN ningun placement'),
  (10, 'BLOQUEA',  'draft con placements pero SIN adsets: no puede pasar a Listo para enviar'),
  (11, 'BLOQUEA',  'draft con adsets incompletos: no puede pasar a Listo para enviar'),
  (12, 'BLOQUEA',  'approved/qa_done con adsets SIN ads: no puede cerrar el QA'),
  (13, 'BLOQUEA',  'approved/qa_done con ads incompletos: no puede cerrar el QA'),
  (20, 'ATENCION', 'live con ads sin marcar como cargados (pasaron a live antes de la regla)'),
  (21, 'ATENCION', 'live cuyo periodo termino hace mas de 60 dias: candidato a Marcar terminada'),
  (22, 'ATENCION', 'Planes sin fechas Y sin billing: caen en el anio actual del filtro'),
  (23, 'ATENCION', 'Tarifa en metrics_json con un slug que no esta en el catalogo del cliente'),
  (30, 'INFO',     'Historicos sin placements con billing que NO estan en finished'),
  (31, 'INFO',     'Planes ubicados en el tiempo por su billing (sin fechas de placement)')
),
hits (orden, quien) as (
  select 1, name from plan where ads_tipo_ajeno > 0
  union all select 2, name from plan
   where status not in ('draft','ready_to_send','approved','qa_done','live','finished','archived')
  union all select 3, c.name from public.clients c
   where not exists (select 1 from public.ad_types t where t.client_id = c.id and t.enabled)
  union all select 4, name from plan where placements = 0 and status in ('approved','qa_done','live')
  union all select 10, name from plan where status = 'draft' and placements > 0 and adsets = 0
  union all select 11, name from plan where status = 'draft' and adsets_incompletos > 0
  union all select 12, name from plan where status in ('approved','qa_done') and adsets_sin_ads > 0
  union all select 13, name from plan where status in ('approved','qa_done') and ads_incompletos > 0
  union all select 20, name from plan where status = 'live' and ads_sin_cargar > 0
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
