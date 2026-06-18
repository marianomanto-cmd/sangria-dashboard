import { asc, ne } from "drizzle-orm";
import { Suspense } from "react";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { db } from "@/db";
import { clients } from "@/db/schema";
import type { AppUser } from "@/lib/auth";
import { TopbarClientPicker } from "@/components/topbar-client-picker";
import { TopbarUser } from "@/components/topbar-user";
import { TopbarNav } from "@/components/topbar-nav";
import { TopNav } from "@/components/top-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { MobileNavToggle } from "@/components/mobile-nav";

export async function Topbar({ user }: { user: AppUser | null }) {
  const year = new Date().getFullYear();
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-surface">
      <div className="px-4 lg:px-6 h-12 flex items-center gap-3 lg:gap-4">
        <MobileNavToggle />

        {/* Marca — solo desktop (en mobile la sostiene el drawer). */}
        <Link
          href="/"
          aria-label="Inicio"
          className="hidden lg:flex items-center gap-2.5 shrink-0"
        >
          <span
            aria-hidden
            className="w-[22px] h-[22px] rounded-full shrink-0"
            style={{
              background:
                "radial-gradient(circle at 38% 32%, #d8587e, #a8345f 55%, #5e1730)",
            }}
          />
          <span className="hidden xl:inline font-display font-black text-[15px] tracking-[0.1em] text-ink leading-none">
            SANGRIA{" "}
            <span className="align-middle text-[10px] font-semibold tracking-[0.18em] text-muted">
              OS
            </span>
          </span>
        </Link>

        {/* Título de sección — solo mobile (en desktop manda la TopNav). */}
        <div className="lg:hidden">
          <TopbarNav />
        </div>

        {/* Navegación principal — solo desktop. */}
        <TopNav />

        <div className="ml-auto flex items-center gap-2 shrink-0">
          {/* Rango fiscal — display (el dashboard hoy no filtra por rango).
              Solo en pantallas anchas para no comerle lugar a la TopNav. */}
          <span className="hidden 2xl:inline-flex items-center gap-1.5 rounded-full border border-line bg-paper-2 px-3 py-1 text-xs text-ink-2">
            <CalendarClock size={13} className="text-muted" />
            Ene — Dic {year}
          </span>

          <Suspense
            fallback={
              <div className="h-7 w-[160px] rounded-full border border-line bg-paper-2 animate-pulse" />
            }
          >
            <ClientPickerLoader />
          </Suspense>

          <ThemeToggle />

          {user ? (
            <TopbarUser
              email={user.email}
              name={user.name}
              avatarUrl={user.avatarUrl}
            />
          ) : (
            <div
              aria-label="Sin sesión"
              className="w-7 h-7 rounded-full bg-paper-2 border border-line shrink-0"
            />
          )}
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
