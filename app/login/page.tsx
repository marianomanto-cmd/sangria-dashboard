import { SangriaMark } from "@/components/sangria-mark";
import { LoginButton } from "./login-button";

type Props = {
  searchParams: Promise<{ error?: string; next?: string }>;
};

const ERROR_LABELS: Record<string, string> = {
  domain:
    "Solo cuentas @sangria.agency tienen acceso. Iniciá sesión con tu mail de la agencia.",
  oauth: "No pudimos completar el login con Google. Probá de nuevo.",
  exchange:
    "El código de autorización no es válido o expiró. Volvé a iniciar el login.",
  unknown: "Algo no anduvo. Probá de nuevo en unos minutos.",
};

export default async function LoginPage({ searchParams }: Props) {
  const sp = await searchParams;
  const errorMsg = sp.error ? (ERROR_LABELS[sp.error] ?? ERROR_LABELS.unknown) : null;
  const next = sp.next ?? null;

  return (
    <main className="min-h-screen flex items-center justify-center bg-paper px-4">
      <div className="w-full max-w-[400px]">
        <div className="flex flex-col items-center mb-7">
          <SangriaMark className="h-9 w-9 text-accent" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink">
            Sangria · Project OS
          </h1>
          <p className="mt-1 text-sm text-muted">
            Herramienta interna · acceso solo con cuenta de la agencia
          </p>
        </div>

        <div className="rounded-lg border border-line bg-white dark:bg-paper-2 p-6 space-y-4">
          {errorMsg && (
            <div className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-xs text-danger">
              {errorMsg}
            </div>
          )}

          <LoginButton next={next} />

          <p className="text-[11px] text-muted text-center border-t border-line-soft pt-3">
            Si tu mail termina en{" "}
            <span className="font-mono text-ink-2">@sangria.agency</span> ya
            tenés acceso. Si no, pedile a Mariano que te de de alta.
          </p>
        </div>
      </div>
    </main>
  );
}
