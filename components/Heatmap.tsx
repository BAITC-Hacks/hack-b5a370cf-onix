"use client";

import { INDICATORS, RULES } from "@/lib/data";
import type { DistrictResult } from "@/lib/engine";
import { useApp } from "./AppState";

const fmt = (x: number) => (x > 0 ? `+${x}` : `${x}`);

/** Последовательная шкала одного оттенка; критические (<40) — статус «критично» с иконкой. */
function cell(v: number) {
  if (v < RULES.criticalThreshold) return "bg-crit-soft text-crit ring-1 ring-crit/60";
  if (v < 50) return "bg-[var(--seq-1)] text-ink";
  if (v < 60) return "bg-[var(--seq-2)] text-ink";
  if (v < 70) return "bg-[var(--seq-3)] text-ink";
  if (v < 80) return "bg-[var(--seq-4)] text-white";
  return "bg-[var(--seq-5)] text-white";
}

export function Heatmap({ districts }: { districts: DistrictResult[] }) {
  const { tr } = useApp();
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-separate border-spacing-[3px] text-center text-xs">
          <caption className="sr-only">{tr.t("heatTitle")}</caption>
          <thead>
            <tr className="text-ink-3">
              <th className="text-left font-medium">{tr.lang === "kz" ? "Аудан" : "Район"}</th>
              {INDICATORS.map((k) => (
                <th key={k} className="font-medium" title={tr.indicator(k)}>
                  {k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {districts.map((d) => (
              <tr key={d.id}>
                <td className="pr-2 text-left text-sm font-medium">{tr.district(d.id)}</td>
                {INDICATORS.map((k) => {
                  const delta = Math.round((d.after[k] - d.before[k]) * 100) / 100;
                  const v = d.after[k];
                  return (
                    <td key={k} className={`rounded-md px-1 py-1.5 ${cell(v)}`} title={`${tr.district(d.id)} · ${tr.indicator(k)}: ${d.before[k]} → ${v}`}>
                      <div className="font-semibold">
                        {v < RULES.criticalThreshold && <span aria-label="критично">! </span>}
                        {Math.round(v * 10) / 10}
                      </div>
                      <div className="text-[10px] opacity-80">{delta ? fmt(delta) : " "}</div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-3">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-10 rounded-sm bg-gradient-to-r from-[var(--seq-1)] to-[var(--seq-5)]" /> 40 → 80+
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-2.5 rounded-sm bg-crit-soft ring-1 ring-crit/60" /> {tr.t("heatCrit")}
        </span>
        <span>{INDICATORS.map((k) => `${k} ${tr.indicator(k).toLowerCase()}`).join(" · ")}</span>
      </div>
    </div>
  );
}
