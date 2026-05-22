import { NextResponse, type NextRequest } from "next/server";

// ⚠️ TEMP — LOGIN DESHABILITADO (branch de control para debug, SOLO pruebas).
// Igual que en `tablero-alertas`, pero SIN el tablero de pendientes. Sirve para
// aislar si el cuelgue de la preview es por el código del tablero o por el
// entorno Preview de Vercel.
export async function updateSession(request: NextRequest) {
  return NextResponse.next({ request });
}
