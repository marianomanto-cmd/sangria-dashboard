import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { AppProviders } from "@/components/app-providers";
import { MobileNavProvider } from "@/components/mobile-nav";
import { getCurrentUser } from "@/lib/auth";
import { getReadOnlyMode } from "@/lib/read-only";
import { AUDIT_SHELL_USER, AUDIT_SIGNOUT_PATH } from "@/lib/audit-session";
import {
  AuditHintLayer,
  AuditModeBanner,
  AuditModeProvider,
} from "@/components/audit-mode";

// La app entera es data-driven: ninguna página debería pre-renderizarse en
// build-time. Forzar dinámica también evita que el build de Vercel intente
// conectarse a la DB durante la fase "Generating static pages".
export const dynamic = "force-dynamic";

// Tope de duración para TODAS las páginas del grupo (los segment configs
// cascadean del layout a las páginas; una página puede subirlo — el dashboard
// usa 60 para su primer render en frío).
//
// El default de Vercel es 300s, y ese default era parte del problema: cuando el
// pooler de Supabase se saturaba, el render quedaba esperando una conexión que
// no llegaba nunca y la función se moría recién a los 5 minutos, dejando su
// conexión trabada en el pooler todo ese tiempo → más saturación → espiral de
// horas. Cortando a 45s la conexión se libera ~7x antes y el usuario ve el
// error boundary (recargable) en vez de un skeleton eterno.
export const maxDuration = 45;

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Una sola lectura del user logueado para toda la chrome: la comparten el
  // sidebar (footer) y el topbar (avatar + menú).
  const user = await getCurrentUser();

  // Solo lectura: sesión de auditoría externa, o usuario interno con rol
  // Viewer. Ver lib/read-only.ts.
  const mode = await getReadOnlyMode(user);

  // La auditoría no tiene sesión de Supabase, así que la chrome se dibuja con
  // un usuario sintético para que el avatar y el menú no queden vacíos.
  const shellUser =
    user ?? (mode.reason === "audit" ? AUDIT_SHELL_USER : null);
  const signOutAction =
    !user && mode.reason === "audit" ? AUDIT_SIGNOUT_PATH : undefined;

  return (
    <MobileNavProvider>
      <AuditModeProvider value={mode}>
        {/* El data-attribute es el que engancha el CSS de globals.css que
            apaga visualmente todo lo marcado con data-audit-hint. */}
        <div
          className="flex flex-1 min-h-screen"
          data-audit-readonly={mode.readOnly ? "1" : undefined}
        >
          <Sidebar user={shellUser} />
          <div className="flex-1 flex flex-col min-w-0">
            <Topbar user={shellUser} signOutAction={signOutAction} />
            {mode.readOnly && mode.reason && (
              <AuditModeBanner reason={mode.reason} />
            )}
            <AppProviders>
              <div className="flex-1 flex flex-col">{children}</div>
            </AppProviders>
          </div>
        </div>
        <AuditHintLayer readOnly={mode.readOnly} />
      </AuditModeProvider>
    </MobileNavProvider>
  );
}
