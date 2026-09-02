import { AlertTriangle } from "lucide-react";

// Aviso de datos incompletos.
//
// Degradar una sección a vacío evita tumbar la vista entera, pero "vacío" y
// "no se pudo cargar" NO son lo mismo: sin este aviso una pantalla en cero se
// lee como un dato real ("no hay nada"), y eso es peor que un error honesto.
// Pasó en prod el 02/sep/2026 con el dashboard en $0.
//
// Server component a propósito: lo renderiza la página que ya sabe qué falló,
// sin mandar nada al bundle del cliente.
export function DegradedNotice({ sections }: { sections: string[] }) {
  if (sections.length === 0) return null;
  return (
    <div
      role="status"
      className="mb-5 rounded-lg border border-warn/30 bg-warn-soft/40 px-4 py-3 flex items-start gap-3"
    >
      <AlertTriangle size={16} className="text-warn shrink-0 mt-0.5" />
      <div className="text-[13px] leading-relaxed text-ink-2">
        <p className="font-medium text-ink">Esta vista está incompleta</p>
        <p className="mt-0.5">
          No se pudo leer {sections.join(", ")} de la base de datos. Lo que falta
          aparece vacío — <strong className="text-ink-2">no es que no haya
          datos</strong>. Recargá en unos segundos.
        </p>
      </div>
    </div>
  );
}
