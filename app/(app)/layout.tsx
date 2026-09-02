import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { AppProviders } from "@/components/app-providers";
import { MobileNavProvider } from "@/components/mobile-nav";
import { getCurrentUser } from "@/lib/auth";

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

  return (
    <MobileNavProvider>
      <div className="flex flex-1 min-h-screen">
        <Sidebar user={user} />
        <div className="flex-1 flex flex-col min-w-0">
          <Topbar user={user} />
          <AppProviders>
            <div className="flex-1 flex flex-col">{children}</div>
          </AppProviders>
        </div>
      </div>
    </MobileNavProvider>
  );
}
