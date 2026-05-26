import { readFileSync } from "node:fs";
import { join } from "node:path";

// El logo de marca se sirve desde public/. Soportamos PNG o JPG; gana el primer
// archivo que exista. Si no hay ninguno, devolvemos null y los exports siguen
// generándose sin logo (no rompemos la descarga por falta del asset).
export type BrandLogo = { bytes: Buffer; type: "png" | "jpg" };

const CANDIDATES: ReadonlyArray<{ file: string; type: "png" | "jpg" }> = [
  { file: "sangria-logo.png", type: "png" },
  { file: "sangria-logo.jpg", type: "jpg" },
  { file: "sangria-logo.jpeg", type: "jpg" },
];

export function getBrandLogo(): BrandLogo | null {
  for (const { file, type } of CANDIDATES) {
    try {
      const bytes = readFileSync(join(process.cwd(), "public", file));
      return { bytes, type };
    } catch {
      // archivo ausente o ilegible: probamos el siguiente candidato
    }
  }
  return null;
}
