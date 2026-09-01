/**
 * Seed script — populates the database with mock audit data for local testing.
 *
 * It deliberately plants a few anomalies (exact/near duplicates, off-hours and
 * weekend entries, and a Benford-skewed population) then runs the audit engine
 * to generate the corresponding AnomalyFlag rows, so the dashboard has a
 * realistic feed on first run.
 *
 * Run with: `npm run prisma:seed`
 */

import {
  PrismaClient,
  TransactionSource,
  TransactionType,
} from "@prisma/client";
import { minorUnitsToString, runAuditEngine } from "../src/lib/audit";
import type { AnalyzableTransaction } from "../src/lib/audit";
import {
  reconcile,
  reconciliationAnomalies,
  type ReconcilableTxn,
} from "../src/lib/reconciliation";

const prisma = new PrismaClient();

/** Deterministic pseudo-random generator so seeds are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260901);

function money(value: number): string {
  return value.toFixed(2);
}

const COUNTERPARTIES = [
  "شركة الأفق للتجارة",
  "مؤسسة النخبة",
  "شركة البناء الحديث",
  "مصنع الرواد",
  "شركة الخليج للخدمات",
  "مؤسسة الإتقان",
];

async function main(): Promise<void> {
  console.log("🌱 Clearing existing data...");
  // Order matters due to FK constraints.
  await prisma.auditLog.deleteMany();
  await prisma.anomalyFlag.deleteMany();
  await prisma.reconciliationMatch.deleteMany();
  await prisma.reconciliationSession.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.document.deleteMany();
  await prisma.engagementMember.deleteMany();
  await prisma.auditEngagement.deleteMany();
  await prisma.clientCompany.deleteMany();
  await prisma.user.deleteMany();
  await prisma.auditFirm.deleteMany();

  console.log("🏢 Creating audit firm and users...");
  const firm = await prisma.auditFirm.create({
    data: {
      name: "Al-Meezan Audit Partners",
      nameAr: "شركاء الميزان للمراجعة",
      licenseNo: "SOCPA-2026-0042",
    },
  });

  const partner = await prisma.user.create({
    data: {
      auditFirmId: firm.id,
      email: "partner@almeezan.sa",
      fullName: "Khalid Al-Otaibi",
      fullNameAr: "خالد العتيبي",
      role: "PARTNER",
    },
  });

  const senior = await prisma.user.create({
    data: {
      auditFirmId: firm.id,
      email: "senior@almeezan.sa",
      fullName: "Sara Al-Harbi",
      fullNameAr: "سارة الحربي",
      role: "SENIOR",
    },
  });

  console.log("👤 Creating client company and engagement...");
  const client = await prisma.clientCompany.create({
    data: {
      auditFirmId: firm.id,
      name: "Nakheel Retail Co.",
      nameAr: "شركة النخيل للتجزئة",
      vatNumber: "300012345600003",
      crNumber: "1010234567",
    },
  });

  const engagement = await prisma.auditEngagement.create({
    data: {
      auditFirmId: firm.id,
      clientCompanyId: client.id,
      title: "FY2025 Statutory Audit",
      titleAr: "المراجعة النظامية للسنة المالية 2025",
      fiscalYear: 2025,
      periodStart: new Date("2025-01-01T00:00:00Z"),
      periodEnd: new Date("2025-12-31T00:00:00Z"),
      currency: "SAR",
      members: {
        create: [{ userId: partner.id }, { userId: senior.id }],
      },
    },
  });

  console.log("📄 Creating documents...");
  const ledgerDoc = await prisma.document.create({
    data: {
      auditFirmId: firm.id,
      engagementId: engagement.id,
      type: "GENERAL_LEDGER",
      status: "PARSED",
      fileName: "GL_FY2025.csv",
      storageKey: "engagements/nakheel/gl_fy2025.csv",
      mimeType: "text/csv",
      sizeBytes: 482_113,
      parsedAt: new Date(),
    },
  });

  console.log("💸 Generating transactions...");
  type TxnSeed = {
    reference: string;
    description: string;
    amount: string;
    counterparty: string;
    account: string;
    postedAt: Date;
    type: TransactionType;
    source: TransactionSource;
    /** Override the auto-computed 15% VAT to plant a discrepancy. */
    vatOverride?: string;
  };

  const seeds: TxnSeed[] = [];

  // --- Baseline Benford-friendly population (business hours, weekdays) ---
  // Weekdays in KSA: Sun-Thu. We anchor to a known Sunday.
  const baseSunday = new Date("2025-06-01T09:00:00Z"); // 12:00 Riyadh
  for (let i = 0; i < 120; i += 1) {
    // Benford-like magnitudes: 1eX * (1 + r) skews toward low leading digits.
    const exponent = 2 + Math.floor(rand() * 4); // 100 .. 999,999
    const value = Math.pow(10, exponent) * (0.1 + rand() * 0.9);
    const dayOffset = Math.floor(rand() * 5); // Sun..Thu
    const posted = new Date(baseSunday);
    posted.setUTCDate(posted.getUTCDate() + dayOffset + Math.floor(i / 5) * 7);
    posted.setUTCHours(6 + Math.floor(rand() * 8)); // 09:00-17:00 Riyadh
    seeds.push({
      reference: `JV-${1000 + i}`,
      description: "قيد يومية تشغيلي",
      amount: money(Math.round(value * 100) / 100),
      counterparty: COUNTERPARTIES[i % COUNTERPARTIES.length]!,
      account: `5${(100 + (i % 40)).toString()}`,
      postedAt: posted,
      type: i % 2 === 0 ? "DEBIT" : "CREDIT",
      source: "LEDGER",
    });
  }

  // --- Planted: exact duplicate pair ---
  const dupAmount = money(48250.0);
  for (let k = 0; k < 2; k += 1) {
    seeds.push({
      reference: "INV-7781",
      description: "سداد فاتورة مورد",
      amount: dupAmount,
      counterparty: "شركة الأفق للتجارة",
      account: "2100",
      postedAt: new Date("2025-07-14T11:00:00Z"),
      type: "DEBIT",
      source: "LEDGER",
    });
  }

  // --- Planted: near-duplicate pair (same amount/party, 1 day apart, diff ref) ---
  seeds.push({
    reference: "INV-8010",
    description: "دفعة مورد",
    amount: money(19900.0),
    counterparty: "مصنع الرواد",
    account: "2100",
    postedAt: new Date("2025-08-03T10:00:00Z"),
    type: "DEBIT",
    source: "LEDGER",
  });
  seeds.push({
    reference: "INV-8044",
    description: "دفعة مورد",
    amount: money(19900.0),
    counterparty: "مصنع الرواد",
    account: "2100",
    postedAt: new Date("2025-08-04T10:00:00Z"),
    type: "DEBIT",
    source: "LEDGER",
  });

  // --- Planted: off-hours weekday entry (03:00 Riyadh on a Tuesday) ---
  seeds.push({
    reference: "JV-9001",
    description: "تسوية يدوية",
    amount: money(275000.0),
    counterparty: "مؤسسة الإتقان",
    account: "3900",
    postedAt: new Date("2025-09-02T00:00:00Z"), // 03:00 Riyadh, Tue
    type: "DEBIT",
    source: "MANUAL",
  });

  // --- Planted: weekend entry (Friday) ---
  seeds.push({
    reference: "JV-9002",
    description: "قيد نهاية أسبوع",
    amount: money(66000.0),
    counterparty: "شركة الخليج للخدمات",
    account: "3900",
    postedAt: new Date("2025-09-05T09:00:00Z"), // Friday
    type: "CREDIT",
    source: "MANUAL",
  });

  // --- Planted: VAT discrepancy (declared VAT is 10%, not the required 15%) ---
  seeds.push({
    reference: "INV-6620",
    description: "فاتورة مبيعات",
    amount: money(131500.0),
    counterparty: "مؤسسة النخبة",
    account: "4100",
    postedAt: new Date("2025-09-10T10:00:00Z"),
    type: "CREDIT",
    source: "INVOICE",
    vatOverride: money(13150.0), // 10% instead of the expected 19725.00
  });

  const createdTxns = [];
  for (const s of seeds) {
    // Default VAT is 15% of the taxable base, unless the seed plants a discrepancy.
    const defaultVat = Math.round(Number.parseFloat(s.amount) * 15) / 100;
    const vat = s.vatOverride ?? money(defaultVat);
    const txn = await prisma.transaction.create({
      data: {
        auditFirmId: firm.id,
        engagementId: engagement.id,
        documentId: s.source === "LEDGER" ? ledgerDoc.id : null,
        reference: s.reference,
        description: s.description,
        amount: s.amount,
        vatAmount: vat,
        currency: "SAR",
        type: s.type,
        source: s.source,
        counterparty: s.counterparty,
        account: s.account,
        postedAt: s.postedAt,
        valueDate: s.postedAt,
      },
    });
    createdTxns.push(txn);
  }

  console.log(`   Created ${createdTxns.length} transactions.`);

  console.log("🔗 Running the reconciliation engine (Bank vs Ledger)...");
  // Build a synthetic bank side: mirror the first 8 ledger entries (one with a
  // small amount delta → PARTIAL) and drop one so a ledger entry stays
  // UNRECONCILED.
  const ledgerForRecon = createdTxns
    .filter((t) => t.source === "LEDGER")
    .slice(0, 8);

  const bankTxns: ReconcilableTxn[] = [];
  for (let i = 0; i < ledgerForRecon.length; i += 1) {
    if (i === 7) continue; // leave the last ledger entry unmatched
    const src = ledgerForRecon[i]!;
    // Entry #3 differs by 0.50 → PARTIAL match; the rest are exact.
    const delta = i === 3 ? 0.5 : 0;
    const bankAmount = money(Number.parseFloat(src.amount.toString()) + delta);
    const bankValueDate = new Date(src.valueDate);
    bankValueDate.setUTCDate(bankValueDate.getUTCDate() + 1); // clears next day
    const bank = await prisma.transaction.create({
      data: {
        auditFirmId: firm.id,
        engagementId: engagement.id,
        reference: `BANK-${1000 + i}`,
        description: "حركة بنكية",
        amount: bankAmount,
        currency: "SAR",
        type: src.type,
        source: "BANK",
        counterparty: src.counterparty,
        postedAt: bankValueDate,
        valueDate: bankValueDate,
      },
    });
    bankTxns.push({
      id: bank.id,
      reference: bank.reference,
      amount: bank.amount.toString(),
      counterparty: bank.counterparty,
      valueDate: bank.valueDate.toISOString(),
    });
  }

  const ledgerSide: ReconcilableTxn[] = ledgerForRecon.map((t) => ({
    id: t.id,
    reference: t.reference,
    amount: t.amount.toString(),
    counterparty: t.counterparty,
    valueDate: t.valueDate.toISOString(),
  }));

  const reconResult = reconcile(bankTxns, ledgerSide, {
    amountToleranceMinor: 100, // allow up to 1.00 SAR delta for PARTIAL
  });
  console.log(
    `   Reconciliation: ${reconResult.matchedCount} matched, ${reconResult.partialCount} partial, ${reconResult.unmatchedTargetIds.length} unmatched ledger.`,
  );

  const reconSession = await prisma.reconciliationSession.create({
    data: {
      auditFirmId: firm.id,
      engagementId: engagement.id,
      name: "Bank vs Ledger — FY2025",
      status: "COMPLETED",
      sourceA: "BANK",
      sourceB: "LEDGER",
      matchedCount: reconResult.matchedCount + reconResult.partialCount,
      totalCount: reconResult.totalCount,
      startedAt: new Date(),
      completedAt: new Date(),
    },
  });

  for (const m of reconResult.matches) {
    if (m.targetId === null) continue; // unmatched bank side: no pair row
    await prisma.reconciliationMatch.create({
      data: {
        sessionId: reconSession.id,
        sourceTxnId: m.sourceId,
        targetTxnId: m.targetId,
        status: m.status,
        confidence: m.confidence.toFixed(4),
        amountDelta:
          m.amountDeltaMinor === null
            ? null
            : minorUnitsToString(m.amountDeltaMinor),
      },
    });
  }

  // Unmatched LEDGER entries (targets here) → UNRECONCILED anomalies.
  const ledgerLookup = new Map(ledgerSide.map((t) => [t.id, t]));
  const reconFindings = reconciliationAnomalies(
    {
      ...reconResult,
      // Report the unmatched ledger side.
      unmatchedSourceIds: reconResult.unmatchedTargetIds,
    },
    (id) => ledgerLookup.get(id),
  );

  console.log("🧮 Running the audit engine...");
  const analyzable: AnalyzableTransaction[] = createdTxns.map((t) => ({
    id: t.id,
    reference: t.reference,
    description: t.description,
    amount: t.amount.toString(),
    vatAmount: t.vatAmount ? t.vatAmount.toString() : null,
    counterparty: t.counterparty,
    account: t.account,
    postedAt: t.postedAt.toISOString(),
  }));

  // Combine statistical findings with the reconciliation (UNRECONCILED) ones.
  const findings = [...runAuditEngine(analyzable), ...reconFindings];
  console.log(`   Engine produced ${findings.length} findings.`);

  for (const f of findings) {
    await prisma.anomalyFlag.create({
      data: {
        auditFirmId: firm.id,
        engagementId: engagement.id,
        transactionId: f.transactionIds[0] ?? null,
        ruleCode: f.ruleCode,
        severity: f.severity,
        status: "OPEN",
        title: f.title,
        titleAr: f.titleAr,
        description: f.description,
        descriptionAr: f.descriptionAr,
        score: f.score.toFixed(2),
        evidence: f.evidence as object,
      },
    });
  }

  console.log("📝 Writing an initial audit-log entry...");
  await prisma.auditLog.create({
    data: {
      auditFirmId: firm.id,
      engagementId: engagement.id,
      userId: senior.id,
      action: "RUN_ANALYSIS",
      entityType: "AuditEngagement",
      entityId: engagement.id,
      metadata: { findings: findings.length },
    },
  });

  console.log("✅ Seed complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
