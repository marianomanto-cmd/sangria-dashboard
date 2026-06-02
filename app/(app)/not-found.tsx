import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { EmptyState } from "@/components/page-shell";
import { buttonVariants } from "@/components/button";

// 404 dentro del grupo (app): lo dispara notFound() (ej. plan/proyecto
// inexistente o code que no matchea). Reusa EmptyState para mantener el estilo.
export default function NotFound() {
  return (
    <main className="px-8 py-20 max-w-md mx-auto w-full">
      <EmptyState
        icon={<FileQuestion size={18} strokeWidth={1.75} />}
        title="No encontramos lo que buscabas"
        hint="El recurso no existe, fue movido o el link está mal. Volvé al dashboard y reintentá desde ahí."
        action={
          <Link href="/" className={buttonVariants({ size: "sm" })}>
            Ir al dashboard
          </Link>
        }
      />
    </main>
  );
}
