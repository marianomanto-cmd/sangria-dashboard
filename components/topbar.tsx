import { asc, ne } from "drizzle-orm";
import { Suspense } from "react";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { TopbarClientPicker } from "@/components/topbar-client-picker";
import { ThemeToggle } from "@/components/theme-toggle";

export async function Topbar() {
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-paper/80 backdrop-blur supports-[backdrop-filter]:bg-paper/70 dark:bg-paper/85">
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

          <ThemeToggle />

          <div
            aria-label="Tu cuenta"
            className="w-7 h-7 rounded-full bg-gradient-to-br from-accent-2 to-accent shrink-0 ring-1 ring-accent-strong/20"
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
            {!last && <span className="text-line">/</span>}
          </span>
        );
      })}
    </nav>
  );
}
