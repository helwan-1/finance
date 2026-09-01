"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, LogIn, ChevronDown } from "lucide-react";
import { ROLE_LABELS_AR } from "@/lib/labels";

interface MeResponse {
  user: {
    userId: string;
    fullNameAr: string;
    role: string;
    permissions: string[];
  } | null;
}

async function fetchMe(): Promise<MeResponse> {
  const res = await fetch("/api/auth/me");
  if (!res.ok) throw new Error("failed");
  return (await res.json()) as MeResponse;
}

export function UserMenu() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data } = useQuery({ queryKey: ["me"], queryFn: fetchMe });

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const user = data?.user ?? null;
  // Demo mode (no session): show a representative name so the shell looks real.
  const nameAr = user?.fullNameAr ?? "سارة الحربي";
  const roleAr = user ? (ROLE_LABELS_AR[user.role] ?? user.role) : "نسخة تجريبية";
  const initial = nameAr.charAt(0);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    await queryClient.invalidateQueries({ queryKey: ["me"] });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg p-1 hover:bg-black/5 dark:hover:bg-white/5"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">
          {initial}
        </span>
        <ChevronDown className="hidden h-4 w-4 text-[rgb(var(--muted))] sm:block" />
      </button>

      {open && (
        <div className="surface absolute left-0 top-full z-20 mt-2 w-56 overflow-hidden rounded-xl border shadow-card">
          <div className="border-b p-3">
            <p className="text-sm font-medium">{nameAr}</p>
            <p className="text-xs text-[rgb(var(--muted))]">{roleAr}</p>
          </div>
          {user ? (
            <button
              type="button"
              onClick={logout}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-right text-sm text-severity-critical hover:bg-black/5 dark:hover:bg-white/5"
            >
              <LogOut className="h-4 w-4" />
              تسجيل الخروج
            </button>
          ) : (
            <button
              type="button"
              onClick={() => router.push("/login")}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-right text-sm hover:bg-black/5 dark:hover:bg-white/5"
            >
              <LogIn className="h-4 w-4" />
              تسجيل الدخول
            </button>
          )}
        </div>
      )}
    </div>
  );
}
