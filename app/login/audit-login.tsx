"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ShieldCheck } from "lucide-react";
import { Button } from "@/components/button";

// Segunda puerta del login: acceso de AUDITORÍA externa, con usuario y
// contraseña en vez de Google. Da acceso de SOLO LECTURA a toda la app
// interna (ver lib/audit-session.ts).
//
// Va colapsado a propósito: el 99% de los logins son del equipo con Google, y
// esto no tiene que competir con ese botón ni invitar a probar contraseñas.
//
// No es un Server Action: postea al endpoint dedicado /api/audit/login, que
// es público en el proxy y se autovalida. Los Server Actions van por POST y el
// proxy los gatea, así que desde una pantalla sin sesión no servirían.
export function AuditLogin({
  next,
  enabled,
  openByDefault = false,
}: {
  next: string | null;
  enabled: boolean;
  // `/login?audit=1` — el link que se comparte con la auditora, para que caiga
  // directo en el formulario y no tenga que buscar el desplegable.
  openByDefault?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(openByDefault);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/audit/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        setError(data.error ?? "No pudimos validar el acceso.");
        setPending(false);
        return;
      }
      // replace + refresh: el cookie ya está seteado y el proxy tiene que
      // volver a evaluar la sesión con él.
      router.replace(next && next.startsWith("/") ? next : "/");
      router.refresh();
    } catch {
      setError("No pudimos conectar. Probá de nuevo.");
      setPending(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-1.5 text-[11px] text-muted hover:text-ink transition-colors"
      >
        <ShieldCheck size={12} strokeWidth={2} />
        Acceso de auditoría
        <ChevronDown size={12} strokeWidth={2} />
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2.5">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
        <ShieldCheck size={12} strokeWidth={2.5} />
        Acceso de auditoría · solo lectura
      </p>

      {!enabled && (
        <div
          role="alert"
          className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-xs text-danger"
        >
          No está configurado en este entorno. Falta la variable
          AUDIT_SESSION_SECRET (o DATABASE_URL).
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-xs text-danger"
        >
          {error}
        </div>
      )}

      <input
        type="email"
        required
        autoComplete="username"
        placeholder="Mail"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full rounded-md border border-line bg-white dark:bg-paper px-3 py-2 text-sm text-ink placeholder:text-muted"
      />
      <input
        type="password"
        required
        autoComplete="current-password"
        placeholder="Contraseña"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full rounded-md border border-line bg-white dark:bg-paper px-3 py-2 text-sm text-ink placeholder:text-muted"
      />
      <div className="flex gap-2">
        <Button type="submit" size="md" disabled={pending || !enabled} className="flex-1">
          {pending ? "Entrando…" : "Entrar"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="md"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}
