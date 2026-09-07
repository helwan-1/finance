import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { withTenantContext } from "@/lib/db/tenant";

/**
 * GET /api/users — the firm's active users (for assigning engagement members).
 * Never returns the password hash. Gated on engagement:manage; RLS scopes rows
 * to the caller's firm.
 */
export async function GET(): Promise<NextResponse> {
  const auth = await requireSession("engagement:manage");
  if (!auth.ok) return auth.response;
  try {
    const rows = await withTenantContext(auth.session.auditFirmId, (tx) =>
      tx.user.findMany({
        where: { isActive: true },
        orderBy: { fullNameAr: "asc" },
        take: 500,
        select: { id: true, fullNameAr: true, email: true, role: true },
      }),
    );
    return NextResponse.json({ users: rows });
  } catch {
    return NextResponse.json({ error: "تعذّر تحميل المستخدمين" }, { status: 503 });
  }
}
