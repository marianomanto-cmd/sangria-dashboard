import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { budgetOrigins, clients } from "@/db/schema";

export type BudgetOriginOption = {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  clientSlug: string;
  colorHex: string | null;
};

// Lista global de budget origins con su cliente asociado (para los selectores
// de filtro en /proyectos y /planes).
export async function listAllBudgetOrigins(): Promise<BudgetOriginOption[]> {
  return db
    .select({
      id: budgetOrigins.id,
      name: budgetOrigins.name,
      clientId: clients.id,
      clientName: clients.name,
      clientSlug: clients.slug,
      colorHex: budgetOrigins.colorHex,
    })
    .from(budgetOrigins)
    .innerJoin(clients, eq(budgetOrigins.clientId, clients.id))
    .orderBy(asc(clients.name), asc(budgetOrigins.name));
}
