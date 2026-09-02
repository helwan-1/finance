import {
  type DatasetKind,
  INGEST_FIELDS,
  REQUIRED_FIELDS,
  ONE_OF_GROUPS,
  fieldType,
} from "./vocab";

/**
 * Row validation & normalization (Closure C4-adjacent, Phase F). Reject, never
 * fabricate: an invalid/missing required date or amount → the row is REJECTED
 * with a persisted issue; no transaction is ever created and no value becomes
 * now()/DEBIT/LEDGER.
 */
export interface FieldIssue {
  field: string | null;
  code: string;
  message: string;
  rawValue: string | null;
  severity: "ERROR" | "WARNING" | "INFO";
  blocking: boolean;
}

export interface RowValidation {
  status: "ACCEPTED" | "ACCEPTED_WITH_WARNING" | "REJECTED";
  normalized: Record<string, string | null> | null;
  issues: FieldIssue[];
}

export type DateInterpretation = "ISO" | "DMY" | "MDY";

/** Strict date parse → ISO yyyy-mm-dd, or null when unparseable. No fallback. */
export function parseDateStrict(
  raw: string,
  interp: DateInterpretation,
): string | null {
  const s = raw.trim();
  if (!s) return null;
  let y: number, mo: number, d: number;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s); // ISO-like
  if (m) {
    y = +m[1]!; mo = +m[2]!; d = +m[3]!;
  } else {
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s); // DMY / MDY
    if (!m) return null;
    if (interp === "MDY") { mo = +m[1]!; d = +m[2]!; }
    else { d = +m[1]!; mo = +m[2]!; } // ISO input already handled; default DMY
    y = +m[3]!;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null; // e.g. 2024-02-31
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(mo)}-${pad(d)}`;
}

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** Strict decimal parse → fixed(2) string, or null when unparseable. */
export function parseDecimalStrict(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  s = s.replace(/[٠-٩]/g, (dch) => String(ARABIC_DIGITS.indexOf(dch)));
  s = s.replace(/[,\s٬]/g, ""); // thousands separators
  s = s.replace(/[^0-9.\-]/g, ""); // drop currency symbols
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(2);
}

function present(v: string | null | undefined): boolean {
  return v !== null && v !== undefined && v.trim() !== "";
}

/**
 * Validate + normalize one mapped row. `mapped` is canonicalField → rawValue.
 */
export function validateRow(
  kind: DatasetKind,
  mapped: Record<string, string | null>,
  opts: { dateInterpretation: DateInterpretation },
): RowValidation {
  const issues: FieldIssue[] = [];
  const normalized: Record<string, string | null> = {};

  // 1) Type-parse every recognized field that is present.
  for (const field of Object.keys(INGEST_FIELDS[kind])) {
    const raw = mapped[field];
    if (!present(raw)) {
      normalized[field] = null;
      continue;
    }
    const t = fieldType(kind, field)!;
    if (t === "date") {
      const iso = parseDateStrict(raw!, opts.dateInterpretation);
      if (iso === null) {
        issues.push({
          field, code: "INVALID_DATE",
          message: `Unparseable date in ${field}`, rawValue: raw!,
          severity: "ERROR", blocking: true,
        });
      } else normalized[field] = iso;
    } else if (t === "decimal") {
      const dec = parseDecimalStrict(raw!);
      if (dec === null) {
        issues.push({
          field, code: "INVALID_AMOUNT",
          message: `Unparseable amount in ${field}`, rawValue: raw!,
          severity: "ERROR", blocking: true,
        });
      } else normalized[field] = dec;
    } else {
      normalized[field] = raw!.trim();
    }
  }

  // 2) Required fields present (and, for dates/decimals, parsed OK).
  for (const field of REQUIRED_FIELDS[kind]) {
    if (!present(mapped[field])) {
      issues.push({
        field, code: "MISSING_REQUIRED",
        message: `Required field ${field} is missing`, rawValue: null,
        severity: "ERROR", blocking: true,
      });
    }
  }

  // 3) "At least one of" groups.
  for (const group of ONE_OF_GROUPS[kind]) {
    const anyParsed = group.some(
      (f) => present(mapped[f]) && normalized[f] != null,
    );
    if (!anyParsed) {
      issues.push({
        field: null, code: "MISSING_VALUE_GROUP",
        message: `At least one of [${group.join(", ")}] is required and must be parseable`,
        rawValue: null, severity: "ERROR", blocking: true,
      });
    }
  }

  const hasBlocking = issues.some((i) => i.blocking);
  if (hasBlocking) return { status: "REJECTED", normalized: null, issues };
  const hasWarn = issues.some((i) => i.severity === "WARNING");
  return {
    status: hasWarn ? "ACCEPTED_WITH_WARNING" : "ACCEPTED",
    normalized,
    issues,
  };
}
