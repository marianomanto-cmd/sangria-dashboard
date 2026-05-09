// Seed con datos de prueba consistentes con el modelo nuevo:
//   1 cliente (Copa Airlines)
//   3 budget origins
//   3 proyectos siguiendo convención COPA.m<id>.<ProjectName>
//   5 planes peer (status mix) con sus publishers + placements + fees
//   1 plan_billing de muestra
//   1 snapshot inmutable del plan approved
//
// Idempotente: limpia las tablas en orden inverso de FK antes de insertar.
// Uso: `npm run db:seed`

import { db } from "@/db";
import * as s from "@/db/schema";

// ─── RNG determinístico ────────────────────────────────────────────────
let _seed = 1337;
const rand = () => {
  _seed = (_seed * 9301 + 49297) % 233280;
  return _seed / 233280;
};
const variance = (min: number, max: number) => min + rand() * (max - min);

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
        endDate: "2026-05-31",
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
        endDate: "2026-08-31",
        totalGrossBudgetUsd: "450000.00",
        notesMd: null,
      },
      {
        clientId: copa.id,
        budgetOriginId: bgTrade.id,
        code: "COPA.m2026C03.MiamiHubGrowth",
        name: "Miami Hub Growth",
        status: "planning",
        startDate: "2026-06-01",
        endDate: "2026-12-31",
        totalGrossBudgetUsd: "200000.00",
        notesMd: null,
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
        periodStart: "2026-02-01",
        periodEnd: "2026-03-31",
        currentVersion: 1,
        notesMd: "Plan upper-funnel para construir conocimiento del destino.",
      },
    ])
    .returning();

  // Publishers + placements + fees del Awareness
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
      placementName: "Bumper Ads 6s", market: "Costa Rica",
      amountUsd: "25000.00", costMethod: "dCPV",
      startDate: "2026-02-01", endDate: "2026-03-31",
      metricsJson: { cpv: 0.0019, est_views: 13157894, est_imp: 14500000 },
      notesMd: "Audiencia: 25-44 viajeros frecuentes\nFormato: video vertical + horizontal\nCreatividad: 3 versiones rotativas",
    },
    {
      mediaPlanPublisherId: aw_yt.id, sortOrder: 1,
      placementName: "In-Stream Skippable", market: "Centroamérica (PA, CR, GT, NI, HN)",
      amountUsd: "20000.00", costMethod: "dCPV",
      startDate: "2026-02-15", endDate: "2026-03-31",
      metricsJson: { cpv: 0.0028, est_views: 7142857, est_imp: 9500000 },
      notesMd: "Audiencia: 18-44 LATAM travel intent\nFormato: video 15-30s",
    },
    {
      mediaPlanPublisherId: aw_meta.id, sortOrder: 0,
      placementName: "Feed Awareness", market: "Costa Rica",
      amountUsd: "18000.00", costMethod: "dCPM",
      startDate: "2026-02-01", endDate: "2026-03-31",
      metricsJson: { cpm: 4.5, est_imp: 4000000, est_reach: 1200000 },
      notesMd: "Audiencia: travelers + lookalike\nFormato: feed estático + carrusel",
    },
    {
      mediaPlanPublisherId: aw_meta.id, sortOrder: 1,
      placementName: "Reels Brand", market: "Costa Rica + LATAM",
      amountUsd: "17000.00", costMethod: "dCPV",
      startDate: "2026-02-15", endDate: "2026-03-31",
      metricsJson: { cpv: 0.012, est_views: 1416666, est_imp: 2500000 },
      notesMd: "Audiencia: 18-34\nFormato: video vertical 9:16",
    },
    {
      mediaPlanPublisherId: aw_tt.id, sortOrder: 0,
      placementName: "In-Feed Top View", market: "18-34 LATAM",
      amountUsd: "20000.00", costMethod: "dCPV",
      startDate: "2026-02-01", endDate: "2026-03-31",
      metricsJson: { cpv: 0.018, est_views: 1111111, est_imp: 1800000 },
      notesMd: "Audiencia: 18-34 jóvenes viajeros\nFormato: video full-screen vertical",
    },
  ]);

  const awarenessFees = await db
    .insert(s.mediaPlanFees)
    .values([
      { mediaPlanId: planAwareness.id, feeType: "management", name: "Management Fee", amountUsd: "15000.00", sortOrder: 0 },
      { mediaPlanId: planAwareness.id, feeType: "setup",      name: "Set Up Fee",     amountUsd: "1000.00",  sortOrder: 1 },
      { mediaPlanId: planAwareness.id, feeType: "reporting",  name: "Reporting Fee",  amountUsd: "2000.00",  sortOrder: 2 },
    ])
    .returning();

  // Snapshot del plan Awareness al momento de su aprobación.
  await db.insert(s.mediaPlanSnapshots).values([
    {
      mediaPlanId: planAwareness.id,
      versionNumber: 1,
      approvedAt: new Date("2026-01-28T15:30:00Z"),
      notes: "Aprobación inicial del plan, firmado por la cuenta del cliente.",
      snapshotJson: {
        plan: { name: "Awareness", periodStart: "2026-02-01", periodEnd: "2026-03-31" },
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
        periodStart: "2026-03-01",
        periodEnd: "2026-04-30",
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
      placementName: "Reels Consideration", market: "Costa Rica + LATAM",
      amountUsd: "15000.00", costMethod: "dCPV",
      startDate: "2026-03-01", endDate: "2026-04-30",
      metricsJson: { cpv: 0.014 },
      notesMd: "Audiencia: retargeting de Awareness + interest groups",
    },
    {
      mediaPlanPublisherId: co_meta.id, sortOrder: 1,
      placementName: "Carousel Destinations", market: "Costa Rica",
      amountUsd: "10000.00", costMethod: "dCPC",
      startDate: "2026-03-15", endDate: "2026-04-30",
      metricsJson: { cpc: 0.45, est_clicks: 22222 },
      notesMd: "Audiencia: travel intent\nFormato: carrusel multi-destino",
    },
    {
      mediaPlanPublisherId: co_yt.id, sortOrder: 0,
      placementName: "In-Stream Mid-Funnel", market: "LATAM",
      amountUsd: "20000.00", costMethod: "dCPV",
      startDate: "2026-03-01", endDate: "2026-04-30",
      metricsJson: { cpv: 0.0025 },
      notesMd: "Audiencia: lookalike de Awareness viewers",
    },
    {
      mediaPlanPublisherId: co_disp.id, sortOrder: 0,
      placementName: "Programmatic Display", market: "Centroamérica",
      amountUsd: "10000.00", costMethod: "CPM",
      startDate: "2026-03-01", endDate: "2026-04-30",
      metricsJson: { cpm: 3.2 },
      notesMd: "Audiencia: travel intent + retargeting site visitors",
    },
  ]);

  await db.insert(s.mediaPlanFees).values([
    { mediaPlanId: planConsideration.id, feeType: "management", name: "Management Fee", amountUsd: "8500.00",  sortOrder: 0 },
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
        periodStart: "2026-04-01",
        periodEnd: "2026-05-31",
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
      placementName: "Brand Defense", market: "Costa Rica + Centroamérica",
      amountUsd: "12000.00", costMethod: "CPC",
      startDate: "2026-04-01", endDate: "2026-05-31",
      metricsJson: { cpc: 0.35, est_clicks: 34285 },
      notesMd: "Brand keywords + competitor defense",
    },
    {
      mediaPlanPublisherId: pe_search.id, sortOrder: 1,
      placementName: "Non-Brand Travel Intent", market: "LATAM",
      amountUsd: "18000.00", costMethod: "CPC",
      startDate: "2026-04-01", endDate: "2026-05-31",
      metricsJson: { cpc: 0.85, est_clicks: 21176 },
      notesMd: "Audiencia: searchers de \"vuelos a costa rica\", \"hoteles tamarindo\", etc.",
    },
    {
      mediaPlanPublisherId: pe_meta.id, sortOrder: 0,
      placementName: "Conversion Campaign", market: "Costa Rica + LATAM",
      amountUsd: "25000.00", costMethod: "CPA",
      startDate: "2026-04-01", endDate: "2026-05-31",
      metricsJson: { cpa: 18, est_conversions: 1388 },
      notesMd: "Optimización por compra de pasaje\nFormato: feed + reels\nAudiencia: warm + lookalike",
    },
  ]);

  await db.insert(s.mediaPlanFees).values([
    { mediaPlanId: planPerformance.id, feeType: "management", name: "Management Fee", amountUsd: "9500.00", sortOrder: 0 },
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
        periodStart: "2026-03-01",
        periodEnd: "2026-08-31",
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
      placementName: "Always-On In-Stream", market: "LATAM",
      amountUsd: "120000.00", costMethod: "dCPV",
      startDate: "2026-03-01", endDate: "2026-08-31",
      metricsJson: { cpv: 0.0022 },
      notesMd: "Brand always-on, 6 meses de pauta continua",
    },
    {
      mediaPlanPublisherId: br_meta.id, sortOrder: 0,
      placementName: "Reels Brand Always-On", market: "LATAM",
      amountUsd: "60000.00", costMethod: "dCPV",
      startDate: "2026-03-01", endDate: "2026-08-31",
      metricsJson: { cpv: 0.011 },
      notesMd: "Brand awareness Reels",
    },
  ]);

  await db.insert(s.mediaPlanFees).values([
    { mediaPlanId: planBrand.id, feeType: "management", name: "Management Fee", amountUsd: "27000.00", sortOrder: 0 },
    { mediaPlanId: planBrand.id, feeType: "reporting",  name: "Reporting Fee",  amountUsd: "6000.00",  sortOrder: 1 },
  ]);

  // Dos snapshots: v1 (initial approval) + v2 (current — minor revision)
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
        periodStart: "2026-03-15",
        periodEnd: "2026-04-30",
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
      placementName: "Reels + Feed Promo", market: "Centroamérica",
      amountUsd: "40000.00", costMethod: "dCPM",
      startDate: "2026-03-15", endDate: "2026-04-30",
      metricsJson: { cpm: 5.2, est_imp: 7700000 },
      notesMd: "Burst de pauta, mensaje promocional",
    },
    {
      mediaPlanPublisherId: pr_tt.id, sortOrder: 0,
      placementName: "Brand Takeover Promo", market: "Panama + LATAM jóvenes",
      amountUsd: "30000.00", costMethod: "dCPV",
      startDate: "2026-04-01", endDate: "2026-04-30",
      metricsJson: { cpv: 0.020 },
      notesMd: "Burst de TikTok para jóvenes viajeros",
    },
  ]);

  await db.insert(s.mediaPlanFees).values([
    { mediaPlanId: planPromo.id, feeType: "management", name: "Management Fee", amountUsd: "10500.00", sortOrder: 0 },
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
  const [billAwarenessMar] = await db
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
    ])
    .returning();

  // ─── Resumen ────────────────────────────────────────────────────────
  console.log("\n✓ Seed completo:");
  console.log(`  · 1 cliente (Copa Airlines)`);
  console.log(`  · 3 budget origins (Online / CMI / Trade)`);
  console.log(`  · 9 publishers en catálogo`);
  console.log(`  · 3 proyectos`);
  console.log(`  · 5 planes peer (Awareness/Consideration/Performance + Brand/Promo)`);
  console.log(`  · 17 placements distribuidos`);
  console.log(`  · 12 fees del plan`);
  console.log(`  · 4 snapshots de aprobación`);
  console.log(`  · 2 plan_billings (1 paid + 1 draft)`);

  // Suprimimos linter de variables del seed que usamos para validación o
  // que quedan reservadas para data adicional cuando se necesite.
  void [bgTrade, projMiami, planConsideration, planPerformance, planPromo, billAwarenessMar];
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("✗ Seed falló:", err);
    process.exit(1);
  });
