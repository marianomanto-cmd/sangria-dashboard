"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import {
  fetchProjectsForPromotion,
  promoteScenarioToPlan,
} from "@/app/actions/simulator";
import type { PromoteTargetProject } from "@/db/queries/simulator";

// El componente externo es solo el gate: si está cerrado, no monta nada.
// Esto evita el patrón de "resetear estado en useEffect al abrir" — el inner
// arranca fresh cada vez que se abre porque se desmonta al cerrar.
export function PromoteDialog(props: {
  open: boolean;
  onClose: () => void;
  clientId: string;
  scenarioId: string | null;
  defaultPlanName: string;
}) {
  if (!props.open) return null;
  return <PromoteDialogInner {...props} />;
}

function PromoteDialogInner({
  onClose,
  clientId,
  scenarioId,
  defaultPlanName,
}: {
  open: boolean;
  onClose: () => void;
  clientId: string;
  scenarioId: string | null;
  defaultPlanName: string;
}) {
  const router = useRouter();
  const [projects, setProjects] = useState<PromoteTargetProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [projectId, setProjectId] = useState<string>("");
  const [planName, setPlanName] = useState<string>(defaultPlanName);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Carga inicial de proyectos al montar (el wrapper garantiza que esto
  // ocurre una sola vez por apertura).
  useEffect(() => {
    let cancelled = false;
    fetchProjectsForPromotion(clientId).then((p) => {
      if (cancelled) return;
      setProjects(p);
      if (p.length === 1) setProjectId(p[0].id);
      setLoadingProjects(false);
    });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  // Esc cierra
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = () => {
    if (!scenarioId) {
      setError("Guardá el escenario antes de promoverlo");
      return;
    }
    if (!projectId) {
      setError("Elegí un proyecto destino");
      return;
    }
    if (!planName.trim()) {
      setError("Poné un nombre para el plan");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await promoteScenarioToPlan({
        scenarioId,
        projectId,
        planName,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Redirige al editor del plan recién creado.
      router.push(`/proyectos/${res.data!.projectCode}/planes/${res.data!.planId}`);
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-paper rounded-lg border border-line shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-4 border-b border-line flex items-start justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted font-medium">
              Promover escenario
            </p>
            <h2 className="text-base font-semibold text-ink mt-1">
              Crear plan de medios
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-muted hover:text-ink hover:bg-paper-2"
          >
            <X size={16} />
          </button>
        </header>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted font-medium block mb-1">
              Proyecto destino
            </label>
            {loadingProjects ? (
              <p className="text-xs text-muted py-2">Cargando proyectos…</p>
            ) : projects.length === 0 ? (
              <p className="text-xs text-muted py-2">
                Este cliente no tiene proyectos disponibles para crear un plan.
              </p>
            ) : (
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full text-sm px-3 py-2 rounded-md border border-line bg-white dark:bg-paper-2"
              >
                <option value="">— Elegí un proyecto —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.status})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted font-medium block mb-1">
              Nombre del plan
            </label>
            <input
              type="text"
              value={planName}
              onChange={(e) => setPlanName(e.target.value)}
              placeholder="Awareness, Performance, etc."
              className="w-full text-sm px-3 py-2 rounded-md border border-line bg-white dark:bg-paper-2"
            />
          </div>

          <p className="text-[11px] text-muted leading-relaxed">
            Se crea un plan en status <strong>draft</strong> con un placement
            por cada fila del escenario. El metrics_json de cada placement se
            calcula con los rates del modo elegido (P25/P50/P75/Manual). Vas a
            poder editarlo en el editor del plan antes de mandarlo a aprobar.
          </p>

          {error && (
            <div className="text-xs text-rose-600 dark:text-rose-400 rounded-md border border-rose-300/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-line flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="text-xs px-3 py-2 rounded-md border border-line text-muted hover:text-ink-2 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending || loadingProjects || projects.length === 0}
            className="text-xs px-3 py-2 rounded-md bg-accent text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {pending ? "Creando…" : "Crear plan"}
          </button>
        </footer>
      </div>
    </div>
  );
}
