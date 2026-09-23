"use client";

import Link from "next/link";
import { INDICATOR_INFO, RULES } from "@/lib/data";
import type { Decision } from "@/lib/engine";
import { useApp } from "../AppState";
import { StatusBadge } from "../ui";

export const TZ_EXAMPLE: Decision[] = [
  { measureId: "M7", districtId: "nura" },
  { measureId: "M8", districtId: "nura" },
  { measureId: "M10", districtId: "nura" },
  { measureId: "M12", districtId: null },
  { measureId: "M5", districtId: "saryarka" },
];

const KEYS = Object.keys(INDICATOR_INFO) as (keyof typeof INDICATOR_INFO)[];

export default function Landing() {
  const { tr, result, decisions, setDecisions } = useApp();
  const minBefore = Math.min(...result.districts.map((d) => d.scoreBefore));

  return (
    <div className="space-y-12">
      <section className="grid items-center gap-8 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">{tr.t("kicker")}</p>
          <h1 className="mt-3 text-4xl font-bold leading-tight sm:text-5xl">{tr.t("heroTitle")}</h1>
          <p className="mt-4 max-w-xl text-lg text-ink-2">{tr.t("heroText")}</p>
          <ol className="mt-6 grid gap-3 sm:grid-cols-3">
            {(
              [
                ["step1", "step1d"],
                ["step2", "step2d"],
                ["step3", "step3d"],
              ] as const
            ).map(([a, b], i) => (
              <li key={a} className="rounded-xl border border-line bg-card p-3">
                <div className="text-xs font-semibold text-accent">
                  {tr.t("step")} {i + 1}
                </div>
                <div className="font-medium">{tr.t(a)}</div>
                <div className="text-xs text-ink-2">{tr.t(b)}</div>
              </li>
            ))}
          </ol>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link href="/plan" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong">
              {decisions.length ? tr.t("ctaContinue") : tr.t("ctaPlan")}
            </Link>
            <Link href="/plan" onClick={() => setDecisions(TZ_EXAMPLE)} className="rounded-lg border border-line bg-card px-4 py-2 text-sm font-medium hover:bg-card-2">
              {tr.t("ctaExample")}
            </Link>
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-card p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-semibold">{tr.t("cityToday")}</h2>
            <span className="text-xs text-ink-3">{tr.t("cityTodayHint")}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {result.districts.map((d) => {
              const crit = KEYS.filter((k) => d.before[k] < RULES.criticalThreshold).length;
              return (
                <div key={d.id} className={`rounded-xl p-3 ${d.scoreBefore === minBefore ? "bg-warn-soft" : "bg-card-2"}`}>
                  <div className="flex items-baseline justify-between">
                    <span className="font-medium">{tr.district(d.id)}</span>
                    <span className="text-[11px] text-ink-3">{Math.round(d.population * 100)}%</span>
                  </div>
                  <div className="mt-1 text-2xl font-bold">{d.scoreBefore.toFixed(1)}</div>
                  <p className="mt-1 text-[11px] leading-snug text-ink-2">{tr.profile(d.id)}</p>
                  {crit > 0 && (
                    <div className="mt-1.5">
                      <StatusBadge kind="crit">
                        {crit} {tr.t("below40")}
                      </StatusBadge>
                    </div>
                  )}
                </div>
              );
            })}
            <div className="rounded-xl border border-dashed border-line p-3">
              <div className="text-[11px] text-ink-3">{tr.t("startScore")}</div>
              <div className="text-2xl font-bold">{result.baseScore.toFixed(2)}</div>
              <p className="mt-1 text-[11px] leading-snug text-ink-2">{tr.t("startScoreHint")}</p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-2xl font-bold">{tr.t("features")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ["f1", "f1d", "/method", "∑"],
              ["f2", "f2d", "/results", "✦"],
              ["f3", "f3d", "/advisor", "⚙"],
              ["f4", "f4d", "/plan", "⚠"],
            ] as const
          ).map(([a, b, href, icon]) => (
            <Link key={a} href={href} className="group rounded-2xl border border-line bg-card p-4 transition hover:border-accent">
              <div className="grid size-9 place-items-center rounded-lg bg-accent-soft text-lg text-accent-strong">{icon}</div>
              <div className="mt-3 font-semibold group-hover:text-accent-strong">{tr.t(a)}</div>
              <p className="mt-1 text-sm text-ink-2">{tr.t(b)}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
