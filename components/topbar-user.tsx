"use client";

import { useEffect, useRef, useState } from "react";
import { LogOut } from "lucide-react";

type Props = {
  email: string;
  name: string | null;
  avatarUrl: string | null;
};

// Avatar + menú con "Cerrar sesión". Client-only para manejar el toggle del
// menú. El sign-out es un POST a /auth/signout — el route ahí limpia la
// sesión y redirige a /login.
export function TopbarUser({ email, name, avatarUrl }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Cerrar el menú al click outside / Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const initials = getInitials(name ?? email);
  const displayName = name ?? email;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Cuenta · ${displayName}`}
        className="w-7 h-7 rounded-full bg-gradient-to-br from-accent-2 to-accent shrink-0 ring-1 ring-accent-strong/20 overflow-hidden flex items-center justify-center text-white text-[11px] font-semibold hover:ring-2 hover:ring-accent-soft transition-shadow"
      >
        {avatarUrl ? (
          // Avatar de Google. No usamos <Image> de next porque la dom de
          // Google no está en la allowlist de remotePatterns y no vale la
          // pena configurarla por un avatar de 28px.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
          />
        ) : (
          <span>{initials}</span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-64 rounded-md border border-line bg-white dark:bg-paper-2 shadow-lg overflow-hidden z-20"
        >
          <div className="px-3 py-2.5 border-b border-line-soft">
            <p className="text-sm font-medium text-ink truncate">{displayName}</p>
            <p className="text-xs text-muted truncate font-mono">{email}</p>
          </div>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              role="menuitem"
              className="w-full px-3 py-2 text-left text-sm text-ink hover:bg-paper-2 flex items-center gap-2"
            >
              <LogOut size={14} strokeWidth={2} className="text-muted" />
              Cerrar sesión
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function getInitials(s: string): string {
  // "Mariano Manto" → "MM"; "mariano.manto@sangria.agency" → "mm".
  const cleaned = s.includes("@") ? s.split("@")[0].replace(/[._-]+/g, " ") : s;
  const parts = cleaned.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
