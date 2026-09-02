/**
 * Minimal RFC 4180-style CSV parser (handles quoted fields, embedded commas,
 * escaped quotes, and CRLF). Returns an array of row objects keyed by the
 * header row. Good enough for importing rule/config files exported from Excel.
 */
export function parseCsv(
  text: string,
  delimiter = ",",
): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  // Strip a leading UTF-8 BOM if present (Excel adds one).
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\r") {
      // ignore; handled by the following \n
    } else {
      field += ch;
    }
  }
  // Flush the last field/row if the file doesn't end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmpty.length === 0) return [];

  const headers = nonEmpty[0]!.map((h) => h.trim());
  return nonEmpty.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = (r[idx] ?? "").trim();
    });
    return obj;
  });
}
