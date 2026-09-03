-- ════════════════════════════════════════════════════════════════════════════
-- Félix · plan "Félix Pago | Back to School" — mercado por línea (T1 / T2)
-- ════════════════════════════════════════════════════════════════════════════
--
-- CONTEXTO:
--   Las 18 líneas del plan estaban SIN MERCADO. No se pueden taggear por
--   estado: cada línea corre sobre TODOS los estados de su tier a la vez y el
--   presupuesto se distribuye entre ellos, mientras que
--   `media_plan_placements.market_id` es UNA sola FK (el dropdown "Mercado" del
--   editor es de un valor). El tier, entonces, es lo que hay que guardar:
--
--     T1 · Mercados Prioritarios → California, New York, New Jersey, Texas, Florida
--     T2 · Mercados Secundarios  → Arizona, Illinois, Colorado, North Carolina,
--                                  Georgia, Washington, Pennsylvania, New Mexico
--
--   Es el mismo patrón de agrupación que ya usa el catálogo para
--   "Centroamérica" o "LATAM": un mercado que son varios países/estados.
--   El desglose de estados sigue estando en la columna `audience` de las
--   líneas de CTV, y los 13 estados quedan cargados en el catálogo
--   (db/felix-markets-usa.sql) para el plan que sí se abra por estado.
--
-- QUÉ HACE:
--   1. Crea los mercados `estados-unidos-t1` / `estados-unidos-t2` en el
--      catálogo de Félix (idempotente; re-habilita sin pisar el `name`).
--   2. Setea `market_id` en las 18 líneas leyendo el T1/T2 del NOMBRE del
--      placement ("… | T1", "… | T1 | Félix Pago"). Sólo toca líneas con
--      `market_id is null`, así que no pisa nada asignado a mano y se puede
--      correr de nuevo.
--
--   El UPDATE resuelve el mercado con una subquery correlacionada en el SET y
--   deja la condición contra la tabla target en el WHERE: en `update ... from`,
--   referenciar el target desde el `ON` de un join da "invalid reference to
--   FROM-clause entry" (ver HANDOFF → gotchas de SQL).
--
-- OJO — el plan está LIVE v1:
--   • Esto NO crea una versión nueva ni toca el snapshot v1: el PDF que firmó
--     el cliente sigue mostrando lo que mostraba. Es un arreglo de data hacia
--     adelante, no una re-aprobación.
--   • Al correr por SQL no queda registro en `audit_log` (lo escriben las
--     server actions, no la DB).
--   • El QA no se invalida: sus checks son por `placement_id`, no por contenido.
--
-- CÓMO APLICAR: pegar los dos statements en el SQL Editor y ejecutarlos.
--   Después el bloque de VERIFICACIÓN.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.markets (client_id, slug, name, enabled, sort_order)
select c.id, v.slug, v.name, true,
       coalesce((select max(m.sort_order) from public.markets m
                  where m.client_id = c.id), -1) + v.ord
  from public.clients c
 cross join (values
     ('estados-unidos-t1', 'Estados Unidos - T1', 1),
     ('estados-unidos-t2', 'Estados Unidos - T2', 2)
   ) as v(slug, name, ord)
 where c.slug = 'felix'
 on conflict on constraint markets_client_slug_uq do update set enabled = true;

update public.media_plan_placements pl
   set market_id = (
         select m.id
           from public.markets m
           join public.clients c2 on c2.id = m.client_id
          where c2.slug = 'felix'
            and m.slug = case
                  when pl.placement_name ~ '\|\s*T1(\s|$)' then 'estados-unidos-t1'
                  else 'estados-unidos-t2'
                end)
  from public.media_plan_publishers mpp
  join public.media_plans mp on mp.id = mpp.media_plan_id
  join public.projects pr    on pr.id = mp.project_id
  join public.clients c      on c.id  = pr.client_id
 where pl.media_plan_publisher_id = mpp.id
   and c.slug = 'felix'
   and mp.deleted_at is null
   and pl.market_id is null
   and pl.placement_name ~ '\|\s*T[12](\s|$)';

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN (correr aparte). Esperado, exacto:
--   Estados Unidos - T1 | 9 líneas |   992.172,20
--   Estados Unidos - T2 | 9 líneas |   417.828,00
--   (sin "(sin mercado)" en el resultado; 992.172,20 + 417.828,00 = 1.410.000
--    = 960.000 CTV + 350.000 YT/OLV Félix Pago + 100.000 YT/OLV Biddeo)
-- ════════════════════════════════════════════════════════════════════════════

-- select coalesce(mk.name, '(sin mercado)') as mercado,
--        count(*)                           as lineas,
--        sum(pl.amount_usd)                 as monto_usd
--   from public.media_plan_placements pl
--   join public.media_plan_publishers mpp on mpp.id = pl.media_plan_publisher_id
--   join public.media_plans mp            on mp.id = mpp.media_plan_id
--   join public.projects pr               on pr.id = mp.project_id
--   join public.clients c                 on c.id = pr.client_id
--   left join public.markets mk           on mk.id = pl.market_id
--  where c.slug = 'felix' and mp.deleted_at is null
--  group by 1
--  order by 1;

-- ════════════════════════════════════════════════════════════════════════════
-- NOTAS DEL PLAN — qué mercados son T1 y cuáles T2
-- ════════════════════════════════════════════════════════════════════════════
--
-- El tier que quedó en la línea dice "T1"/"T2" pero no QUÉ mercados son. La
-- lista completa va en las notas del plan (`media_plans.notes_md`, el bloque
-- "Notas del plan" del editor). Con las siglas al lado del nombre, que son las
-- que usa la columna `audience` de las líneas de CTV.
--
-- Anexa, no pisa: si el plan ya tenía notas, agrega el bloque al final separado
-- por una línea en blanco. Idempotente: no hace nada si el texto ya está
-- ("Mercados por tier"). Sólo toca planes que efectivamente usan tiers.
--
-- Sale también en el Excel del plan (fila `Notas` del bloque de metadata del
-- Tab 1) — la paridad pantalla↔export se agregó en el mismo PR. Al PDF NO: ése
-- es el documento que firma el cliente.
-- ════════════════════════════════════════════════════════════════════════════

update public.media_plans mp
   set notes_md = case
         when coalesce(btrim(mp.notes_md), '') = '' then v.bloque
         else btrim(mp.notes_md) || E'\n\n' || v.bloque
       end
  from public.projects pr
  join public.clients c on c.id = pr.client_id
  cross join (values (
    E'Mercados por tier — cada línea corre sobre TODOS los mercados de su tier; el presupuesto se distribuye entre ellos.\n'
    'T1 · Mercados Prioritarios: California (CA), New York (NY), New Jersey (NJ), Texas (TX), Florida (FL)\n'
    'T2 · Mercados Secundarios: Arizona (AZ), Illinois (IL), Colorado (CO), North Carolina (NC), Georgia (GA), Washington (WA), Pennsylvania (PA), New Mexico (NM)'
  )) as v(bloque)
 where mp.project_id = pr.id
   and c.slug = 'felix'
   and mp.deleted_at is null
   and position('Mercados por tier' in coalesce(mp.notes_md, '')) = 0
   and exists (
     select 1
       from public.media_plan_publishers mpp2
       join public.media_plan_placements pl2
         on pl2.media_plan_publisher_id = mpp2.id
      where mpp2.media_plan_id = mp.id
        and pl2.placement_name ~ '\|\s*T[12](\s|$)'
   );

-- VERIFICACIÓN (aparte): tiene que devolver 1 fila con las tres líneas.
-- select mp.name, mp.notes_md
--   from public.media_plans mp
--   join public.projects pr on pr.id = mp.project_id
--   join public.clients c   on c.id = pr.client_id
--  where c.slug = 'felix' and mp.deleted_at is null;
