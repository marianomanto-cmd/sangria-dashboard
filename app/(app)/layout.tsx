import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";

// La app entera es data-driven: ninguna página debería pre-renderizarse en
// build-time. Forzar dinámica también evita que el build de Vercel intente
// conectarse a la DB durante la fase "Generating static pages".
export const dynamic = "force-dynamic";

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex flex-1 min-h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar />
        <div className="flex-1 flex flex-col">{children}</div>
      </div>
    </div>
  );
}
