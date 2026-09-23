"use client";

import { useEffect, useRef, useState } from "react";
import { INDICATORS, RULES, type Indicator } from "@/lib/data";
import type { DistrictResult } from "@/lib/engine";
import { useApp } from "./AppState";

/**
 * Схематичная изометрическая 3D-карта Астаны: пять районов в их реальном взаимном расположении
 * (правый берег — Сарыарка, Байконур, Алматы; левый берег — Нура, Есиль), река Есиль между ними.
 * Высота призмы = балл района (или выбранного показателя); изменения анимируются.
 */

type Pt = [number, number];

// План в условных единицах: x — на восток, y — на юг.
const SHAPES: Record<string, Pt[]> = {
  saryarka: [
    [0, 0.2],
    [3.9, 0],
    [4.3, 3.1],
    [0.3, 3.4],
  ],
  baikonur: [
    [3.9, 0],
    [7, 0.3],
    [7.1, 3.2],
    [4.3, 3.1],
  ],
  almaty: [
    [7, 0.3],
    [10.4, 1],
    [10.1, 4.6],
    [7.1, 3.2],
  ],
  nura: [
    [0.1, 5.4],
    [3.4, 5.3],
    [3.8, 9.2],
    [0.4, 8.9],
  ],
  esil: [
    [3.4, 5.3],
    [8.6, 5.9],
    [8.9, 9.1],
    [3.8, 9.2],
  ],
};

// Русло Есиля между берегами.
const RIVER: Pt[] = [
  [-0.6, 3.7],
  [3.8, 3.4],
  [7.2, 3.6],
  [10.2, 4.9],
  [11.2, 5.4],
  [11.2, 6.3],
  [8.6, 5.5],
  [3.4, 4.95],
  [-0.6, 5.1],
];

const S = 30; // масштаб
const COS = Math.cos(Math.PI / 6);
const SIN = Math.sin(Math.PI / 6);
const iso = ([x, y]: Pt, z = 0): Pt => [(x - y) * COS * S, (x + y) * SIN * S - z];
const pts = (arr: Pt[]) => arr.map((p) => p.join(",")).join(" ");
const centroid = (poly: Pt[]): Pt => [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];

/** Высота призмы по значению 0–100: разница заметна в диапазоне реальных значений 35–80. */
const heightOf = (v: number) => Math.max(4, (v - 30) * 1.7);

/** Плавная анимация чисел при смене плана. */
function useAnimated(target: Record<string, number>) {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  const key = JSON.stringify(target);
  useEffect(() => {
    const start = performance.now();
    const src = { ...from.current };
    const dst: Record<string, number> = JSON.parse(key);
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / 700);
      const e = 1 - Math.pow(1 - k, 3);
      const next = Object.fromEntries(Object.keys(dst).map((id) => [id, (src[id] ?? dst[id]) + (dst[id] - (src[id] ?? dst[id])) * e]));
      from.current = next;
      setValue(next);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [key]);
  return value;
}

function fill(v: number) {
  if (v < RULES.criticalThreshold) return ["var(--crit-soft)", "var(--crit)"];
  if (v < 50) return ["var(--seq-1)", "var(--seq-3)"];
  if (v < 60) return ["var(--seq-2)", "var(--seq-4)"];
  if (v < 70) return ["var(--seq-3)", "var(--seq-5)"];
  return ["var(--seq-4)", "var(--seq-5)"];
}

export function CityMap3D({ districts, weakest }: { districts: DistrictResult[]; weakest: string }) {
  const { tr } = useApp();
  const [metric, setMetric] = useState<"D" | Indicator>("D");
  const [hover, setHover] = useState<string | null>(null);

  const valueOf = (d: DistrictResult, when: "before" | "after") => (metric === "D" ? (when === "before" ? d.scoreBefore : d.scoreAfter) : d[when][metric]);
  const animated = useAnimated(Object.fromEntries(districts.map((d) => [d.id, valueOf(d, "after")])));

  // Отрисовка от дальних к ближним (по сумме x+y центроида).
  const order = [...districts].sort((a, b) => {
    const ca = centroid(SHAPES[a.id]);
    const cb = centroid(SHAPES[b.id]);
    return ca[0] + ca[1] - (cb[0] + cb[1]);
  });

  const hovered = districts.find((d) => d.id === hover);
  const metricLabel = metric === "D" ? tr.t("districtsTitle") : `${metric} · ${tr.indicator(metric)}`;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="text-xs text-ink-3" htmlFor="map-metric">
          {tr.lang === "kz" ? "Биіктік" : "Высота"}:
        </label>
        <select id="map-metric" value={metric} onChange={(e) => setMetric(e.target.value as "D" | Indicator)} className="rounded-lg border border-line bg-card px-2 py-1 text-sm">
          <option value="D">{tr.lang === "kz" ? "Аудан балы (D)" : "Балл района (D)"}</option>
          {INDICATORS.map((k) => (
            <option key={k} value={k}>
              {k} · {tr.indicator(k)}
            </option>
          ))}
        </select>
        <span className="ml-auto flex items-center gap-3 text-[11px] text-ink-3">
          <span className="flex items-center gap-1">
            <span className="inline-block h-0 w-5 border-t-2 border-dashed border-ink-3" /> {tr.t("before")}
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block size-2.5 rounded-sm bg-[var(--seq-3)]" /> {tr.t("after")}
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block size-2.5 rounded-sm bg-crit-soft ring-1 ring-crit" /> &lt; 40
          </span>
        </span>
      </div>

      <div className="relative">
        <svg viewBox="-295 -70 610 400" className="mx-auto h-auto w-full max-w-3xl" role="img" aria-label={metricLabel}>
          {/* Подложка-город */}
          <polygon points={pts([iso([-0.8, -0.6]), iso([11.2, -0.6]), iso([11.2, 9.8]), iso([-0.8, 9.8])])} fill="var(--card-2)" />
          <polygon points={pts(RIVER.map((p) => iso(p)))} fill="#3987e5" opacity={0.35} />
          <text x={iso([10.2, 5.75])[0] - 20} y={iso([10.2, 5.75])[1] + 16} fontSize="9" fill="var(--accent-strong)">
            {tr.lang === "kz" ? "Есіл өзені" : "р. Есиль"}
          </text>

          {order.map((d) => {
            const poly = SHAPES[d.id];
            const v = animated[d.id] ?? valueOf(d, "after");
            const before = valueOf(d, "before");
            const h = heightOf(v);
            const hb = heightOf(before);
            const [top, side] = fill(v);
            const isHover = hover === d.id;
            // Боковые грани, видимые зрителю (обращены на юг/восток в изометрии).
            const faces = poly
              .map((p, i) => [p, poly[(i + 1) % poly.length]] as [Pt, Pt])
              .filter(([a, b]) => {
                const nx = b[1] - a[1];
                const ny = -(b[0] - a[0]);
                return nx + ny > 0;
              });

            return (
              <g key={d.id} onMouseEnter={() => setHover(d.id)} onMouseLeave={() => setHover(null)} className="cursor-pointer">
                {faces.map(([a, b], i) => (
                  <polygon
                    key={i}
                    points={pts([iso(a), iso(b), iso(b, h), iso(a, h)])}
                    fill={side}
                    opacity={i % 2 ? 0.85 : 0.7}
                    stroke="var(--card)"
                    strokeWidth={0.8}
                  />
                ))}
                <polygon points={pts(poly.map((p) => iso(p, h)))} fill={top} stroke={isHover ? "var(--ink)" : "var(--card)"} strokeWidth={isHover ? 2 : 1} />
                {/* Уровень до мер */}
                {Math.abs(hb - h) > 1 && <polygon points={pts(poly.map((p) => iso(p, hb)))} fill="none" stroke="var(--ink-3)" strokeWidth={1.2} strokeDasharray="4 3" />}
              </g>
            );
          })}

          {/* Подписи отдельным слоем, чтобы их не перекрывали соседние районы */}
          {order.map((d) => {
            const poly = SHAPES[d.id];
            const h = heightOf(animated[d.id] ?? valueOf(d, "after"));
            const before = valueOf(d, "before");
            const [cx, cy] = iso(centroid(poly), h);
            const delta = Math.round((valueOf(d, "after") - before) * 10) / 10;
            const crit = INDICATORS.filter((k) => d.after[k] < RULES.criticalThreshold).length;
            return (
              <g key={`label-${d.id}`} pointerEvents="none" style={{ paintOrder: "stroke" }}>
                <text x={cx} y={cy - 4} textAnchor="middle" fontSize="11" fontWeight={700} fill="var(--ink)" stroke="var(--card)" strokeWidth={3} strokeLinejoin="round">
                  {tr.district(d.id)}
                </text>
                <text x={cx} y={cy + 9} textAnchor="middle" fontSize="11" fill="var(--ink)" stroke="var(--card)" strokeWidth={3} strokeLinejoin="round">
                  {valueOf(d, "after").toFixed(1)}
                  {delta ? ` (${delta > 0 ? "+" : ""}${delta})` : ""}
                </text>
                {metric === "D" && crit > 0 && (
                  <g>
                    <circle cx={cx + 34} cy={cy - 14} r={7} fill="var(--crit)" />
                    <text x={cx + 34} y={cy - 10.5} textAnchor="middle" fontSize="10" fontWeight={700} fill="#fff">
                      !
                    </text>
                  </g>
                )}
                {d.name === weakest && metric === "D" && (
                  <text x={cx} y={cy + 21} textAnchor="middle" fontSize="9" fill="var(--ink-2)" stroke="var(--card)" strokeWidth={3}>
                    ▲ {tr.t("weakestTag")}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {hovered && (
          <div className="pointer-events-none absolute left-2 top-2 max-w-64 rounded-lg border border-line bg-card px-3 py-2 text-xs shadow-lg">
            <div className="font-semibold">{tr.district(hovered.id)}</div>
            <div className="text-ink-2">
              {Math.round(hovered.population * 100)}% {tr.t("residents")} · {tr.profile(hovered.id)}
            </div>
            <div className="mt-1">
              D: {hovered.scoreBefore} → <b>{hovered.scoreAfter}</b>
            </div>
            <div className="mt-1 grid grid-cols-5 gap-x-2 gap-y-0.5">
              {INDICATORS.map((k) => (
                <span key={k} className={hovered.after[k] < RULES.criticalThreshold ? "font-semibold text-crit" : ""}>
                  {k} {Math.round(hovered.after[k])}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      <p className="mt-1 text-[11px] text-ink-3">
        {tr.lang === "kz"
          ? "Схемалық карта: аудандардың өзара орналасуы шынайы, шекаралары шартты. Биіктік — таңдалған көрсеткіш."
          : "Схематичная карта: взаимное расположение районов реальное, границы условные. Высота — выбранный показатель."}
      </p>
    </div>
  );
}
