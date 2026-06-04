"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// Gate del portal de cliente (read-only, público). Usuario = nombre o slug del
// cliente; password compartido. No es auth real — es para compartir un link.
export function PortalLogin({
  slug,
  clientName,
}: {
  slug: string;
  clientName: string;
}) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/portal/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, username, password }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: boolean; error?: string }
        | null;
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? "No se pudo ingresar.");
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <p className="text-xs font-semibold tracking-[0.18em] uppercase text-accent">
            Sangria
          </p>
          <h1 className="text-2xl font-semibold tracking-tight mt-2">
            {clientName}
          </h1>
          <p className="text-sm text-muted mt-1">
            Portal de cliente · acceso de solo lectura
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-lg border border-line bg-white dark:bg-paper-2 p-5 space-y-3"
        >
          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.08em] text-muted font-medium">
              Usuario
            </span>
            <input
              type="text"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={slug}
              autoComplete="username"
              className="mt-1 block w-full rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.08em] text-muted font-medium">
              Contraseña
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="mt-1 block w-full rounded-md border border-line bg-white dark:bg-paper-2 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </label>

          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-ink text-white px-3 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Ingresando…" : "Ingresar"}
          </button>
        </form>
      </div>
    </div>
  );
}
