import { Moon } from "lucide-react";
import { asc, ne } from "drizzle-orm";
import { Suspense } from "react";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { TopbarClientPicker } from "@/components/topbar-client-picker";

export async function Topbar() {
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-white">
      <div className="px-6 h-12 flex items-center gap-4">
        <Breadcrumbs trail={["Sangria", "Dashboard"]} />

        <div className="ml-auto flex items-center gap-2">
          <Suspense
            fallback={
              <div className="h-7 w-[160px] rounded-md border border-line bg-paper-2 animate-pulse" />
            }
          >
            <ClientPickerLoader />
          </Suspense>

          <button
            type="button"
            aria-label="Cambiar a modo oscuro"
            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-muted hover:bg-paper-2 hover:text-ink transition-colors"
          >
            <Moon size={14} strokeWidth={2} />
          </button>

          <div
            aria-label="Tu cuenta"
            className="w-7 h-7 rounded-full bg-accent shrink-0"
          />
        </div>
      </div>
    </header>
  );
}

async function ClientPickerLoader() {
  // Los clientes archivados no aparecen en el filtro global. Se siguen
  // gestionando desde /configuracion/clientes.
  const rows = await db
    .select({ slug: clients.slug, name: clients.name })
    .from(clients)
    .where(ne(clients.status, "archived"))
    .orderBy(asc(clients.name));
  return <TopbarClientPicker clients={rows} />;
}

function Breadcrumbs({ trail }: { trail: readonly string[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-muted flex items-center gap-1.5">
      {trail.map((segment, i) => {
        const last = i === trail.length - 1;
        return (
          <span key={`${segment}-${i}`} className="flex items-center gap-1.5">
            <span className={last ? "text-ink font-medium" : undefined}>
              {segment}
            </span>
            {!last && <span className="text-stone-300">/</span>}
          </span>
        );
      })}
    </nav>
  );
}
