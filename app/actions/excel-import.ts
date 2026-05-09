"use server";

import * as XLSX from "xlsx";
import { and, asc, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  auditLog,
  mediaPlanLines,
  mediaPlans,
  projects,
} from "@/db/schema";

// ────────────────────────────────────────────────────────────────────────────
// Aliases para auto-detectar columnas (case-insensitive, _/- → espacio).
// ────────────────────────────────────────────────────────────────────────────

const ALIASES: Record<string, string[]> = {
  publisher: [
    "publisher",
    "plataforma",
    "medio",
    "vendor",
    "channel",
    "canal",
  ],
  placementName: [
    "placement",
    "placement name",
    "placement_name",
    "ubicacion",
    "ubicación",
    "name",
    "nombre",
    "linea",
    "línea",
  ],
  audienceMarket: [
    "audience",
    "audiencia",
    "mercado",
    "market",
    "audiencia mercado",
    "audiencia/mercado",
    "audience market",
    "target",
    "publico",
    "público",
  ],
  startDate: [
    "start date",
    "start_date",
    "fecha inicio",
    "fecha desde",
    "desde",
    "inicio",
    "start",
  ],
  endDate: [
    "end date",
    "end_date",
    "fecha fin",
    "fecha hasta",
    "hasta",
    "fin",
    "end",
  ],
  budgetNetUsd: [
    "budget",
    "budget net",
    "budget_net",
    "budget_net_usd",
    "net",
    "neto",
    "presupuesto",
    "monto",
    "amount",
    "investment",
    "inversion",
    "inversión",
  ],
  feePct: [
    "fee",
    "fee pct",
    "fee_pct",
    "fee%",
    "honorarios",
    "fee percentage",
    "comision",
    "comisión",
  ],
};

const PUBLISHER_VALUES = [
  "YouTube",
  "Meta",
  "TikTok",
  "DV360",
  "OOH",
  "Display",
  "Search",
  "Spotify",
  "Programmatic",
  "Other",
] as const;

type PublisherValue = (typeof PUBLISHER_VALUES)[number];

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/[_\-]+/g, " ").replace(/\s+/g, " ");
}

function detectColumns(headers: string[]): Record<string, string | null> {
  const result: Record<string, string | null> = {
    publisher: null,
    placementName: null,
    audienceMarket: null,
    startDate: null,
    endDate: null,
    budgetNetUsd: null,
    feePct: null,
  };
  for (const h of headers) {
    const norm = normalize(h);
    for (const [field, aliases] of Object.entries(ALIASES)) {
      if (result[field]) continue; // ya matcheado
      if (aliases.some((a) => normalize(a) === norm)) {
        result[field] = h;
        break;
      }
    }
  }
  return result;
}

function normalizePublisher(raw: unknown): PublisherValue {
  if (typeof raw !== "string") return "Other";
  const norm = raw.trim().toLowerCase();
  for (const v of PUBLISHER_VALUES) {
    if (v.toLowerCase() === norm) return v;
  }
  // matching parcial
  if (norm.includes("youtube") || norm.includes("yt")) return "YouTube";
  if (norm.includes("meta") || norm.includes("facebook") || norm.includes("instagram")) return "Meta";
  if (norm.includes("tiktok")) return "TikTok";
  if (norm.includes("dv360") || norm.includes("display & video")) return "DV360";
  if (norm.includes("ooh") || norm.includes("dooh")) return "OOH";
  if (norm.includes("search") || norm.includes("google ads")) return "Search";
  if (norm.includes("spotify") || norm.includes("audio")) return "Spotify";
  if (norm.includes("programmatic")) return "Programmatic";
  if (norm.includes("display")) return "Display";
  return "Other";
}

function parseDate(raw: unknown): string | null {
  if (raw == null) return null;
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    // ISO
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
    // dd/mm/yyyy o dd-mm-yyyy
    const m = trimmed.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})$/);
    if (m) {
      const [, dd, mm, yy] = m;
      const yyyy = yy.length === 2 ? `20${yy}` : yy;
      return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
    }
    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return null;
  }
  if (typeof raw === "number") {
    // Excel serial number (días desde 1899-12-30).
    const ms = (raw - 25569) * 86400 * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
}

function parseNumber(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const cleaned = raw.replace(/[$, %]/g, "").trim();
    if (!cleaned) return null;
    const n = Number.parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// parseExcelFile — devuelve preview + mapping detectado
// ────────────────────────────────────────────────────────────────────────────

export type ExcelPreviewLine = {
  publisher: PublisherValue;
  placementName: string;
  audienceMarket: string | null;
  startDate: string | null;
  endDate: string | null;
  budgetNetUsd: number;
  feePct: number;
  rawRowIndex: number;
  warnings: string[];
};

export type ExcelPreview = {
  ok: true;
  filename: string;
  sheetName: string;
  totalRows: number;
  detectedHeaders: string[];
  mapping: Record<string, string | null>;
  lines: ExcelPreviewLine[];
  skippedCount: number;
  totalBudget: number;
};

export type ExcelPreviewResult = ExcelPreview | { ok: false; error: string };

export async function parseExcelFile(
  formData: FormData,
): Promise<ExcelPreviewResult> {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, error: "No se recibió un archivo" };
  }
  if (file.size === 0) return { ok: false, error: "Archivo vacío" };
  if (file.size > 10 * 1024 * 1024) {
    return { ok: false, error: "Archivo demasiado grande (>10MB)" };
  }

  let workbook: XLSX.WorkBook;
  try {
    const buf = await file.arrayBuffer();
    workbook = XLSX.read(buf, { type: "array", cellDates: true });
  } catch (e) {
    return {
      ok: false,
      error: `No se pudo parsear el Excel: ${e instanceof Error ? e.message : "error desconocido"}`,
    };
  }

  if (workbook.SheetNames.length === 0) {
    return { ok: false, error: "El Excel no tiene sheets" };
  }
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: false,
  });

  if (rows.length === 0) {
    return { ok: false, error: "El sheet está vacío" };
  }

  const headers = Object.keys(rows[0] ?? {});
  const mapping = detectColumns(headers);

  // Si no encontramos placement_name + budget, probablemente no es nuestro
  // formato y necesita el mapping wizard manual. Avisamos pero seguimos.
  const missingCritical: string[] = [];
  if (!mapping.placementName) missingCritical.push("placementName");
  if (!mapping.budgetNetUsd) missingCritical.push("budgetNetUsd");

  if (missingCritical.length > 0) {
    return {
      ok: false,
      error: `No pudimos detectar las columnas: ${missingCritical.join(", ")}. Headers encontrados: ${headers.join(", ")}. (El mapping wizard manual llega en un próximo iteración.)`,
    };
  }

  const lines: ExcelPreviewLine[] = [];
  let skipped = 0;
  let totalBudget = 0;

  rows.forEach((row, idx) => {
    const placementRaw = mapping.placementName
      ? row[mapping.placementName]
      : null;
    const budgetRaw = mapping.budgetNetUsd ? row[mapping.budgetNetUsd] : null;

    const placement =
      typeof placementRaw === "string" ? placementRaw.trim() : null;
    const budget = parseNumber(budgetRaw);

    if (!placement || budget == null || budget <= 0) {
      skipped += 1;
      return;
    }

    const warnings: string[] = [];
    const startDate = mapping.startDate
      ? parseDate(row[mapping.startDate])
      : null;
    const endDate = mapping.endDate ? parseDate(row[mapping.endDate]) : null;
    if (!startDate && mapping.startDate) warnings.push("fecha inicio inválida");
    if (!endDate && mapping.endDate) warnings.push("fecha fin inválida");

    const feePct = mapping.feePct
      ? (parseNumber(row[mapping.feePct]) ?? 0)
      : 0;

    lines.push({
      publisher: normalizePublisher(
        mapping.publisher ? row[mapping.publisher] : null,
      ),
      placementName: placement,
      audienceMarket: mapping.audienceMarket
        ? typeof row[mapping.audienceMarket] === "string"
          ? (row[mapping.audienceMarket] as string).trim()
          : null
        : null,
      startDate,
      endDate,
      budgetNetUsd: budget,
      feePct,
      rawRowIndex: idx + 2, // +2 = 1-indexed + header row
      warnings,
    });

    totalBudget += budget;
  });

  return {
    ok: true,
    filename: file.name,
    sheetName,
    totalRows: rows.length,
    detectedHeaders: headers,
    mapping,
    lines,
    skippedCount: skipped,
    totalBudget,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// createMediaPlanFromImport — guarda el preview como un nuevo plan
// ────────────────────────────────────────────────────────────────────────────

export type CreateMediaPlanResult =
  | { ok: true; planId: string; version: number; lineCount: number }
  | { ok: false; error: string };

export async function createMediaPlanFromImport(
  projectId: string,
  preview: ExcelPreview,
): Promise<CreateMediaPlanResult> {
  if (!projectId) return { ok: false, error: "Falta project_id" };
  if (preview.lines.length === 0) {
    return { ok: false, error: "El preview no tiene líneas" };
  }

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) return { ok: false, error: "Proyecto no encontrado" };

  // Próxima versión: max(version) + 1.
  const [last] = await db
    .select({ version: mediaPlans.version })
    .from(mediaPlans)
    .where(eq(mediaPlans.projectId, projectId))
    .orderBy(desc(mediaPlans.version))
    .limit(1);
  const nextVersion = (last?.version ?? 0) + 1;

  // Si hay una versión approved y vamos a crear una nueva: la marcamos como
  // superseded (la regla "solo un approved" la enforce app code).
  if (last) {
    const [currentApproved] = await db
      .select()
      .from(mediaPlans)
      .where(
        and(
          eq(mediaPlans.projectId, projectId),
          eq(mediaPlans.status, "approved"),
        ),
      )
      .orderBy(asc(mediaPlans.version))
      .limit(1);
    if (currentApproved) {
      await db
        .update(mediaPlans)
        .set({ status: "superseded" })
        .where(eq(mediaPlans.id, currentApproved.id));
      await db.insert(auditLog).values({
        entityType: "media_plan",
        entityId: currentApproved.id,
        action: "update",
        beforeJson: currentApproved,
        afterJson: { ...currentApproved, status: "superseded" },
      });
    }
  }

  const [newPlan] = await db
    .insert(mediaPlans)
    .values({
      projectId,
      version: nextVersion,
      status: "draft",
      importedAt: new Date(),
    })
    .returning();

  await db.insert(mediaPlanLines).values(
    preview.lines.map((l, idx) => ({
      mediaPlanId: newPlan.id,
      publisher: l.publisher,
      placementName: l.placementName,
      audienceMarket: l.audienceMarket,
      startDate: l.startDate,
      endDate: l.endDate,
      budgetNetUsd: l.budgetNetUsd.toFixed(2),
      feePct: l.feePct.toFixed(2),
      sortOrder: idx,
    })),
  );

  await db.insert(auditLog).values({
    entityType: "media_plan",
    entityId: newPlan.id,
    action: "create",
    afterJson: {
      ...newPlan,
      lineCount: preview.lines.length,
      sourceFile: preview.filename,
      totalBudget: preview.totalBudget,
    },
  });

  revalidatePath(`/proyectos/${project.code}`);
  return {
    ok: true,
    planId: newPlan.id,
    version: nextVersion,
    lineCount: preview.lines.length,
  };
}
