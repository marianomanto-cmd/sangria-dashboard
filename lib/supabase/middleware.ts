import { NextResponse, type NextRequest } from "next/server";

// ⚠️ TEMP — LOGIN DESHABILITADO (rama `tablero-alertas`, SOLO para pruebas).
// Esta versión deja pasar TODOS los requests sin chequear sesión, para poder
// probar el tablero de pendientes en un Preview de Vercel sin autenticarse.
//
// La lógica real de auth (Supabase getUser() + redirect a /login + bloqueo de
// dominio @sangria.agency) está en `main` y en el historial de git.
//
// 👉 PARA VOLVER A HABILITAR EL LOGIN: `git revert` de este commit (o restaurar
//    este archivo desde `main`) ANTES de mergear el tablero a `main`.
export async function updateSession(request: NextRequest) {
  return NextResponse.next({ request });
}
