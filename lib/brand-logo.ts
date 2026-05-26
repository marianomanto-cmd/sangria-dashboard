import { readFileSync } from "node:fs";
import { join } from "node:path";

// El logo de marca se sirve desde public/. Soportamos PNG o JPG; gana el primer
// archivo que exista. Si no hay ninguno, devolvemos null y los exports siguen
// generándose sin logo (no rompemos la descarga por falta del asset).
export type BrandLogo = {
  bytes: Buffer;
  type: "png" | "jpg";
  // Dimensiones intrínsecas (px). 0 si no se pudieron leer del header; el XLSX
  // las usa para preservar el aspect ratio (el PDF las saca de pdf-lib).
  width: number;
  height: number;
};

const CANDIDATES: ReadonlyArray<{ file: string; type: "png" | "jpg" }> = [
  { file: "sangria-logo.png", type: "png" },
  { file: "sangria-logo.jpg", type: "jpg" },
  { file: "sangria-logo.jpeg", type: "jpg" },
];

function pngSize(b: Buffer): { width: number; height: number } | null {
  // IHDR es el primer chunk; el tipo está en el offset 12 y las dimensiones a
  // continuación (big-endian).
  if (b.length < 24 || b.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function jpgSize(b: Buffer): { width: number; height: number } | null {
  // Recorremos los marcadores hasta el SOFn, que contiene alto/ancho.
  let off = 2; // saltamos el SOI (FFD8)
  while (off + 9 < b.length) {
    if (b[off] !== 0xff) {
      off++;
      continue;
    }
    const marker = b[off + 1];
    // Marcadores sin payload (RSTn, SOI, EOI): no llevan length.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      off += 2;
      continue;
    }
    const len = b.readUInt16BE(off + 2);
    const isSOF =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 && // DHT
      marker !== 0xc8 && // JPG
      marker !== 0xcc; // DAC
    if (isSOF) {
      return { height: b.readUInt16BE(off + 5), width: b.readUInt16BE(off + 7) };
    }
    off += 2 + len;
  }
  return null;
}

export function getBrandLogo(): BrandLogo | null {
  for (const { file, type } of CANDIDATES) {
    try {
      const bytes = readFileSync(join(process.cwd(), "public", file));
      const size = type === "png" ? pngSize(bytes) : jpgSize(bytes);
      return { bytes, type, width: size?.width ?? 0, height: size?.height ?? 0 };
    } catch {
      // archivo ausente o ilegible: probamos el siguiente candidato
    }
  }
  return null;
}
