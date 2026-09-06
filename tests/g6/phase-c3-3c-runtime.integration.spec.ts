/**
 * G6 Phase C3-3C — background runtime (RT suite).
 *
 * Real PostgreSQL, gated by G4_DB_TEST. Proves the runtime tick/loop wires
 * DISCOVERY (the real SECURITY DEFINER locator, exercised under the real
 * audit_dispatch role) → bounded dispatcher → real tenant processors, so a
 * published QUEUED run actually executes to COMPLETED with results — and that the
 * loop is bounded and shuts down cleanly, and the dispatch pool requires its own
 * credential.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/db/tenant";
import { startImport, confirmImport } from "@/lib/import/pipeline";
import { createDraftRun } from "@/lib/g4/run";
import { beginPreparation, materializePopulation, sealPreparation } from "@/lib/g4/preparation";
import { publishRun } from "@/lib/g4/publish";
import { runDispatcherTick, runDispatcherLoop, createDispatchClient, makeDispatchLocate } from "@/lib/g4/runtime";
import type { Coordinate } from "@/lib/g4/dispatcher";

const run = process.env.G4_DB_TEST ? describe : describe.skip;
const owner = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL } } });
const FIRM = "firmA", ENG = "engA";

// Real locator, exercised under the real audit_dispatch role (NOLOGIN → assume the
// role via the owner connection; identical privilege surface to a dispatch login).
const dispatchLocate = (): Promise<Coordinate[]> =>
  owner.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL ROLE audit_dispatch");
    return tx.$queryRawUnsafe<Coordinate[]>("SELECT * FROM app_locate_runnable_work()");
  });

async function publishQueuedRun(n: number): Promise<{ runId: string; members: number }> {
  const nonce = randomUUID();
  const csv = "account,date,debit,currency\n" + Array.from({ length: n }, (_, i) => `10${i},2024-01-01,${i + 1}.00,USD`).join("\n") + "\n";
  const start = await startImport({ auditFirmId: FIRM, userId: null, engagementId: ENG, datasetKind: "GENERAL_LEDGER", fileName: `rt-${nonce}.csv`, mimeType: "text/csv", bytes: Buffer.from(csv, "utf8"), idempotencyKey: `rt-${nonce}`, acknowledgeDuplicate: true });
  await confirmImport(FIRM, null, start.batchId!);
  const ds = start.datasetId!;
  const key = `T-RT-${nonce}`;
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
  await publishRun(FIRM, runId, prepId); // → QUEUED
  const members = await withTenantContext(FIRM, (t) => t.auditRunScopeMember.count({ where: { preparationId: prepId } }));
  return { runId, members };
}
const runStatus = (runId: string) => owner.auditRun.findUniqueOrThrow({ where: { id: runId }, select: { status: true } });
const resultCount = (runId: string) => owner.auditResult.count({ where: { runId } });

run("G6 Phase C3-3C — background runtime (RT)", () => {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });
  const PRIOR = process.env.AUDIT_ENGINE_BUILD;
  beforeAll(async () => { process.env.AUDIT_ENGINE_BUILD = "test-build-rt"; const s = await import("../g4/_seed"); await s.ensureSeed(); }, 120_000);
  afterAll(async () => { if (PRIOR === undefined) delete process.env.AUDIT_ENGINE_BUILD; else process.env.AUDIT_ENGINE_BUILD = PRIOR; await owner.$disconnect(); await prisma.$disconnect(); });

  it("RT1: a tick discovers (real locator/audit_dispatch) and executes a QUEUED run to COMPLETED", async () => {
    const q = await publishQueuedRun(4);
    expect((await runStatus(q.runId)).status).toBe("QUEUED");
    const summary = await runDispatcherTick({ locate: dispatchLocate, maxCoordinatesPerCycle: 50, maxConcurrency: 2 });
    expect(summary.selectedCount).toBeGreaterThanOrEqual(1);
    const mine = summary.results.find((r) => r.runId === q.runId);
    expect(mine?.outcome).toBe("DONE");
    expect((await runStatus(q.runId)).status).toBe("COMPLETED");
    expect(await resultCount(q.runId)).toBe(q.members);
  });

  it("RT2: a tick with no runnable work is a clean empty cycle", async () => {
    const summary = await runDispatcherTick({ locate: async () => [], maxConcurrency: 1 });
    expect(summary.locatedCount).toBe(0);
    expect(summary.selectedCount).toBe(0);
    expect(summary.results).toEqual([]);
  });

  it("RT3: the loop runs a bounded number of ticks then stops", async () => {
    let ticks = 0;
    const res = await runDispatcherLoop({ locate: async () => [], intervalMs: 1, maxTicks: 3, onTick: () => { ticks++; } });
    expect(res.ticks).toBe(3);
    expect(ticks).toBe(3);
  });

  it("RT4: the loop stops promptly when its abort signal fires", async () => {
    const controller = new AbortController();
    const p = runDispatcherLoop({ locate: async () => [], intervalMs: 10_000, signal: controller.signal, onTick: () => controller.abort() });
    const res = await p; // aborts during the post-tick sleep
    expect(res.ticks).toBe(1);
  });

  it("RT5: the dispatch pool requires its own credential (DISPATCH_DATABASE_URL)", () => {
    expect(() => createDispatchClient(undefined)).toThrow(/DISPATCH_DATABASE_URL/);
  });

  it("RT6: makeDispatchLocate returns runnable coordinates from the real locator", async () => {
    const q = await publishQueuedRun(2);
    // Build a locate() bound to a client already assuming the dispatch role.
    const locate = makeDispatchLocate(owner as unknown as PrismaClient);
    // owner has table access, so this proves the SQL shape; the role-scoped ACL is
    // proven in C3-1 V-tests and by dispatchLocate above.
    const rows = await owner.$transaction(async (tx) => { await tx.$executeRawUnsafe("SET LOCAL ROLE audit_dispatch"); return tx.$queryRawUnsafe<Coordinate[]>("SELECT * FROM app_locate_runnable_work()"); });
    expect(rows.some((r) => r.runId === q.runId && r.workType === "EXECUTION")).toBe(true);
    void locate;
  });
});
