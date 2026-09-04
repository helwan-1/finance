/**
 * G5 demo seed — populates the "النتائج والأحكام" screen with real data so the
 * professional-disposition workflow can be seen end to end.
 *
 * It is additive and safe to re-run: it skips creating demo matters if they
 * already exist. It uses the FIRST engagement in the database and ensures every
 * firm user is a member of it (so whoever is logged in can use the feature).
 *
 * What it creates:
 *   - membership rows so exceptions/dispositions are allowed (DB-enforced),
 *   - 3 minimal G4 audit results for the engagement,
 *   - one CONCLUDED matter (finding drafted → submitted → approved → concluded),
 *   - one OPEN matter with a DRAFT finding,
 *   - one free audit result left un-linked so you can create your own matter.
 *
 * Run: npm run seed:g5
 */
import { randomUUID } from "node:crypto";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/db/tenant";
import { createExceptionFromResult, concludeException } from "@/lib/g5/exception";
import { createFinding, submitFinding, reviewFinding } from "@/lib/g5/finding";
import type { FindingContentInput } from "@/lib/g5/finding";

/** Insert a minimal, valid G4 audit result (no journal lines needed). */
async function fabricateResult(firm: string, engagementId: string): Promise<string> {
  const n = randomUUID();
  const test = await prisma.auditTest.create({
    data: { auditFirmId: firm, key: `SEED-${n}`, name: "seed", nameAr: "بذرة", testType: "ACCOUNTING_INTEGRITY" },
    select: { id: true },
  });
  const tv = await prisma.auditTestVersion.create({
    data: {
      auditFirmId: firm, auditTestId: test.id, version: 1, testType: "ACCOUNTING_INTEGRITY",
      definitionJson: {}, requirementsJson: {}, versionHash: `vh-${n}`, status: "ACTIVE",
    },
    select: { id: true },
  });
  const rn = await prisma.auditRun.create({
    data: { auditFirmId: firm, engagementId, status: "COMPLETED" },
    select: { id: true },
  });
  const prep = await prisma.auditRunPreparation.create({
    data: { auditFirmId: firm, runId: rn.id, generationNo: 1, status: "PUBLISHED" },
    select: { id: true },
  });
  const artv = await prisma.auditRunTestVersion.create({
    data: {
      auditFirmId: firm, preparationId: prep.id, runId: rn.id, auditTestVersionId: tv.id,
      testType: "ACCOUNTING_INTEGRITY", effectiveParametersJson: {}, effectiveParametersHash: `ph-${n}`, orderIndex: 0,
    },
    select: { id: true },
  });
  const res = await prisma.auditResult.create({
    data: {
      auditFirmId: firm, runId: rn.id, auditRunTestVersionId: artv.id,
      resultKind: "ACCOUNTING_INTEGRITY", resultCode: "AI_INVALID_DEBIT_CREDIT", severity: "HIGH",
      score: "0.00", payloadJson: {}, resultOccurrenceFingerprint: `occ-${n}`, resultSemanticFingerprint: `sem-${n}`,
    },
    select: { id: true },
  });
  return res.id;
}

async function ensureMember(firm: string, engagementId: string, userId: string): Promise<void> {
  await withTenantContext(firm, async (t) => {
    const existing = await t.engagementMember.findFirst({ where: { engagementId, userId }, select: { id: true } });
    if (!existing) await t.engagementMember.create({ data: { engagementId, userId } });
  });
}

async function ensureUser(firm: string, role: UserRole, tag: string): Promise<string> {
  const id = `seed-${tag}-${randomUUID().slice(0, 8)}`;
  await withTenantContext(firm, (t) =>
    t.user.create({
      data: { id, auditFirmId: firm, email: `${id}@finance.local`, fullName: id, fullNameAr: `مستخدم ${tag}`, role },
    }),
  );
  return id;
}

function demoContent(category: string): FindingContentInput {
  return {
    category,
    condition: "لوحظ وجود قيود محاسبية بمبالغ في الطرفين المدين والدائن معًا بما يخالف مبدأ القيد المزدوج.",
    criteria: "يجب أن يكون كل قيد إمّا مدينًا أو دائنًا وفق المعايير المحاسبية المتعارف عليها.",
    cause: "ضعف في ضوابط الإدخال بنظام المحاسبة وعدم وجود فحص آلي للقيود.",
    effect: "احتمال تحريف أرصدة الحسابات وإضعاف موثوقية القوائم المالية.",
    auditorConclusion: "القصور الرقابي مؤكَّد ويستدعي معالجة وتصحيح القيود المتأثرة.",
    recommendation: "تفعيل فحص آلي يمنع القيود ثنائية الطرف، ومراجعة القيود التاريخية المتأثرة.",
    observedAmount: "8.00",
    observedCurrency: "SAR",
    estimatedExposureAmount: "8.00",
    estimatedExposureCurrency: "SAR",
  };
}

async function main(): Promise<void> {
  const eng = await prisma.auditEngagement.findFirst({ orderBy: { createdAt: "asc" } });
  if (!eng) {
    throw new Error("لا يوجد ارتباط (engagement) في قاعدة البيانات. أنشئ ارتباطًا من التطبيق أولًا.");
  }
  const firm = eng.auditFirmId;
  const engagementId = eng.id;
  console.log(`Engagement: ${engagementId} (firm ${firm})`);

  // Ensure at least two users, and make every firm user a member.
  const users = await prisma.user.findMany({ where: { auditFirmId: firm }, select: { id: true, role: true } });
  let preparerId = users[0]?.id ?? (await ensureUser(firm, "STAFF", "prep"));
  let reviewerId = users.find((u) => u.id !== preparerId)?.id ?? (await ensureUser(firm, "MANAGER", "rev"));
  const allUserIds = new Set<string>([...users.map((u) => u.id), preparerId, reviewerId]);
  for (const uid of allUserIds) await ensureMember(firm, engagementId, uid);
  console.log(`Members ensured for ${allUserIds.size} user(s). preparer=${preparerId} reviewer=${reviewerId}`);

  // Idempotency: skip demo matters if already present.
  const already = await withTenantContext(firm, (t) =>
    t.auditException.findFirst({ where: { engagementId, creationIdempotencyKey: { startsWith: "seed-demo-" } }, select: { id: true } }),
  );
  if (already) {
    console.log("Demo matters already exist — skipping creation. (Membership + a fresh spare result still ensured.)");
    await fabricateResult(firm, engagementId);
    console.log("Done.");
    return;
  }

  const [r1, r2] = await Promise.all([
    fabricateResult(firm, engagementId),
    fabricateResult(firm, engagementId),
  ]);
  await fabricateResult(firm, engagementId); // a spare, left free to try in the UI
  console.log("Fabricated 3 audit results.");

  // Matter 1 — worked all the way to CONCLUDED.
  const ex1 = await createExceptionFromResult(firm, {
    engagementId, createdById: preparerId,
    title: "Debit/credit integrity breach", titleAr: "مخالفة سلامة القيد المزدوج",
    description: "مسألة تجريبية مُنشأة بالبذرة لعرض الدورة الكاملة.",
    priority: "HIGH", firstResultId: r1, idempotencyKey: "seed-demo-1",
  });
  const f1 = await createFinding(firm, {
    exceptionId: ex1.exceptionId, engagementId, createdById: preparerId,
    content: demoContent("CONTROL_DEFICIENCY"), idempotencyKey: "seed-demo-f1",
  });
  await submitFinding(firm, { findingId: f1.findingId, actorId: preparerId, idempotencyKey: "seed-demo-s1" });
  await reviewFinding(firm, {
    findingId: f1.findingId, actorId: reviewerId, action: "APPROVE",
    findingVersionId: f1.versionId, note: "معتمدة", idempotencyKey: "seed-demo-r1",
  });
  await concludeException(firm, { exceptionId: ex1.exceptionId, actorId: preparerId, idempotencyKey: "seed-demo-c1" });
  console.log(`Matter 1 concluded: ${ex1.exceptionId}`);

  // Matter 2 — OPEN with a DRAFT finding.
  const ex2 = await createExceptionFromResult(firm, {
    engagementId, createdById: preparerId,
    title: "Second matter under review", titleAr: "مسألة قيد الإعداد",
    description: "مسألة تجريبية ثانية بنتيجة في حالة مسودة.",
    priority: "MEDIUM", firstResultId: r2, idempotencyKey: "seed-demo-2",
  });
  await createFinding(firm, {
    exceptionId: ex2.exceptionId, engagementId, createdById: preparerId,
    content: demoContent("PROCESS_GAP"), idempotencyKey: "seed-demo-f2",
  });
  console.log(`Matter 2 (open, draft finding): ${ex2.exceptionId}`);

  console.log("\n✅ Seed complete. Refresh /findings to see two matters + a spare audit result.");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
