/**
 * Login credential-lookup path under RLS (G1). Gated by G1_DB_TEST; requires
 * DATABASE_URL → audit_app and the two-tenant seed (userA a@a.sa / firmA with a
 * bcrypt hash of "Audit@1234").
 */
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth/password";

const run = process.env.G1_DB_TEST ? describe : describe.skip;

interface AuthRow {
  id: string;
  auditFirmId: string;
  role: string;
  fullNameAr: string;
  passwordHash: string;
}

run("login credential lookup under RLS", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("a direct RLS-scoped read of users (no context) returns nothing", async () => {
    const rows = await prisma.user.findMany();
    expect(rows).toHaveLength(0);
  });

  it("app_authenticate() resolves the user for login and verifies the password", async () => {
    const rows = await prisma.$queryRaw<
      AuthRow[]
    >`SELECT * FROM app_authenticate(${"a@a.sa"})`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.auditFirmId).toBe("firmA");
    expect(await verifyPassword("Audit@1234", rows[0]!.passwordHash)).toBe(true);
    expect(await verifyPassword("wrong", rows[0]!.passwordHash)).toBe(false);
  });

  it("app_authenticate() returns nothing for an unknown email", async () => {
    const rows = await prisma.$queryRaw<
      AuthRow[]
    >`SELECT * FROM app_authenticate(${"nobody@x.sa"})`;
    expect(rows).toHaveLength(0);
  });
});
