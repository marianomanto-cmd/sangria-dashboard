// Seed con datos de prueba consistentes con el modelo nuevo:
//   1 cliente (Copa Airlines)
//   3 budget origins
//   Catálogos: 9 publishers + 14 markets + 17 metrics
//   3 proyectos siguiendo convención COPA.m<id>.<ProjectName>
//   5 planes peer (status mix) con publishers + placements + fees
//   1 plan_billing de muestra
//   1 snapshot inmutable del plan approved
//
// Idempotente: limpia las tablas en orden inverso de FK antes de insertar.
// Uso: `npm run db:seed`

import { db } from "@/db";
import * as s from "@/db/schema";

async function main() {
  console.log("⏳ Limpiando datos existentes...");
  await db.delete(s.auditLog);
  await db.delete(s.planBillingFees);
  await db.delete(s.planBillingPublishers);
  await db.delete(s.planBillings);
  await db.delete(s.mediaPlanSnapshots);
  await db.delete(s.mediaPlanFees);
  await db.delete(s.mediaPlanPlacements);
  await db.delete(s.mediaPlanPublishers);
  await db.delete(s.mediaPlans);
  await db.delete(s.projects);
  await db.delete(s.budgetOrigins);
  await db.delete(s.clients);
  await db.delete(s.publishers);
  await db.delete(s.markets);
  await db.delete(s.metricsCatalog);

  console.log("⏳ Catálogo de publishers...");
  const pubs = await db
    .insert(s.publishers)
    .values([
      { slug: "youtube", name: "YouTube", agencyPaysDefault: true, sortOrder: 0 },
      { slug: "meta", name: "Meta", agencyPaysDefault: true, sortOrder: 1 },
      { slug: "tiktok", name: "TikTok", agencyPaysDefault: true, sortOrder: 2 },
      { slug: "dv360", name: "DV360", agencyPaysDefault: true, sortOrder: 3 },
      { slug: "display", name: "Display", agencyPaysDefault: true, sortOrder: 4 },
      { slug: "search", name: "Google Search", agencyPaysDefault: true, sortOrder: 5 },
      { slug: "spotify", name: "Spotify", agencyPaysDefault: true, sortOrder: 6 },
      { slug: "ooh", name: "OOH (Out of Home)", agencyPaysDefault: false, sortOrder: 7 },
      { slug: "programmatic", name: "Programmatic", agencyPaysDefault: true, sortOrder: 8 },
    ])
    .returning();

  const pubBySlug = new Map(pubs.map((p) => [p.slug, p]));
  const pub = (slug: string) => {
    const p = pubBySlug.get(slug);
    if (!p) throw new Error(`Publisher slug ${slug} no existe`);
    return p;
  };

  console.log("⏳ Catálogo de mercados...");
  const mkts = await db
    .insert(s.markets)
    .values([
      // Países individuales
      { slug: "costa-rica", name: "Costa Rica", sortOrder: 0 },
      { slug: "panama", name: "Panama", sortOrder: 1 },
      { slug: "guatemala", name: "Guatemala", sortOrder: 2 },
      { slug: "honduras", name: "Honduras", sortOrder: 3 },
      { slug: "el-salvador", name: "El Salvador", sortOrder: 4 },
      { slug: "nicaragua", name: "Nicaragua", sortOrder: 5 },
      { slug: "mexico", name: "México", sortOrder: 6 },
      { slug: "argentina", name: "Argentina", sortOrder: 7 },
      { slug: "brasil", name: "Brasil", sortOrder: 8 },
      { slug: "chile", name: "Chile", sortOrder: 9 },
      { slug: "colombia", name: "Colombia", sortOrder: 10 },
      { slug: "peru", name: "Perú", sortOrder: 11 },
      // Agrupaciones
      { slug: "centroamerica", name: "Centroamérica", sortOrder: 50 },
      { slug: "latam", name: "LATAM", sortOrder: 51 },
    ])
    .returning();
  const mktBySlug = new Map(mkts.map((m) => [m.slug, m]));
  const mkt = (slug: string) => {
    const m = mktBySlug.get(slug);
    if (!m) throw new Error(`Market slug ${slug} no existe`);
    return m;
  };

  console.log("⏳ Catálogo de métricas...");
  await db.insert(s.metricsCatalog).values([
    // Direct — el planner entra el valor
    { slug: "impressions", name: "Impressions", kind: "direct", unit: "imp", sortOrder: 0 },
    { slug: "clicks",      name: "Clicks",      kind: "direct", unit: "click", sortOrder: 1 },
    { slug: "views",       name: "Video Views", kind: "direct", unit: "view", sortOrder: 2 },
    { slug: "conversions", name: "Conversions", kind: "direct", unit: "conv", sortOrder: 3 },
    { slug: "reach",       name: "Reach único", kind: "direct", unit: "users", sortOrder: 4 },
    { slug: "frequency",   name: "Frequency",   kind: "direct", unit: "freq", sortOrder: 5 },
    { slug: "engagements", name: "Engagements", kind: "direct", unit: "eng", sortOrder: 6 },
    { slug: "followers",   name: "Followers",   kind: "direct", unit: "users", sortOrder: 7 },
    { slug: "leads",       name: "Leads",       kind: "direct", unit: "leads", sortOrder: 8 },
    { slug: "installs",    name: "App Installs", kind: "direct", unit: "installs", sortOrder: 9 },
    { slug: "visits",      name: "Site Visits", kind: "direct", unit: "visits", sortOrder: 10 },
    // Calculated — derivadas
    { slug: "ctr",  name: "CTR",  kind: "calculated", unit: "%", formula: "clicks / impressions", sortOrder: 50 },
    { slug: "cpc",  name: "CPC",  kind: "calculated", unit: "$", formula: "amount / clicks", sortOrder: 51 },
    { slug: "cpm",  name: "CPM",  kind: "calculated", unit: "$", formula: "amount / impressions × 1000", sortOrder: 52 },
    { slug: "cpv",  name: "CPV",  kind: "calculated", unit: "$", formula: "amount / views", sortOrder: 53 },
    { slug: "cpa",  name: "CPA",  kind: "calculated", unit: "$", formula: "amount / conversions", sortOrder: 54 },
    { slug: "vtr",  name: "VTR (View-Through Rate)", kind: "calculated", unit: "%", formula: "views / impressions", sortOrder: 55 },
  ]);

  console.log("⏳ Cliente...");
  const [copa] = await db
    .insert(s.clients)
    .values([
      {
        name: "Copa Airlines",
        slug: "copa",
        prefix: "COPA",
        status: "active",
      },
    ])
    .returning();

  console.log("⏳ Budget origins...");
  const [bgOnline, bgCmi, bgTrade] = await db
    .insert(s.budgetOrigins)
    .values([
      { clientId: copa.id, name: "Online", monthlyTargetUsd: "200000.00", colorHex: "#7a1f3d" },
      { clientId: copa.id, name: "CMI", monthlyTargetUsd: "80000.00", colorHex: "#5e1730" },
      { clientId: copa.id, name: "Trade", monthlyTargetUsd: "50000.00", colorHex: "#8b2a52" },
    ])
    .returning();

  console.log("⏳ Proyectos...");
  const [projCR, projPanama, projMiami] = await db
    .insert(s.projects)
    .values([
      {
        clientId: copa.id,
        budgetOriginId: bgOnline.id,
        code: "COPA.m2026A01.CostaRica2026",
        name: "Costa Rica 2026",
        status: "active",
        startDate: "2026-02-01",
        totalGrossBudgetUsd: "300000.00",
        notesMd:
          "Campaña multi-funnel para promoción de Costa Rica. Se divide en 3 planes peer: Awareness, Consideration y Performance, con períodos solapados.",
      },
      {
        clientId: copa.id,
        budgetOriginId: bgCmi.id,
        code: "COPA.m2026B02.PanamaSummer",
        name: "Panama Summer 2026",
        status: "active",
        startDate: "2026-03-01",
        totalGrossBudgetUsd: "450000.00",
      },
      {
        clientId: copa.id,
        budgetOriginId: bgTrade.id,
        code: "COPA.m2026C03.MiamiHubGrowth",
        name: "Miami Hub Growth",
        status: "planning",
        startDate: "2026-06-01",
        totalGrossBudgetUsd: "200000.00",
      },
    ])
    .returning();

  console.log("⏳ Planes peer del proyecto Costa Rica...");

  // ─── Plan 1: Awareness (APPROVED) ───────────────────────────────────
  const [planAwareness] = await db
    .insert(s.mediaPlans)
    .values([
      {
        projectId: projCR.id,
        name: "Awareness",
        status: "approved",
        currentVersion: 1,
        notesMd: "Plan upper-funnel para construir conocimiento del destino.",
      },
    ])
    .returning();

  const [aw_yt, aw_meta, aw_tt] = await db
    .insert(s.mediaPlanPublishers)
    .values([
      { mediaPlanId: planAwareness.id, publisherId: pub("youtube").id, totalPlannedUsd: "45000.00", sortOrder: 0 },
      { mediaPlanId: planAwareness.id, publisherId: pub("meta").id,    totalPlannedUsd: "35000.00", sortOrder: 1 },
      { mediaPlanId: planAwareness.id, publisherId: pub("tiktok").id,  totalPlannedUsd: "20000.00", sortOrder: 2 },
    ])
    .returning();

  await db.insert(s.mediaPlanPlacements).values([
    {
      mediaPlanPublisherId: aw_yt.id, sortOrder: 0,
      placementName: "Bumper Ads 6s", marketId: mkt("costa-rica").id,
      audience: "25-44 viajeros frecuentes",
      amountUsd: "25000.00", costMethod: "dCPV",
      startDate: "2026-02-01", endDate: "2026-03-31",
      metricsJson: { views: 13157894, impressions: 14500000 },
      notesMd: "Formato: video vertical + horizontal\nCreatividad: 3 versiones rotativas",
    },
    {
      mediaPlanPublisherId: aw_yt.id, sortOrder: 1,
      placementName: "In-Stream Skippable", marketId: mkt("centroamerica").id,
      audience: "18-44 LATAM travel intent",
      amountUsd: "20000.00", costMethod: "dCPV",
      startDate: "2026-02-15", endDate: "2026-03-31",
      metricsJson: { views: 7142857, impressions: 9500000 },
      notesMd: "Formato: video 15-30s",
    },
    {
      mediaPlanPublisherId: aw_meta.id, sortOrder: 0,
      placementName: "Feed Awareness", marketId: mkt("costa-rica").id,
      audience: "travelers + lookalike de site visitors",
      amountUsd: "18000.00", costMethod: "dCPM",
      startDate: "2026-02-01", endDate: "2026-03-31",
      metricsJson: { impressions: 4000000, reach: 1200000 },
      notesMd: "Formato: feed estático + carrusel",
    },
    {
      mediaPlanPublisherId: aw_meta.id, sortOrder: 1,
      placementName: "Reels Brand", marketId: mkt("latam").id,
      audience: "18-34 viajeros activos",
      amountUsd: "17000.00", costMethod: "dCPV",
      startDate: "2026-02-15", endDate: "2026-03-31",
      metricsJson: { views: 1416666, impressions: 2500000 },
      notesMd: "Formato: video vertical 9:16",
    },
    {
      mediaPlanPublisherId: aw_tt.id, sortOrder: 0,
      placementName: "In-Feed Top View", marketId: mkt("latam").id,
      audience: "18-34 jóvenes viajeros",
      amountUsd: "20000.00", costMethod: "dCPV",
      startDate: "2026-02-01", endDate: "2026-03-31",
      metricsJson: { views: 1111111, impressions: 1800000 },
      notesMd: "Formato: video full-screen vertical",
    },
  ]);

  const awarenessFees = await db
    .insert(s.mediaPlanFees)
    .values([
      { mediaPlanId: planAwareness.id, feeType: "management", name: "Management Fee", amountUsd: "0.00", ratePct: "15.00", sortOrder: 0 },
      { mediaPlanId: planAwareness.id, feeType: "setup",      name: "Set Up Fee",     amountUsd: "1000.00",  sortOrder: 1 },
      { mediaPlanId: planAwareness.id, feeType: "reporting",  name: "Reporting Fee",  amountUsd: "2000.00",  sortOrder: 2 },
    ])
    .returning();

  await db.insert(s.mediaPlanSnapshots).values([
    {
      mediaPlanId: planAwareness.id,
      versionNumber: 1,
      approvedAt: new Date("2026-01-28T15:30:00Z"),
      notes: "Aprobación inicial del plan, firmado por la cuenta del cliente.",
      snapshotJson: {
        plan: { name: "Awareness" },
        totalMedia: 100000,
        totalFees: 18000,
        publishers: 3,
        placements: 5,
      },
    },
  ]);

  // ─── Plan 2: Consideration (DRAFT) ──────────────────────────────────
  const [planConsideration] = await db
    .insert(s.mediaPlans)
    .values([
      {
        projectId: projCR.id,
        name: "Consideration",
        status: "draft",
        currentVersion: 0,
        notesMd: "Plan mid-funnel para mover audiencias a consideración. Solapa con Awareness en Marzo.",
      },
    ])
    .returning();

  const [co_meta, co_yt, co_disp] = await db
    .insert(s.mediaPlanPublishers)
    .values([
      { mediaPlanId: planConsideration.id, publisherId: pub("meta").id,    totalPlannedUsd: "25000.00", sortOrder: 0 },
      { mediaPlanId: planConsideration.id, publisherId: pub("youtube").id, totalPlannedUsd: "20000.00", sortOrder: 1 },
      { mediaPlanId: planConsideration.id, publisherId: pub("display").id, totalPlannedUsd: "10000.00", sortOrder: 2 },
    ])
    .returning();

  await db.insert(s.mediaPlanPlacements).values([
    {
      mediaPlanPublisherId: co_meta.id, sortOrder: 0,
      placementName: "Reels Consideration", marketId: mkt("latam").id,
      audience: "retargeting de Awareness viewers + travel interest groups",
      amountUsd: "15000.00", costMethod: "dCPV",
      startDate: "2026-03-01", endDate: "2026-04-30",
      metricsJson: { views: 1071428 },
      notesMd: "",
    },
    {
      mediaPlanPublisherId: co_meta.id, sortOrder: 1,
      placementName: "Carousel Destinations", marketId: mkt("costa-rica").id,
      audience: "travel intent searchers",
      amountUsd: "10000.00", costMethod: "dCPC",
      startDate: "2026-03-15", endDate: "2026-04-30",
      metricsJson: { clicks: 22222 },
      notesMd: "Formato: carrusel multi-destino",
    },
    {
      mediaPlanPublisherId: co_yt.id, sortOrder: 0,
      placementName: "In-Stream Mid-Funnel", marketId: mkt("latam").id,
      audience: "lookalike de Awareness viewers",
      amountUsd: "20000.00", costMethod: "dCPV",
      startDate: "2026-03-01", endDate: "2026-04-30",
      metricsJson: { views: 8000000 },
      notesMd: "",
    },
    {
      mediaPlanPublisherId: co_disp.id, sortOrder: 0,
      placementName: "Programmatic Display", marketId: mkt("centroamerica").id,
      audience: "travel intent + retargeting site visitors",
      amountUsd: "10000.00", costMethod: "CPM",
      startDate: "2026-03-01", endDate: "2026-04-30",
      metricsJson: { impressions: 3125000 },
      notesMd: "",
    },
  ]);

  await db.insert(s.mediaPlanFees).values([
    { mediaPlanId: planConsideration.id, feeType: "management", name: "Management Fee", amountUsd: "0.00", ratePct: "15.00", sortOrder: 0 },
    { mediaPlanId: planConsideration.id, feeType: "setup",      name: "Set Up Fee",     amountUsd: "500.00",   sortOrder: 1 },
    { mediaPlanId: planConsideration.id, feeType: "reporting",  name: "Reporting Fee",  amountUsd: "2000.00",  sortOrder: 2 },
  ]);

  // ─── Plan 3: Performance (READY_TO_SEND) ────────────────────────────
  const [planPerformance] = await db
    .insert(s.mediaPlans)
    .values([
      {
        projectId: projCR.id,
        name: "Performance",
        status: "ready_to_send",
        currentVersion: 0,
        notesMd: "Plan lower-funnel: search + conversion campaigns. Esperando firma del cliente.",
      },
    ])
    .returning();

  const [pe_search, pe_meta] = await db
    .insert(s.mediaPlanPublishers)
    .values([
      { mediaPlanId: planPerformance.id, publisherId: pub("search").id, totalPlannedUsd: "30000.00", sortOrder: 0 },
      { mediaPlanId: planPerformance.id, publisherId: pub("meta").id,   totalPlannedUsd: "25000.00", sortOrder: 1 },
    ])
    .returning();

  await db.insert(s.mediaPlanPlacements).values([
    {
      mediaPlanPublisherId: pe_search.id, sortOrder: 0,
      placementName: "Brand Defense", marketId: mkt("centroamerica").id,
      audience: "Brand keywords + competitor defense",
      amountUsd: "12000.00", costMethod: "CPC",
      startDate: "2026-04-01", endDate: "2026-05-31",
      metricsJson: { clicks: 34285 },
      notesMd: "",
    },
    {
      mediaPlanPublisherId: pe_search.id, sortOrder: 1,
      placementName: "Non-Brand Travel Intent", marketId: mkt("latam").id,
      audience: 'searchers de "vuelos a costa rica", "hoteles tamarindo", etc.',
      amountUsd: "18000.00", costMethod: "CPC",
      startDate: "2026-04-01", endDate: "2026-05-31",
      metricsJson: { clicks: 21176 },
      notesMd: "",
    },
    {
      mediaPlanPublisherId: pe_meta.id, sortOrder: 0,
      placementName: "Conversion Campaign", marketId: mkt("latam").id,
      audience: "warm + lookalike de compradores",
      amountUsd: "25000.00", costMethod: "CPA",
      startDate: "2026-04-01", endDate: "2026-05-31",
      metricsJson: { conversions: 1388 },
      notesMd: "Optimización por compra de pasaje\nFormato: feed + reels",
    },
  ]);

  await db.insert(s.mediaPlanFees).values([
    { mediaPlanId: planPerformance.id, feeType: "management", name: "Management Fee", amountUsd: "0.00", ratePct: "15.00", sortOrder: 0 },
    { mediaPlanId: planPerformance.id, feeType: "setup",      name: "Set Up Fee",     amountUsd: "500.00",  sortOrder: 1 },
  ]);

  // ─── Plan 4: Brand Continuous (APPROVED, en proyecto Panama) ────────
  const [planBrand] = await db
    .insert(s.mediaPlans)
    .values([
      {
        projectId: projPanama.id,
        name: "Brand Continuous",
        status: "approved",
        currentVersion: 2,
        notesMd: "Plan always-on de marca para Panama Summer.",
      },
    ])
    .returning();

  const [br_yt, br_meta] = await db
    .insert(s.mediaPlanPublishers)
    .values([
      { mediaPlanId: planBrand.id, publisherId: pub("youtube").id, totalPlannedUsd: "120000.00", sortOrder: 0 },
      { mediaPlanId: planBrand.id, publisherId: pub("meta").id,    totalPlannedUsd: "60000.00",  sortOrder: 1 },
    ])
    .returning();

  await db.insert(s.mediaPlanPlacements).values([
    {
      mediaPlanPublisherId: br_yt.id, sortOrder: 0,
      placementName: "Always-On In-Stream", marketId: mkt("latam").id,
      audience: "viajeros frecuentes LATAM",
      amountUsd: "120000.00", costMethod: "dCPV",
      startDate: "2026-03-01", endDate: "2026-08-31",
      metricsJson: { views: 54545454 },
      notesMd: "Brand always-on, 6 meses de pauta continua",
    },
    {
      mediaPlanPublisherId: br_meta.id, sortOrder: 0,
      placementName: "Reels Brand Always-On", marketId: mkt("latam").id,
      audience: "Brand awareness audiencias amplias",
      amountUsd: "60000.00", costMethod: "dCPV",
      startDate: "2026-03-01", endDate: "2026-08-31",
      metricsJson: { views: 5454545 },
      notesMd: "Reels always-on",
    },
  ]);

  await db.insert(s.mediaPlanFees).values([
    { mediaPlanId: planBrand.id, feeType: "management", name: "Management Fee", amountUsd: "0.00", ratePct: "15.00", sortOrder: 0 },
    { mediaPlanId: planBrand.id, feeType: "reporting",  name: "Reporting Fee",  amountUsd: "6000.00",  sortOrder: 1 },
  ]);

  await db.insert(s.mediaPlanSnapshots).values([
    {
      mediaPlanId: planBrand.id, versionNumber: 1,
      approvedAt: new Date("2026-02-15T10:00:00Z"),
      notes: "Aprobación inicial.",
      snapshotJson: { plan: "Brand Continuous v1", totalMedia: 175000, totalFees: 32000 },
    },
    {
      mediaPlanId: planBrand.id, versionNumber: 2,
      approvedAt: new Date("2026-04-12T14:20:00Z"),
      notes: "Revisión Q2: ajuste de presupuesto YouTube +$5K, fees actualizados.",
      snapshotJson: { plan: "Brand Continuous v2", totalMedia: 180000, totalFees: 33000 },
    },
  ]);

  // ─── Plan 5: Promo Lanzamiento (APPROVED, en proyecto Panama) ───────
  const [planPromo] = await db
    .insert(s.mediaPlans)
    .values([
      {
        projectId: projPanama.id,
        name: "Promo Lanzamiento",
        status: "approved",
        currentVersion: 1,
        notesMd: "Burst de lanzamiento de promoción Summer Panama.",
      },
    ])
    .returning();

  const [pr_meta, pr_tt] = await db
    .insert(s.mediaPlanPublishers)
    .values([
      { mediaPlanId: planPromo.id, publisherId: pub("meta").id,   totalPlannedUsd: "40000.00", sortOrder: 0 },
      { mediaPlanId: planPromo.id, publisherId: pub("tiktok").id, totalPlannedUsd: "30000.00", sortOrder: 1 },
    ])
    .returning();

  await db.insert(s.mediaPlanPlacements).values([
    {
      mediaPlanPublisherId: pr_meta.id, sortOrder: 0,
      placementName: "Reels + Feed Promo", marketId: mkt("centroamerica").id,
      audience: "Travel intent + price-sensitive shoppers",
      amountUsd: "40000.00", costMethod: "dCPM",
      startDate: "2026-03-15", endDate: "2026-04-30",
      metricsJson: { impressions: 7700000 },
      notesMd: "Burst de pauta, mensaje promocional",
    },
    {
      mediaPlanPublisherId: pr_tt.id, sortOrder: 0,
      placementName: "Brand Takeover Promo", marketId: mkt("panama").id,
      audience: "jóvenes 18-29 viajeros aspiracionales",
      amountUsd: "30000.00", costMethod: "dCPV",
      startDate: "2026-04-01", endDate: "2026-04-30",
      metricsJson: { views: 1500000 },
      notesMd: "Burst de TikTok",
    },
  ]);

  await db.insert(s.mediaPlanFees).values([
    { mediaPlanId: planPromo.id, feeType: "management", name: "Management Fee", amountUsd: "0.00", ratePct: "15.00", sortOrder: 0 },
    { mediaPlanId: planPromo.id, feeType: "setup",      name: "Set Up Fee",     amountUsd: "500.00",   sortOrder: 1 },
  ]);

  await db.insert(s.mediaPlanSnapshots).values([
    {
      mediaPlanId: planPromo.id, versionNumber: 1,
      approvedAt: new Date("2026-03-08T11:45:00Z"),
      notes: "Aprobación del burst promocional.",
      snapshotJson: { plan: "Promo Lanzamiento v1", totalMedia: 70000, totalFees: 11000 },
    },
  ]);

  // ─── Plan billing de muestra para Awareness (Feb 2026) ──────────────
  console.log("⏳ Plan billings de muestra...");
  const [billAwarenessFeb] = await db
    .insert(s.planBillings)
    .values([
      {
        mediaPlanId: planAwareness.id,
        month: "2026-02",
        status: "paid",
        invoiceNumber: "2026-0001",
        totalNetUsd: "48000.00",
        totalFeeUsd: "9000.00",
        totalUsd: "57000.00",
        sentAt: new Date("2026-03-05T16:00:00Z"),
        paidAt: new Date("2026-03-25T10:30:00Z"),
        dueDate: "2026-04-04",
        notesMd: "Cierre Feb 2026.",
      },
    ])
    .returning();

  await db.insert(s.planBillingPublishers).values([
    {
      planBillingId: billAwarenessFeb.id, publisherId: pub("youtube").id,
      amountRealUsd: "22000.00", isBillable: true,
      notes: "Imputación 50% del Bumper + parcial In-Stream",
    },
    {
      planBillingId: billAwarenessFeb.id, publisherId: pub("meta").id,
      amountRealUsd: "16000.00", isBillable: true,
      notes: "50% Feed + 30% Reels",
    },
    {
      planBillingId: billAwarenessFeb.id, publisherId: pub("tiktok").id,
      amountRealUsd: "10000.00", isBillable: true,
      notes: "50% TikTok In-Feed",
    },
  ]);

  await db.insert(s.planBillingFees).values([
    { planBillingId: billAwarenessFeb.id, mediaPlanFeeId: awarenessFees[0].id, amountImputedUsd: "7500.00", notes: "50% del Mgmt Fee" },
    { planBillingId: billAwarenessFeb.id, mediaPlanFeeId: awarenessFees[1].id, amountImputedUsd: "1000.00", notes: "Set Up completo" },
    { planBillingId: billAwarenessFeb.id, mediaPlanFeeId: awarenessFees[2].id, amountImputedUsd: "500.00",  notes: "Reporting parcial" },
  ]);

  // Marzo en draft (sin emitir)
  await db
    .insert(s.planBillings)
    .values([
      {
        mediaPlanId: planAwareness.id,
        month: "2026-03",
        status: "draft",
        totalNetUsd: "0.00",
        totalFeeUsd: "0.00",
        totalUsd: "0.00",
      },
    ]);

  // ─── Resumen ────────────────────────────────────────────────────────
  console.log("\n✓ Seed completo:");
  console.log(`  · 1 cliente (Copa Airlines)`);
  console.log(`  · 3 budget origins`);
  console.log(`  · 9 publishers + 14 markets + 17 metrics en catálogos`);
  console.log(`  · 3 proyectos`);
  console.log(`  · 5 planes peer (mix de status)`);
  console.log(`  · 17 placements distribuidos`);
  console.log(`  · 12 fees del plan`);
  console.log(`  · 4 snapshots de aprobación`);
  console.log(`  · 2 plan_billings (1 paid + 1 draft)`);

  void [bgTrade, projMiami, planConsideration, planPerformance, planPromo];
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("✗ Seed falló:", err);
    process.exit(1);
  });
