-- ════════════════════════════════════════════════════════════════════════════
-- Control del catálogo de mercados — READ-ONLY, se puede correr cuando sea.
--
-- Devuelve una fila por mercado con lo que cuelga de él (líneas, monto, planes
-- distintos, cierres) y una columna `control` que dice `ok` o qué mirar. Es el
-- chequeo de "no se rompió nada" después de db/markets-nomenclatura.sql, y
-- sirve igual como control periódico: si alguien vuelve a meter un mercado
-- fuera de la taxonomía, acá salta.
--
-- Qué marca cada REVISAR:
--   · "el slug no coincide con el nombre" — un rename que no regeneró el slug.
--     Importa porque el mapa de /analisis geocodifica probando el slug ANTES
--     que el nombre: un slug viejo pone la burbuja en el lugar equivocado.
--   · "nombre repetido" — dos mercados del mismo cliente con el mismo nombre.
--     El unique es (client_id, slug), NO (client_id, name), así que la base
--     sola no lo impide; y `lib/budget-split.ts` y el Excel de pacing agrupan
--     por NOMBRE, con lo cual dos así se sumarían en una fila sin aviso.
--   · "fuera de la taxonomía" — un nombre que no es `<País> (País)`,
--     `<País> - <Plaza>`, `<País> - Varios` ni una de las regiones.
--   · "espacios" — dobles espacios o espacios al borde, que rompen el match.
--
-- ESPERADO hoy (03/sep/2026, después de la normalización): 62 filas, TODAS en
-- `ok`, repartidas en 36 plazas · 19 países · 4 varios · 3 regiones.
--
-- La normalización va inline a propósito: es la misma que `slugify` en
-- app/actions/markets.ts y `norm` en lib/market-nomenclature.ts, y así el
-- archivo no depende de ninguna función creada antes.
-- ════════════════════════════════════════════════════════════════════════════

with norm as (
  select m.id, m.client_id, m.name, m.slug, c.slug as cliente,
         regexp_replace(
           regexp_replace(
             lower(translate(m.name, 'ÁÀÂÄÃÅáàâäãåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÖÕóòôöõÚÙÛÜúùûüÝýÑñÇç',
                                    'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuYyNnCc')),
             '[^a-z0-9]+', '-', 'g'),
           '^-+|-+$', '', 'g') as slug_esperado
    from public.markets m
    join public.clients c on c.id = m.client_id
)
select n.cliente,
       n.name                                                   as mercado,
       case
         when n.name like '% (País)'                            then 'país'
         when n.name like '% - Varios' or n.name like '% - Varios (%)' then 'varios'
         when n.name like '% - %'                               then 'plaza'
         else 'región'
       end                                                      as forma,
       (select count(*) from public.media_plan_placements pl
         where pl.market_id = n.id)                             as lineas,
       (select coalesce(sum(pl.amount_usd), 0) from public.media_plan_placements pl
         where pl.market_id = n.id)                             as monto_usd,
       (select count(distinct mpp.media_plan_id)
          from public.media_plan_placements pl
          join public.media_plan_publishers mpp on mpp.id = pl.media_plan_publisher_id
         where pl.market_id = n.id)                             as planes,
       (select count(*) from public.campaign_actual_snapshots s
         where s.market_id = n.id)                              as cierres,
       case
         when n.slug <> n.slug_esperado then 'REVISAR: el slug no coincide con el nombre'
         when n.name <> btrim(n.name) or n.name like '%  %' then 'REVISAR: espacios'
         when exists (select 1 from norm n2
                       where n2.client_id = n.client_id and n2.id <> n.id
                         and n2.name = n.name)              then 'REVISAR: nombre repetido'
         when n.name not like '% (País)' and n.name not like '% - %'
              and n.name not in ('Centroamérica','Sudamérica','Norteamérica','LATAM',
                                 'Caribe','Región Andina','Cono Sur','Global')
                                                            then 'REVISAR: fuera de la taxonomía'
         else 'ok'
       end                                                      as control
  from norm n
 order by n.cliente, n.name;
