import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { withTenantContext } from "@/lib/db/tenant";

/** GET /api/clients — the firm's client companies (for reusing one on a new engagement). */
export async function GET(): Promise<NextResponse> {
  const auth = await requireSession("engagement:manage");
  if (!auth.ok) return auth.response;
  try {
    const rows = await withTenantContext(auth.session.auditFirmId, (tx) =>
      tx.clientCompany.findMany({
        orderBy: { nameAr: "asc" },
        take: 500,
        select: { id: true, nameAr: true, vatNumber: true },
      }),
    );
    return NextResponse.json({ clients: rows.map((c) => ({ id: c.id, nameAr: c.nameAr, vatNumber: c.vatNumber })) });
  } catch {
    return NextResponse.json({ error: "تعذّر تحميل الشركات" }, { status: 503 });
  }
}
