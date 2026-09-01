import { NextResponse } from "next/server";
import { clearSessionCookie, getSession } from "@/lib/auth/session";
import { recordAuditLog } from "@/lib/audit-log";

/** POST /api/auth/logout — clear the session cookie. */
export async function POST(): Promise<NextResponse> {
  const session = await getSession();
  await clearSessionCookie();

  if (session) {
    try {
      await recordAuditLog({
        auditFirmId: session.auditFirmId,
        userId: session.userId,
        action: "LOGOUT",
        entityType: "User",
        entityId: session.userId,
      });
    } catch {
      // Best-effort: logout succeeds regardless of the audit write.
    }
  }

  return NextResponse.json({ ok: true });
}
