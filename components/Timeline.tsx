"use client";

import { useEffect, useRef, useState } from "react";
import { RULES } from "@/lib/data";
import { getMeasure, type Decision, type QuarterPoint } from "@/lib/engine";
import { useApp } from "./AppState";
import { Button } from "./ui";

/** Дорожная карта плана: Score по кварталам + когда какая мера начинает работать. Управляет кварталом на карте. */
export function Timeline({ points, decisions, quarter, setQuarter }: { points: QuarterPoint[]; decisions: Decision[]; quarter: number; setQuarter: (q: number) => void }) {
  const { tr } = useApp();
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => void (timer.current && clearInterval(timer.current)), []);

  const play = () => {
    if (playing) {
      if (timer.current) clearInterval(timer.current);
      setPlaying(false);
      return;
    }
    let q = quarter >= RULES.horizon ? 0 : quarter;
    setQuarter(q);
    setPlaying(true);
    timer.current = setInterval(() => {
      q += 1;
      setQuarter(q);
      if (q >= RULES.horizon) {
        if (timer.current) clearInterval(timer.current);
        setPlaying(false);
      }
    }, 900);
  };

  // График Score по кварталам
  const W = 520;
  const H = 150;
  const pad = { l: 36, r: 12, t: 12, b: 24 };
  const scores = points.map((p) => p.score);
  const lo = Math.floor(Math.min(...scores) - 0.5);
  const hi = Math.ceil(Math.max(...scores) + 0.5);
  const x = (q: number) => pad.l + (q / RULES.horizon) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - pad.t - pad.b);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(p.quarter)},${y(p.score)}`).join(" ");
  const cur = points[quarter];

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={play} disabled={!decisions.length}>
            {playing ? tr.t("pause") : tr.t("play")}
          </Button>
          <input
            type="range"
            min={0}
            max={RULES.horizon}
            step={1}
            value={quarter}
            onChange={(e) => setQuarter(Number(e.target.value))}
            className="min-w-32 flex-1 accent-[var(--accent)]"
            aria-label={tr.t("quarter")}
          />
          <span className="text-sm font-semibold tabular-nums">
            {tr.t("q")}
            {quarter}
          </span>
        </div>
        <p className="mb-1 text-xs text-ink-2">{tr.t("tlNow", { q: quarter, s: cur.score.toFixed(2) })}</p>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={tr.t("tlTitle")}>
          {[lo, (lo + hi) / 2, hi].map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--line)" />
              <text x={pad.l - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="var(--ink-3)">
                {v.toFixed(1)}
              </text>
            </g>
          ))}
          {points.map((p) => (
            <text key={p.quarter} x={x(p.quarter)} y={H - 6} textAnchor="middle" fontSize="10" fill={p.quarter === quarter ? "var(--ink)" : "var(--ink-3)"}>
              {tr.t("q")}
              {p.quarter}
            </text>
          ))}
          <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} />
          {points.map((p) => (
            <circle
              key={p.quarter}
              cx={x(p.quarter)}
              cy={y(p.score)}
              r={p.quarter === quarter ? 6 : 4}
              fill={p.quarter === quarter ? "var(--accent)" : "var(--card)"}
              stroke="var(--accent)"
              strokeWidth={2}
              className="cursor-pointer"
              onClick={() => setQuarter(p.quarter)}
            >
              <title>{`${tr.t("quarter")} ${p.quarter}: Score ${p.score}`}</title>
            </circle>
          ))}
        </svg>
      </div>

      {/* Когда какая мера включается */}
      <div className="space-y-1.5 text-xs">
        {decisions.map((d) => {
          const m = getMeasure(d.measureId)!;
          const active = cur.active.includes(m.id);
          return (
            <div key={m.id} className="grid grid-cols-[5.5rem_1fr] items-center gap-2">
              <div className="truncate" title={tr.measure(m.id)}>
                <b>{m.id}</b> <span className="text-ink-3">{tr.district(d.districtId)}</span>
              </div>
              <div className="relative h-5 rounded bg-card-2">
                <div
                  className={`absolute inset-y-0 rounded ${active ? "bg-accent" : "bg-accent/35"}`}
                  style={{ left: `${(m.lag / RULES.horizon) * 100}%`, right: 0 }}
                  title={tr.t("startsAt", { q: m.lag + 1 })}
                />
                <div className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `${(quarter / RULES.horizon) * 100}%` }} />
                <span className="absolute inset-y-0 left-1 flex items-center text-[10px] text-ink-2">{tr.t("startsAt", { q: m.lag + 1 })}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
