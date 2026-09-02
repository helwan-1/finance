import ExcelJS from "exceljs";
import type { RawCell } from "./canonical";

/**
 * Positional, lossless spreadsheet reading (Closure C5). Rows are arrays of
 * cells indexed by column position; duplicate headers are preserved as distinct
 * columns and never overwrite each other.
 */
export interface PositionalTable {
  headers: (string | null)[];
  rows: string[][]; // each row: cell strings by column index (missing → "")
}

/** Detect the most likely CSV delimiter from the header line. */
export function detectDelimiter(text: string): string {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const cands = [",", ";", "\t"] as const;
  let best = ",";
  let bestN = -1;
  for (const d of cands) {
    const n = first.split(d).length - 1;
    if (n > bestN) { bestN = n; best = d; }
  }
  return best;
}

/** RFC4180-ish CSV tokenizer → array of rows, each an array of cell strings. */
export function parseCsvPositional(text: string, delimiter: string): string[][] {
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // strip BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < t.length; i += 1) {
    const c = t[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (t[i + 1] === '"') { cell += '"'; i += 1; }
        else inQuotes = false;
      } else cell += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(cell); cell = "";
    } else if (c === "\n") {
      row.push(cell); rows.push(row); row = []; cell = "";
    } else if (c === "\r") {
      /* ignore; \n handles EOL */
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

function isXlsx(name: string, mime: string): boolean {
  const l = name.toLowerCase();
  return l.endsWith(".xlsx") || l.endsWith(".xls") ||
    mime.includes("spreadsheetml") || mime.includes("ms-excel");
}

async function readXlsxPositional(buf: ArrayBuffer): Promise<PositionalTable> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const sheet = wb.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };
  const cellText = (v: ExcelJS.CellValue): string => {
    if (v === null || v === undefined) return "";
    if (typeof v === "object") {
      const o = v as { text?: string; result?: unknown; richText?: { text: string }[] };
      if (Array.isArray(o.richText)) return o.richText.map((x) => x.text).join("");
      if (o.text !== undefined) return String(o.text);
      if (o.result !== undefined) return String(o.result);
    }
    return String(v);
  };
  let headers: (string | null)[] = [];
  const rows: string[][] = [];
  let maxCols = 0;
  sheet.eachRow((excelRow, rowNumber) => {
    const values = excelRow.values as ExcelJS.CellValue[]; // 1-indexed
    const arr: string[] = [];
    for (let c = 1; c < values.length; c += 1) arr[c - 1] = cellText(values[c]).trim();
    maxCols = Math.max(maxCols, arr.length);
    if (rowNumber === 1) headers = arr.map((h) => (h === "" ? null : h));
    else if (arr.some((v) => v !== "")) rows.push(arr);
  });
  // pad
  headers = Array.from({ length: maxCols }, (_, i) => headers[i] ?? null);
  return { headers, rows: rows.map((r) => Array.from({ length: maxCols }, (_, i) => r[i] ?? "")) };
}

export async function readPositional(
  fileName: string,
  mimeType: string,
  bytes: Buffer,
  delimiter: string,
): Promise<PositionalTable> {
  if (isXlsx(fileName, mimeType)) {
    return readXlsxPositional(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  }
  const text = bytes.toString("utf8");
  const all = parseCsvPositional(text, delimiter);
  if (all.length === 0) return { headers: [], rows: [] };
  const header = all[0]!;
  const maxCols = all.reduce((m, r) => Math.max(m, r.length), 0);
  const headers: (string | null)[] = Array.from({ length: maxCols }, (_, i) => {
    const h = header[i];
    return h === undefined || h.trim() === "" ? null : h.trim();
  });
  const rows = all.slice(1)
    .filter((r) => r.some((v) => v.trim() !== ""))
    .map((r) => Array.from({ length: maxCols }, (_, i) => r[i] ?? ""));
  return { headers, rows };
}

/** Build lossless positional RawCells for one data row. */
export function toRawCells(headers: (string | null)[], row: string[]): RawCell[] {
  const n = Math.max(headers.length, row.length);
  const cells: RawCell[] = [];
  for (let i = 0; i < n; i += 1) {
    const v = row[i];
    cells.push({ i, h: headers[i] ?? null, v: v === undefined || v === "" ? null : v });
  }
  return cells;
}
