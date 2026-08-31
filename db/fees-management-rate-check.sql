-- ════════════════════════════════════════════════════════════════════════════
-- CONTROL (read-only): management fees con tarifa distinta de la de base (13%)
--
-- Contexto: hasta 2f5f189 el botón "Agregar fee · management" precargaba 15%.
-- La tarifa de base de la agencia es 13%, así que cualquier fee donde el
-- planner aceptó la precarga sin editarla quedó cobrando de más.
--
-- Esto NO modifica nada. Corrélo en el SQL Editor de Supabase y revisá el
-- resultado: cada fila es un management fee cuya tarifa no es 13%. Algunos van
-- a ser legítimos (clientes con tarifa negociada distinta); los que estén en
-- 15% redondo y nadie recuerde haber negociado son los sospechosos.
--
-- `amount_esperado_13` es lo que daría el mismo fee a 13%, con la fórmula real
-- de la app: monto = total de medios × tarifa / (100 - tarifa).
--
-- Probado contra un Postgres 16 local con una fixture de seis casos: aparecen
-- el fee al 15% (con su diferencia), el que tiene rate_pct NULL y el de un plan
-- sin publishers (columnas en NULL, sin romper); quedan afuera el fee correcto
-- al 13%, el de un plan borrado y un set up fee.
-- ════════════════════════════════════════════════════════════════════════════

with media as (
  -- Total de medios del plan = suma de los bloques de publisher.
  select
    mpp.media_plan_id,
    sum(mpp.total_planned_usd) as total_media_usd
  from media_plan_publishers mpp
  group by mpp.media_plan_id
)
select
  c.name                                as cliente,
  p.code                                as proyecto,
  mp.name                               as plan,
  mp.status,
  f.name                                as fee,
  f.rate_pct                            as tarifa_pct,
  f.amount_usd                          as monto_cargado,
  m.total_media_usd,
  round(
    m.total_media_usd * 13.0 / (100.0 - 13.0),
    2
  )                                     as amount_esperado_13,
  round(
    f.amount_usd - (m.total_media_usd * 13.0 / (100.0 - 13.0)),
    2
  )                                     as diferencia_vs_13
from media_plan_fees f
join media_plans mp on mp.id = f.media_plan_id
join projects p     on p.id  = mp.project_id
join clients c      on c.id  = p.client_id
left join media m   on m.media_plan_id = mp.id
where f.fee_type = 'management'
  and mp.deleted_at is null
  and (f.rate_pct is distinct from 13.00)
order by
  -- Primero los que más plata desvían.
  abs(coalesce(f.amount_usd, 0) - coalesce(m.total_media_usd * 13.0 / 87.0, 0)) desc nulls last,
  c.name, p.code, mp.name;
