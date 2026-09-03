import Link from "next/link";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { UsersRolesClient } from "@/components/users-roles-client";
import { listAppUsers } from "@/db/queries/app-users";
import { getCurrentUser } from "@/lib/auth";
import { canManageUsers } from "@/lib/permissions";

function Notice({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-line bg-paper-2 px-5 py-6 flex items-start gap-3 max-w-2xl">
      <ShieldAlert size={18} className="text-warn shrink-0 mt-0.5" />
      <div className="text-[13px] leading-relaxed text-ink-2">
        <p className="font-semibold text-ink">{title}</p>
        <div className="mt-1">{children}</div>
        <Link prefetch={false}
          href="/configuracion"
          className="mt-3 inline-flex items-center gap-1.5 text-accent hover:underline"
        >
          <ArrowLeft size={14} />
          Volver a Configuración
        </Link>
      </div>
    </div>
  );
}

export default async function UsuariosPage() {
  const user = await getCurrentUser();
  const allowed = await canManageUsers(user?.email);

  const shell = (children: React.ReactNode) => (
    <PageShell
      eyebrow="Configuración"
      title="Usuarios y roles"
      subtitle="Quién tiene acceso a la app y qué puede hacer. La identidad la maneja Supabase Auth: acá se asigna el rol, no se crean contraseñas."
    >
      {children}
    </PageShell>
  );

  if (!allowed) {
    return shell(
      <Notice title="Necesitás el rol Admin">
        <p>
          Esta sección la administra un Admin. Si necesitás acceso, pedile a
          alguien que ya lo tenga que te asigne el rol.
        </p>
      </Notice>,
    );
  }

  const users = await listAppUsers();

  // `null` = la tabla no existe todavía. Se explica en pantalla en vez de
  // tirar el error boundary: el SQL lo corre el dueño del repo a mano.
  if (users === null) {
    return shell(
      <Notice title="Falta correr la migración">
        <p>
          La tabla <code className="font-mono text-xs">app_users</code> no
          existe todavía. Corré{" "}
          <code className="font-mono text-xs">db/app-users.sql</code> en el SQL
          Editor de Supabase y volvé a entrar.
        </p>
        <p className="mt-2">
          Hasta entonces la app sigue funcionando normal: aprobar planes usa la
          allowlist de <code className="font-mono text-xs">lib/permissions.ts</code>.
        </p>
      </Notice>,
    );
  }

  return shell(
    <UsersRolesClient users={users} currentEmail={user?.email ?? null} />,
  );
}
