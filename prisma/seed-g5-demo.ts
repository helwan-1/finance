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
  // Match the app's engagement switcher, which selects the first engagement from
  // /api/engagements ordered by [fiscalYear desc, createdAt desc]. Seeding the
  // SAME engagement the UI shows by default avoids an empty screen.
  const eng = await prisma.auditEngagement.findFirst({
    orderBy: [{ fiscalYear: "desc" }, { createdAt: "desc" }],
  });
  if (!eng) {
    throw new Error("لا يوجد ارتباط (engagement) في قاعدة البيانات. أنشئ ارتباطًا من التطبيق أولًا.");
  }
  const firm = eng.auditFirmId;
  const engagementId = eng.id;
  /** Engagement-scoped idempotency keys (unique per firm, per engagement). */
  const K = (s: string) => `seed-${engagementId}-${s}`;
  console.log(`Engagement: ${eng.titleAr ?? eng.title} — ${eng.fiscalYear}  [${engagementId}] (firm ${firm})`);

  // Ensure at least two users, and make every firm user a member.
  const users = await prisma.user.findMany({ where: { auditFirmId: firm }, select: { id: true, role: true } });
  let preparerId = users[0]?.id ?? (await ensureUser(firm, "STAFF", "prep"));
  let reviewerId = users.find((u) => u.id !== preparerId)?.id ?? (await ensureUser(firm, "MANAGER", "rev"));
  const allUserIds = new Set<string>([...users.map((u) => u.id), preparerId, reviewerId]);
  for (const uid of allUserIds) await ensureMember(firm, engagementId, uid);
  console.log(`Members ensured for ${allUserIds.size} user(s). preparer=${preparerId} reviewer=${reviewerId}`);

  // Re-runnable helpers: resolve existing state by stable idempotency keys.
  const exByKey = (key: string) =>
    withTenantContext(firm, (t) =>
      t.auditException.findFirst({
        where: { engagementId, creationIdempotencyKey: key },
        select: { id: true, currentStatus: true },
      }),
    );
  const findingOf = (exceptionId: string) =>
    withTenantContext(firm, (t) =>
      t.auditFinding.findFirst({
        where: { exceptionId },
        select: { id: true, currentStatus: true, currentVersionId: true },
      }),
    );

  let createdAny = false;

  // ---- Matter 1: driven all the way to CONCLUDED ----
  let ex1 = await exByKey(K("1"));
  if (!ex1) {
    const r = await fabricateResult(firm, engagementId);
    const c = await createExceptionFromResult(firm, {
      engagementId, createdById: preparerId,
      title: "Debit/credit integrity breach", titleAr: "مخالفة سلامة القيد المزدوج",
      description: "مسألة تجريبية مُنشأة بالبذرة لعرض الدورة الكاملة.",
      priority: "HIGH", firstResultId: r, idempotencyKey: K("1"),
    });
    ex1 = { id: c.exceptionId, currentStatus: "OPEN" };
    createdAny = true;
  }
  let f1 = await findingOf(ex1.id);
  if (!f1) {
    const c = await createFinding(firm, {
      exceptionId: ex1.id, engagementId, createdById: preparerId,
      content: demoContent("CONTROL_DEFICIENCY"), idempotencyKey: K("f1"),
    });
    f1 = { id: c.findingId, currentStatus: "DRAFT", currentVersionId: c.versionId };
  }
  if (f1.currentStatus === "DRAFT") {
    await submitFinding(firm, { findingId: f1.id, actorId: preparerId, idempotencyKey: K("s1") });
    f1 = { ...f1, currentStatus: "IN_REVIEW" };
  }
  if (f1.currentStatus === "IN_REVIEW" && f1.currentVersionId) {
    await reviewFinding(firm, {
      findingId: f1.id, actorId: reviewerId, action: "APPROVE",
      findingVersionId: f1.currentVersionId, note: "معتمدة", idempotencyKey: K("r1"),
    });
  }
  const ex1now = await exByKey(K("1"));
  if (ex1now && ex1now.currentStatus !== "CONCLUDED_WITH_FINDING") {
    await concludeException(firm, { exceptionId: ex1.id, actorId: preparerId, idempotencyKey: K("c1") });
  }
  console.log(`Matter 1 ready (CONCLUDED): ${ex1.id}`);

  // ---- Matter 2: OPEN with a DRAFT finding ----
  let ex2 = await exByKey(K("2"));
  if (!ex2) {
    const r = await fabricateResult(firm, engagementId);
    const c = await createExceptionFromResult(firm, {
      engagementId, createdById: preparerId,
      title: "Second matter under review", titleAr: "مسألة قيد الإعداد",
      description: "مسألة تجريبية ثانية بنتيجة في حالة مسودة.",
      priority: "MEDIUM", firstResultId: r, idempotencyKey: K("2"),
    });
    ex2 = { id: c.exceptionId, currentStatus: "OPEN" };
    createdAny = true;
  }
  const f2 = await findingOf(ex2.id);
  if (!f2) {
    await createFinding(firm, {
      exceptionId: ex2.id, engagementId, createdById: preparerId,
      content: demoContent("DATA_QUALITY_MATTER"), idempotencyKey: K("f2"),
    });
  }
  console.log(`Matter 2 ready (OPEN, draft finding): ${ex2.id}`);

  // A spare, un-linked result so you can create your own matter from the UI.
  if (createdAny) await fabricateResult(firm, engagementId);

  console.log("\n✅ Seed complete. Refresh /findings to see two matters + a spare audit result.");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
