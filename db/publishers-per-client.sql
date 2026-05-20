-- ════════════════════════════════════════════════════════════════════════════
-- Migración one-time: publishers global + client_publishers → publishers per-cliente
-- ════════════════════════════════════════════════════════════════════════════
--
-- CONTEXTO:
--   Antes `publishers` era un catálogo GLOBAL (unique slug) + `client_publishers`
--   (join cliente↔publisher con agency_pays / enabled / sort_order). Ahora
--   `publishers` es PER-CLIENTE (igual que markets / metrics_catalog): tiene
--   client_id + agency_pays, unique (client_id, slug), y la tabla
--   `client_publishers` deja de existir.
--
-- QUÉ HACE (transaccional → todo o nada; si algo falla, ROLLBACK automático):
--   1. Agrega publishers.client_id + publishers.agency_pays.
--   2. Crea una copia per-cliente de cada publisher que esté mapeado en
--      client_publishers O usado en media_plan_publishers /
--      plan_billing_publishers / campaign_actual_snapshots.
--   3. Re-apunta esas 3 tablas a la copia per-cliente correcta (según el
--      cliente del plan / billing / snapshot).
--   4. Borra client_publishers y los publishers globales viejos.
--   5. Aplica los constraints finales (client_id NOT NULL + FK, unique(client_id, slug)).
--
-- CÓMO APLICAR:
--   Pegá TODO este archivo en el SQL Editor de Supabase (Dashboard → SQL Editor)
--   y ejecutalo. Después corré el bloque de VERIFICACIÓN del final: los conteos
--   de media_plan_publishers / plan_billing_publishers / campaign_actual_snapshots
--   deben quedar IGUALES que antes (en la data actual: 8 / 2 / 50), y
--   publishers_huerfanos debe ser 0.
--
--   IMPORTANTE: corré esta migración ANTES (o junto con) el deploy del código
--   nuevo. El código nuevo espera el schema per-cliente; si la DB todavía tiene
--   el schema viejo, la app rompe (y viceversa).
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- 1) Columnas nuevas (nullable mientras migramos).
alter table public.publishers
  add column if not exists client_id uuid references public.clients(id) on delete cascade;
alter table public.publishers
  add column if not exists agency_pays boolean not null default true;

-- 2) Drop del unique global sobre slug (el nombre del constraint puede variar
--    según cómo lo generó drizzle, así que lo buscamos dinámicamente).
do $$
declare cname text;
begin
  select conname into cname
    from pg_constraint
   where conrelid = 'public.publishers'::regclass
     and contype = 'u'
     and pg_get_constraintdef(oid) ilike '%(slug)%';
  if cname is not null then
    execute format('alter table public.publishers drop constraint %I', cname);
  end if;
end $$;

-- 3) Tabla de remap: (publisher global, cliente) → nuevo publisher per-cliente.
--    El universo = mapeados en client_publishers + usados en cualquiera de las
--    3 tablas que referencian publishers. Para huérfanos (usados pero sin fila
--    en client_publishers) caemos al agency_pays_default / sort_order del
--    catálogo global.
create temporary table _pub_remap on commit drop as
with universe as (
  select cp.client_id, cp.publisher_id as old_pub from public.client_publishers cp
  union
  select pr.client_id, mpp.publisher_id
    from public.media_plan_publishers mpp
    join public.media_plans mp on mp.id = mpp.media_plan_id
    join public.projects pr     on pr.id = mp.project_id
  union
  select pr.client_id, pbp.publisher_id
    from public.plan_billing_publishers pbp
    join public.plan_billings pb on pb.id = pbp.plan_billing_id
    join public.media_plans mp   on mp.id = pb.media_plan_id
    join public.projects pr      on pr.id = mp.project_id
  union
  select cas.client_id, cas.publisher_id
    from public.campaign_actual_snapshots cas
)
select
  u.client_id,
  u.old_pub,
  gen_random_uuid()                                as new_pub,
  p.slug,
  p.name,
  coalesce(cp.agency_pays, p.agency_pays_default)  as agency_pays,
  coalesce(cp.enabled, true)                       as enabled,
  coalesce(cp.sort_order, p.sort_order)            as sort_order
from universe u
join public.publishers p on p.id = u.old_pub
left join public.client_publishers cp
       on cp.client_id = u.client_id and cp.publisher_id = u.old_pub
where p.client_id is null;  -- sólo los publishers globales

-- 4) Insertar las copias per-cliente.
insert into public.publishers
  (id, client_id, slug, name, enabled, agency_pays, sort_order, created_at)
select new_pub, client_id, slug, name, enabled, agency_pays, sort_order, now()
from _pub_remap;

-- 5) Re-apuntar las 3 tablas a la copia per-cliente correcta.
update public.media_plan_publishers mpp
   set publisher_id = r.new_pub
  from _pub_remap r, public.media_plans mp, public.projects pr
 where mpp.media_plan_id = mp.id
   and mp.project_id     = pr.id
   and r.old_pub         = mpp.publisher_id
   and r.client_id       = pr.client_id;

update public.plan_billing_publishers pbp
   set publisher_id = r.new_pub
  from _pub_remap r, public.plan_billings pb, public.media_plans mp, public.projects pr
 where pbp.plan_billing_id = pb.id
   and pb.media_plan_id     = mp.id
   and mp.project_id        = pr.id
   and r.old_pub            = pbp.publisher_id
   and r.client_id          = pr.client_id;

update public.campaign_actual_snapshots cas
   set publisher_id = r.new_pub
  from _pub_remap r
 where r.old_pub   = cas.publisher_id
   and r.client_id = cas.client_id;

-- 6) Borrar client_publishers + los publishers globales viejos (ya nadie los
--    referencia: las 3 tablas se re-apuntaron en el paso 5).
drop table if exists public.client_publishers;
delete from public.publishers where client_id is null;

-- 7) Constraints finales.
alter table public.publishers alter column client_id set not null;
alter table public.publishers drop column if exists agency_pays_default;
alter table public.publishers
  add constraint publishers_client_slug_uq unique (client_id, slug);
drop index if exists public.idx_publishers_enabled;
create index if not exists idx_publishers_client_enabled
  on public.publishers (client_id, enabled, sort_order);

commit;

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN — correr DESPUÉS del commit. Conteos de referencias deben quedar
-- IGUALES a antes de migrar (en la data actual: 8 / 2 / 50) y huérfanos = 0.
-- ────────────────────────────────────────────────────────────────────────────
-- select
--   (select count(*) from publishers)                          as publishers_total,
--   (select count(*) from publishers where client_id is null)  as publishers_huerfanos,   -- debe ser 0
--   (select count(*) from media_plan_publishers)               as media_plan_publishers,  -- = 8
--   (select count(*) from plan_billing_publishers)             as plan_billing_publishers,-- = 2
--   (select count(*) from campaign_actual_snapshots)           as campaign_actual_snapshots; -- = 50
--
-- -- Que ninguna referencia quedó colgada (las 3 deben dar 0):
-- select 'mpp' tbl, count(*) n from media_plan_publishers m
--   left join publishers p on p.id = m.publisher_id where p.id is null
-- union all
-- select 'pbp', count(*) from plan_billing_publishers x
--   left join publishers p on p.id = x.publisher_id where p.id is null
-- union all
-- select 'cas', count(*) from campaign_actual_snapshots c
--   left join publishers p on p.id = c.publisher_id where p.id is null;
