import { redirect } from "next/navigation";

type Props = {
  searchParams: Promise<{ client?: string; view?: string }>;
};

// La home redirige al dashboard nuevo (`/dashboard`, db/queries/dashboard-v2.ts).
//
// El dashboard viejo NO se borró: vive en `/dashboard-legacy`, fuera de la
// navegación, por si hace falta comparar un número contra el nuevo. Se puede
// eliminar —junto con db/queries/dashboard.ts, db/queries/pendings.ts y
// components/dashboard/— cuando ya no se consulte.
//
// Se preserva `?client=` para no perder el filtro global al redirigir.
export default async function HomePage({ searchParams }: Props) {
  const sp = await searchParams;
  const qs = sp.client ? `?client=${encodeURIComponent(sp.client)}` : "";
  redirect(`/dashboard${qs}`);
}
