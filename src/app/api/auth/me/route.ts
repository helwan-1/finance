import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { ROLE_PERMISSIONS } from "@/lib/auth/rbac";

/** GET /api/auth/me — current session (or null) plus effective permissions. */
export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ user: null });
  }
  return NextResponse.json({
    user: {
      userId: session.userId,
      fullNameAr: session.fullNameAr,
      role: session.role,
      permissions: ROLE_PERMISSIONS[session.role],
    },
  });
}
