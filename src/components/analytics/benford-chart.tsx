"use client";

import type { BenfordDigitDTO } from "@/lib/ui-types";

/**
 * Grouped bar chart (dependency-free SVG) comparing the observed first-digit
 * distribution against the Benford expectation. Observed bars use the brand
 * colour; expected bars use a muted tone. Percentages shown on the y-axis.
 */
export function BenfordChart({ digits }: { digits: BenfordDigitDTO[] }) {
  const width = 720;
  const height = 320;
  const padding = { top: 20, right: 16, bottom: 36, left: 40 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const maxProp = Math.max(
    0.35,
    ...digits.map((d) => Math.max(d.observedProportion, d.expectedProportion)),
  );

  const groupW = plotW / digits.length;
  const barW = groupW * 0.32;
  const y = (prop: number) => padding.top + plotH - (prop / maxProp) * plotH;

  // Horizontal gridlines at 10% intervals.
  const gridLines: number[] = [];
  for (let p = 0; p <= maxProp + 0.001; p += 0.1) gridLines.push(p);

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="min-w-[640px]"
        role="img"
        aria-label="مخطط توزيع الرقم الأول مقارنة بقانون بنفورد"
      >
        {/* Gridlines + y-axis labels */}
        {gridLines.map((p) => (
          <g key={p}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={y(p)}
              y2={y(p)}
              className="stroke-black/10 dark:stroke-white/10"
              strokeWidth={1}
            />
            <text
              x={padding.left - 8}
              y={y(p) + 4}
              textAnchor="end"
              className="fill-current text-[10px] text-[rgb(var(--muted))]"
            >
              {Math.round(p * 100)}%
            </text>
          </g>
        ))}

        {digits.map((d, i) => {
          const groupX = padding.left + i * groupW;
          const center = groupX + groupW / 2;
          // Observed (right bar) and expected (left bar) in the group.
          const obsX = center + 2;
          const expX = center - barW - 2;
          return (
            <g key={d.digit}>
              <rect
                x={expX}
                y={y(d.expectedProportion)}
                width={barW}
                height={padding.top + plotH - y(d.expectedProportion)}
                rx={3}
                className="fill-slate-400/70 dark:fill-slate-500/70"
              >
                <title>
                  المتوقع: {(d.expectedProportion * 100).toFixed(1)}%
                </title>
              </rect>
              <rect
                x={obsX}
                y={y(d.observedProportion)}
                width={barW}
                height={padding.top + plotH - y(d.observedProportion)}
                rx={3}
                className="fill-brand-500"
              >
                <title>
                  الملاحظ: {(d.observedProportion * 100).toFixed(1)}% (
                  {d.observedCount})
                </title>
              </rect>
              <text
                x={center}
                y={height - padding.bottom + 20}
                textAnchor="middle"
                className="fill-current text-xs font-medium"
              >
                {d.digit}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="mt-3 flex items-center justify-center gap-6 text-xs">
        <span className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-sm bg-brand-500" />
          الملاحظ
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-sm bg-slate-400/70" />
          المتوقع (بنفورد)
        </span>
      </div>
    </div>
  );
}
