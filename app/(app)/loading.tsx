import { PageSkeleton } from "@/components/skeleton";

// Fallback de carga a nivel del grupo (app): se muestra mientras cualquier
// página server-side resuelve sus datos. La chrome (sidebar + topbar) persiste
// porque vive en el layout; esto solo reemplaza el contenido.
export default function Loading() {
  return <PageSkeleton />;
}
