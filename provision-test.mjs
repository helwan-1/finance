import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const firm = await prisma.auditFirm.findFirstOrThrow({ select: { id: true } });
const key = "GL-POP-COMPLETENESS";
if (await prisma.auditTest.findFirst({ where: { auditFirmId: firm.id, key } })) {
  console.log("test already exists"); await prisma.$disconnect(); process.exit(0);
}
const test = await prisma.auditTest.create({ data: { auditFirmId: firm.id, key,
  name: "General Ledger population completeness", nameAr: "اكتمال مجتمع دفتر الأستاذ",
  testType: "DATA_QUALITY" }, select: { id: true } });
const tv = await prisma.auditTestVersion.create({ data: { auditFirmId: firm.id,
  auditTestId: test.id, version: 1, testType: "DATA_QUALITY",
  definitionJson: { dqKind: "POPULATION_MEMBER" },
  requirementsJson: { requiredDatasetKinds: ["GENERAL_LEDGER"] },
  versionHash: "vh-local-1", status: "ACTIVE" }, select: { id: true } });
await prisma.auditTest.update({ where: { id: test.id }, data: { currentVersionId: tv.id } });
console.log("created audit test:", key);
await prisma.$disconnect();
