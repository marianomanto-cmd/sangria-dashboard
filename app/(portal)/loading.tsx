// Skeleton del portal del cliente.
//
// Sin esto, el cliente veía la página en blanco mientras el server renderizaba
// (el portal es `force-dynamic` y hace varias lecturas). Un blanco de dos
// segundos se lee como "no funciona"; un skeleton se lee como "está cargando".
//
// Ojo con lo que este archivo NO hace: `loading.js` envuelve `page.js` y los
// layouts anidados, pero NO el layout del mismo segmento — igual que
// `error.js`. Acá no importa porque `app/(portal)/` no tiene layout propio.
// Ver node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md:88
//
// Espeja la estructura real de app/(portal)/[clientSlug]/page.tsx: header con
// la marca + nombre del cliente, tira de 8 tabs, y una grilla de tarjetas.

const TAB_WIDTHS = [
  "w-20",
  "w-28",
  "w-20",
  "w-24",
  "w-24",
  "w-20",
  "w-22",
  "w-26",
];

export default function PortalLoading() {
  return (
    <div className="min-h-[100dvh] bg-paper" aria-busy="true" aria-live="polite">
      <span className="sr-only">Cargando · Loading</span>

      <header className="border-b border-line bg-white dark:bg-paper-2">
        <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-[0.18em] uppercase text-accent">
              Sangria
            </p>
            <div className="h-6 w-44 mt-1.5 rounded bg-paper-2 border border-line-soft animate-pulse" />
          </div>
          <div className="h-8 w-24 rounded-full bg-paper-2 border border-line-soft animate-pulse" />
        </div>

        <nav className="max-w-[1400px] mx-auto px-6 flex gap-1" aria-hidden="true">
          {TAB_WIDTHS.map((w, i) => (
            <div key={i} className="px-3.5 py-2.5">
              <div
                className={`h-4 ${w} rounded bg-paper-2 border border-line-soft animate-pulse`}
              />
            </div>
          ))}
        </nav>
      </header>

      <main className="max-w-[1400px] mx-auto px-6 py-6" aria-hidden="true">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border border-line bg-white dark:bg-paper-2 px-4 py-3.5"
            >
              <div className="h-3 w-20 rounded bg-paper-2 border border-line-soft animate-pulse" />
              <div className="h-7 w-28 mt-2.5 rounded bg-paper-2 border border-line-soft animate-pulse" />
            </div>
          ))}
        </div>

        <div className="mt-5 rounded-xl border border-line bg-white dark:bg-paper-2 px-5 py-6">
          <div className="h-4 w-40 rounded bg-paper-2 border border-line-soft animate-pulse" />
          <div className="mt-5 flex items-end gap-1.5 h-44">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="flex-1 rounded-t bg-paper-2 border border-line-soft animate-pulse"
                style={{ height: `${30 + ((i * 37) % 65)}%` }}
              />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
