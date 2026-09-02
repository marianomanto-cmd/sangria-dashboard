-- Tabla de facturación creative + carga de las 21 facturas 2025 del Excel.
-- Idempotente: se puede correr de nuevo sin duplicar.
BEGIN;

CREATE TABLE IF NOT EXISTS creative_billings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  invoice_number text NOT NULL UNIQUE,
  campaign_code  text,
  project_name   text,
  month          varchar(7) NOT NULL,
  invoice_date   date,
  amount_usd     numeric(14,2) NOT NULL DEFAULT 0,
  status         billing_status NOT NULL DEFAULT 'draft',
  paid_at        timestamptz,
  notes_md       text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_creative_billings_month  ON creative_billings (month);
CREATE INDEX IF NOT EXISTS idx_creative_billings_client ON creative_billings (client_id);
-- RLS sin policies, como el resto de las tablas (rls.sql). Cierra la REST pública.
ALTER TABLE creative_billings ENABLE ROW LEVEL SECURITY;

INSERT INTO creative_billings
  (client_id, invoice_number, campaign_code, project_name, month, amount_usd, status)
SELECT (SELECT id FROM clients WHERE slug = 'copa'),
       v.nro, v.code, v.name, v.month, v.amount, 'invoiced'
  FROM (VALUES
  ('1078','COPA.c1055.MejoresTarifasCreative','Mejores Tarifas Creative','2025-04',3500.00),
  ('1079','COPA.c1057.CMI Marqueta Creative','CMI Marqueta Creative','2025-04',15000.00),
  ('1080','COPA.c1063.SanDiegoCreative','San Diego Creative','2025-04',23742.00),
  ('1108','COPA.c1060.Tucuman y Salta','Tucuman y Salta','2025-04',4448.28),('1109','COPA.c1062.BoostingAbril','Boosting Abril','2025-04',16292.11),
  ('1100','COPA.c1066.SanDiegoTranscreation','San Diego Transcreation','2025-05',6615.00),
  ('1112','COPA.c1069.Stopover2025ColombiaCreative','Stopover2025Colombia Creative','2025-05',8217.00),
  ('1141','COPA.c1082.MejoresTarifasUpdate','Mejores Tarifas Update','2025-07',4980.00),
  ('1161','COPA.c1094.BlueSaleCreative','Blue Sale Creative','2025-08',4905.00),
  ('1202','COPA.c1111.TucumanCreative','Tucuman Creative','2025-09',7000.00),
  ('1203','COPA.c1110.CopaCourierCreative','Copa Courier Creative','2025-09',7500.00),
  ('1204','COPA.c1114.PuertoPlataCreative','Puerto Plata Creative','2025-09',3150.00),
  ('1205','COPA.c1117.SaltaCreative','Salta Creative','2025-09',3500.00),('1206','COPA.c1118.StopoverHotelAds','Stopover Hotel Ads','2025-10',5319.00),
  ('1219','COPA.c1113.TarifasViajaPanamaCreative','Tarifas Viaja Panama Creative','2025-10',7920.00),
  ('1220','COPA.c1124.Stopover Dark Post Creative','Stopover Dark Post Creative','2025-10',5895.00),
  ('1221','COPA.c1125.CopaPost Creative','Copa Post Creative','2025-10',10000.00),
  ('1222','COPA.c1093.LosCabosCreative','Los Cabos Creative','2025-10',3000.00),
  ('1223','COPA.c1120.PuertoPlataCreative','Puerto Plata Creative','2025-10',13635.00),
  ('1224','COPA.c1127.SandiegoCreativeTarifas','Sandiego Creative Tarifas','2025-10',3720.00),
  ('1225','COPA.c1119.Colombia Creative','Colombia Creative','2025-10',13716.00)
) AS v(nro, code, name, month, amount)
 WHERE NOT EXISTS (SELECT 1 FROM creative_billings cb WHERE cb.invoice_number = v.nro);

SELECT format('creative_billings=%s|total=%s',
  (SELECT count(*) FROM creative_billings),
  (SELECT to_char(coalesce(sum(amount_usd),0),'FM999,999,999.00') FROM creative_billings));
-- Cambia por ROLLBACK para ensayar.
COMMIT;