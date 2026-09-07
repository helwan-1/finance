"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2, UserPlus, X } from "lucide-react";
import { ROLE_LABELS_AR } from "@/lib/labels";

interface MemberDTO {
  userId: string;
  assignedAt: string;
  fullNameAr: string;
  email: string;
  role: string;
}
interface FirmUserDTO {
  id: string;
  fullNameAr: string;
  email: string;
  role: string;
}

const input =
  "surface w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500/40";
const btnBrand =
  "inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60";

/**
 * Engagement member management — add firm users to (or remove them from) the
 * selected engagement. Membership governs who may prepare, review and dispose of
 * findings (segregation of duties requires a reviewer who is a member and differs
 * from the preparer), so this is the UI that replaces manual SQL.
 */
export function EngagementMembersDialog({
  engagementId,
  engagementLabel,
  onClose,
}: {
  engagementId: string;
  engagementLabel: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [pick, setPick] = useState("");

  const membersQuery = useQuery({
    queryKey: ["engagement-members", engagementId],
    queryFn: async () => {
      const res = await fetch(`/api/engagements/${engagementId}/members`);
      if (!res.ok) throw new Error("failed");
      return (await res.json()) as { members: MemberDTO[] };
    },
  });
  const usersQuery = useQuery({
    queryKey: ["firm-users"],
    queryFn: async () => {
      const res = await fetch("/api/users");
      if (!res.ok) throw new Error("failed");
      return (await res.json()) as { users: FirmUserDTO[] };
    },
  });

  const members = useMemo(() => membersQuery.data?.members ?? [], [membersQuery.data]);
  const memberIds = useMemo(() => new Set(members.map((m) => m.userId)), [members]);
  const candidates = useMemo(
    () => (usersQuery.data?.users ?? []).filter((u) => !memberIds.has(u.id)),
    [usersQuery.data, memberIds],
  );

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["engagement-members", engagementId] });
  };

  const addMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/engagements/${engagementId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        throw new Error([d.error ?? "فشل الإضافة", d.detail].filter(Boolean).join(" — "));
      }
    },
    onSuccess: async () => {
      setPick("");
      await invalidate();
    },
    onError: (e) => alert(e instanceof Error ? e.message : "فشل الإضافة"),
  });

  const removeMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/engagements/${engagementId}/members/${userId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        throw new Error([d.error ?? "فشل الإزالة", d.detail].filter(Boolean).join(" — "));
      }
    },
    onSuccess: invalidate,
    onError: (e) => alert(e instanceof Error ? e.message : "فشل الإزالة"),
  });

  const busy = addMutation.isPending || removeMutation.isPending;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="surface w-full max-w-lg space-y-4 rounded-2xl border p-5 shadow-card"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold">أعضاء المهمة</h3>
            <p className="text-xs text-[rgb(var(--muted))]">{engagementLabel}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-black/5 dark:hover:bg-white/5">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700 dark:bg-brand-700/15 dark:text-brand-300">
          العضوية تحدّد من يُعِدّ ويُراجِع ويعتمد نتائج التدقيق. اعتماد نتيجة يتطلب مُراجِعًا عضوًا في المهمة ومختلفًا عن مُعِدّها (فصل المهام).
        </p>

        {/* Add a member */}
        <div className="flex items-end gap-2">
          <label className="block flex-1 space-y-1 text-sm">
            <span className="text-[rgb(var(--muted))]">إضافة عضو</span>
            <select
              className={input}
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              disabled={busy || candidates.length === 0}
            >
              <option value="">
                {candidates.length === 0 ? "— لا يوجد مستخدمون متاحون —" : "— اختر مستخدمًا —"}
              </option>
              {candidates.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullNameAr} — {ROLE_LABELS_AR[u.role] ?? u.role}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={btnBrand}
            disabled={busy || !pick}
            onClick={() => pick && addMutation.mutate(pick)}
          >
            {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            إضافة
          </button>
        </div>

        {/* Current members */}
        <div className="space-y-2">
          <h4 className="text-sm font-bold">الأعضاء الحاليون ({members.length})</h4>
          {membersQuery.isPending ? (
            <p className="text-sm text-[rgb(var(--muted))]">جارٍ التحميل…</p>
          ) : members.length === 0 ? (
            <p className="text-sm text-[rgb(var(--muted))]">لا يوجد أعضاء.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {members.map((m) => (
                <li key={m.userId} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <span className="block truncate text-sm font-medium">{m.fullNameAr}</span>
                    <span className="block truncate text-xs text-[rgb(var(--muted))]">
                      {m.email} · {ROLE_LABELS_AR[m.role] ?? m.role}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="rounded-lg border border-severity-critical/40 p-1.5 text-severity-critical hover:bg-severity-critical/5 disabled:opacity-50"
                    title={members.length <= 1 ? "لا يمكن إزالة آخر عضو" : "إزالة"}
                    disabled={busy || members.length <= 1}
                    onClick={() => {
                      if (window.confirm(`إزالة ${m.fullNameAr} من المهمة؟`)) {
                        removeMutation.mutate(m.userId);
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">إغلاق</button>
        </div>
      </div>
    </div>
  );
}
