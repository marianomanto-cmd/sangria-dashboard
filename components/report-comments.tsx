"use client";

// Tablerito de comentarios por reporte del Reporting Calendar. Un botoncito
// "Comentarios (N)" abre un modal con la lista (autor + fecha y hora +
// cuerpo), un compose box abajo y edición/borrado inline. El primer
// comentario de un reporte manual es su descripción (sembrada al crearlo).
// Los datos van y vienen por server actions (app/actions/report-comments.ts);
// el count de los botones viene del server en cada fila (commentsCount) y se
// refresca con router.refresh() tras cada mutación.

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, Pencil, Trash2, X } from "lucide-react";
import {
  addReportComment,
  deleteReportComment,
  listReportComments,
  updateReportComment,
  type ReportComment,
  type ReportRef,
} from "@/app/actions/report-comments";
import { useConfirm } from "@/components/confirm-dialog";
import {
  actorLabel,
  formatAbsoluteDateTime,
  formatRelativeDateTime,
} from "@/lib/audit-format";
import type { Language } from "@/lib/i18n";

// Botón self-contained para celdas de tabla (pendientes / enviados).
export function ReportCommentsButton({
  reportRef,
  title,
  count,
  lang,
}: {
  reportRef: ReportRef;
  title: string;
  count: number;
  lang: Language;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink"
        title={
          lang === "es" ? "Comentarios del reporte" : "Report comments"
        }
      >
        <MessageSquare size={12} strokeWidth={2} />
        {lang === "es" ? "Comentarios" : "Comments"}
        {count > 0 && (
          <span className="font-mono text-[10px] rounded-full bg-paper-2 border border-line px-1.5">
            {count}
          </span>
        )}
      </button>
      {open && (
        <ReportCommentsModal
          reportRef={reportRef}
          title={title}
          lang={lang}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// Modal solo del tablerito (lo usa el botón de arriba y el callback del
// Gantt vía ReportingCalendarClient). Mismo patrón a11y que los otros
// modales: Escape/backdrop cierran, scroll-lock, foco restaurado al cerrar.
export function ReportCommentsModal({
  reportRef,
  title,
  lang,
  onClose,
}: {
  reportRef: ReportRef;
  title: string;
  lang: Language;
  onClose: () => void;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [comments, setComments] = useState<ReportComment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(
    null,
  );
  const composeRef = useRef<HTMLTextAreaElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);

  const load = () => {
    startTransition(async () => {
      const r = await listReportComments(reportRef);
      if (!r.ok) setError(r.error);
      else {
        setError(null);
        setComments(r.comments);
      }
    });
  };

  // Carga inicial + scroll-lock + foco.
  useEffect(() => {
    lastFocused.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    load();
    return () => {
      document.body.style.overflow = prevOverflow;
      lastFocused.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onAdd = () => {
    if (!draft.trim()) return;
    startTransition(async () => {
      const r = await addReportComment({ ref: reportRef, body: draft });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setDraft("");
      const list = await listReportComments(reportRef);
      if (list.ok) setComments(list.comments);
      router.refresh(); // actualiza el count del botón
      composeRef.current?.focus();
    });
  };

  const onSaveEdit = () => {
    if (!editing || !editing.body.trim()) return;
    startTransition(async () => {
      const r = await updateReportComment({
        commentId: editing.id,
        body: editing.body,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setEditing(null);
      const list = await listReportComments(reportRef);
      if (list.ok) setComments(list.comments);
    });
  };

  const onDelete = async (commentId: string) => {
    if (
      !(await confirm({
        title:
          lang === "es" ? "¿Eliminar el comentario?" : "Delete this comment?",
        body:
          lang === "es"
            ? "Esta acción no se puede deshacer."
            : "This can't be undone.",
        confirmLabel: lang === "es" ? "Eliminar" : "Delete",
        danger: true,
      }))
    )
      return;
    startTransition(async () => {
      const r = await deleteReportComment({ commentId });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const list = await listReportComments(reportRef);
      if (list.ok) setComments(list.comments);
      router.refresh();
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onKeyDown={onKeyDown}
    >
      <div
        className="absolute inset-0 bg-ink/40 backdrop-blur-[1px] animate-fade-in"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-comments-title"
        className="relative w-full max-w-lg max-h-[80vh] flex flex-col rounded-lg border border-line bg-white dark:bg-paper-2 shadow-[var(--shadow-card-hover)] animate-dialog-in"
      >
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-line-soft">
          <div className="min-w-0">
            <h2
              id="report-comments-title"
              className="text-base font-semibold text-ink truncate"
            >
              {lang === "es" ? "Comentarios" : "Comments"} — {title}
            </h2>
            <p className="text-xs text-muted mt-0.5">
              {lang === "es"
                ? "El primero es la descripción del reporte (si la tiene)."
                : "The first one is the report description (if any)."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1.5 text-muted hover:text-ink hover:bg-paper-2"
            aria-label={lang === "es" ? "Cerrar" : "Close"}
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          {comments === null ? (
            <p className="px-5 py-8 text-center text-xs text-muted">
              {lang === "es" ? "Cargando…" : "Loading…"}
            </p>
          ) : comments.length === 0 ? (
            <p className="px-5 py-8 text-center text-xs text-muted">
              {lang === "es"
                ? "Sin comentarios todavía. Escribí el primero abajo."
                : "No comments yet. Write the first one below."}
            </p>
          ) : (
            <ul className="divide-y divide-line-soft">
              {comments.map((c) => (
                <li key={c.id} className="px-5 py-3">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-xs font-medium text-ink">
                      {actorLabel(c.authorEmail, c.authorUserId)}
                    </span>
                    <span
                      className="font-mono text-[10px] text-muted"
                      title={formatAbsoluteDateTime(new Date(c.createdAt))}
                    >
                      {formatRelativeDateTime(new Date(c.createdAt))}
                    </span>
                    {new Date(c.updatedAt).getTime() -
                      new Date(c.createdAt).getTime() >
                      1000 && (
                      <span className="text-[10px] text-muted italic">
                        ({lang === "es" ? "editado" : "edited"})
                      </span>
                    )}
                    <span className="ml-auto inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setEditing({ id: c.id, body: c.body })}
                        disabled={pending}
                        className="text-muted hover:text-ink disabled:opacity-50"
                        title={lang === "es" ? "Editar" : "Edit"}
                      >
                        <Pencil size={12} strokeWidth={2} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(c.id)}
                        disabled={pending}
                        className="text-muted hover:text-danger disabled:opacity-50"
                        title={lang === "es" ? "Eliminar" : "Delete"}
                      >
                        <Trash2 size={12} strokeWidth={2} />
                      </button>
                    </span>
                  </div>
                  {editing?.id === c.id ? (
                    <div className="mt-1.5 space-y-1.5">
                      <textarea
                        value={editing.body}
                        onChange={(e) =>
                          setEditing({ id: c.id, body: e.target.value })
                        }
                        rows={3}
                        autoFocus
                        className="w-full rounded-md border border-line bg-white dark:bg-paper-2 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent resize-y"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditing(null)}
                          disabled={pending}
                          className="text-xs text-muted hover:text-ink disabled:opacity-50"
                        >
                          {lang === "es" ? "Cancelar" : "Cancel"}
                        </button>
                        <button
                          type="button"
                          onClick={onSaveEdit}
                          disabled={pending || !editing.body.trim()}
                          className="rounded-md bg-ink text-white px-2.5 py-1 text-xs font-medium hover:bg-ink-2 disabled:opacity-50"
                        >
                          {lang === "es" ? "Guardar" : "Save"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-ink-2 whitespace-pre-line leading-relaxed">
                      {c.body}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-5 py-3 border-t border-line-soft space-y-2">
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
          <textarea
            ref={composeRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder={
              lang === "es" ? "Escribir un comentario…" : "Write a comment…"
            }
            className="w-full rounded-md border border-line bg-white dark:bg-paper-2 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent resize-y"
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onAdd}
              disabled={pending || !draft.trim()}
              className="rounded-md bg-ink text-white px-3 py-1.5 text-sm font-medium hover:bg-ink-2 disabled:opacity-50"
            >
              {pending
                ? lang === "es"
                  ? "Guardando…"
                  : "Saving…"
                : lang === "es"
                  ? "Comentar"
                  : "Comment"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
