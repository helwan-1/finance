/**
 * G6 PHASE C3-3B — bounded dispatcher cycle (DC suite).
 *
 * Mechanics (DC1–DC25, DC29–DC32, DC35, DC36) are proven with injected fake
 * locate()/processors (deterministic, no DB). Idempotency/isolation under real
 * processors + audit_app RLS (DC26–DC28, DC33, DC34) run against real PostgreSQL,
 * gated by G4_DB_TEST. DC30 is a source-forensic assertion.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/db/tenant";
import { startImport, confirmImport } from "@/lib/import/pipeline";
import { createDraftRun } from "@/lib/g4/run";
import { beginPreparation, materializePopulation, sealPreparation } from "@/lib/g4/preparation";
import { publishRun } from "@/lib/g4/publish";
import { processExecutionWork } from "@/lib/g4/execution-driver";
import { processPreparationWork } from "@/lib/g4/preparation-driver";
import { runDispatcherCycle, type Coordinate, type DispatchClass } from "@/lib/g4/dispatcher";

const dbrun = process.env.G4_DB_TEST ? describe : describe.skip;
const coord = (workType: string, auditFirmId: string = "F", runId: string = randomUUID()): Coordinate => ({ auditFirmId, runId, workType });
const fixedNow = () => 0;

// ── mechanics (no DB) ────────────────────────────────────────────────────────
describe("C3-3B dispatcher mechanics (injected)", () => {
  it("DC1: empty locate → successful empty cycle", async () => {
    const s = await runDispatcherCycle({ locate: async () => [], now: fixedNow });
    expect(s.locatedCount).toBe(0); expect(s.selectedCount).toBe(0); expect(s.results).toEqual([]);
  });

  it("DC2/DC3: routes PREPARATION and EXECUTION to the right processor", async () => {
    let prep = 0, exec = 0;
    const s = await runDispatcherCycle({
      locate: async () => [coord("PREPARATION"), coord("EXECUTION")],
      processPreparation: async () => { prep++; return { kind: "SEALED" }; },
      processExecution: async () => { exec++; return { kind: "DONE" }; },
      now: fixedNow,
    }, { maxConcurrency: 1 });
    expect(prep).toBe(1); expect(exec).toBe(1);
    expect(s.results.map((r) => r.outcome)).toEqual(["DONE", "DONE"]);
  });

  it("DC4: mixed coordinates preserve input/start order in results", async () => {
    const s = await runDispatcherCycle({
      locate: async () => [coord("PREPARATION", "F", "a"), coord("EXECUTION", "F", "b"), coord("PREPARATION", "F", "c")],
      processPreparation: async () => ({ kind: "SEALED" }), processExecution: async () => ({ kind: "DONE" }),
      now: fixedNow,
    }, { maxConcurrency: 1 });
    expect(s.results.map((r) => r.runId)).toEqual(["a", "b", "c"]);
    expect(s.results.map((r) => r.index)).toEqual([0, 1, 2]);
  });

  it("DC5: unknown workType → UNSUPPORTED_WORK_TYPE, no processor called", async () => {
    let called = 0;
    const s = await runDispatcherCycle({
      locate: async () => [coord("GARBAGE")],
      processPreparation: async () => { called++; return { kind: "SEALED" }; },
      processExecution: async () => { called++; return { kind: "DONE" }; },
      now: fixedNow,
    });
    expect(called).toBe(0); expect(s.results[0]!.outcome).toBe("UNSUPPORTED_WORK_TYPE");
  });

  it("DC6/DC7: malformed auditFirmId/runId → DATA_ERROR, no processor called", async () => {
    let called = 0;
    const s = await runDispatcherCycle({
      locate: async () => [coord("EXECUTION", "", "r"), coord("PREPARATION", "F", "")],
      processPreparation: async () => { called++; return { kind: "SEALED" }; },
      processExecution: async () => { called++; return { kind: "DONE" }; },
      now: fixedNow,
    });
    expect(called).toBe(0);
    expect(s.results.map((r) => r.outcome)).toEqual(["DATA_ERROR", "DATA_ERROR"]);
  });

  it("DC8: locate() throwing fails the cycle (not a successful empty cycle)", async () => {
    await expect(runDispatcherCycle({ locate: async () => { throw new Error("discovery down"); }, now: fixedNow })).rejects.toThrow(/discovery down/);
  });

  it("DC9/DC32: only the bounded prefix (≤ maxCoordinates, ≤200) is processed", async () => {
    const many = Array.from({ length: 250 }, () => coord("EXECUTION"));
    const s = await runDispatcherCycle({ locate: async () => many, processExecution: async () => ({ kind: "DONE" }), now: fixedNow }, { maxCoordinatesPerCycle: 2, maxConcurrency: 1 });
    expect(s.locatedCount).toBe(250); expect(s.selectedCount).toBe(2); expect(s.startedCount).toBe(2);
    const capped = await runDispatcherCycle({ locate: async () => many, processExecution: async () => ({ kind: "DONE" }), now: fixedNow }, { maxCoordinatesPerCycle: 200, maxConcurrency: 8 });
    expect(capped.selectedCount).toBe(200);
  });

  it("DC10: bounded concurrency — peak in-flight never exceeds maxConcurrency", async () => {
    let active = 0, peak = 0;
    const s = await runDispatcherCycle({
      locate: async () => Array.from({ length: 9 }, () => coord("EXECUTION")),
      processExecution: async () => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 15)); active--; return { kind: "DONE" }; },
      now: fixedNow,
    }, { maxConcurrency: 3, maxCoordinatesPerCycle: 9 });
    expect(peak).toBeLessThanOrEqual(3); expect(s.completedCount).toBe(9);
  });

  it("DC11/DC12: soft budget stops new starts but never cancels an in-flight processor", async () => {
    const clock = { t: 0 };
    let completed = 0;
    const s = await runDispatcherCycle({
      locate: async () => Array.from({ length: 5 }, () => coord("EXECUTION")),
      processExecution: async () => { clock.t = 10_000; await new Promise((r) => setTimeout(r, 5)); completed++; return { kind: "DONE" }; }, // advances clock past budget mid-run
      now: () => clock.t,
    }, { maxConcurrency: 1, wallClockBudgetMs: 500, maxCoordinatesPerCycle: 5 });
    expect(s.startedCount).toBe(1); // budget exhausted after the first start
    expect(completed).toBe(1); // the started one still finished (not cancelled)
    expect(s.budgetExhausted).toBe(true);
    expect(s.notStartedCount).toBe(4);
  });

  it("DC13/DC36: cycle awaits started processors; a hanging one holds the cycle open", async () => {
    let release!: () => void;
    const hang = new Promise<void>((r) => (release = r));
    let quickDone = 0, cycleResolved = false;
    const p = runDispatcherCycle({
      locate: async () => [coord("EXECUTION", "F", "hang"), coord("EXECUTION", "F", "q1"), coord("EXECUTION", "F", "q2")],
      processExecution: async (_f, runId) => { if (runId === "hang") { await hang; } else { quickDone++; } return { kind: "DONE" }; },
      now: fixedNow,
    }, { maxConcurrency: 2, maxCoordinatesPerCycle: 3 }).then((s) => { cycleResolved = true; return s; });
    await new Promise((r) => setTimeout(r, 40));
    expect(quickDone).toBe(2); // the other slot progressed
    expect(cycleResolved).toBe(false); // cycle still open on the hanging processor
    release();
    const s = await p;
    expect(cycleResolved).toBe(true); expect(s.completedCount).toBe(3);
  });

  const prepCases: Array<[string, DispatchClass]> = [["SEALED", "DONE"], ["YIELDED", "YIELDED"], ["BUSY_YIELDED", "BUSY"], ["NOOP", "STALE"], ["DATA_ERROR", "DATA_ERROR"]];
  for (const [kind, cls] of prepCases) {
    it(`DC14-18: PREPARATION ${kind} → ${cls}`, async () => {
      const s = await runDispatcherCycle({ locate: async () => [coord("PREPARATION")], processPreparation: async () => ({ kind }), now: fixedNow });
      expect(s.results[0]!.outcome).toBe(cls);
    });
  }

  const execCases: Array<[string, DispatchClass]> = [["DONE", "DONE"], ["BUSY", "BUSY"], ["STALE", "STALE"], ["LEASE_LOST", "LEASE_LOST"], ["CONFIG_ERROR", "CONFIG_ERROR"], ["TERMINAL_FAILED", "TERMINAL_FAILED"]];
  for (const [kind, cls] of execCases) {
    it(`DC19-24: EXECUTION ${kind} → ${cls}`, async () => {
      const s = await runDispatcherCycle({ locate: async () => [coord("EXECUTION")], processExecution: async () => ({ kind }), now: fixedNow });
      expect(s.results[0]!.outcome).toBe(cls);
    });
  }

  it("DC25: a thrown processor error → RETRYABLE_INFRA and does not abort other coordinates", async () => {
    const s = await runDispatcherCycle({
      locate: async () => [coord("EXECUTION", "F", "bad"), coord("EXECUTION", "F", "good")],
      processExecution: async (_f, runId) => { if (runId === "bad") throw new Error("db exploded"); return { kind: "DONE" }; },
      now: fixedNow,
    }, { maxConcurrency: 1 });
    const byId = Object.fromEntries(s.results.map((r) => [r.runId, r.outcome]));
    expect(byId["bad"]).toBe("RETRYABLE_INFRA");
    expect(byId["good"]).toBe("DONE");
  });

  it("DC29: summary counts are truthful under prefix + budget + mixed outcomes", async () => {
    const clock = { t: 0 };
    const coords = [coord("PREPARATION", "F", "p"), coord("EXECUTION", "F", "e"), coord("GARBAGE", "F", "g"), coord("EXECUTION", "F", "x")];
    const s = await runDispatcherCycle({
      locate: async () => coords,
      processPreparation: async () => ({ kind: "SEALED" }),
      processExecution: async () => { clock.t = 999_999; return { kind: "DONE" }; },
      now: () => clock.t,
    }, { maxConcurrency: 1, wallClockBudgetMs: 1000, maxCoordinatesPerCycle: 10 });
    expect(s.locatedCount).toBe(4); expect(s.selectedCount).toBe(4);
    expect(s.startedCount + s.notStartedCount).toBe(s.selectedCount);
    expect(s.completedCount).toBe(s.startedCount);
    const total = Object.values(s.outcomeCounts).reduce((a, b) => a + b, 0);
    expect(total).toBe(s.startedCount);
  });

  it("DC31: invalid options fail before locate() is called", async () => {
    for (const bad of [{ maxCoordinatesPerCycle: 0 }, { maxCoordinatesPerCycle: 201 }, { maxConcurrency: 0 }, { maxCoordinatesPerCycle: 5, maxConcurrency: 6 }, { wallClockBudgetMs: -1 }, { maxCoordinatesPerCycle: 2.5 }, { maxConcurrency: NaN }, { wallClockBudgetMs: Infinity }]) {
      let located = false;
      await expect(runDispatcherCycle({ locate: async () => { located = true; return []; }, now: fixedNow }, bad)).rejects.toThrow();
      expect(located).toBe(false);
    }
  });

  it("DC35: budget already exhausted when a slot frees → no further starts", async () => {
    const clock = { t: 0 };
    const s = await runDispatcherCycle({
      locate: async () => Array.from({ length: 6 }, () => coord("EXECUTION")),
      processExecution: async () => { clock.t = 5000; await new Promise((r) => setTimeout(r, 5)); return { kind: "DONE" }; },
      now: () => clock.t,
    }, { maxConcurrency: 2, wallClockBudgetMs: 1000, maxCoordinatesPerCycle: 6 });
    expect(s.startedCount).toBeLessThanOrEqual(2); // only the initial slots; none after budget exhausted
    expect(s.budgetExhausted).toBe(true);
  });

  it("DC30/forensic: dispatcher source has no locator/db/publish/heartbeat/loop authority", async () => {
    const src = readFileSync(join(process.cwd(), "src/lib/g4/dispatcher.ts"), "utf8");
    for (const f of ["app_locate_runnable_work", "audit_dispatch", "DATABASE_URL", "DISPATCH_DATABASE_URL", "process.env", "SET ROLE", "BYPASSRLS", "publishRun", "publishRunForActor", "extendLease(", "heartbeat(", ".leaseExpiresAt", "auditJob", "while (true)", "while(true)", "setInterval(", "@/lib/prisma", "withTenantContext"]) {
      expect(src.includes(f)).toBe(false);
    }
    expect(src.includes("processPreparationWork")).toBe(true);
    expect(src.includes("processExecutionWork")).toBe(true);
  });
});

// ── real processors + RLS (DB) ───────────────────────────────────────────────
const FIRM = "firmA", ENG = "engA";
async function freezeExec(n: number) {
  const nonce = randomUUID();
  const csv = "account,date,debit,currency\n" + Array.from({ length: n }, (_, i) => `10${i},2024-01-01,${i + 1}.00,USD`).join("\n") + "\n";
  const start = await startImport({ auditFirmId: FIRM, userId: null, engagementId: ENG, datasetKind: "GENERAL_LEDGER", fileName: `dc-${nonce}.csv`, mimeType: "text/csv", bytes: Buffer.from(csv, "utf8"), idempotencyKey: `dc-${nonce}`, acknowledgeDuplicate: true });
  await confirmImport(FIRM, null, start.batchId!);
  const ds = start.datasetId!;
  const key = `T-${nonce}`;
  const tvId = await withTenantContext(FIRM, async (t) => {
    const test = await t.auditTest.create({ data: { auditFirmId: FIRM, key, name: "n", nameAr: "ن", testType: "DATA_QUALITY" }, select: { id: true } });
    const tv = await t.auditTestVersion.create({ data: { auditFirmId: FIRM, auditTestId: test.id, version: 1, testType: "DATA_QUALITY", definitionJson: { dqKind: "POPULATION_MEMBER" }, requirementsJson: { requiredDatasetKinds: ["GENERAL_LEDGER"] }, versionHash: `vh-${nonce}`, status: "ACTIVE" }, select: { id: true } });
    await t.auditTest.update({ where: { id: test.id }, data: { currentVersionId: tv.id } });
    return tv.id;
  });
  const { runId } = await createDraftRun(FIRM, { engagementId: ENG });
  const { prepId } = await beginPreparation(FIRM, { runId, tests: [{ testKey: key }], datasetIds: [ds], batchSize: 500 });
  await materializePopulation(FIRM, prepId, tvId, ds, { batchSize: 500 });
  await sealPreparation(FIRM, prepId);
  await publishRun(FIRM, runId, prepId);
  const members = await withTenantContext(FIRM, (t) => t.auditRunScopeMember.count({ where: { preparationId: prepId } }));
  return { runId, members };
}
async function preparingRun(n: number) {
  const nonce = randomUUID();
  const csv = "account,date,debit,credit,currency\n" + Array.from({ length: n }, (_, i) => `20${i},2024-02-01,${i + 1}.00,${i + 1}.00,USD`).join("\n") + "\n";
  const start = await startImport({ auditFirmId: FIRM, userId: null, engagementId: ENG, datasetKind: "GENERAL_LEDGER", fileName: `dcp-${nonce}.csv`, mimeType: "text/csv", bytes: Buffer.from(csv, "utf8"), idempotencyKey: `dcp-${nonce}`, acknowledgeDuplicate: true });
  await confirmImport(FIRM, null, start.batchId!);
  const ds = start.datasetId!;
  const key = `TP-${nonce}`;
  await withTenantContext(FIRM, async (t) => {
    const test = await t.auditTest.create({ data: { auditFirmId: FIRM, key, name: "n", nameAr: "ن", testType: "ACCOUNTING_INTEGRITY" }, select: { id: true } });
    const tv = await t.auditTestVersion.create({ data: { auditFirmId: FIRM, auditTestId: test.id, version: 1, testType: "ACCOUNTING_INTEGRITY", definitionJson: { kind: "INVALID_DEBIT_CREDIT" }, requirementsJson: { requiredDatasetKinds: ["GENERAL_LEDGER"] }, versionHash: `vhp-${nonce}`, status: "ACTIVE" }, select: { id: true } });
    await t.auditTest.update({ where: { id: test.id }, data: { currentVersionId: tv.id } });
  });
  const { runId } = await createDraftRun(FIRM, { engagementId: ENG });
  const { prepId } = await beginPreparation(FIRM, { runId, tests: [{ testKey: key }], datasetIds: [ds], batchSize: 500 });
  return { runId, prepId };
}
const resultCount = (runId: string) => withTenantContext(FIRM, (t) => t.auditResult.count({ where: { runId } }));

dbrun("C3-3B dispatcher with real processors (RLS)", () => {
  const PRIOR = process.env.AUDIT_ENGINE_BUILD;
  beforeAll(async () => { process.env.AUDIT_ENGINE_BUILD = "test-build-dc"; const s = await import("../g4/_seed"); await s.ensureSeed(); }, 120_000);
  afterAll(async () => { if (PRIOR === undefined) delete process.env.AUDIT_ENGINE_BUILD; else process.env.AUDIT_ENGINE_BUILD = PRIOR; await prisma.$disconnect(); });

  it("DC27/DC33: duplicate EXECUTION delivery (concurrency 2) → no duplicate durable effect", async () => {
    const f = await freezeExec(4);
    const s = await runDispatcherCycle({
      locate: async () => [coord("EXECUTION", FIRM, f.runId), coord("EXECUTION", FIRM, f.runId)],
      processExecution: processExecutionWork,
    }, { maxConcurrency: 2, maxCoordinatesPerCycle: 2 });
    expect(s.results.map((r) => r.outcome).filter((o) => o === "DONE").length).toBeGreaterThanOrEqual(1);
    for (const r of s.results) expect(["DONE", "BUSY", "STALE"]).toContain(r.outcome);
    expect(await resultCount(f.runId)).toBe(f.members); // no duplication
  });

  it("DC26/DC34: duplicate PREPARATION delivery (concurrency 2) → no corruption; sealed once", async () => {
    const p = await preparingRun(3);
    const s = await runDispatcherCycle({
      locate: async () => [coord("PREPARATION", FIRM, p.runId), coord("PREPARATION", FIRM, p.runId)],
      processPreparation: processPreparationWork,
    }, { maxConcurrency: 2, maxCoordinatesPerCycle: 2 });
    for (const r of s.results) expect(["DONE", "STALE", "BUSY", "YIELDED"]).toContain(r.outcome);
    expect(s.results.some((r) => r.outcome === "DONE")).toBe(true);
    const prep = await withTenantContext(FIRM, (t) => t.auditRunPreparation.findUniqueOrThrow({ where: { id: p.prepId }, select: { status: true } }));
    expect(prep.status).toBe("COMPLETE");
  });

  it("DC28: cross-firm substituted coordinate → tenant processor STALE, no mutation/leak", async () => {
    const f = await freezeExec(3);
    const s = await runDispatcherCycle({
      locate: async () => [coord("EXECUTION", "firmB", f.runId)], // firmB cannot see firmA's run
      processExecution: processExecutionWork,
    }, { maxConcurrency: 1 });
    expect(s.results[0]!.outcome).toBe("STALE");
    expect(await resultCount(f.runId)).toBe(0); // untouched
  });
});
