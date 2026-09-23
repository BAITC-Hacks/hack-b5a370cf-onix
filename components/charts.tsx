"use client";

import { useState, type ReactNode } from "react";
import type { Contribution, DistrictResult } from "@/lib/engine";
import { useApp } from "./AppState";

const fmt = (x: number) => (x > 0 ? `+${x}` : `${x}`);

/** Всплывающая подсказка, привязанная к курсору внутри контейнера графика. */
function useTooltip() {
  const [tip, setTip] = useState<{ x: number; y: number; content: ReactNode } | null>(null);
  const bind = (content: ReactNode) => ({
    onMouseMove: (e: React.MouseEvent) => {
      const box = (e.currentTarget as Element).closest("[data-chart]")!.getBoundingClientRect();
      setTip({ x: e.clientX - box.left, y: e.clientY - box.top, content });
    },
    onMouseLeave: () => setTip(null),
  });
  const node = tip ? (
    <div
      className="pointer-events-none absolute z-10 max-w-64 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-card px-3 py-2 text-xs text-ink shadow-lg"
      style={{ left: tip.x, top: tip.y - 10 }}
      role="tooltip"
    >
      {tip.content}
    </div>
  ) : null;
  return { bind, node };
}

/** Вклад каждой меры в Score (leave-one-out): горизонтальные бары от нулевой линии. */
export function ContributionChart({ items }: { items: Contribution[] }) {
  const { tr } = useApp();
  const { bind, node } = useTooltip();
  const sorted = [...items].sort((a, b) => b.marginalScore - a.marginalScore);
  const max = Math.max(0.5, ...sorted.map((c) => Math.abs(c.marginalScore)));
  const hasNeg = sorted.some((c) => c.marginalScore < 0);
  const zero = hasNeg ? 30 : 0; // % ширины под отрицательную часть

  return (
    <div data-chart className="relative">
      <div className="space-y-2">
        {sorted.map((c) => {
          const w = (Math.abs(c.marginalScore) / max) * (100 - zero);
          const neg = c.marginalScore < 0;
          return (
            <div key={c.measureId} className="grid grid-cols-[7.5rem_1fr_3.5rem] items-center gap-3 text-sm" {...bind(<ContributionTip c={c} />)}>
              <div className="truncate text-ink-2" title={`${c.measureId} ${tr.measure(c.measureId)}`}>
                <b className="text-ink">{c.measureId}</b> · {tr.districtByName(c.district)}
              </div>
              <div className="relative h-6">
                {hasNeg && <div className="absolute inset-y-0 w-px bg-line" style={{ left: `${zero}%` }} />}
                <div
                  className={`absolute top-1 h-4 ${neg ? "rounded-l bg-crit" : "rounded-r bg-accent"}`}
                  style={neg ? { right: `${100 - zero}%`, width: `${w}%` } : { left: `${zero}%`, width: `${Math.max(w, 0.5)}%` }}
                />
              </div>
              <div className="text-right font-semibold">{fmt(c.marginalScore)}</div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-ink-3">{tr.t("contribHint")}</p>
      {node}
    </div>
  );
}

function ContributionTip({ c }: { c: Contribution }) {
  const { tr } = useApp();
  return (
    <div className="space-y-1">
      <div className="font-semibold">
        {c.measureId} «{tr.measure(c.measureId)}»
      </div>
      <div className="text-ink-2">
        {tr.districtByName(c.district)} · {tr.t("cost")} {c.cost} · {tr.t("lag")} {c.lag} → {Math.round(c.realizedShare * 100)}%
      </div>
      <div>
        {c.deltas.map((d) => (
          <span key={d.indicator} className="mr-2">
            {d.indicator} {fmt(d.delta)}
          </span>
        ))}
      </div>
      <div>
        Score: <b>{fmt(c.marginalScore)}</b>
      </div>
    </div>
  );
}

/** Балл каждого района до и после мер: «гантели» на общей оси. */
export function DistrictDumbbell({ districts, weakest }: { districts: DistrictResult[]; weakest: string }) {
  const { tr } = useApp();
  const { bind, node } = useTooltip();
  const values = districts.flatMap((d) => [d.scoreBefore, d.scoreAfter]);
  const lo = Math.floor(Math.min(...values) / 5) * 5 - 2;
  const hi = Math.ceil(Math.max(...values) / 5) * 5 + 2;
  const x = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / 5) * 5; t <= hi; t += 5) ticks.push(t);

  return (
    <div data-chart className="relative">
      <div className="mb-3 flex items-center gap-4 text-xs text-ink-2">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-full bg-[var(--before)]" /> {tr.t("before")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-full bg-accent" /> {tr.t("after")}
        </span>
      </div>
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-[7.5rem] right-[3.5rem]">
          {ticks.map((t) => (
            <div key={t} className="absolute inset-y-0 w-px bg-line/70" style={{ left: `${x(t)}%` }} />
          ))}
        </div>
        <div className="space-y-1">
          {districts.map((d) => {
            const a = x(d.scoreBefore);
            const b = x(d.scoreAfter);
            const up = d.scoreAfter - d.scoreBefore;
            return (
              <div
                key={d.id}
                className="grid grid-cols-[7.5rem_1fr_3.5rem] items-center text-sm"
                {...bind(
                  <div>
                    <div className="font-semibold">{tr.district(d.id)}</div>
                    <div className="text-ink-2">
                      {Math.round(d.population * 100)}% {tr.t("residents")}
                    </div>
                    <div>
                      {d.scoreBefore} → <b>{d.scoreAfter}</b> ({fmt(Math.round(up * 100) / 100)})
                    </div>
                    {d.name === weakest && <div className="mt-1">{tr.t("weakestTag")} · 30% Score</div>}
                  </div>,
                )}
              >
                <div className="truncate pr-3">
                  <span className="font-medium">{tr.district(d.id)}</span>
                  {d.name === weakest && <span className="ml-1.5 rounded bg-warn-soft px-1 text-[10px] font-semibold text-ink">{tr.t("weakestTag")}</span>}
                </div>
                <div className="relative h-8">
                  <div className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-accent/40" style={{ left: `${Math.min(a, b)}%`, width: `${Math.abs(b - a)}%` }} />
                  <div className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--before)] ring-2 ring-card" style={{ left: `${a}%` }} />
                  <div className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-card" style={{ left: `${b}%` }} />
                </div>
                <div className="text-right font-semibold">{d.scoreAfter.toFixed(1)}</div>
              </div>
            );
          })}
        </div>
        <div className="relative ml-[7.5rem] mr-[3.5rem] mt-1 h-4 text-[10px] text-ink-3">
          {ticks.map((t) => (
            <span key={t} className="absolute -translate-x-1/2" style={{ left: `${x(t)}%` }}>
              {t}
            </span>
          ))}
        </div>
      </div>
      {node}
    </div>
  );
}
