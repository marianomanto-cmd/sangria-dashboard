"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import {
  createMediaPlanFromImport,
  parseExcelFile,
  type ExcelPreview,
} from "@/app/actions/excel-import";
import { formatPct, formatUsd, formatUsdCompact } from "@/lib/format";

type Stage =
  | { kind: "idle" }
  | { kind: "parsing" }
  | { kind: "preview"; data: ExcelPreview }
  | { kind: "saving"; data: ExcelPreview }
  | { kind: "error"; message: string };

export function ExcelImporter({
  projectId,
  projectCode,
}: {
  projectId: string;
  projectCode: string;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setStage({ kind: "parsing" });
    const fd = new FormData();
    fd.append("file", file);
    const result = await parseExcelFile(fd);
    if (!result.ok) {
      setStage({ kind: "error", message: result.error });
      return;
    }
    setStage({ kind: "preview", data: result });
  };

  const handleSave = async (data: ExcelPreview) => {
    setStage({ kind: "saving", data });
    const result = await createMediaPlanFromImport(projectId, data);
    if (!result.ok) {
      setStage({ kind: "error", message: result.error });
      return;
    }
    router.push(`/proyectos/${projectCode}`);
  };

  if (stage.kind === "idle") {
    return (
      <div className="rounded-lg border border-line border-dashed bg-paper-2 px-6 py-16 text-center">
        <div className="w-12 h-12 mx-auto rounded-full bg-paper border border-line flex items-center justify-center mb-3">
          <FileSpreadsheet size={20} strokeWidth={2} className="text-ink-2" />
        </div>
        <p className="text-sm font-medium text-ink-2 mb-1">
          Subí un Excel del plan de medios
        </p>
        <p className="text-xs text-muted mb-4 max-w-sm mx-auto">
          .xlsx con columnas Publisher, Placement, Fecha inicio/fin, Budget,
          Fee. El parser tolera mayúsculas y nombres en español.
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-md bg-ink text-white px-4 py-2 text-sm font-medium hover:bg-ink-2 transition-colors"
        >
          <Upload size={14} strokeWidth={2.5} />
          Elegir archivo
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
      </div>
    );
  }

  if (stage.kind === "parsing") {
    return (
      <div className="rounded-lg border border-line bg-white px-5 py-8 text-center">
        <div className="text-sm text-muted">Parseando Excel…</div>
      </div>
    );
  }

  if (stage.kind === "error") {
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-danger bg-danger-soft px-4 py-3 text-sm text-danger">
          <strong>Error:</strong> {stage.message}
        </div>
        <button
          type="button"
          onClick={() => setStage({ kind: "idle" })}
          className="text-sm text-muted hover:text-ink"
        >
          Volver a empezar
        </button>
      </div>
    );
  }

  // preview o saving
  const data = stage.data;
  const isSaving = stage.kind === "saving";

  return (
    <div className="space-y-4">
      {/* Resumen */}
      <section className="rounded-lg border border-line bg-white px-5 py-4 grid grid-cols-2 sm:grid-cols-5 gap-x-6 gap-y-3">
        <Meta label="Archivo">
          <span className="font-mono text-sm text-ink-2">{data.filename}</span>
        </Meta>
        <Meta label="Sheet">
          <span className="font-mono text-sm text-ink-2">{data.sheetName}</span>
        </Meta>
        <Meta label="Filas leídas">
          <span className="font-mono text-sm font-semibold tabular-nums text-ink">
            {data.totalRows}
          </span>
        </Meta>
        <Meta label="Líneas válidas">
          <span className="font-mono text-sm font-semibold tabular-nums text-ink">
            {data.lines.length}
            {data.skippedCount > 0 && (
              <span className="ml-1 text-muted text-xs font-normal">
                · {data.skippedCount} omitidas
              </span>
            )}
          </span>
        </Meta>
        <Meta label="Total budget">
          <span className="font-mono text-sm font-semibold tabular-nums text-ink">
            {formatUsdCompact(data.totalBudget)}
          </span>
        </Meta>
      </section>

      {/* Mapping detectado */}
      <section className="rounded-lg border border-line bg-white px-5 py-4">
        <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <CheckCircle2 size={14} className="text-success" />
          Mapping detectado
        </h2>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-xs">
          {Object.entries(data.mapping).map(([field, header]) => (
            <div key={field}>
              <dt className="font-medium text-muted">{field}</dt>
              <dd className="font-mono text-ink-2">
                {header ?? <span className="text-stone-300">—</span>}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Preview de líneas */}
      <section className="rounded-lg border border-line bg-white overflow-hidden">
        <div className="px-5 py-3 border-b border-line">
          <h2 className="text-sm font-semibold">
            Preview de líneas ({data.lines.length})
          </h2>
        </div>
        <div className="overflow-x-auto max-h-[480px]">
          <table className="w-full text-sm">
            <thead className="bg-paper sticky top-0">
              <tr className="text-[11px] uppercase tracking-[0.06em] text-muted">
                <th className="text-right font-medium px-3 py-2 w-[44px]">#</th>
                <th className="text-left font-medium px-3 py-2">Publisher</th>
                <th className="text-left font-medium px-3 py-2">Placement</th>
                <th className="text-left font-medium px-3 py-2">Audiencia</th>
                <th className="text-left font-medium px-3 py-2">Período</th>
                <th className="text-right font-medium px-3 py-2">Budget</th>
                <th className="text-right font-medium px-3 py-2">Fee</th>
                <th className="text-left font-medium px-3 py-2">Warnings</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l) => (
                <tr
                  key={l.rawRowIndex}
                  className="border-t border-line-soft hover:bg-paper-2 transition-colors"
                >
                  <td className="px-3 py-1.5 text-right font-mono text-[11px] text-muted tabular-nums">
                    {l.rawRowIndex}
                  </td>
                  <td className="px-3 py-1.5 text-ink-2">{l.publisher}</td>
                  <td className="px-3 py-1.5 text-ink">{l.placementName}</td>
                  <td className="px-3 py-1.5 text-muted text-xs">
                    {l.audienceMarket ?? "—"}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[11px] text-ink-2">
                    {l.startDate ?? "—"} → {l.endDate ?? "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-ink-2 tabular-nums">
                    {formatUsd(l.budgetNetUsd)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-muted tabular-nums text-xs">
                    {formatPct(l.feePct, 0)}
                  </td>
                  <td className="px-3 py-1.5">
                    {l.warnings.length > 0 ? (
                      <span className="text-warn text-[11px]">
                        {l.warnings.join(", ")}
                      </span>
                    ) : (
                      <span className="text-stone-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => setStage({ kind: "idle" })}
          disabled={isSaving}
          className="text-sm text-muted hover:text-ink disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => handleSave(data)}
          disabled={isSaving}
          className="inline-flex items-center gap-1.5 rounded-md bg-ink text-white px-4 py-2 text-sm font-medium hover:bg-ink-2 transition-colors disabled:opacity-50"
        >
          {isSaving ? "Guardando…" : `Crear plan v? con ${data.lines.length} líneas`}
        </button>
      </div>
    </div>
  );
}

function Meta({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
        {label}
      </dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}
