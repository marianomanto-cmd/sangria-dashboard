export default function Home() {
  return (
    <main className="flex-1 px-8 py-12 max-w-[1380px] mx-auto w-full">
      <p className="text-xs font-semibold tracking-[0.16em] uppercase text-accent">
        Sangria · Project OS
      </p>
      <h1 className="text-4xl font-semibold tracking-tight mt-3">
        Fase 0 — base
      </h1>
      <p className="text-[15px] text-muted mt-2 max-w-2xl">
        Tipografías, tokens y shell sin estrenar. Próximo paso: sidebar dark
        colapsable + topbar replicando el sistema de{" "}
        <code className="font-mono text-sm">_design/index.html</code>.
      </p>

      <section className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-lg border border-line bg-white p-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
            Stack
          </p>
          <p className="mt-2 font-mono text-sm leading-relaxed">
            next 16.2
            <br />
            react 19.2
            <br />
            tailwind 4
          </p>
        </div>
        <div className="rounded-lg border border-line bg-white p-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
            Tipografía
          </p>
          <p className="mt-2 text-sm">
            Geist (chrome + body),{" "}
            <span className="font-mono">JetBrains Mono</span> (cifras).
          </p>
        </div>
        <div className="rounded-lg border border-line bg-ink p-4 text-paper">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
            Acento
          </p>
          <p className="mt-2 font-mono text-sm">#7a1f3d · sangría</p>
        </div>
      </section>
    </main>
  );
}
