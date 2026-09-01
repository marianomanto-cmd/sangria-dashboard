import { Fragment } from "react";

// ════════════════════════════════════════════════════════════════════════════
// Nombre de placement, legible completo.
//
// Los nombres siguen el naming del cliente —"COPA.m1220|Meta|Latam|
// Performance|Awareness"— y son 60/90 caracteres SIN UN SOLO ESPACIO. Para el
// navegador eso es una palabra sola e indivisible: no tiene dónde cortarla, así
// que en una celda angosta o desborda la columna o queda recortada. En la
// planilla del plan se veía "COPA.m1220|Meta|Latam|Perform" y para leer el
// final había que meterse en el campo y moverse con las flechas.
//
// La solución es marcar puntos de corte (<wbr>) después de cada separador del
// naming, para que el texto se envuelva por segmentos y se lea entero:
//
//   COPA.m1220|Meta|
//   Latam|Performance|
//   Awareness
//
// El corte va DESPUÉS del separador a propósito: el "|" se queda pegado al
// segmento que cierra, así se ve que la línea sigue abajo.
// ════════════════════════════════════════════════════════════════════════════

// Separadores del naming. El "." queda afuera: "COPA.m1220" es el código de
// campaña, una unidad — partirlo al medio se lee peor que envolver más abajo.
const SEPARATORS = "|_/-";

/** Parte el nombre en segmentos, cada uno terminado en su separador. */
export function splitPlacementName(name: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < name.length; i++) {
    if (SEPARATORS.includes(name[i])) {
      parts.push(name.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < name.length) parts.push(name.slice(start));
  return parts;
}

export function PlacementName({
  name,
  className = "",
  empty = "—",
}: {
  name: string | null | undefined;
  className?: string;
  /** Qué mostrar si el placement todavía no tiene nombre. */
  empty?: React.ReactNode;
}) {
  const text = (name ?? "").trim();
  if (text === "") return <>{empty}</>;

  const parts = splitPlacementName(text);
  return (
    // break-words es la red de contención: si un segmento suelto no entra ni
    // así en la columna, se corta igual antes que desbordarla.
    <span className={`break-words ${className}`}>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part}
          {i < parts.length - 1 && <wbr />}
        </Fragment>
      ))}
    </span>
  );
}
