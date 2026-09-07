"use client";

import { useT } from "@/lib/i18n/use-t";
import type { MessageKey } from "@/lib/i18n/messages";

/**
 * Localized screen heading (title + optional subtitle). Client component so it
 * follows the active UI language; used by the server-rendered page shells in
 * place of hardcoded Arabic <h1>/<p> blocks.
 */
export function PageHeading({
  titleKey,
  subtitleKey,
}: {
  titleKey: MessageKey;
  subtitleKey?: MessageKey;
}) {
  const { t } = useT();
  return (
    <div>
      <h1 className="text-xl font-bold">{t(titleKey)}</h1>
      {subtitleKey && (
        <p className="text-sm text-[rgb(var(--muted))]">{t(subtitleKey)}</p>
      )}
    </div>
  );
}
