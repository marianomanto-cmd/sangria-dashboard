// One-shot inspector. NO se commitea. Solo para entender la estructura
// del Excel del cliente.
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("Uso: node scripts/inspect-excel.mjs <ruta>");
  process.exit(1);
}

const wb = XLSX.read(readFileSync(path), { cellDates: true });

console.log("─── ARCHIVO ─────────────────────────────────");
console.log("Path:", path);
console.log("Sheets:", wb.SheetNames);
console.log();

for (const sheetName of wb.SheetNames) {
  const sheet = wb.Sheets[sheetName];
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
  const rowCount = range.e.r - range.s.r + 1;
  const colCount = range.e.c - range.s.c + 1;

  console.log(`─── SHEET: "${sheetName}" ────────────────────`);
  console.log(`  Dimensiones: ${rowCount} filas × ${colCount} cols`);
  console.log(`  Range: ${sheet["!ref"]}`);
  console.log();

  // Dump primeras 25 filas en formato grid (col letter | value)
  const arr = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: null });
  const preview = arr.slice(0, 30);

  for (let r = 0; r < preview.length; r++) {
    const row = preview[r];
    const nonNull = row.filter((v) => v !== null && v !== "" && v !== undefined);
    if (nonNull.length === 0) {
      console.log(`  [${r + 1}] (vacía)`);
      continue;
    }
    // Imprimir solo columnas con contenido, con su letra
    const cells = [];
    for (let c = 0; c < row.length; c++) {
      const v = row[c];
      if (v == null || v === "") continue;
      const colLetter = XLSX.utils.encode_col(c);
      const display =
        v instanceof Date
          ? v.toISOString().slice(0, 10)
          : typeof v === "string" && v.length > 50
            ? `${v.slice(0, 50)}…`
            : String(v);
      cells.push(`${colLetter}=${display}`);
    }
    console.log(`  [${r + 1}] ${cells.slice(0, 10).join(" │ ")}${cells.length > 10 ? ` │ … (+${cells.length - 10} más)` : ""}`);
  }
  console.log();
}
