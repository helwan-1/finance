/**
 * G4-DEBT-012 mitigation — migration destructiveness guard.
 *
 * `prisma migrate diff` cannot see raw-SQL FKs (models are relationless), so it
 * emits spurious DROP CONSTRAINT/DROP INDEX against pre-existing objects. This
 * guard fails when any migration contains such destructive statements, except
 * the explicitly allowlisted known inherited defect (the committed G3 migration,
 * remediated forward-only by 20260902140000_restore_g2_composite_tenant_fks).
 *
 * Mandatory workflow when adding a gate: after generating a migration, strip the
 * spurious drops (G4 is purely additive). This test enforces that discipline.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../prisma/migrations");

// Known inherited defect (pre-G4). Remediated by the corrective migration.
// Nothing else may contain destructive drops.
const ALLOWLIST = new Set<string>(["20260902120000_g3_canonical_accounting"]);

const DESTRUCTIVE = /^\s*(ALTER\s+TABLE\s+.*\bDROP\s+CONSTRAINT\b|DROP\s+INDEX\b)/i;

describe("G4-DEBT-012 migration destructiveness guard", () => {
  it("no migration (outside the allowlist) contains DROP CONSTRAINT / DROP INDEX", () => {
    const offenders: { migration: string; line: number; sql: string }[] = [];
    for (const name of readdirSync(MIGRATIONS_DIR)) {
      const file = path.join(MIGRATIONS_DIR, name, "migration.sql");
      let sql: string;
      try { sql = readFileSync(file, "utf8"); } catch { continue; }
      if (ALLOWLIST.has(name)) continue;
      sql.split("\n").forEach((ln, i) => {
        // ignore comment lines
        if (ln.trim().startsWith("--")) return;
        if (DESTRUCTIVE.test(ln)) offenders.push({ migration: name, line: i + 1, sql: ln.trim() });
      });
    }
    expect(offenders, `Destructive DROP found:\n${offenders.map((o) => `  ${o.migration}:${o.line} ${o.sql}`).join("\n")}`).toEqual([]);
  });

  it("the corrective migration itself contains ZERO drops", () => {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, "20260902140000_restore_g2_composite_tenant_fks", "migration.sql"), "utf8");
    const drops = sql.split("\n").filter((ln) => !ln.trim().startsWith("--") && DESTRUCTIVE.test(ln));
    expect(drops).toEqual([]);
  });
});
