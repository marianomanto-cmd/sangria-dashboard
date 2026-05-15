import { Inbox } from "lucide-react";

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
      <header className="mb-10 flex items-end justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-2.5">
          {eyebrow && (
            <p className="text-[11px] font-semibold tracking-[0.18em] uppercase text-accent">
              {eyebrow}
            </p>
          )}
          <h1 className="text-[32px] leading-[1.1] font-semibold tracking-tight text-ink">
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm text-muted max-w-2xl leading-relaxed">
              {subtitle}
            </p>
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
  icon?: React.ReactNode;
  action?: React.ReactNode;
};

export function EmptyState({ title, hint, icon, action }: EmptyStateProps) {
  return (
    <div className="rounded-lg border border-line border-dashed bg-paper-2/50 px-5 py-14 text-center flex flex-col items-center gap-3">
      <div className="w-10 h-10 rounded-full bg-paper-2 border border-line-soft flex items-center justify-center text-muted">
        {icon ?? <Inbox size={18} strokeWidth={1.75} />}
      </div>
      <div>
        <p className="text-sm font-medium text-ink-2">{title}</p>
        {hint && (
          <p className="text-xs text-muted mt-1 max-w-sm mx-auto leading-relaxed">
            {hint}
          </p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
