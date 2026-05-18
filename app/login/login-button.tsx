"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Botón "Continuar con Google". Inicia el flow OAuth de Supabase, con
// redirect al callback de la app que valida el dominio. Si el user ya
// está logueado pero el proxy le devolvió a /login con `?error=domain`,
// el botón fuerza un nuevo signIn limpio.
export function LoginButton({ next }: { next: string | null }) {
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setLoading(true);
    setLocalError(null);
    const supabase = createClient();

    // El redirect post-OAuth tiene que ser absoluto y matchear lo
    // configurado en Supabase Auth → URL Configuration → Redirect URLs.
    const origin = window.location.origin;
    const redirectTo = `${origin}/auth/callback${
      next ? `?next=${encodeURIComponent(next)}` : ""
    }`;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        // Pedimos el dominio explícitamente: si el user tiene varias
        // cuentas Google, Google preselecciona la de sangria.agency.
        queryParams: {
          hd: "sangria.agency",
          // Forzamos el account chooser para evitar que entre con la
          // cuenta personal por inercia si está logueado en varias.
          prompt: "select_account",
        },
      },
    });

    if (error) {
      setLocalError("No se pudo iniciar el login. Probá de nuevo.");
      setLoading(false);
    }
    // Si OK, el navegador navega a Google y el callback va a manejar el resto.
  };

  return (
    <>
      <button
        type="button"
        onClick={handleSignIn}
        disabled={loading}
        className="w-full inline-flex items-center justify-center gap-2.5 rounded-md border border-line bg-white dark:bg-paper-2 px-4 py-2.5 text-sm font-medium text-ink hover:bg-paper-2 focus:outline-none focus:ring-2 focus:ring-accent-soft transition-colors disabled:opacity-50 disabled:cursor-wait"
      >
        <GoogleIcon />
        {loading ? "Redirigiendo a Google…" : "Continuar con Google"}
      </button>
      {localError && (
        <p className="text-[11px] text-danger text-center">{localError}</p>
      )}
    </>
  );
}

function GoogleIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 18 18"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  );
}
