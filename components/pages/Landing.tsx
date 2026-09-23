"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { INDICATOR_INFO, RULES } from "@/lib/data";
import type { Decision, DistrictResult } from "@/lib/engine";
import { useApp } from "../AppState";
import { StatusBadge } from "../ui";

const MapPlaceholder = () => <div className="h-[600px] rounded-xl bg-card-2" aria-hidden="true" />;
const CityMap = dynamic(() => import("../CityMap").then((module) => module.CityMap), {
  ssr: false,
  loading: MapPlaceholder,
});

function NearViewportCityMap({ districts, weakest }: { districts: DistrictResult[]; weakest: string }) {
  const target = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      const timer = window.setTimeout(() => setMounted(true), 0);
      return () => window.clearTimeout(timer);
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setMounted(true);
        observer.disconnect();
      }
    }, { rootMargin: "300px 0px" });
    if (target.current) observer.observe(target.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={target} className="min-h-[600px]">
      {mounted ? <CityMap districts={districts} weakest={weakest} /> : <MapPlaceholder />}
    </div>
  );
}

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
          <div className="mt-6 flex flex-wrap gap-2">
            <Link href="/plan" className="rounded-xl bg-accent px-5 py-2.5 text-base font-semibold text-white hover:bg-accent-strong">
              {decisions.length ? tr.t("ctaContinue") : tr.t("ctaPlan")} →
            </Link>
            <Link href="/plan" onClick={() => setDecisions(TZ_EXAMPLE)} className="rounded-xl border border-line bg-card px-5 py-2.5 text-base font-medium hover:bg-card-2">
              {tr.t("ctaExample")}
            </Link>
          </div>
          <ol className="mt-8 grid gap-3 sm:grid-cols-3">
            {(
              [
                ["step1", "step1d"],
                ["step2", "step2d"],
                ["step3", "step3d"],
              ] as const
            ).map(([a, b], i) => (
              <li key={a} className="flex gap-3 rounded-xl border border-line bg-card p-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-bold text-accent-strong">{i + 1}</span>
                <div>
                  <div className="font-semibold leading-tight">{tr.t(a)}</div>
                  <div className="text-xs text-ink-2">{tr.t(b)}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="rounded-2xl border border-line bg-card p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">{tr.t("cityToday")}</h2>
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

      <section className="rounded-2xl border border-line bg-card p-5">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-2xl font-bold">{tr.lang === "kz" ? "Астана 3D — сіздің жоспарыңызбен" : "Астана в 3D — с вашим планом"}</h2>
          <Link href="/plan" className="text-sm font-medium text-accent-strong hover:underline">
            {tr.t("ctaPlan")} →
          </Link>
        </div>
        <NearViewportCityMap districts={result.districts} weakest={result.weakestDistrict} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">{tr.t("features")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ["f1", "f1d", "/method", "∑"],
              ["f2", "f2d", "/results", "✦"],
              ["f3", "f3d", "/advisor", "⚙"],
              ["f4", "f4d", "/plan", "⚠"],
            ] as const
          ).map(([a, b, href, icon]) => (
            <Link key={a} href={href} className="group flex items-center gap-3 rounded-2xl border border-line bg-card p-4 transition hover:border-accent">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-lg text-accent-strong">{icon}</div>
              <div className="min-w-0">
                <div className="font-semibold group-hover:text-accent-strong">{tr.t(a)}</div>
                <p className="text-xs text-ink-2">{tr.t(b)}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
