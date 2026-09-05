import { redirect } from "next/navigation";

type Props = {
  searchParams: Promise<{ client?: string; view?: string }>;
};

// La home redirige a Pendientes (`/pendientes`, db/queries/pendientes.ts), que
// es la pantalla de entrada de la app.
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
  redirect(`/pendientes${qs}`);
}
