// Roles: datos puros, sin nada server-only. Vive en lib/ y NO en
// db/queries/app-users.ts porque lo importa un componente cliente
// (components/users-roles-client.tsx) — desde ahí, importar el módulo de
// queries arrastraría el driver de Postgres al bundle del browser.

export type AppUserRole =
  | "admin"
  | "approver"
  | "media_planner"
  | "account_manager"
  | "finance"
  | "viewer";

export type AppUserRow = {
  id: string;
  email: string;
  name: string | null;
  role: AppUserRole;
  active: boolean;
  lastSeenAt: string | null;
  createdAt: string;
};

// La UI de roles en un solo lugar: label + qué puede hacer. El orden es el que
// se muestra en los selectores.
export const ROLE_META: Record<
  AppUserRole,
  { label: string; description: string }
> = {
  admin: {
    label: "Admin",
    description: "Configura la app y los roles. Puede aprobar planes.",
  },
  approver: {
    label: "Aprobador",
    description: "Puede aprobar planes. No toca la configuración.",
  },
  media_planner: {
    label: "Media Planner",
    description: "Arma y edita planes de medios.",
  },
  account_manager: {
    label: "Account Manager",
    description: "Gestiona proyectos, reportes y billing.",
  },
  finance: {
    label: "Finance",
    description: "Facturación y seguimiento de cobros.",
  },
  viewer: {
    label: "Viewer",
    description: "Solo lectura.",
  },
};

export const ROLE_VALUES = Object.keys(ROLE_META) as AppUserRole[];

// Roles que pueden aprobar planes. Ver lib/permissions.ts.
export const APPROVER_ROLES: readonly AppUserRole[] = ["admin", "approver"];

export function isValidRole(role: string): role is AppUserRole {
  return (ROLE_VALUES as string[]).includes(role);
}
