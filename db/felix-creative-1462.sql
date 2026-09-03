-- ════════════════════════════════════════════════════════════════════════════
-- Alta de la factura de creative 1462 — Félix (Felix Technologies)
--
-- QuickBooks "Invoice no.: 1462" (archivo Invoice_201462.pdf), emitida el
-- 02/sep/2026. Una sola línea: "FEL.c1003 Creative Fee 2026 Holiday",
-- qty 1 × USD 21.150,00 = total USD 21.150,00. Sin impuestos ni descuentos.
--
-- `status` va EXPLÍCITO: el DEFAULT de creative_billings en prod es 'draft'
-- (db/creative-billings.sql) y una fila draft NO la ve el portal del cliente.
-- Idempotente: se puede correr dos veces. Aborta con mensaje claro si no hay
-- cliente vivo con slug 'felix' o si el N° 1462 ya está tomado por otro cliente.
-- ════════════════════════════════════════════════════════════════════════════

begin;

do $$
begin
  if not exists (select 1 from public.clients
                  where slug = 'felix' and status <> 'archived') then
    raise exception 'No hay cliente activo con slug felix — no se cargó nada. Corré: select id, name, slug, status from public.clients order by name;';
  end if;

  if exists (select 1
               from public.creative_billings cb
               join public.clients c on c.id = cb.client_id
              where cb.invoice_number = '1462' and c.slug <> 'felix') then
    raise exception 'El N° 1462 ya existe y NO es de Félix — no se cargó nada. Revisá esa fila antes de seguir.';
  end if;
end $$;

insert into public.creative_billings
  (client_id, invoice_number, campaign_code, project_name,
   month, invoice_date, amount_usd, status, notes_md)
select c.id, '1462', 'FEL.c1003', 'Creative Fee 2026 Holiday',
       '2026-09', date '2026-09-02', 21150.00,
       'invoiced'::public.billing_status,
       'QuickBooks Invoice no. 1462 (archivo Invoice_201462.pdf). Linea: FEL.c1003 Creative Fee 2026 Holiday. Qty 1 x 21150.00. Terms: due on receipt.'
  from public.clients c
 where c.slug = 'felix'
   and c.status <> 'archived'
   and not exists (select 1 from public.creative_billings cb
                    where cb.invoice_number = '1462');

-- Única salida visible del bloque en el SQL Editor (muestra el último select).
select coalesce(
         (select 'CARGADA: ' || c.name || ' · ' || cb.month || ' · USD ' ||
                 cb.amount_usd || ' · ' || cb.status
            from public.creative_billings cb
            join public.clients c on c.id = cb.client_id
           where cb.invoice_number = '1462'),
         'NO SE CARGÓ') as factura_1462,
       (select count(*) from public.creative_billings) as filas_totales;

commit;

-- ── VERIFICACIÓN (correr APARTE, después del bloque de arriba) ─────────────
-- Esperado: 1 fila, con chequeo = OK. 0 filas = no cargó (revisar el slug).

select cb.invoice_number as nro,
       c.name            as cliente,
       c.slug            as slug,
       cb.campaign_code  as campania,
       cb.project_name   as proyecto,
       cb.month          as mes,
       cb.invoice_date   as fecha,
       cb.amount_usd     as monto_usd,
       cb.status         as estado,
       cb.paid_at        as cobrada_el,
       case when c.slug = 'felix'
             and cb.campaign_code = 'FEL.c1003'
             and cb.project_name  = 'Creative Fee 2026 Holiday'
             and cb.month = '2026-09'
             and cb.invoice_date = date '2026-09-02'
             and cb.amount_usd = 21150.00
             and cb.status = 'invoiced'
             and cb.paid_at is null
            then 'OK' else 'REVISAR' end as chequeo
  from public.creative_billings cb
  join public.clients c on c.id = cb.client_id
 where cb.invoice_number = '1462';
