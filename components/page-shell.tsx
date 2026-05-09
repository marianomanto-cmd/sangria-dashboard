type PageShellProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
};

export function PageShell({
  eyebrow,
  title,
  subtitle,
  actions,
  children,
}: PageShellProps) {
  return (
    <main className="px-8 py-10 max-w-[1380px] mx-auto w-full">
      <header className="mb-8 flex items-end justify-between gap-4 flex-wrap">
        <div>
          {eyebrow && (
            <p className="text-xs font-semibold tracking-[0.16em] uppercase text-accent">
              {eyebrow}
            </p>
          )}
          <h1 className="text-3xl font-semibold tracking-tight mt-2">{title}</h1>
          {subtitle && (
            <p className="text-sm text-muted mt-1 max-w-2xl">{subtitle}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>
      {children}
    </main>
  );
}

type EmptyStateProps = {
  title: string;
  hint?: string;
};

export function EmptyState({ title, hint }: EmptyStateProps) {
  return (
    <div className="rounded-lg border border-line border-dashed bg-paper-2 px-5 py-12 text-center">
      <p className="text-sm font-medium text-ink-2">{title}</p>
      {hint && <p className="text-xs text-muted mt-1">{hint}</p>}
    </div>
  );
}
