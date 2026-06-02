// Allowlist de quién puede APROBAR planes (transición ready_to_send →
// approved). Aprobar congela un snapshot inmutable del plan, así que la acción
// se limita a estos usuarios.
//
// El chequeo REAL (barrera de seguridad) vive en la server action
// `transitionPlanStatus` (app/actions/plans.ts). La UI solo esconde el botón
// como conveniencia. Este módulo no importa nada server-only, así que se puede
// usar tanto en el server como derivar un boolean para pasarle al client.
//
// Comparación case-insensitive (los emails de Supabase suelen venir en minúscula,
// pero normalizamos por las dudas).
export const PLAN_APPROVER_EMAILS = [
  "mariano.mantovani@sangria.agency",
  "herman.grabosky@sangria.agency",
] as const;

export function canApprovePlans(email: string | null | undefined): boolean {
  if (!email) return false;
  return (PLAN_APPROVER_EMAILS as readonly string[]).includes(
    email.trim().toLowerCase(),
  );
}
