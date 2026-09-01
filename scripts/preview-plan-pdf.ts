// Previsualiza el PDF del plan SIN base de datos: arma un PlanDetail de
// mentira, con datos del tamaño que tienen en prod (naming de Copa de 60/90
// caracteres sin espacios, audiencias de párrafo, montos de 7 cifras, varias
// métricas), y escribe los PDF en una carpeta para mirarlos.
//
// Uso:  npx tsx scripts/preview-plan-pdf.ts ./out
//
// Además del caso base escribe los casos borde donde el layout se rompe:
// muchas métricas (la columna del nombre queda en su mínimo), una audiencia
// más larga que una página, sin métricas, campos vacíos, inglés con nombres y
// montos extremos, y un plan con hoja auxiliar.
//
// Es la forma de verificar un cambio en lib/plan-pdf.ts sin tener que
// descargar un plan real: el PDF es lo que firma el cliente, así que cualquier
// cambio ahí se mira antes de mergear.

// Fixture con datos del tamaño real que se ve en prod: naming de Copa (60/90
// caracteres sin espacios), audiencias de párrafo, montos de 7 cifras y varias
// métricas — que es donde el PDF se rompía.
import { mkdirSync, writeFileSync } from "node:fs";
import { renderPlanPdf } from "@/lib/plan-pdf";
import type { PlanDetail } from "@/db/queries/project-detail";
import type { MetricMeta } from "@/lib/plan-metrics";

const AUD_LATAM =
  "Adultos 25-54 de LATAM con intención de viaje declarada en los últimos 90 días, " +
  "lookalike 2% de compradores 2025, excluyendo audiencias de retargeting activas en " +
  "otras campañas de la marca. Se prioriza Colombia, Perú, Chile y Argentina.";
const AUD_US =
  "Hispanic travelers 25-54 in US DMAs with direct Copa routes (MIA, MCO, JFK, LAX, IAH), " +
  "in-market for air travel, Spanish or bilingual household language.";
const AUD_BR =
  "Viajantes 25-54 no Brasil, foco GRU/GIG, interesse declarado em Caribe e América Central.";

const pl = (
  id: string,
  placementName: string,
  marketName: string,
  audience: string,
  amountUsd: number,
  costMethod: "cpm" | "cpc" | "cpv",
  startDate: string,
  endDate: string,
  metricsJson: Record<string, number>,
  sortOrder: number,
) => ({
  id, placementName, marketId: "m-" + id, marketName, audience, amountUsd,
  costMethod: costMethod as never, startDate, endDate, metricsJson,
  notesMd: null, sortOrder,
});

const metrics: MetricMeta[] = [
  { slug: "impressions", name: "Impresiones", unit: null, kind: "direct", formula: null },
  { slug: "clicks", name: "Clicks", unit: null, kind: "direct", formula: null },
  { slug: "views", name: "Views", unit: null, kind: "direct", formula: null },
  { slug: "reach", name: "Alcance", unit: null, kind: "direct", formula: null },
  { slug: "cpm", name: "CPM", unit: "$", kind: "calculated", formula: "amount / impressions * 1000" },
  { slug: "ctr", name: "CTR", unit: "%", kind: "calculated", formula: "clicks / impressions" },
  { slug: "cpv", name: "CPV", unit: "$", kind: "calculated", formula: "amount / views" },
] as unknown as MetricMeta[];

const detail: PlanDetail = {
  plan: {
    id: "plan-1",
    name: "Copa Airlines - Verano 2026 - Performance & Awareness LATAM",
    status: "approved",
    currentVersion: 3,
    notesMd: null,
  } as never,
  project: {
    id: "prj-1",
    code: "copa-verano-2026",
    name: "Copa Verano 2026",
    totalGrossBudgetUsd: "350000",
  },
  client: { id: "c1", name: "Copa Airlines", slug: "copa", language: "es" as never },
  budgetOrigin: { id: "bo1", name: "Copa Airlines - Brand" },
  publishers: [
    {
      id: "pub-1", publisherId: "p1", publisherSlug: "meta", publisherName: "Meta",
      totalPlannedUsd: 148000, agencyPays: true, sortOrder: 0, placementsTotalUsd: 148000,
      placements: [
        pl("a1", "COPA.m1220|Meta|Latam|Performance|Awareness|Video|Feed_Stories", "LATAM", AUD_LATAM,
           68000, "cpm", "2026-01-05", "2026-03-31",
           { impressions: 24500000, clicks: 132000, views: 3800000, reach: 8900000 }, 0),
        pl("a2", "COPA.m1202|Meta|EEUU|Performance|Consideration|Carousel_Retargeting", "Estados Unidos", AUD_US,
           45000, "cpc", "2026-01-05", "2026-03-31",
           { impressions: 12800000, clicks: 214000, views: 0, reach: 4100000 }, 1),
        pl("a3", "COPA.m1202|Meta|BR|Performance|Conversion|Collection_Prospecting", "Brasil", AUD_BR,
           35000, "cpm", "2026-02-01", "2026-03-31",
           { impressions: 11200000, clicks: 78000, views: 0, reach: 3600000 }, 2),
      ],
    },
    {
      id: "pub-2", publisherId: "p2", publisherSlug: "google", publisherName: "Google / YouTube",
      totalPlannedUsd: 97000, agencyPays: true, sortOrder: 1, placementsTotalUsd: 97000,
      placements: [
        pl("b1", "COPA.m1220|YouTube|Latam|Awareness|VideoReach|Bumper_6s+InStream_Skippable", "LATAM", AUD_LATAM,
           62000, "cpv", "2026-01-05", "2026-03-31",
           { impressions: 31000000, clicks: 44000, views: 9800000, reach: 12400000 }, 0),
        pl("b2", "COPA.m1231|GoogleAds|Latam|Performance|Search_Brand+Generic_Exact", "LATAM",
           "Búsquedas de marca y genéricas de alta intención (vuelos, pasajes, destinos Caribe).",
           35000, "cpc", "2026-01-05", "2026-03-31",
           { impressions: 4200000, clicks: 386000, views: 0, reach: 0 }, 1),
      ],
    },
  ],
  fees: [
    { id: "f1", feeType: "management" as never, name: "Management fee sobre media total",
      amountUsd: 36609, ratePct: 13, isAutoComputed: true,
      notes: "Calculado sobre la media total del plan, incluida la que el cliente paga directo al publisher.",
      sortOrder: 0 },
    { id: "f2", feeType: "setup" as never, name: "Set up de campañas, pixeles y audiencias custom",
      amountUsd: 4500, ratePct: null, isAutoComputed: false, notes: null, sortOrder: 1 },
    { id: "f3", feeType: "reporting" as never, name: "Reporting mensual + dashboard en vivo",
      amountUsd: 3200, ratePct: null, isAutoComputed: false,
      notes: "Incluye tres reportes mensuales y un wrap-up de cierre de campaña.", sortOrder: 2 },
  ],
  snapshots: [],
  auxSheets: [],
  totals: { media: 245000, fees: 44309, grand: 289309 },
};

const clone = (): PlanDetail => JSON.parse(JSON.stringify(detail));

// 12 métricas: la columna del nombre queda en su mínimo.
const manyMetrics = [
  ...metrics,
  ...["engagements", "video_p100", "leads", "tickets", "conversions"].map((slug, i) => ({
    slug, name: `Métrica custom bastante larga ${i + 1}`, unit: null,
    kind: "direct" as const, formula: null, sortOrder: 10 + i,
  })),
];

const cases: [string, PlanDetail, typeof metrics][] = [];

// 1. Muchas métricas (con datos: si no, resolveMetricColumns las descarta)
const many = clone();
for (const pub of many.publishers) {
  for (const p of pub.placements) {
    Object.assign(p.metricsJson, {
      engagements: 512000, video_p100: 2100000, leads: 8400,
      tickets: 1250, conversions: 3900,
    });
  }
}
cases.push(["muchas-metricas", many, manyMetrics as never]);

// 2. Audiencia más larga que una página entera
const huge = clone();
huge.publishers[0].placements[0].audience =
  ("Segmento detallado con criterios de inclusión y exclusión. ").repeat(60);
cases.push(["audiencia-gigante", huge, metrics]);

// 3. Sin métricas
cases.push(["sin-metricas", clone(), [] as never]);

// 4. Campos vacíos + publisher sin placements + sin fees
const empty = clone();
empty.publishers[0].placements = empty.publishers[0].placements.map((p) => ({
  ...p, marketName: null, audience: null, costMethod: null as never,
  startDate: null, endDate: null,
}));
empty.publishers[1].placements = [];
empty.fees = [];
cases.push(["campos-vacios", empty, metrics]);

// 5. Inglés + nombres y montos extremos
const en = clone();
en.client.language = "en" as never;
en.plan.name =
  "Copa Airlines - Summer 2026 - Performance & Awareness across LATAM, US Hispanic and Brazil markets";
en.publishers[0].publisherName =
  "Google / YouTube - Video Partners & Display Network (Programmatic Guaranteed)";
en.publishers[0].placements[0].amountUsd = 12345678;
en.publishers[0].totalPlannedUsd = 12345678;
en.totals = { media: 12456678, fees: 1861000, grand: 14317678 };
en.fees[0].name =
  "Management fee calculated over total media investment including publisher-direct spend";
cases.push(["ingles-extremos", en, metrics]);

// 6. Con hoja auxiliar (que el cambio de wrap no la rompa)
const aux = clone();
aux.auxSheets = [{
  id: "ax1", name: "Budget por mercado",
  grid: [
    ["Mercado", "Enero", "Febrero", "Marzo", "Total"],
    ["LATAM", "45000", "45000", "40000", "=SUM(B2:D2)"],
    ["Estados Unidos", "15000", "15000", "15000", "=SUM(B3:D3)"],
    ["Brasil", "0", "17500", "17500", "=SUM(B4:D4)"],
    ["Total", "=SUM(B2:B4)", "=SUM(C2:C4)", "=SUM(D2:D4)", "=SUM(E2:E4)"],
  ],
  merges: [],
}];
cases.push(["con-aux", aux, metrics]);

async function main() {
  const outDir = process.argv[2] ?? "./plan-pdf-preview";
  mkdirSync(outDir, { recursive: true });
  cases.unshift(["base", detail, metrics]);
  for (const [name, d, m] of cases) {
    const bytes = await renderPlanPdf(d, m as never);
    writeFileSync(`${outDir}/${name}.pdf`, bytes);
    console.log(`  ${name.padEnd(20)} ${String(bytes.length).padStart(6)} bytes  -> ${outDir}/${name}.pdf`);
  }
}
void main();
