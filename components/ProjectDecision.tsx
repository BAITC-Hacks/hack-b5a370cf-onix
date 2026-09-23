"use client";

import Link from "next/link";
import { DISTRICTS, RULES, type Indicator } from "@/lib/data";
import { getMeasure, simulate, validate, type Decision } from "@/lib/engine";
import { useApp } from "./AppState";
import { CityMap } from "./CityMap";
import { Button, StatusBadge } from "./ui";

const NURA = "nura";
const OPTIONS = [
  { id: "M7", kind: "school" as const, indicators: ["S1", "E1"] as Indicator[] },
  { id: "M4", kind: "park" as const, indicators: ["S1", "E1", "E2", "B1"] as Indicator[] },
];

/** Один конкретный выбор: школа или парк на условной территории Нуры. Числа берём только из движка. */
export function ProjectDecision() {
  const { tr, decisions, setDecisions, eventId, result } = useApp();
  const selected = decisions.find((d) => d.districtId === NURA && OPTIONS.some((o) => o.id === d.measureId));
  const currentDistrict = result.districts.find((d) => d.id === NURA)!;
  const withoutProject = selected ? simulate(decisions.filter((d) => d !== selected), eventId) : result;
  const withoutProjectDistrict = withoutProject.districts.find((d) => d.id === NURA)!;
  const base = DISTRICTS.find((d) => d.id === NURA)!;

  const nextPlan = (id: string): Decision[] => [
    ...decisions.filter((d) => d !== selected),
    { measureId: id, districtId: NURA },
  ];

  return (
    <section className="rounded-3xl border border-accent/30 bg-card p-5 shadow-sm sm:p-6" aria-labelledby="project-title">
      <div className="mb-5 max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-strong">{tr.t("projectKicker")}</p>
        <h2 id="project-title" className="mt-1 text-2xl font-bold sm:text-3xl">{tr.t("projectTitle")}</h2>
        <p className="mt-2 text-sm text-ink-2">{tr.t("projectIntro")}</p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-warn bg-warn-soft p-4">
            <div className="flex items-center gap-2 font-semibold"><span aria-hidden>⌖</span>{tr.t("projectProblem")}</div>
            <p className="mt-1 text-sm leading-relaxed text-ink-2">
              {tr.t("projectProblemText", { schools: base.values.S1, green: base.values.E1 })}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusBadge kind="crit">S1 {base.values.S1} &lt; {RULES.criticalThreshold}</StatusBadge>
              <StatusBadge kind="info">E1 {base.values.E1}</StatusBadge>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            {OPTIONS.map(({ id, kind, indicators }) => {
              const m = getMeasure(id)!;
              const isSelected = selected?.measureId === id;
              const candidate = nextPlan(id);
              const v = validate(candidate, eventId);
              const issue = v.issues.find((i) => i.code !== "count");
              const tooMany = !selected && decisions.length >= RULES.decisions;
              const disabled = !isSelected && Boolean(issue || tooMany);
              const previewResult = simulate(candidate, eventId);
              const preview = previewResult.districts.find((d) => d.id === NURA)!;
              const title = kind === "school" ? tr.t("projectSchool") : tr.t("projectPark");
              return (
                <div key={id} className={`rounded-2xl border p-4 transition ${isSelected ? "border-accent bg-accent-soft/25 ring-1 ring-accent" : "border-line bg-card-2"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold"><span aria-hidden className="mr-2">{kind === "school" ? "▤" : "♧"}</span>{title}</div>
                      <div className="text-xs text-ink-3">{id} · {tr.measure(id)}</div>
                    </div>
                    {isSelected && <StatusBadge kind="good">{tr.t("projectSelected")}</StatusBadge>}
                  </div>
                  <p className="mt-2 text-sm text-ink-2">{kind === "school" ? tr.t("projectSchoolReason") : tr.t("projectParkReason")}</p>
                  <p className="mt-3 text-xs font-medium text-ink-2">{tr.t("projectCostLag", { cost: m.cost, quarter: m.lag + 1 })}</p>
                  <div className="mt-3 rounded-xl bg-card px-3 py-2 text-xs">
                    <div className="font-semibold">{tr.t("projectCompare")}</div>
                    {indicators.map((indicator) => (
                      <div key={indicator} className="mt-1 tabular-nums text-ink-2">
                        {tr.t("projectIndicatorChange", {
                          name: `${indicator} ${tr.indicator(indicator)}`,
                          before: isSelected ? withoutProjectDistrict.after[indicator] : currentDistrict.after[indicator],
                          after: preview.after[indicator],
                        })}
                      </div>
                    ))}
                  </div>
                  {(preview.after.S1 < RULES.criticalThreshold || (isSelected ? withoutProjectDistrict.after.S1 : currentDistrict.after.S1) < RULES.criticalThreshold) && (
                    <p className="mt-2 text-xs font-semibold text-ink-2">
                      {preview.after.S1 < RULES.criticalThreshold ? tr.t("projectCriticalRemains") : tr.t("projectCriticalResolved")}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-ink-3">{tr.t("projectTotalCost", { cost: previewResult.cost, budget: previewResult.budget })}</p>
                  <p className="mt-1 text-xs font-semibold tabular-nums text-ink-2">
                    {tr.t("projectScoreChange", {
                      before: (isSelected ? withoutProject.score : result.score).toFixed(2),
                      after: previewResult.score.toFixed(2),
                    })}
                  </p>
                  {!isSelected && (
                    <div className="mt-3">
                      <Button variant="primary" disabled={disabled} onClick={() => setDecisions(candidate)} className="w-full">
                        {selected ? tr.t("projectReplace") : tr.t("projectChoose")}
                      </Button>
                      {disabled && <p className="mt-1 text-xs text-crit">{issue ? tr.issue(issue) : tr.t("projectNoSlot")}</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-xs leading-relaxed text-ink-3">{tr.t("projectTradeoff")}</p>
        </div>

        <div className="min-w-0 rounded-2xl border border-line bg-card-2 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
            <div>
              <div className="font-semibold">{tr.t("projectSite")}</div>
              <p className="text-xs text-ink-3">{tr.t("projectSiteDisclaimer")}</p>
            </div>
            {selected && <Link href="/results#city-map" className="text-xs font-semibold text-accent-strong underline">{tr.t("projectSeeMap")} →</Link>}
          </div>
          <CityMap
            districts={result.districts}
            weakest={result.weakestDistrict}
            project={{ kind: selected ? selected.measureId === "M7" ? "school" : "park" : "site", districtId: NURA }}
            quarter={RULES.horizon}
          />
        </div>
      </div>
    </section>
  );
}
