// Seed con datos de prueba consistentes con la Fase 1 del prompt:
//   2 clientes · 4 budget origins · 8 proyectos
//   · 1 plan de medios completo (~28 líneas) · 3 meses de gastos reales
//
// Es idempotente: borra todo y reinserta. Usa un RNG semilla para que
// los gastos reales sean reproducibles.
//
// Uso: `npm run db:seed`

import { db } from "@/db";
import * as s from "@/db/schema";

// ─── RNG determinístico (LCG) ──────────────────────────────────────────
let _seed = 1337;
const rand = () => {
  _seed = (_seed * 9301 + 49297) % 233280;
  return _seed / 233280;
};
const variance = (min: number, max: number) => min + rand() * (max - min);

// ─── Datos del plan ────────────────────────────────────────────────────
type LineSeed = {
  publisher: (typeof s.publisherEnum.enumValues)[number];
  placementName: string;
  audienceMarket: string;
  startDate: string;
  endDate: string;
  budgetNetUsd: string;
  feePct: string;
};

const PLAN_LINES: LineSeed[] = [
  // YouTube — 6
  { publisher: "YouTube", placementName: "In-Stream Skippable · LATAM Brand",
    audienceMarket: "25-44 viajeros · LATAM",
    startDate: "2026-04-01", endDate: "2026-06-30",
    budgetNetUsd: "24500.00", feePct: "8.00" },
  { publisher: "YouTube", placementName: "Bumper Ads 6s",
    audienceMarket: "18-44 · LATAM",
    startDate: "2026-04-15", endDate: "2026-05-31",
    budgetNetUsd: "18200.00", feePct: "8.00" },
  { publisher: "YouTube", placementName: "TrueView Discovery",
    audienceMarket: "MX brand search",
    startDate: "2026-04-01", endDate: "2026-06-15",
    budgetNetUsd: "9200.00", feePct: "10.00" },
  { publisher: "YouTube", placementName: "Masthead Mobile",
    audienceMarket: "Brasil · all",
    startDate: "2026-05-15", endDate: "2026-05-15",
    budgetNetUsd: "35000.00", feePct: "12.00" },
  { publisher: "YouTube", placementName: "Non-Skippable 15s",
    audienceMarket: "LATAM premium",
    startDate: "2026-05-01", endDate: "2026-06-30",
    budgetNetUsd: "14800.00", feePct: "8.00" },
  { publisher: "YouTube", placementName: "Shorts In-Feed",
    audienceMarket: "25-44 LATAM",
    startDate: "2026-04-01", endDate: "2026-06-30",
    budgetNetUsd: "7400.00", feePct: "7.00" },

  // Meta — 6
  { publisher: "Meta", placementName: "Feed Conversion",
    audienceMarket: "LATAM viajeros frecuentes",
    startDate: "2026-04-01", endDate: "2026-06-30",
    budgetNetUsd: "12400.00", feePct: "8.00" },
  { publisher: "Meta", placementName: "Reels Brand",
    audienceMarket: "25-44 LATAM",
    startDate: "2026-04-01", endDate: "2026-06-30",
    budgetNetUsd: "8600.00", feePct: "7.00" },
  { publisher: "Meta", placementName: "Stories Awareness",
    audienceMarket: "MX/AR/CL/PE",
    startDate: "2026-04-01", endDate: "2026-05-15",
    budgetNetUsd: "6200.00", feePct: "7.00" },
  { publisher: "Meta", placementName: "Carousel Destinations",
    audienceMarket: "LATAM brand",
    startDate: "2026-05-01", endDate: "2026-06-30",
    budgetNetUsd: "5400.00", feePct: "7.00" },
  { publisher: "Meta", placementName: "Lookalike Conversion",
    audienceMarket: "25-54 high-value",
    startDate: "2026-04-15", endDate: "2026-06-30",
    budgetNetUsd: "9800.00", feePct: "9.00" },
  { publisher: "Meta", placementName: "Video Mid-Funnel",
    audienceMarket: "LATAM consideradores",
    startDate: "2026-04-01", endDate: "2026-05-31",
    budgetNetUsd: "7200.00", feePct: "8.00" },

  // TikTok — 4
  { publisher: "TikTok", placementName: "In-Feed Top View",
    audienceMarket: "18-34 LATAM",
    startDate: "2026-04-15", endDate: "2026-05-15",
    budgetNetUsd: "11000.00", feePct: "10.00" },
  { publisher: "TikTok", placementName: "Spark Ads Creator",
    audienceMarket: "MX / BR",
    startDate: "2026-05-01", endDate: "2026-06-15",
    budgetNetUsd: "6800.00", feePct: "9.00" },
  { publisher: "TikTok", placementName: "Brand Takeover Mobile",
    audienceMarket: "BR · all",
    startDate: "2026-05-05", endDate: "2026-05-05",
    budgetNetUsd: "18000.00", feePct: "12.00" },
  { publisher: "TikTok", placementName: "Hashtag Challenge",
    audienceMarket: "LATAM jóvenes",
    startDate: "2026-06-01", endDate: "2026-06-30",
    budgetNetUsd: "9400.00", feePct: "11.00" },

  // DV360 — 4
  { publisher: "DV360", placementName: "Programmatic Video",
    audienceMarket: "Premium news inventory",
    startDate: "2026-04-01", endDate: "2026-06-30",
    budgetNetUsd: "14200.00", feePct: "9.00" },
  { publisher: "DV360", placementName: "CTV Connected TV",
    audienceMarket: "LATAM premium households",
    startDate: "2026-05-01", endDate: "2026-06-30",
    budgetNetUsd: "22000.00", feePct: "10.00" },
  { publisher: "DV360", placementName: "PMP Display",
    audienceMarket: "Travel inventory directos",
    startDate: "2026-04-01", endDate: "2026-06-30",
    budgetNetUsd: "7600.00", feePct: "8.00" },
  { publisher: "DV360", placementName: "Audio Programmatic",
    audienceMarket: "Spotify + One Podcasts · LATAM",
    startDate: "2026-05-01", endDate: "2026-06-30",
    budgetNetUsd: "4800.00", feePct: "8.00" },

  // Display — 3
  { publisher: "Display", placementName: "Premium Display Direct",
    audienceMarket: "Travel sites direct buy",
    startDate: "2026-04-01", endDate: "2026-06-30",
    budgetNetUsd: "5200.00", feePct: "8.00" },
  { publisher: "Display", placementName: "Native Outbrain",
    audienceMarket: "LATAM consideradores",
    startDate: "2026-04-15", endDate: "2026-06-15",
    budgetNetUsd: "3400.00", feePct: "7.00" },
  { publisher: "Display", placementName: "Rich Media",
    audienceMarket: "MX premium",
    startDate: "2026-05-01", endDate: "2026-06-30",
    budgetNetUsd: "4100.00", feePct: "9.00" },

  // Programmatic — 2
  { publisher: "Programmatic", placementName: "Long-tail Retargeting",
    audienceMarket: "site visitors L30D",
    startDate: "2026-04-01", endDate: "2026-06-30",
    budgetNetUsd: "3200.00", feePct: "7.00" },
  { publisher: "Programmatic", placementName: "Native Travel Intent",
    audienceMarket: "Travel intent LATAM",
    startDate: "2026-04-15", endDate: "2026-06-30",
    budgetNetUsd: "4600.00", feePct: "8.00" },

  // OOH — 2
  { publisher: "OOH", placementName: "DOOH Aeropuertos GRU+EZE+SCL",
    audienceMarket: "Pasajeros tránsito · 30s loop",
    startDate: "2026-05-01", endDate: "2026-06-15",
    budgetNetUsd: "28000.00", feePct: "10.00" },
  { publisher: "OOH", placementName: "OOH Estática Premium",
    audienceMarket: "MX City premium hubs",
    startDate: "2026-04-15", endDate: "2026-05-30",
    budgetNetUsd: "16000.00", feePct: "10.00" },

  // Search — 1
  { publisher: "Search", placementName: "Brand Defense",
    audienceMarket: "Google Ads · LATAM brand keywords",
    startDate: "2026-04-01", endDate: "2026-06-30",
    budgetNetUsd: "6400.00", feePct: "7.00" },
];

// ─── Main ──────────────────────────────────────────────────────────────

async function main() {
  console.log("⏳ Limpiando datos existentes...");
  await db.delete(s.auditLog);
  await db.delete(s.billingLines);
  await db.delete(s.billings);
  await db.delete(s.actualSpend);
  await db.delete(s.mediaPlanLines);
  await db.delete(s.mediaPlans);
  await db.delete(s.projects);
  await db.delete(s.budgetOrigins);
  await db.delete(s.clients);

  console.log("⏳ Insertando clientes...");
  const [aviacion, qsr] = await db
    .insert(s.clients)
    .values([
      { name: "Cliente Aviación", slug: "aviacion", status: "active" },
      { name: "Cliente QSR", slug: "qsr", status: "active" },
    ])
    .returning();

  console.log("⏳ Insertando budget origins...");
  const [bgOnline, bgCmi, bgTrade, bgCargo] = await db
    .insert(s.budgetOrigins)
    .values([
      { clientId: aviacion.id, name: "Online",
        monthlyTargetUsd: "200000.00", colorHex: "#7a1f3d" },
      { clientId: aviacion.id, name: "CMI",
        monthlyTargetUsd: "80000.00", colorHex: "#5e1730" },
      { clientId: aviacion.id, name: "Trade",
        monthlyTargetUsd: "50000.00", colorHex: "#8b2a52" },
      { clientId: qsr.id, name: "Cargo",
        monthlyTargetUsd: "120000.00", colorHex: "#92400e" },
    ])
    .returning();

  console.log("⏳ Insertando proyectos...");
  const projects = await db
    .insert(s.projects)
    .values([
      // Aviación
      { clientId: aviacion.id, budgetOriginId: bgOnline.id,
        name: "Brand Always-On Q2 2026", code: "AVI-BRD-Q2",
        status: "active",
        startDate: "2026-04-01", endDate: "2026-06-30",
        totalBudgetUsd: "323400.00",
        notesMd: "Plan vigente cargado a partir del Excel del cliente." },
      { clientId: aviacion.id, budgetOriginId: bgOnline.id,
        name: "Performance Lower Funnel Q2", code: "AVI-PLF-Q2",
        status: "active",
        startDate: "2026-04-01", endDate: "2026-06-30",
        totalBudgetUsd: "180000.00", notesMd: null },
      { clientId: aviacion.id, budgetOriginId: bgCmi.id,
        name: "CMI Trip Booking Push", code: "AVI-CMI-001",
        status: "active",
        startDate: "2026-04-15", endDate: "2026-07-15",
        totalBudgetUsd: "210000.00", notesMd: null },
      { clientId: aviacion.id, budgetOriginId: bgCmi.id,
        name: "Premium Class Awareness", code: "AVI-CMI-002",
        status: "planning",
        startDate: "2026-07-01", endDate: "2026-09-30",
        totalBudgetUsd: "150000.00", notesMd: null },
      { clientId: aviacion.id, budgetOriginId: bgTrade.id,
        name: "Travel Trade Activation", code: "AVI-TRD-001",
        status: "active",
        startDate: "2026-05-01", endDate: "2026-08-31",
        totalBudgetUsd: "120000.00", notesMd: null },
      // QSR
      { clientId: qsr.id, budgetOriginId: bgCargo.id,
        name: "Cargo Local Push Brasil", code: "QSR-LOC-BR",
        status: "active",
        startDate: "2026-03-01", endDate: "2026-05-31",
        totalBudgetUsd: "240000.00", notesMd: null },
      { clientId: qsr.id, budgetOriginId: bgCargo.id,
        name: "Cargo Loyalty App", code: "QSR-LOY-001",
        status: "planning",
        startDate: "2026-07-01", endDate: "2026-12-31",
        totalBudgetUsd: "320000.00", notesMd: null },
      { clientId: qsr.id, budgetOriginId: bgCargo.id,
        name: "Cargo Brand New York", code: "QSR-BRD-NY",
        status: "closed",
        startDate: "2025-09-01", endDate: "2025-12-31",
        totalBudgetUsd: "280000.00", notesMd: null },
    ])
    .returning();

  const brandAlwaysOn = projects[0];

  console.log("⏳ Insertando media plan + 28 líneas...");
  const [plan] = await db
    .insert(s.mediaPlans)
    .values([
      {
        projectId: brandAlwaysOn.id,
        version: 1,
        status: "approved",
        importedAt: new Date("2026-03-25T14:32:00Z"),
        approvedAt: new Date("2026-03-28T11:15:00Z"),
      },
    ])
    .returning();

  const lines = await db
    .insert(s.mediaPlanLines)
    .values(
      PLAN_LINES.map((line, idx) => ({
        mediaPlanId: plan.id,
        publisher: line.publisher,
        placementName: line.placementName,
        audienceMarket: line.audienceMarket,
        startDate: line.startDate,
        endDate: line.endDate,
        budgetNetUsd: line.budgetNetUsd,
        feePct: line.feePct,
        sortOrder: idx,
      })),
    )
    .returning();

  console.log("⏳ Insertando 3 meses de gastos reales (84 filas)...");
  const months = ["2026-04", "2026-05", "2026-06"];
  const spendRows = lines.flatMap((line) => {
    const totalBudget = Number.parseFloat(line.budgetNetUsd);
    const startMonth = line.startDate?.slice(0, 7) ?? "2026-04";
    const endMonth = line.endDate?.slice(0, 7) ?? "2026-06";
    const activeMonths = months.filter((m) => m >= startMonth && m <= endMonth);
    const monthly = activeMonths.length > 0 ? totalBudget / activeMonths.length : 0;

    return months.map((month) => {
      const isActive = activeMonths.includes(month);
      const amount = isActive ? (monthly * variance(0.85, 1.15)).toFixed(2) : "0.00";
      return {
        mediaPlanLineId: line.id,
        month,
        amountUsd: amount,
      };
    });
  });

  await db.insert(s.actualSpend).values(spendRows);

  // ─── Resumen ────────────────────────────────────────────────────────
  console.log("\n✓ Seed completo:");
  console.log(`  · ${2} clientes`);
  console.log(`  · ${4} budget origins`);
  console.log(`  · ${projects.length} proyectos`);
  console.log(`  · ${1} plan de medios (v1, approved)`);
  console.log(`  · ${lines.length} líneas del plan`);
  console.log(`  · ${spendRows.length} registros de gasto real`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("✗ Seed falló:", err);
    process.exit(1);
  });
