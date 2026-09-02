import ExcelJS from "exceljs";
import { parseCsv } from "./csv";

/**
 * Read an uploaded spreadsheet file into row objects, regardless of format:
 *   * .xlsx / .xls  → parsed with ExcelJS (first worksheet)
 *   * .csv / text   → parsed with an auto-detected delimiter (, ; or tab)
 *
 * This removes the two most common import failures: Excel binaries uploaded as
 * "CSV", and locale CSVs that use ";" instead of ",".
 */

/** Detect the most likely delimiter from the header line. */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const candidates = [",", ";", "\t"] as const;
  let best = ",";
  let bestCount = -1;
  for (const d of candidates) {
    const count = firstLine.split(d).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

function isXlsx(fileName: string, mimeType: string): boolean {
  const lower = fileName.toLowerCase();
  return (
    lower.endsWith(".xlsx") ||
    lower.endsWith(".xls") ||
    mimeType.includes("spreadsheetml") ||
    mimeType.includes("ms-excel")
  );
}

/** Read an .xlsx buffer's first worksheet into row objects keyed by header. */
async function readXlsx(buffer: ArrayBuffer): Promise<Record<string, string>[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const rows: Record<string, string>[] = [];
  const headers: string[] = [];
  const cellText = (v: ExcelJS.CellValue): string => {
    if (v === null || v === undefined) return "";
    if (typeof v === "object") {
      const o = v as { text?: string; result?: unknown; richText?: { text: string }[] };
      if (Array.isArray(o.richText)) return o.richText.map((t) => t.text).join("");
      if (o.text !== undefined) return String(o.text);
      if (o.result !== undefined) return String(o.result);
    }
    return String(v);
  };

  sheet.eachRow((excelRow, rowNumber) => {
    const values = excelRow.values as ExcelJS.CellValue[]; // 1-indexed
    if (rowNumber === 1) {
      for (let c = 1; c < values.length; c += 1) headers[c] = cellText(values[c]).trim();
      return;
    }
    const obj: Record<string, string> = {};
    let hasValue = false;
    for (let c = 1; c < Math.max(values.length, headers.length); c += 1) {
      const key = headers[c];
      if (!key) continue;
      const val = cellText(values[c]).trim();
      obj[key] = val;
      if (val) hasValue = true;
    }
    if (hasValue) rows.push(obj);
  });
  return rows;
}

/** Parse any uploaded spreadsheet File into row objects. */
export async function readSpreadsheet(
  file: File,
): Promise<Record<string, string>[]> {
  if (isXlsx(file.name, file.type)) {
    return readXlsx(await file.arrayBuffer());
  }
  const text = await file.text();
  return parseCsv(text, detectDelimiter(text));
}
