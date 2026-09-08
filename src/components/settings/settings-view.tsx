"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, Save, Building2, UserCircle } from "lucide-react";
import type { FirmSettings, SettingsResponse } from "@/lib/ui-types";
import { useT } from "@/lib/i18n/use-t";
import type { MessageKey } from "@/lib/i18n/messages";

const WEEKDAY_KEYS: MessageKey[] = [
  "settings.weekday.sunday",
  "settings.weekday.monday",
  "settings.weekday.tuesday",
  "settings.weekday.wednesday",
  "settings.weekday.thursday",
  "settings.weekday.friday",
  "settings.weekday.saturday",
];
const input = "surface w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500/40";

async function fetchSettings(): Promise<SettingsResponse> {
  const res = await fetch("/api/settings");
  if (!res.ok) throw new Error("فشل تحميل الإعدادات");
  return (await res.json()) as SettingsResponse;
}

export function SettingsView() {
  const { t } = useT();
  const { data, isPending, isError } = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const [form, setForm] = useState<FirmSettings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data && !form) setForm(data.settings);
  }, [data, form]);

  const mutation = useMutation({
    mutationFn: async (s: FirmSettings) => {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? t("settings.saveError"));
      }
    },
    onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2500); },
  });

  if (isPending || !form) {
    return (
      <div className="surface flex items-center justify-center gap-2 rounded-xl border p-12 text-[rgb(var(--muted))]">
        <Loader2 className="h-5 w-5 animate-spin" /> {t("settings.loading")}
      </div>
    );
  }
  if (isError || !data) {
    return <div className="surface rounded-xl border p-12 text-center text-severity-critical">{t("settings.loadError")}</div>;
  }

  const set = (patch: Partial<FirmSettings>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const toggleWeekend = (day: number) =>
    set({
      weekendDays: form.weekendDays.includes(day)
        ? form.weekendDays.filter((d) => d !== day)
        : [...form.weekendDays, day].sort(),
    });

  return (
    <div className="space-y-5">
      {/* Profile */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="surface flex items-center gap-3 rounded-xl border p-4 shadow-card">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-700/15">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <p className="font-semibold">{data.firmNameAr}</p>
            <p className="text-xs text-[rgb(var(--muted))]">{t("settings.licenseNo", { licenseNo: data.licenseNo })}</p>
          </div>
        </div>
        <div className="surface flex items-center gap-3 rounded-xl border p-4 shadow-card">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-700/15">
            <UserCircle className="h-5 w-5" />
          </div>
          <div>
            <p className="font-semibold">{data.userNameAr ?? t("settings.demoUser")}</p>
            <p className="text-xs text-[rgb(var(--muted))]">{data.role ?? t("settings.notLoggedIn")}</p>
          </div>
        </div>
      </div>

      {/* Audit parameters */}
      <div className="surface space-y-4 rounded-xl border p-5 shadow-card">
        <div>
          <h2 className="font-semibold">{t("settings.auditParams")}</h2>
          <p className="text-xs text-[rgb(var(--muted))]">{t("settings.auditParamsHint")}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1 text-sm">
            <span className="text-[rgb(var(--muted))]">{t("settings.vatRate")}</span>
            <input className={input} type="number" step="any" value={form.vatRatePct}
              onChange={(e) => set({ vatRatePct: Number.parseFloat(e.target.value) })} disabled={!data.canEdit} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-[rgb(var(--muted))]">{t("settings.businessStart")}</span>
            <input className={input} type="number" min={0} max={23} value={form.businessStartHour}
              onChange={(e) => set({ businessStartHour: Number.parseInt(e.target.value, 10) })} disabled={!data.canEdit} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-[rgb(var(--muted))]">{t("settings.businessEnd")}</span>
            <input className={input} type="number" min={0} max={23} value={form.businessEndHour}
              onChange={(e) => set({ businessEndHour: Number.parseInt(e.target.value, 10) })} disabled={!data.canEdit} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-[rgb(var(--muted))]">{t("settings.timeZone")}</span>
            <input className={input} dir="ltr" value={form.timeZone}
              onChange={(e) => set({ timeZone: e.target.value })} disabled={!data.canEdit} />
          </label>
        </div>

        <div className="space-y-1.5">
          <span className="text-sm text-[rgb(var(--muted))]">{t("settings.weekendDays")}</span>
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_KEYS.map((key, day) => {
              const on = form.weekendDays.includes(day);
              return (
                <button key={day} type="button" disabled={!data.canEdit} onClick={() => toggleWeekend(day)}
                  className={`rounded-lg border px-3 py-1.5 text-xs ${on ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-700/20 dark:text-brand-300" : "text-[rgb(var(--muted))]"}`}>
                  {t(key)}
                </button>
              );
            })}
          </div>
        </div>

        {data.canEdit ? (
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => mutation.mutate(form)} disabled={mutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {t("settings.save")}
            </button>
            {saved && <span className="text-sm text-severity-low">{t("settings.saved")}</span>}
            {mutation.isError && <span className="text-sm text-severity-critical">{(mutation.error as Error).message}</span>}
          </div>
        ) : (
          <p className="text-xs text-[rgb(var(--muted))]">{t("settings.noEditPermission")}</p>
        )}
      </div>
    </div>
  );
}
