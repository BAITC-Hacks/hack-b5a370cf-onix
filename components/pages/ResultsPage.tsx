"use client";

import { useState } from "react";
import { useApp } from "../AppState";
import { ContributionChart, DistrictDumbbell } from "../charts";
import { CityMap } from "../CityMap";
import { StressTest } from "../StressTest";
import { Timeline } from "../Timeline";
import { timeline } from "@/lib/engine";
import { ExplanationView } from "../ExplanationView";
import { Heatmap } from "../Heatmap";
import { Button, Card, CardTitle, StatusBadge } from "../ui";
import { EventBar } from "./EventBar";

export default function ResultsPage() {
  const app = useApp();
  const { tr, result, contrib, complete, explanation, explaining, explainError, runExplain, optimum, setOptimum, eventId, setDecisions, saved, persistSaved, setEventId } = app;
  const [optimizing, setOptimizing] = useState(false);
  const [quarter, setQuarter] = useState(8);
  const points = timeline(app.decisions, eventId);
  const mapDistricts = points[quarter].districts;

  const runOptimize = async () => {
    setOptimizing(true);
    try {
      const res = await fetch(`/api/optimize${eventId ? `?event=${eventId}` : ""}`);
      setOptimum((await res.json()).plans);
    } finally {
      setOptimizing(false);
    }
  };

  return (
    <div className="space-y-6">
      <EventBar />

      <Card>
        <CardTitle hint={tr.lang === "kz" ? "Аудандар шараларыңызбен бірге «өседі». Тінтуірді апарсаңыз — толық көрсеткіштер." : "Районы «вырастают» вместе с вашими мерами. Наведите на район — все показатели."}>
          {tr.lang === "kz" ? "Астана 3D" : "Астана в 3D"}
        </CardTitle>
        <CityMap districts={mapDistricts} weakest={result.weakestDistrict} />
        <div className="mt-5 border-t border-line pt-4">
          <div className="mb-3">
            <h3 className="font-semibold">{tr.t("tlTitle")}</h3>
            <p className="text-sm text-ink-2">{tr.t("tlHint")}</p>
          </div>
          <Timeline points={points} decisions={app.decisions} quarter={quarter} setQuarter={setQuarter} />
        </div>
      </Card>

      <Card>
        <CardTitle hint={tr.t("stressHint")}>{tr.t("stressTitle")}</CardTitle>
        <StressTest decisions={app.decisions} complete={complete} onApply={setDecisions} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle hint={tr.t("districtsHint")}>{tr.t("districtsTitle")}</CardTitle>
          <DistrictDumbbell districts={result.districts} weakest={result.weakestDistrict} />
        </Card>
        <Card>
          <CardTitle hint={tr.t("contribHint")}>{tr.t("contribTitle")}</CardTitle>
          {contrib.length ? <ContributionChart items={contrib} /> : <p className="text-sm text-ink-3">{tr.t("contribEmpty")}</p>}
        </Card>
      </div>

      <Card>
        <CardTitle hint={tr.t("heatHint")}>{tr.t("heatTitle")}</CardTitle>
        <Heatmap districts={result.districts} />
      </Card>

      <Card id="ai" className="scroll-mt-20">
        <CardTitle
          hint={tr.t("aiHint")}
          action={
            <Button variant="primary" onClick={runExplain} disabled={!complete || explaining}>
              {explaining ? tr.t("aiAnalyzing") : explanation ? tr.t("aiRerun") : tr.t("aiRun")}
            </Button>
          }
        >
          {tr.t("aiTitle")}
        </CardTitle>
        {!complete && !explanation && <p className="text-sm text-ink-3">{tr.t("aiNeedPlan")}</p>}
        {explaining && !explanation && <div className="h-24 animate-pulse rounded-xl bg-card-2" />}
        {explainError && <StatusBadge kind="crit">{explainError}</StatusBadge>}
        {explanation && <ExplanationView e={explanation} />}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle
            hint={tr.t("optHint")}
            action={
              <Button onClick={runOptimize} disabled={optimizing}>
                {optimizing ? tr.t("optRunning") : optimum ? tr.t("optRefresh") : tr.t("optRun")}
              </Button>
            }
          >
            {tr.t("optTitle")}
          </CardTitle>
          {optimum ? (
            <ol className="space-y-2">
              {optimum.map((p, i) => (
                <li key={i} className="rounded-xl bg-card-2 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">#{i + 1}</span>
                    <span className="font-bold text-accent-strong">{p.score.toFixed(2)}</span>
                    <span className="text-xs text-ink-3">
                      {tr.t("cost")} {p.cost}
                    </span>
                    {i === 0 && complete && (
                      <span className="text-xs text-ink-2">
                        {result.score >= p.score - 0.005 ? tr.t("yourPlanOptimal") : `${tr.t("yourPlanGap")} −${(p.score - result.score).toFixed(2)}`}
                      </span>
                    )}
                    <Button onClick={() => setDecisions(p.decisions)} className="ml-auto px-2 py-0.5 text-xs">
                      {tr.t("apply")}
                    </Button>
                  </div>
                  <div className="mt-1 text-xs text-ink-2">{p.decisions.map((d) => `${d.measureId} ${tr.district(d.districtId)}`).join(" · ")}</div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-ink-3">{tr.t("optEmpty")}</p>
          )}
        </Card>

        <Card>
          <CardTitle hint={tr.t("cmpHint")}>{tr.t("cmpTitle")}</CardTitle>
          {saved.length ? (
            <>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-ink-3">
                  <tr>
                    <th className="py-1 font-medium">{tr.t("scenario")}</th>
                    <th className="text-right font-medium">{tr.t("budget")}</th>
                    <th className="text-right font-medium">Score</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {[...saved]
                    .sort((a, b) => b.score - a.score)
                    .map((s, i) => (
                      <tr key={`${s.name}-${i}`} className="border-t border-line">
                        <td className="py-1.5">
                          <div className="font-medium">
                            {i === 0 && "🏆 "}
                            {s.name}
                          </div>
                          <div className="text-xs text-ink-3">{s.decisions.map((d) => d.measureId).join(", ")}</div>
                        </td>
                        <td className="text-right">{s.cost}</td>
                        <td className="text-right font-semibold">{s.score.toFixed(2)}</td>
                        <td className="text-right">
                          <button
                            onClick={() => {
                              setEventId(s.eventId);
                              setDecisions(s.decisions);
                            }}
                            className="text-xs text-accent-strong underline"
                          >
                            {tr.t("open")}
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <button onClick={() => persistSaved([])} className="mt-3 text-xs text-ink-3 underline">
                {tr.t("clear")}
              </button>
            </>
          ) : (
            <p className="text-sm text-ink-3">{tr.t("cmpEmpty")}</p>
          )}
        </Card>
      </div>
    </div>
  );
}
