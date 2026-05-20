// Seed con datos de prueba para una demo realista.
//
// Cubre:
//   · 4 clientes en distintos estados (active / paused), cada uno con su
//     propio subset de publishers y su propia regla de "agencia/cliente paga"
//   · Catálogos per-cliente: publishers + markets + metrics (cada cliente
//     tiene su propia lista; no hay catálogo global)
//   · 9 proyectos cubriendo TODOS los estados: planning / active / paused / closed
//   · ~14 planes peer cubriendo TODOS los estados: draft / ready_to_send /
//     approved / archived
//   · Billings de muestra (paid + sent + draft) para alimentar la estimación
//     y el módulo de billing
//   · Snapshots de aprobación
//
// Idempotente: limpia las tablas en orden inverso de FK antes de insertar.
// Uso: `npm run db:seed`

import { eq } from "drizzle-orm";
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
  await db.delete(s.projectReports);
  await db.delete(s.projects);
  await db.delete(s.budgetOrigins);
  await db.delete(s.publishers);
  await db.delete(s.markets);
  await db.delete(s.metricsCatalog);
  await db.delete(s.clients);

  // ════════════════════════════════════════════════════════════════════════
  // Catálogos per-cliente
  // ════════════════════════════════════════════════════════════════════════

  // Nombres "lindos" por slug — para sembrar los publishers per-cliente abajo.
  const PUBLISHER_NAMES: Record<string, string> = {
    youtube: "YouTube",
    meta: "Meta",
    tiktok: "TikTok",
    dv360: "DV360",
    display: "Display",
    search: "Google Search",
    spotify: "Spotify",
    ooh: "OOH (Out of Home)",
    programmatic: "Programmatic",
    linkedin: "LinkedIn",
    x: "X (Twitter)",
  };

  // El catálogo de publishers, markets y metricas ahora es per-cliente. Lo armamos
  // después de insertar los clientes — ver más abajo.
  console.log("⏳ Catálogo de mercados y métricas: skipped (per cliente, después)");

  // ════════════════════════════════════════════════════════════════════════
  // Clientes — 4 con perfiles distintos
  // ════════════════════════════════════════════════════════════════════════

  console.log("⏳ Clientes...");
  const [copa, cra, bpac, tr] = await db
    .insert(s.clients)
    .values([
      { name: "Copa Airlines",      slug: "copa", prefix: "COPA", status: "active", language: "es" },
      { name: "Cervecería Andina",  slug: "andina", prefix: "CRA", status: "active", language: "es" },
      { name: "Banco Pacífico",     slug: "bpac", prefix: "BPAC", status: "active", language: "en" },
      { name: "Tienda Roma",        slug: "tienda-roma", prefix: "TR", status: "paused", language: "es" },
    ])
    .returning();

  // ════════════════════════════════════════════════════════════════════════
  // Markets y métricas per-cliente — replicamos la misma lista para cada uno
  // para demo. En prod cada cliente edita los suyos.
  // ════════════════════════════════════════════════════════════════════════

  console.log("⏳ Markets per cliente (replicados)...");
  const MARKETS_TEMPLATE = [
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
    { slug: "centroamerica", name: "Centroamérica", sortOrder: 50 },
    { slug: "latam", name: "LATAM", sortOrder: 51 },
  ] as const;

  const allClientsForCatalog = [copa, cra, bpac, tr];
  const mktRows = await db
    .insert(s.markets)
    .values(
      allClientsForCatalog.flatMap((c) =>
        MARKETS_TEMPLATE.map((m) => ({ ...m, clientId: c.id })),
      ),
    )
    .returning();
  const mktByClientAndSlug = new Map(
    mktRows.map((m) => [`${m.clientId}|${m.slug}`, m]),
  );
  const mkt = (clientId: string, slug: string) => {
    const k = `${clientId}|${slug}`;
    const m = mktByClientAndSlug.get(k);
    if (!m)
      throw new Error(`Market ${slug} no existe para cliente ${clientId}`);
    return m;
  };

  console.log("⏳ Métricas per cliente (replicadas)...");
  const METRICS_TEMPLATE = [
    { slug: "impressions", name: "Impressions", kind: "direct" as const, unit: "imp", sortOrder: 0 },
    { slug: "clicks",      name: "Clicks",      kind: "direct" as const, unit: "click", sortOrder: 1 },
    { slug: "views",       name: "Video Views", kind: "direct" as const, unit: "view", sortOrder: 2 },
    { slug: "conversions", name: "Conversions", kind: "direct" as const, unit: "conv", sortOrder: 3 },
    { slug: "reach",       name: "Reach único", kind: "direct" as const, unit: "users", sortOrder: 4 },
    { slug: "frequency",   name: "Frequency",   kind: "direct" as const, unit: "freq", sortOrder: 5 },
    { slug: "engagements", name: "Engagements", kind: "direct" as const, unit: "eng", sortOrder: 6 },
    { slug: "followers",   name: "Followers",   kind: "direct" as const, unit: "users", sortOrder: 7 },
    { slug: "leads",       name: "Leads",       kind: "direct" as const, unit: "leads", sortOrder: 8 },
    { slug: "installs",    name: "App Installs", kind: "direct" as const, unit: "installs", sortOrder: 9 },
    { slug: "visits",      name: "Site Visits", kind: "direct" as const, unit: "visits", sortOrder: 10 },
    { slug: "ctr",   name: "CTR",  kind: "calculated" as const, unit: "%", formula: "clicks / impressions", sortOrder: 50 },
    { slug: "cpc",   name: "CPC",  kind: "calculated" as const, unit: "$", formula: "amount / clicks", sortOrder: 51 },
    { slug: "cpm",   name: "CPM",  kind: "calculated" as const, unit: "$", formula: "amount / impressions × 1000", sortOrder: 52 },
    { slug: "cpv",   name: "CPV",  kind: "calculated" as const, unit: "$", formula: "amount / views", sortOrder: 53 },
    { slug: "cpa",   name: "CPA",  kind: "calculated" as const, unit: "$", formula: "amount / conversions", sortOrder: 54 },
    { slug: "vtr",   name: "VTR (View-Through Rate)", kind: "calculated" as const, unit: "%", formula: "views / impressions", sortOrder: 55 },
    { slug: "cpr",   name: "CPR (Cost per Reach)",       kind: "calculated" as const, unit: "$", formula: "amount / reach",       sortOrder: 56 },
    { slug: "cpe",   name: "CPE (Cost per Engagement)",  kind: "calculated" as const, unit: "$", formula: "amount / engagements", sortOrder: 57 },
    { slug: "cpf",   name: "CPF (Cost per Follower)",    kind: "calculated" as const, unit: "$", formula: "amount / followers",   sortOrder: 58 },
    { slug: "cpl",   name: "CPL (Cost per Lead)",        kind: "calculated" as const, unit: "$", formula: "amount / leads",       sortOrder: 59 },
    { slug: "cpi",   name: "CPI (Cost per Install)",     kind: "calculated" as const, unit: "$", formula: "amount / installs",    sortOrder: 60 },
    { slug: "cpvis", name: "CPVis (Cost per Visit)",     kind: "calculated" as const, unit: "$", formula: "amount / visits",      sortOrder: 61 },
  ];
  await db.insert(s.metricsCatalog).values(
    allClientsForCatalog.flatMap((c) =>
      METRICS_TEMPLATE.map((m) => ({ ...m, clientId: c.id })),
    ),
  );

  // Banco Pacífico además tiene una conversión custom — demo de la nueva
  // capacidad per-cliente.
  await db.insert(s.metricsCatalog).values({
    clientId: bpac.id,
    slug: "card_applications",
    name: "Solicitudes de tarjeta",
    kind: "direct",
    unit: "apps",
    sortOrder: 11,
  });

  // ════════════════════════════════════════════════════════════════════════
  // Publishers per-cliente. Cada cliente tiene su propia lista, con su slug,
  // nombre, regla de pago (agencia / cliente) y orden.
  // ════════════════════════════════════════════════════════════════════════

  console.log("⏳ Publishers per cliente...");

  const CLIENT_PUBLISHERS: {
    clientId: string;
    list: { slug: string; agencyPays: boolean }[];
  }[] = [
    // Copa: catálogo amplio, agencia paga casi todo (excepto OOH).
    {
      clientId: copa.id,
      list: [
        { slug: "youtube", agencyPays: true },
        { slug: "meta", agencyPays: true },
        { slug: "tiktok", agencyPays: true },
        { slug: "dv360", agencyPays: true },
        { slug: "display", agencyPays: true },
        { slug: "search", agencyPays: true },
        { slug: "spotify", agencyPays: true },
        { slug: "ooh", agencyPays: false },
        { slug: "programmatic", agencyPays: true },
      ],
    },
    // Cervecería Andina: foco social. Spotify = cliente paga directo.
    {
      clientId: cra.id,
      list: [
        { slug: "youtube", agencyPays: true },
        { slug: "meta", agencyPays: true },
        { slug: "tiktok", agencyPays: true },
        { slug: "spotify", agencyPays: false },
        { slug: "programmatic", agencyPays: true },
        { slug: "x", agencyPays: true },
      ],
    },
    // Banco Pacífico: B2B / display-heavy + LinkedIn. OOH = agencia paga.
    {
      clientId: bpac.id,
      list: [
        { slug: "search", agencyPays: true },
        { slug: "display", agencyPays: true },
        { slug: "meta", agencyPays: true },
        { slug: "linkedin", agencyPays: true },
        { slug: "programmatic", agencyPays: true },
        { slug: "ooh", agencyPays: true },
      ],
    },
    // Tienda Roma: catálogo mínimo.
    {
      clientId: tr.id,
      list: [
        { slug: "meta", agencyPays: true },
        { slug: "tiktok", agencyPays: true },
        { slug: "search", agencyPays: true },
      ],
    },
  ];

  const pubRowsSeed = await db
    .insert(s.publishers)
    .values(
      CLIENT_PUBLISHERS.flatMap((c) =>
        c.list.map((p, i) => ({
          clientId: c.clientId,
          slug: p.slug,
          name: PUBLISHER_NAMES[p.slug] ?? p.slug,
          agencyPays: p.agencyPays,
          enabled: true,
          sortOrder: i,
        })),
      ),
    )
    .returning();

  const pubByClientAndSlug = new Map(
    pubRowsSeed.map((p) => [`${p.clientId}|${p.slug}`, p]),
  );
  const pubFor = (clientId: string, slug: string) => {
    const p = pubByClientAndSlug.get(`${clientId}|${slug}`);
    if (!p)
      throw new Error(`Publisher ${slug} no existe para cliente ${clientId}`);
    return p;
  };

  // ════════════════════════════════════════════════════════════════════════
  // Budget Origins por cliente
  // ════════════════════════════════════════════════════════════════════════

  console.log("⏳ Budget origins...");
  const [bgOnline, bgCmi, bgTrade] = await db
    .insert(s.budgetOrigins)
    .values([
      { clientId: copa.id, name: "Online", colorHex: "#7a1f3d" },
      { clientId: copa.id, name: "CMI", colorHex: "#5e1730" },
      { clientId: copa.id, name: "Trade", colorHex: "#8b2a52" },
    ])
    .returning();

  const [bgCraBrand, bgCraPromo] = await db
    .insert(s.budgetOrigins)
    .values([
      { clientId: cra.id, name: "Brand", colorHex: "#b56a17" },
      { clientId: cra.id, name: "Promo", colorHex: "#d18a3b" },
    ])
    .returning();

  const [bgBpacRetail, bgBpacCorp] = await db
    .insert(s.budgetOrigins)
    .values([
      { clientId: bpac.id, name: "Retail", colorHex: "#1f4d8c" },
      { clientId: bpac.id, name: "Corporate", colorHex: "#2c6bb8" },
    ])
    .returning();

  const [bgTrGen] = await db
    .insert(s.budgetOrigins)
    .values([
      { clientId: tr.id, name: "General", colorHex: "#4f4f4f" },
    ])
    .returning();

  // ════════════════════════════════════════════════════════════════════════
  // Proyectos — todos los estados representados
  // ════════════════════════════════════════════════════════════════════════

  console.log("⏳ Proyectos...");
  const [
    projCR,        // active
    projPanama,    // active
    projMiami,     // planning
    projBogota,    // paused
    projLegacy,    // closed
    projCraIPA,    // active
    projCraVerano, // planning
    projBpacJov,   // active
    projBpacPrest, // active
    projBpacCierre,// closed
    projTrBF,      // closed
  ] = await db
    .insert(s.projects)
    .values([
      // ─── Copa Airlines ─────────────────────────────────────────
      {
        clientId: copa.id, budgetOriginId: bgOnline.id,
        code: "COPA.m2026A01.CostaRica2026", name: "Costa Rica 2026",
        status: "active", startDate: "2026-02-01",
        totalGrossBudgetUsd: "300000.00",
        notesMd: "Campaña multi-funnel para promoción de Costa Rica. Awareness + Consideration + Performance.",
      },
      {
        clientId: copa.id, budgetOriginId: bgCmi.id,
        code: "COPA.m2026B02.PanamaSummer", name: "Panama Summer 2026",
        status: "active", startDate: "2026-03-01",
        totalGrossBudgetUsd: "450000.00",
      },
      {
        clientId: copa.id, budgetOriginId: bgTrade.id,
        code: "COPA.m2026C03.MiamiHubGrowth", name: "Miami Hub Growth",
        status: "planning", startDate: "2026-06-01",
        totalGrossBudgetUsd: "200000.00",
      },
      {
        clientId: copa.id, budgetOriginId: bgOnline.id,
        code: "COPA.m2026D04.BogotaHubExpansion", name: "Bogota Hub Expansion",
        status: "paused", startDate: "2026-04-01",
        totalGrossBudgetUsd: "180000.00",
        notesMd: "Pausado en mayo por restructuración del hub. Se reactiva Q3.",
      },
      {
        clientId: copa.id, budgetOriginId: bgOnline.id,
        code: "COPA.m2025X01.LegacyEoY2025", name: "End of Year 2025",
        status: "closed", startDate: "2025-10-01",
        totalGrossBudgetUsd: "250000.00",
        notesMd: "Cerrado en enero 2026.",
      },
      // ─── Cervecería Andina ─────────────────────────────────────
      {
        clientId: cra.id, budgetOriginId: bgCraBrand.id,
        code: "CRA.m2026E01.LanzamientoIPA", name: "Lanzamiento IPA Cordillera",
        status: "active", startDate: "2026-04-01",
        totalGrossBudgetUsd: "120000.00",
        notesMd: "Lanzamiento de nueva línea premium.",
      },
      {
        clientId: cra.id, budgetOriginId: bgCraPromo.id,
        code: "CRA.m2026F02.VeranoBrand", name: "Verano Brand 2026",
        status: "planning", startDate: "2026-11-15",
        totalGrossBudgetUsd: "90000.00",
        notesMd: "Campaña de verano sur — arranca Q4.",
      },
      // ─── Banco Pacífico ────────────────────────────────────────
      {
        clientId: bpac.id, budgetOriginId: bgBpacRetail.id,
        code: "BPAC.m2026G01.CuentasJovenes", name: "Cuentas Jóvenes 2026",
        status: "active", startDate: "2026-03-01",
        totalGrossBudgetUsd: "180000.00",
        notesMd: "Adquisición de cuentas para 18-29.",
      },
      {
        clientId: bpac.id, budgetOriginId: bgBpacCorp.id,
        code: "BPAC.m2026H02.PrestamosDigitales", name: "Préstamos Digitales",
        status: "active", startDate: "2026-04-15",
        totalGrossBudgetUsd: "140000.00",
      },
      {
        clientId: bpac.id, budgetOriginId: bgBpacRetail.id,
        code: "BPAC.m2025Y01.Clausura2025", name: "Clausura Año 2025",
        status: "closed", startDate: "2025-11-01",
        totalGrossBudgetUsd: "95000.00",
      },
      // ─── Tienda Roma ───────────────────────────────────────────
      {
        clientId: tr.id, budgetOriginId: bgTrGen.id,
        code: "TR.m2025Z01.BlackFriday2025", name: "Black Friday 2025",
        status: "closed", startDate: "2025-10-15",
        totalGrossBudgetUsd: "45000.00",
      },
    ])
    .returning();

  // ════════════════════════════════════════════════════════════════════════
  // Reporting Calendar — un row por proyecto closed. Tres escenarios de demo:
  //   · projLegacy        → cerrado hace ~50d, sin delivery_date (pending).
  //   · projBpacCierre    → cerrado hace ~30d, delivery_date a +7d desde hoy
  //                         (assigned hace 3d) — caso "en plazo".
  //   · projTrBF          → cerrado hace ~25d, delivery_date a -5d desde hoy
  //                         (assigned hace 15d) — caso "atrasado".
  // ════════════════════════════════════════════════════════════════════════
  console.log("⏳ Project reports (reporting calendar demo)...");
  const now = new Date();
  const daysAgo = (d: number) => {
    const t = new Date(now);
    t.setDate(t.getDate() - d);
    return t;
  };
  const isoDate = (d: Date) => d.toISOString().slice(0, 10);
  await db.insert(s.projectReports).values([
    { projectId: projLegacy.id, closedAt: daysAgo(50) },
    {
      projectId: projBpacCierre.id,
      closedAt: daysAgo(30),
      deliveryDate: isoDate(daysAgo(-7)),
      deliveryDateAssignedAt: daysAgo(3),
    },
    {
      projectId: projTrBF.id,
      closedAt: daysAgo(25),
      deliveryDate: isoDate(daysAgo(5)),
      deliveryDateAssignedAt: daysAgo(15),
    },
  ]);

  // ════════════════════════════════════════════════════════════════════════
  // Helpers para insertar planes con publishers + placements + fees
  // ════════════════════════════════════════════════════════════════════════

  type PlacementSpec = {
    name: string;
    marketSlug: string;
    audience?: string;
    amount: number;
    costMethod?: "dCPV" | "dCPC" | "dCPM" | "dCPA" | "CPM" | "CPC" | "CPV" | "CPA" | "Flat" | "Other";
    startDate: string;
    endDate: string;
    metricsJson?: Record<string, number>;
    notesMd?: string;
  };

  type FeeSpec =
    | { type: "management"; name: string; ratePct: number; notes?: string }
    | { type: "setup" | "reporting" | "custom"; name: string; amount: number; notes?: string };

  type PublisherSpec = {
    slug: string;
    totalPlanned: number;
    placements: PlacementSpec[];
  };

  async function createPlan(args: {
    projectId: string;
    name: string;
    status: "draft" | "ready_to_send" | "approved" | "archived";
    notesMd?: string;
    publishers: PublisherSpec[];
    fees: FeeSpec[];
    snapshots?: { version: number; approvedAt: Date; notes?: string }[];
  }) {
    // Cada placement necesita el market_id del cliente correspondiente. Los
    // markets ahora son per-cliente, así que lo resolvemos por el cliente
    // del proyecto en el que vive el plan.
    const projRows = await db
      .select({ clientId: s.projects.clientId })
      .from(s.projects)
      .where(eq(s.projects.id, args.projectId))
      .limit(1);
    const planClientId = projRows[0]?.clientId;
    if (!planClientId) {
      throw new Error(`Proyecto ${args.projectId} no encontrado al crear plan ${args.name}`);
    }

    const [plan] = await db
      .insert(s.mediaPlans)
      .values({
        projectId: args.projectId,
        name: args.name,
        status: args.status,
        currentVersion:
          args.status === "approved" || args.status === "archived"
            ? args.snapshots?.length ?? 1
            : 0,
        notesMd: args.notesMd ?? null,
      })
      .returning();

    const insertedPubs: { id: string; slug: string }[] = [];
    for (let i = 0; i < args.publishers.length; i++) {
      const psp = args.publishers[i];
      const [mpp] = await db
        .insert(s.mediaPlanPublishers)
        .values({
          mediaPlanId: plan.id,
          publisherId: pubFor(planClientId, psp.slug).id,
          totalPlannedUsd: psp.totalPlanned.toFixed(2),
          sortOrder: i,
        })
        .returning();
      insertedPubs.push({ id: mpp.id, slug: psp.slug });

      if (psp.placements.length > 0) {
        await db.insert(s.mediaPlanPlacements).values(
          psp.placements.map((pl, j) => ({
            mediaPlanPublisherId: mpp.id,
            sortOrder: j,
            placementName: pl.name,
            marketId: mkt(planClientId, pl.marketSlug).id,
            audience: pl.audience ?? null,
            amountUsd: pl.amount.toFixed(2),
            costMethod: pl.costMethod ?? null,
            startDate: pl.startDate,
            endDate: pl.endDate,
            metricsJson: pl.metricsJson ?? {},
            notesMd: pl.notesMd ?? null,
          })),
        );
      }
    }

    const feeRows = await db
      .insert(s.mediaPlanFees)
      .values(
        args.fees.map((f, i) =>
          f.type === "management"
            ? {
                mediaPlanId: plan.id,
                feeType: "management" as const,
                name: f.name,
                amountUsd: "0.00",
                ratePct: f.ratePct.toFixed(2),
                notes: f.notes ?? null,
                sortOrder: i,
              }
            : {
                mediaPlanId: plan.id,
                feeType: f.type,
                name: f.name,
                amountUsd: f.amount.toFixed(2),
                ratePct: null,
                notes: f.notes ?? null,
                sortOrder: i,
              },
        ),
      )
      .returning();

    if (args.snapshots && args.snapshots.length > 0) {
      await db.insert(s.mediaPlanSnapshots).values(
        args.snapshots.map((sn) => ({
          mediaPlanId: plan.id,
          versionNumber: sn.version,
          approvedAt: sn.approvedAt,
          notes: sn.notes ?? null,
          snapshotJson: { plan: args.name, version: sn.version },
        })),
      );
    }

    return { plan, publishers: insertedPubs, fees: feeRows };
  }

  // ════════════════════════════════════════════════════════════════════════
  // Planes — Copa Airlines / Costa Rica 2026
  // ════════════════════════════════════════════════════════════════════════

  console.log("⏳ Planes — Costa Rica 2026...");

  const awareness = await createPlan({
    projectId: projCR.id,
    name: "Awareness",
    status: "approved",
    notesMd: "Plan upper-funnel para construir conocimiento del destino.",
    publishers: [
      {
        slug: "youtube",
        totalPlanned: 45000,
        placements: [
          {
            name: "Bumper Ads 6s", marketSlug: "costa-rica",
            audience: "25-44 viajeros frecuentes",
            amount: 25000, costMethod: "dCPV",
            startDate: "2026-02-01", endDate: "2026-03-31",
            metricsJson: { views: 13157894, impressions: 14500000 },
            notesMd: "Formato: video vertical + horizontal. 3 versiones rotativas.",
          },
          {
            name: "In-Stream Skippable", marketSlug: "centroamerica",
            audience: "18-44 LATAM travel intent",
            amount: 20000, costMethod: "dCPV",
            startDate: "2026-02-15", endDate: "2026-03-31",
            metricsJson: { views: 7142857, impressions: 9500000 },
          },
        ],
      },
      {
        slug: "meta",
        totalPlanned: 35000,
        placements: [
          {
            name: "Feed Awareness", marketSlug: "costa-rica",
            audience: "travelers + lookalike de site visitors",
            amount: 18000, costMethod: "dCPM",
            startDate: "2026-02-01", endDate: "2026-03-31",
            metricsJson: { impressions: 4000000, reach: 1200000 },
            notesMd: "Formato: feed estático + carrusel.",
          },
          {
            name: "Reels Brand", marketSlug: "latam",
            audience: "18-34 viajeros activos",
            amount: 17000, costMethod: "dCPV",
            startDate: "2026-02-15", endDate: "2026-03-31",
            metricsJson: { views: 1416666, impressions: 2500000 },
          },
        ],
      },
      {
        slug: "tiktok",
        totalPlanned: 20000,
        placements: [
          {
            name: "In-Feed Top View", marketSlug: "latam",
            audience: "18-34 jóvenes viajeros",
            amount: 20000, costMethod: "dCPV",
            startDate: "2026-02-01", endDate: "2026-03-31",
            metricsJson: { views: 1111111, impressions: 1800000 },
          },
        ],
      },
    ],
    fees: [
      { type: "management", name: "Management Fee", ratePct: 15 },
      { type: "setup", name: "Set Up Fee", amount: 1000 },
      { type: "reporting", name: "Reporting Fee", amount: 2000 },
    ],
    snapshots: [
      {
        version: 1,
        approvedAt: new Date("2026-01-28T15:30:00Z"),
        notes: "Aprobación inicial del plan.",
      },
    ],
  });

  const consideration = await createPlan({
    projectId: projCR.id,
    name: "Consideration",
    status: "draft",
    notesMd: "Plan mid-funnel para mover audiencias a consideración. Solapa con Awareness en Marzo.",
    publishers: [
      {
        slug: "meta",
        totalPlanned: 25000,
        placements: [
          {
            name: "Reels Consideration", marketSlug: "latam",
            audience: "retargeting de Awareness viewers + travel interest groups",
            amount: 15000, costMethod: "dCPV",
            startDate: "2026-03-01", endDate: "2026-04-30",
            metricsJson: { views: 1071428 },
          },
          {
            name: "Carousel Destinations", marketSlug: "costa-rica",
            audience: "travel intent searchers",
            amount: 10000, costMethod: "dCPC",
            startDate: "2026-03-15", endDate: "2026-04-30",
            metricsJson: { clicks: 22222 },
          },
        ],
      },
      {
        slug: "youtube",
        totalPlanned: 20000,
        placements: [
          {
            name: "In-Stream Mid-Funnel", marketSlug: "latam",
            audience: "lookalike de Awareness viewers",
            amount: 20000, costMethod: "dCPV",
            startDate: "2026-03-01", endDate: "2026-04-30",
            metricsJson: { views: 8000000 },
          },
        ],
      },
      {
        slug: "display",
        totalPlanned: 10000,
        placements: [
          {
            name: "Programmatic Display", marketSlug: "centroamerica",
            audience: "travel intent + retargeting site visitors",
            amount: 10000, costMethod: "CPM",
            startDate: "2026-03-01", endDate: "2026-04-30",
            metricsJson: { impressions: 3125000 },
          },
        ],
      },
    ],
    fees: [
      { type: "management", name: "Management Fee", ratePct: 15 },
      { type: "setup", name: "Set Up Fee", amount: 500 },
      { type: "reporting", name: "Reporting Fee", amount: 2000 },
    ],
  });

  const performance = await createPlan({
    projectId: projCR.id,
    name: "Performance",
    status: "ready_to_send",
    notesMd: "Plan lower-funnel: search + conversion. Esperando firma del cliente.",
    publishers: [
      {
        slug: "search",
        totalPlanned: 30000,
        placements: [
          {
            name: "Brand Defense", marketSlug: "centroamerica",
            audience: "Brand keywords + competitor defense",
            amount: 12000, costMethod: "CPC",
            startDate: "2026-04-01", endDate: "2026-05-31",
            metricsJson: { clicks: 34285 },
          },
          {
            name: "Non-Brand Travel Intent", marketSlug: "latam",
            audience: 'searchers de "vuelos a costa rica", "hoteles tamarindo"',
            amount: 18000, costMethod: "CPC",
            startDate: "2026-04-01", endDate: "2026-05-31",
            metricsJson: { clicks: 21176 },
          },
        ],
      },
      {
        slug: "meta",
        totalPlanned: 25000,
        placements: [
          {
            name: "Conversion Campaign", marketSlug: "latam",
            audience: "warm + lookalike de compradores",
            amount: 25000, costMethod: "CPA",
            startDate: "2026-04-01", endDate: "2026-05-31",
            metricsJson: { conversions: 1388 },
          },
        ],
      },
    ],
    fees: [
      { type: "management", name: "Management Fee", ratePct: 15 },
      { type: "setup", name: "Set Up Fee", amount: 500 },
    ],
  });

  // Plan archivado de Costa Rica (versión vieja reemplazada)
  await createPlan({
    projectId: projCR.id,
    name: "Awareness Q1 (legacy)",
    status: "archived",
    notesMd: "Versión inicial Q1 reemplazada por el plan Awareness actual.",
    publishers: [
      {
        slug: "youtube",
        totalPlanned: 30000,
        placements: [
          {
            name: "Bumper Ads", marketSlug: "costa-rica",
            amount: 30000, costMethod: "dCPV",
            startDate: "2026-01-15", endDate: "2026-02-28",
            metricsJson: { views: 12000000 },
          },
        ],
      },
    ],
    fees: [{ type: "management", name: "Management Fee", ratePct: 15 }],
  });

  // ════════════════════════════════════════════════════════════════════════
  // Planes — Copa Airlines / Panama Summer
  // ════════════════════════════════════════════════════════════════════════

  console.log("⏳ Planes — Panama Summer...");

  const brandCont = await createPlan({
    projectId: projPanama.id,
    name: "Brand Continuous",
    status: "approved",
    notesMd: "Plan always-on de marca para Panama Summer.",
    publishers: [
      {
        slug: "youtube",
        totalPlanned: 120000,
        placements: [
          {
            name: "Always-On In-Stream", marketSlug: "latam",
            audience: "viajeros frecuentes LATAM",
            amount: 120000, costMethod: "dCPV",
            startDate: "2026-03-01", endDate: "2026-08-31",
            metricsJson: { views: 54545454 },
            notesMd: "Brand always-on, 6 meses.",
          },
        ],
      },
      {
        slug: "meta",
        totalPlanned: 60000,
        placements: [
          {
            name: "Reels Brand Always-On", marketSlug: "latam",
            audience: "Brand awareness audiencias amplias",
            amount: 60000, costMethod: "dCPV",
            startDate: "2026-03-01", endDate: "2026-08-31",
            metricsJson: { views: 5454545 },
          },
        ],
      },
    ],
    fees: [
      { type: "management", name: "Management Fee", ratePct: 15 },
      { type: "reporting", name: "Reporting Fee", amount: 6000 },
    ],
    snapshots: [
      {
        version: 1, approvedAt: new Date("2026-02-15T10:00:00Z"),
        notes: "Aprobación inicial.",
      },
      {
        version: 2, approvedAt: new Date("2026-04-12T14:20:00Z"),
        notes: "Revisión Q2: ajuste +$5K en YouTube.",
      },
    ],
  });

  const promoLanz = await createPlan({
    projectId: projPanama.id,
    name: "Promo Lanzamiento",
    status: "approved",
    notesMd: "Burst de lanzamiento de promoción Summer Panama.",
    publishers: [
      {
        slug: "meta",
        totalPlanned: 40000,
        placements: [
          {
            name: "Reels + Feed Promo", marketSlug: "centroamerica",
            audience: "Travel intent + price-sensitive shoppers",
            amount: 40000, costMethod: "dCPM",
            startDate: "2026-03-15", endDate: "2026-04-30",
            metricsJson: { impressions: 7700000 },
          },
        ],
      },
      {
        slug: "tiktok",
        totalPlanned: 30000,
        placements: [
          {
            name: "Brand Takeover Promo", marketSlug: "panama",
            audience: "jóvenes 18-29 viajeros aspiracionales",
            amount: 30000, costMethod: "dCPV",
            startDate: "2026-04-01", endDate: "2026-04-30",
            metricsJson: { views: 1500000 },
          },
        ],
      },
    ],
    fees: [
      { type: "management", name: "Management Fee", ratePct: 15 },
      { type: "setup", name: "Set Up Fee", amount: 500 },
    ],
    snapshots: [
      {
        version: 1, approvedAt: new Date("2026-03-08T11:45:00Z"),
        notes: "Aprobación del burst promocional.",
      },
    ],
  });

  // ════════════════════════════════════════════════════════════════════════
  // Planes — Copa Airlines / Bogota (paused project)
  // ════════════════════════════════════════════════════════════════════════

  await createPlan({
    projectId: projBogota.id,
    name: "Hub Awareness",
    status: "approved",
    notesMd: "Plan original. Pausado junto con el proyecto.",
    publishers: [
      {
        slug: "youtube",
        totalPlanned: 60000,
        placements: [
          {
            name: "In-Stream Brand", marketSlug: "colombia",
            amount: 60000, costMethod: "dCPV",
            startDate: "2026-04-15", endDate: "2026-06-30",
            metricsJson: { views: 27272727 },
          },
        ],
      },
      {
        slug: "meta",
        totalPlanned: 40000,
        placements: [
          {
            name: "Feed Bogota", marketSlug: "colombia",
            amount: 40000, costMethod: "dCPM",
            startDate: "2026-04-15", endDate: "2026-06-30",
            metricsJson: { impressions: 8000000 },
          },
        ],
      },
    ],
    fees: [
      { type: "management", name: "Management Fee", ratePct: 15 },
      { type: "reporting", name: "Reporting Fee", amount: 1500 },
    ],
    snapshots: [
      {
        version: 1, approvedAt: new Date("2026-04-10T09:00:00Z"),
        notes: "Aprobación inicial — luego el proyecto se pausó.",
      },
    ],
  });

  // ════════════════════════════════════════════════════════════════════════
  // Planes — Copa Airlines / Legacy 2025 (closed project)
  // ════════════════════════════════════════════════════════════════════════

  const eoy = await createPlan({
    projectId: projLegacy.id,
    name: "End of Year Brand",
    status: "approved",
    notesMd: "Cierre 2025 — facturado y cerrado.",
    publishers: [
      {
        slug: "youtube",
        totalPlanned: 80000,
        placements: [
          {
            name: "Bumper EOY", marketSlug: "latam",
            amount: 80000, costMethod: "dCPV",
            startDate: "2025-10-15", endDate: "2025-12-31",
            metricsJson: { views: 36363636 },
          },
        ],
      },
      {
        slug: "meta",
        totalPlanned: 50000,
        placements: [
          {
            name: "EOY Promo Feed", marketSlug: "latam",
            amount: 50000, costMethod: "dCPM",
            startDate: "2025-11-01", endDate: "2025-12-31",
            metricsJson: { impressions: 11000000 },
          },
        ],
      },
    ],
    fees: [
      { type: "management", name: "Management Fee", ratePct: 15 },
    ],
    snapshots: [
      { version: 1, approvedAt: new Date("2025-10-05T12:00:00Z") },
    ],
  });

  // ════════════════════════════════════════════════════════════════════════
  // Planes — Cervecería Andina
  // ════════════════════════════════════════════════════════════════════════

  console.log("⏳ Planes — Cervecería Andina...");

  const ipa = await createPlan({
    projectId: projCraIPA.id,
    name: "IPA Lanzamiento",
    status: "approved",
    notesMd: "Lanzamiento de la IPA Cordillera. Burst inicial + sustaining.",
    publishers: [
      {
        slug: "youtube",
        totalPlanned: 30000,
        placements: [
          {
            name: "Hero Spot 30s", marketSlug: "argentina",
            audience: "25-44 cerveceros LATAM",
            amount: 30000, costMethod: "dCPV",
            startDate: "2026-04-15", endDate: "2026-06-30",
            metricsJson: { views: 13636363 },
          },
        ],
      },
      {
        slug: "meta",
        totalPlanned: 35000,
        placements: [
          {
            name: "Feed Lanzamiento", marketSlug: "argentina",
            amount: 20000, costMethod: "dCPM",
            startDate: "2026-04-15", endDate: "2026-05-31",
            metricsJson: { impressions: 4400000 },
          },
          {
            name: "Reels Sustaining", marketSlug: "chile",
            amount: 15000, costMethod: "dCPV",
            startDate: "2026-05-01", endDate: "2026-06-30",
            metricsJson: { views: 1071428 },
          },
        ],
      },
      {
        slug: "tiktok",
        totalPlanned: 15000,
        placements: [
          {
            name: "TikTok Branding", marketSlug: "argentina",
            amount: 15000, costMethod: "dCPV",
            startDate: "2026-04-15", endDate: "2026-06-30",
            metricsJson: { views: 833333 },
          },
        ],
      },
      {
        slug: "spotify",
        totalPlanned: 8000,
        placements: [
          {
            name: "Audio Spot", marketSlug: "latam",
            audience: "indie + rock listeners 21-44",
            amount: 8000, costMethod: "CPM",
            startDate: "2026-04-15", endDate: "2026-06-30",
            metricsJson: { impressions: 2000000 },
            notesMd: "Cliente paga directo a Spotify (no facturable por agencia).",
          },
        ],
      },
    ],
    fees: [
      { type: "management", name: "Management Fee", ratePct: 18 },
      { type: "setup", name: "Set Up Fee", amount: 1500 },
    ],
    snapshots: [
      { version: 1, approvedAt: new Date("2026-04-05T15:00:00Z") },
    ],
  });

  await createPlan({
    projectId: projCraIPA.id,
    name: "Performance IPA",
    status: "draft",
    notesMd: "Conversión a e-commerce — pendiente de definición creativa.",
    publishers: [
      {
        slug: "meta",
        totalPlanned: 12000,
        placements: [
          {
            name: "Conversion Ad", marketSlug: "argentina",
            amount: 12000, costMethod: "CPA",
            startDate: "2026-05-15", endDate: "2026-07-31",
            metricsJson: { conversions: 600 },
          },
        ],
      },
    ],
    fees: [
      { type: "management", name: "Management Fee", ratePct: 18 },
    ],
  });

  await createPlan({
    projectId: projCraVerano.id,
    name: "Verano Brand Awareness",
    status: "ready_to_send",
    notesMd: "Plan principal. Esperando aprobación del CMO.",
    publishers: [
      {
        slug: "youtube",
        totalPlanned: 25000,
        placements: [
          {
            name: "Pre-Roll Verano", marketSlug: "argentina",
            amount: 25000, costMethod: "dCPV",
            startDate: "2026-12-01", endDate: "2027-02-28",
            metricsJson: { views: 11363636 },
          },
        ],
      },
      {
        slug: "x",
        totalPlanned: 8000,
        placements: [
          {
            name: "Trending Topic", marketSlug: "argentina",
            amount: 8000, costMethod: "CPM",
            startDate: "2026-12-15", endDate: "2027-01-15",
            metricsJson: { impressions: 1600000 },
          },
        ],
      },
    ],
    fees: [
      { type: "management", name: "Management Fee", ratePct: 18 },
      { type: "setup", name: "Set Up Fee", amount: 800 },
    ],
  });

  // ════════════════════════════════════════════════════════════════════════
  // Planes — Banco Pacífico
  // ════════════════════════════════════════════════════════════════════════

  console.log("⏳ Planes — Banco Pacífico...");

  const cuentas = await createPlan({
    projectId: projBpacJov.id,
    name: "Cuentas Adquisición",
    status: "approved",
    notesMd: "Adquisición digital de cuentas para 18-29.",
    publishers: [
      {
        slug: "search",
        totalPlanned: 50000,
        placements: [
          {
            name: "Brand + Generic", marketSlug: "peru",
            amount: 30000, costMethod: "CPC",
            startDate: "2026-03-15", endDate: "2026-08-31",
            metricsJson: { clicks: 85714 },
          },
          {
            name: "Competitive Defense", marketSlug: "peru",
            amount: 20000, costMethod: "CPC",
            startDate: "2026-03-15", endDate: "2026-08-31",
            metricsJson: { clicks: 50000 },
          },
        ],
      },
      {
        slug: "meta",
        totalPlanned: 35000,
        placements: [
          {
            name: "Lead Gen Forms", marketSlug: "peru",
            audience: "18-29 con cuenta bancaria",
            amount: 35000, costMethod: "CPA",
            startDate: "2026-03-15", endDate: "2026-08-31",
            metricsJson: { leads: 1166 },
          },
        ],
      },
      {
        slug: "display",
        totalPlanned: 15000,
        placements: [
          {
            name: "Programmatic Awareness", marketSlug: "peru",
            amount: 15000, costMethod: "CPM",
            startDate: "2026-03-15", endDate: "2026-06-30",
            metricsJson: { impressions: 4000000 },
          },
        ],
      },
    ],
    fees: [
      { type: "management", name: "Management Fee", ratePct: 12 },
      { type: "setup", name: "Set Up Fee", amount: 2000 },
      { type: "reporting", name: "Reporting Fee", amount: 3000 },
    ],
    snapshots: [
      { version: 1, approvedAt: new Date("2026-03-10T14:00:00Z") },
    ],
  });

  await createPlan({
    projectId: projBpacJov.id,
    name: "OOH Cuentas",
    status: "approved",
    notesMd: "OOH físico Lima — agencia paga (override).",
    publishers: [
      {
        slug: "ooh",
        totalPlanned: 40000,
        placements: [
          {
            name: "Vallas Lima Norte", marketSlug: "peru",
            amount: 25000, costMethod: "Flat",
            startDate: "2026-04-01", endDate: "2026-06-30",
          },
          {
            name: "Mupis Centro", marketSlug: "peru",
            amount: 15000, costMethod: "Flat",
            startDate: "2026-04-01", endDate: "2026-06-30",
          },
        ],
      },
    ],
    fees: [
      { type: "management", name: "Management Fee", ratePct: 12 },
    ],
    snapshots: [
      { version: 1, approvedAt: new Date("2026-03-20T12:00:00Z") },
    ],
  });

  const prest = await createPlan({
    projectId: projBpacPrest.id,
    name: "Préstamos Search",
    status: "approved",
    publishers: [
      {
        slug: "search",
        totalPlanned: 60000,
        placements: [
          {
            name: "Préstamos Generic", marketSlug: "peru",
            amount: 60000, costMethod: "CPC",
            startDate: "2026-04-15", endDate: "2026-09-30",
            metricsJson: { clicks: 150000 },
          },
        ],
      },
      {
        slug: "linkedin",
        totalPlanned: 30000,
        placements: [
          {
            name: "Sponsored InMail", marketSlug: "peru",
            audience: "asalariados nivel medio-alto",
            amount: 30000, costMethod: "CPC",
            startDate: "2026-04-15", endDate: "2026-09-30",
            metricsJson: { clicks: 5000 },
          },
        ],
      },
    ],
    fees: [
      { type: "management", name: "Management Fee", ratePct: 12 },
    ],
    snapshots: [
      { version: 1, approvedAt: new Date("2026-04-10T16:30:00Z") },
    ],
  });

  await createPlan({
    projectId: projBpacPrest.id,
    name: "Display Retargeting",
    status: "ready_to_send",
    publishers: [
      {
        slug: "programmatic",
        totalPlanned: 20000,
        placements: [
          {
            name: "Retargeting Site Visitors", marketSlug: "peru",
            amount: 20000, costMethod: "CPM",
            startDate: "2026-05-15", endDate: "2026-09-30",
            metricsJson: { impressions: 5000000 },
          },
        ],
      },
    ],
    fees: [
      { type: "management", name: "Management Fee", ratePct: 12 },
    ],
  });

  await createPlan({
    projectId: projBpacCierre.id,
    name: "Clausura Brand",
    status: "approved",
    notesMd: "Cerrado, facturado completo.",
    publishers: [
      {
        slug: "meta",
        totalPlanned: 50000,
        placements: [
          {
            name: "Brand Recap", marketSlug: "peru",
            amount: 50000, costMethod: "dCPM",
            startDate: "2025-11-15", endDate: "2025-12-31",
            metricsJson: { impressions: 10000000 },
          },
        ],
      },
    ],
    fees: [
      { type: "management", name: "Management Fee", ratePct: 12 },
    ],
    snapshots: [
      { version: 1, approvedAt: new Date("2025-11-10T10:00:00Z") },
    ],
  });

  // ════════════════════════════════════════════════════════════════════════
  // Planes — Tienda Roma (cliente paused)
  // ════════════════════════════════════════════════════════════════════════

  console.log("⏳ Planes — Tienda Roma...");

  await createPlan({
    projectId: projTrBF.id,
    name: "Black Friday Burst",
    status: "approved",
    notesMd: "Cliente pausado. Plan último de la temporada 2025.",
    publishers: [
      {
        slug: "meta",
        totalPlanned: 25000,
        placements: [
          {
            name: "Carrusel Promos BF", marketSlug: "argentina",
            amount: 25000, costMethod: "dCPM",
            startDate: "2025-11-15", endDate: "2025-11-30",
            metricsJson: { impressions: 5000000 },
          },
        ],
      },
      {
        slug: "tiktok",
        totalPlanned: 10000,
        placements: [
          {
            name: "TikTok Promos", marketSlug: "argentina",
            amount: 10000, costMethod: "dCPV",
            startDate: "2025-11-20", endDate: "2025-11-30",
            metricsJson: { views: 555555 },
          },
        ],
      },
    ],
    fees: [
      { type: "management", name: "Management Fee", ratePct: 15 },
      { type: "setup", name: "Set Up Fee", amount: 500 },
    ],
    snapshots: [
      { version: 1, approvedAt: new Date("2025-11-10T09:00:00Z") },
    ],
  });

  // ════════════════════════════════════════════════════════════════════════
  // Billings de muestra — facturados (paid + sent) y drafts del mes en curso
  // ════════════════════════════════════════════════════════════════════════

  console.log("⏳ Billings de muestra...");

  // Awareness Costa Rica — Feb 2026 paid
  const [billAwFeb] = await db
    .insert(s.planBillings)
    .values([
      {
        mediaPlanId: awareness.plan.id, month: "2026-02", status: "paid",
        invoiceNumber: "2026-0001",
        totalNetUsd: "48000.00", totalFeeUsd: "9000.00", totalUsd: "57000.00",
        sentAt: new Date("2026-03-05T16:00:00Z"),
        paidAt: new Date("2026-03-25T10:30:00Z"),
        dueDate: "2026-04-04",
        notesMd: "Cierre Feb 2026.",
      },
    ])
    .returning();

  await db.insert(s.planBillingPublishers).values([
    { planBillingId: billAwFeb.id, publisherId: pubFor(copa.id, "youtube").id, amountRealUsd: "22000.00", isBillable: true, notes: "50% Bumper + parcial In-Stream" },
    { planBillingId: billAwFeb.id, publisherId: pubFor(copa.id, "meta").id,    amountRealUsd: "16000.00", isBillable: true, notes: "50% Feed + 30% Reels" },
    { planBillingId: billAwFeb.id, publisherId: pubFor(copa.id, "tiktok").id,  amountRealUsd: "10000.00", isBillable: true, notes: "50% TikTok In-Feed" },
  ]);
  await db.insert(s.planBillingFees).values([
    { planBillingId: billAwFeb.id, mediaPlanFeeId: awareness.fees[0].id, amountImputedUsd: "7500.00", notes: "50% Mgmt Fee" },
    { planBillingId: billAwFeb.id, mediaPlanFeeId: awareness.fees[1].id, amountImputedUsd: "1000.00", notes: "Set Up completo" },
    { planBillingId: billAwFeb.id, mediaPlanFeeId: awareness.fees[2].id, amountImputedUsd: "500.00",  notes: "Reporting parcial" },
  ]);

  // Awareness Costa Rica — Mar 2026 sent
  const [billAwMar] = await db
    .insert(s.planBillings)
    .values([
      {
        mediaPlanId: awareness.plan.id, month: "2026-03", status: "sent",
        invoiceNumber: "2026-0007",
        totalNetUsd: "52000.00", totalFeeUsd: "9000.00", totalUsd: "61000.00",
        sentAt: new Date("2026-04-04T14:00:00Z"),
        dueDate: "2026-05-04",
      },
    ])
    .returning();

  await db.insert(s.planBillingPublishers).values([
    { planBillingId: billAwMar.id, publisherId: pubFor(copa.id, "youtube").id, amountRealUsd: "23000.00", isBillable: true },
    { planBillingId: billAwMar.id, publisherId: pubFor(copa.id, "meta").id,    amountRealUsd: "19000.00", isBillable: true },
    { planBillingId: billAwMar.id, publisherId: pubFor(copa.id, "tiktok").id,  amountRealUsd: "10000.00", isBillable: true },
  ]);
  await db.insert(s.planBillingFees).values([
    { planBillingId: billAwMar.id, mediaPlanFeeId: awareness.fees[0].id, amountImputedUsd: "7500.00", notes: "50% Mgmt Fee" },
    { planBillingId: billAwMar.id, mediaPlanFeeId: awareness.fees[2].id, amountImputedUsd: "1500.00", notes: "Reporting" },
  ]);

  // Brand Continuous Panama — Mar 2026 paid
  const [billBrandMar] = await db
    .insert(s.planBillings)
    .values([
      {
        mediaPlanId: brandCont.plan.id, month: "2026-03", status: "paid",
        invoiceNumber: "2026-0002",
        totalNetUsd: "30000.00", totalFeeUsd: "6500.00", totalUsd: "36500.00",
        sentAt: new Date("2026-04-04T15:00:00Z"),
        paidAt: new Date("2026-04-22T09:00:00Z"),
        dueDate: "2026-05-04",
      },
    ])
    .returning();

  await db.insert(s.planBillingPublishers).values([
    { planBillingId: billBrandMar.id, publisherId: pubFor(copa.id, "youtube").id, amountRealUsd: "20000.00", isBillable: true },
    { planBillingId: billBrandMar.id, publisherId: pubFor(copa.id, "meta").id,    amountRealUsd: "10000.00", isBillable: true },
  ]);
  await db.insert(s.planBillingFees).values([
    { planBillingId: billBrandMar.id, mediaPlanFeeId: brandCont.fees[0].id, amountImputedUsd: "5000.00" },
    { planBillingId: billBrandMar.id, mediaPlanFeeId: brandCont.fees[1].id, amountImputedUsd: "1500.00" },
  ]);

  // Brand Continuous Panama — Apr 2026 sent
  const [billBrandApr] = await db
    .insert(s.planBillings)
    .values([
      {
        mediaPlanId: brandCont.plan.id, month: "2026-04", status: "sent",
        invoiceNumber: "2026-0008",
        totalNetUsd: "30000.00", totalFeeUsd: "6500.00", totalUsd: "36500.00",
        sentAt: new Date("2026-05-04T15:00:00Z"),
        dueDate: "2026-06-04",
      },
    ])
    .returning();
  await db.insert(s.planBillingPublishers).values([
    { planBillingId: billBrandApr.id, publisherId: pubFor(copa.id, "youtube").id, amountRealUsd: "20000.00", isBillable: true },
    { planBillingId: billBrandApr.id, publisherId: pubFor(copa.id, "meta").id,    amountRealUsd: "10000.00", isBillable: true },
  ]);
  await db.insert(s.planBillingFees).values([
    { planBillingId: billBrandApr.id, mediaPlanFeeId: brandCont.fees[0].id, amountImputedUsd: "5000.00" },
    { planBillingId: billBrandApr.id, mediaPlanFeeId: brandCont.fees[1].id, amountImputedUsd: "1500.00" },
  ]);

  // Cuentas Jóvenes BPAC — Mar 2026 sent
  const [billCuentasMar] = await db
    .insert(s.planBillings)
    .values([
      {
        mediaPlanId: cuentas.plan.id, month: "2026-03", status: "sent",
        invoiceNumber: "2026-0003",
        totalNetUsd: "20000.00", totalFeeUsd: "3500.00", totalUsd: "23500.00",
        sentAt: new Date("2026-04-08T11:00:00Z"),
        dueDate: "2026-05-08",
      },
    ])
    .returning();
  await db.insert(s.planBillingPublishers).values([
    { planBillingId: billCuentasMar.id, publisherId: pubFor(bpac.id, "search").id, amountRealUsd: "10000.00", isBillable: true },
    { planBillingId: billCuentasMar.id, publisherId: pubFor(bpac.id, "meta").id,   amountRealUsd: "7000.00",  isBillable: true },
    { planBillingId: billCuentasMar.id, publisherId: pubFor(bpac.id, "display").id,amountRealUsd: "3000.00",  isBillable: true },
  ]);
  await db.insert(s.planBillingFees).values([
    { planBillingId: billCuentasMar.id, mediaPlanFeeId: cuentas.fees[0].id, amountImputedUsd: "2400.00" },
    { planBillingId: billCuentasMar.id, mediaPlanFeeId: cuentas.fees[1].id, amountImputedUsd: "500.00" },
    { planBillingId: billCuentasMar.id, mediaPlanFeeId: cuentas.fees[2].id, amountImputedUsd: "600.00" },
  ]);

  // Préstamos BPAC — Apr 2026 paid
  const [billPrestApr] = await db
    .insert(s.planBillings)
    .values([
      {
        mediaPlanId: prest.plan.id, month: "2026-04", status: "paid",
        invoiceNumber: "2026-0004",
        totalNetUsd: "16000.00", totalFeeUsd: "1900.00", totalUsd: "17900.00",
        sentAt: new Date("2026-05-04T10:00:00Z"),
        paidAt: new Date("2026-05-18T15:00:00Z"),
        dueDate: "2026-06-04",
      },
    ])
    .returning();
  await db.insert(s.planBillingPublishers).values([
    { planBillingId: billPrestApr.id, publisherId: pubFor(bpac.id, "search").id,   amountRealUsd: "11000.00", isBillable: true },
    { planBillingId: billPrestApr.id, publisherId: pubFor(bpac.id, "linkedin").id, amountRealUsd: "5000.00",  isBillable: true },
  ]);
  await db.insert(s.planBillingFees).values([
    { planBillingId: billPrestApr.id, mediaPlanFeeId: prest.fees[0].id, amountImputedUsd: "1900.00" },
  ]);

  // IPA — Apr 2026 sent
  const [billIpaApr] = await db
    .insert(s.planBillings)
    .values([
      {
        mediaPlanId: ipa.plan.id, month: "2026-04", status: "sent",
        invoiceNumber: "2026-0005",
        totalNetUsd: "12000.00", totalFeeUsd: "2200.00", totalUsd: "14200.00",
        sentAt: new Date("2026-05-04T12:00:00Z"),
        dueDate: "2026-06-04",
      },
    ])
    .returning();
  await db.insert(s.planBillingPublishers).values([
    { planBillingId: billIpaApr.id, publisherId: pubFor(cra.id, "youtube").id, amountRealUsd: "5000.00", isBillable: true },
    { planBillingId: billIpaApr.id, publisherId: pubFor(cra.id, "meta").id,    amountRealUsd: "4500.00", isBillable: true },
    { planBillingId: billIpaApr.id, publisherId: pubFor(cra.id, "tiktok").id,  amountRealUsd: "2500.00", isBillable: true },
    // Spotify es no-billable porque cliente paga directo
    { planBillingId: billIpaApr.id, publisherId: pubFor(cra.id, "spotify").id, amountRealUsd: "1500.00", isBillable: false, notes: "Cliente paga directo" },
  ]);
  await db.insert(s.planBillingFees).values([
    { planBillingId: billIpaApr.id, mediaPlanFeeId: ipa.fees[0].id, amountImputedUsd: "1700.00" },
    { planBillingId: billIpaApr.id, mediaPlanFeeId: ipa.fees[1].id, amountImputedUsd: "500.00" },
  ]);

  // EOY 2025 (legacy closed) — Nov + Dec 2025 paid
  const [billEoyNov] = await db
    .insert(s.planBillings)
    .values([
      {
        mediaPlanId: eoy.plan.id, month: "2025-11", status: "paid",
        invoiceNumber: "2025-0091",
        totalNetUsd: "55000.00", totalFeeUsd: "9500.00", totalUsd: "64500.00",
        sentAt: new Date("2025-12-04T10:00:00Z"),
        paidAt: new Date("2025-12-22T11:30:00Z"),
        dueDate: "2026-01-04",
      },
    ])
    .returning();
  await db.insert(s.planBillingPublishers).values([
    { planBillingId: billEoyNov.id, publisherId: pubFor(copa.id, "youtube").id, amountRealUsd: "30000.00", isBillable: true },
    { planBillingId: billEoyNov.id, publisherId: pubFor(copa.id, "meta").id,    amountRealUsd: "25000.00", isBillable: true },
  ]);
  await db.insert(s.planBillingFees).values([
    { planBillingId: billEoyNov.id, mediaPlanFeeId: eoy.fees[0].id, amountImputedUsd: "9500.00" },
  ]);

  const [billEoyDec] = await db
    .insert(s.planBillings)
    .values([
      {
        mediaPlanId: eoy.plan.id, month: "2025-12", status: "paid",
        invoiceNumber: "2025-0099",
        totalNetUsd: "75000.00", totalFeeUsd: "13000.00", totalUsd: "88000.00",
        sentAt: new Date("2026-01-05T10:00:00Z"),
        paidAt: new Date("2026-01-28T14:00:00Z"),
        dueDate: "2026-02-05",
      },
    ])
    .returning();
  await db.insert(s.planBillingPublishers).values([
    { planBillingId: billEoyDec.id, publisherId: pubFor(copa.id, "youtube").id, amountRealUsd: "50000.00", isBillable: true },
    { planBillingId: billEoyDec.id, publisherId: pubFor(copa.id, "meta").id,    amountRealUsd: "25000.00", isBillable: true },
  ]);
  await db.insert(s.planBillingFees).values([
    { planBillingId: billEoyDec.id, mediaPlanFeeId: eoy.fees[0].id, amountImputedUsd: "13000.00" },
  ]);

  // Drafts del mes en curso (May 2026) para Awareness y Brand Continuous
  await db.insert(s.planBillings).values([
    {
      mediaPlanId: awareness.plan.id, month: "2026-04", status: "draft",
      totalNetUsd: "0.00", totalFeeUsd: "0.00", totalUsd: "0.00",
    },
    {
      mediaPlanId: brandCont.plan.id, month: "2026-05", status: "draft",
      totalNetUsd: "0.00", totalFeeUsd: "0.00", totalUsd: "0.00",
    },
  ]);

  // ════════════════════════════════════════════════════════════════════════
  // Resumen
  // ════════════════════════════════════════════════════════════════════════

  console.log("\n✓ Seed completo:");
  console.log(`  · 4 clientes (3 active + 1 paused)`);
  console.log(`  · 8 budget origins`);
  console.log(`  · 11 publishers + 14 markets + 17 metrics`);
  console.log(`  · ~24 mappings cliente↔publisher`);
  console.log(`  · 11 proyectos (planning + active + paused + closed)`);
  console.log(`  · 14+ planes peer (mix completo de status)`);
  console.log(`  · 9 plan_billings de muestra (paid + sent + draft)`);
  console.log(`  · Snapshots de aprobación distribuidos`);

  void [
    bgTrade,
    projMiami,
    consideration, performance,
    promoLanz,
  ];
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("✗ Seed falló:", err);
    process.exit(1);
  });
