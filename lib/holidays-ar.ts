// Feriados nacionales de Argentina.
//
// Devuelve un Set<"YYYY-MM-DD"> con las fechas observadas (incluyendo
// las trasladables según ley 27.399) para uso visual en el Reporting
// Calendar: si un día es feriado, se renderiza igual que un fin de semana.
//
// Cubre:
//   • Inamovibles (fechas fijas): Año Nuevo, Memoria, Malvinas, Trabajador,
//     Revolución de Mayo, Belgrano, Independencia, Inmaculada, Navidad.
//   • Trasladables: San Martín (17/8), Respeto a la Diversidad (12/10),
//     Soberanía (20/11). Reglas de traslado:
//       · Si caen Tue o Wed → al lunes anterior.
//       · Si caen Thu, Fri o Sat → al lunes siguiente.
//       · Si caen Sun o Mon → quedan donde caen.
//   • Móviles vinculados a Pascua: Carnaval (lunes y martes anteriores
//     al miércoles de ceniza = 48/47 días antes de Pascua) y Viernes
//     Santo (2 días antes de Pascua). Pascua se computa con el
//     algoritmo "Anonymous" gregoriano.
//
// No incluye:
//   • Feriados "puente" decretados año a año por el PEN (varían cada año).
//   • Feriados provinciales o municipales.

const cache = new Map<number, Set<string>>();

export function getArgentineHolidays(year: number): Set<string> {
  const cached = cache.get(year);
  if (cached) return cached;

  const e = easter(year);
  const goodFriday = addDays(e, -2);
  const carnavalMon = addDays(e, -48);
  const carnavalTue = addDays(e, -47);

  const fixed: Date[] = [
    new Date(year, 0, 1),   // 1 ene  — Año Nuevo
    new Date(year, 2, 24),  // 24 mar — Memoria por la Verdad y la Justicia
    new Date(year, 3, 2),   // 2 abr  — Veteranos y Caídos en Malvinas
    new Date(year, 4, 1),   // 1 may  — Día del Trabajador
    new Date(year, 4, 25),  // 25 may — Revolución de Mayo
    new Date(year, 5, 20),  // 20 jun — Paso a la Inmortalidad del Gral. Belgrano
    new Date(year, 6, 9),   // 9 jul  — Día de la Independencia
    new Date(year, 11, 8),  // 8 dic  — Inmaculada Concepción
    new Date(year, 11, 25), // 25 dic — Navidad
  ];

  const moveable: Date[] = [
    adjustMoveable(new Date(year, 7, 17)),  // 17 ago — San Martín
    adjustMoveable(new Date(year, 9, 12)),  // 12 oct — Respeto a la Diversidad Cultural
    adjustMoveable(new Date(year, 10, 20)), // 20 nov — Soberanía Nacional
  ];

  const all: Date[] = [
    ...fixed,
    ...moveable,
    goodFriday,
    carnavalMon,
    carnavalTue,
  ];

  const set = new Set(all.map(toISO));
  cache.set(year, set);
  return set;
}

// Conveniencia: devuelve un Set combinado para un rango de años.
export function getArgentineHolidaysForYears(years: number[]): Set<string> {
  const combined = new Set<string>();
  for (const y of years) {
    for (const iso of getArgentineHolidays(y)) combined.add(iso);
  }
  return combined;
}

// ───── helpers ──────────────────────────────────────────────────────────────

// Computus gregoriano (Anonymous Gregorian algorithm). Devuelve el domingo de
// Pascua para el año dado.
function easter(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const L = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * L) / 451);
  const month = Math.floor((h + L - 7 * m + 114) / 31); // 3 = marzo, 4 = abril
  const day = ((h + L - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function adjustMoveable(d: Date): Date {
  const dow = d.getDay(); // 0=Sun, 1=Mon ... 6=Sat
  if (dow === 2 || dow === 3) {
    // Mar/Mié → al lunes anterior
    return addDays(d, -(dow - 1));
  }
  if (dow === 4 || dow === 5) {
    // Jue/Vie → al lunes siguiente
    return addDays(d, 8 - dow);
  }
  if (dow === 6) {
    // Sáb → al lunes siguiente (la ley lo asimila al traslado posterior)
    return addDays(d, 2);
  }
  // Dom o Lun → queda donde está
  return d;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
