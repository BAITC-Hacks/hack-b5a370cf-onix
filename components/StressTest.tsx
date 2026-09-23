"use client";

import { useState } from "react";
import { robustness, type Decision, type RobustPlan } from "@/lib/engine";
import { useApp } from "./AppState";
import { Button, StatusBadge } from "./ui";

/** Стресс-тест: план во всех событиях сразу + поиск устойчивого (максиминного) плана. */
export function StressTest({ decisions, complete, onApply }: { decisions: Decision[]; complete: boolean; onApply: (d: Decision[]) => void }) {
  const { tr } = useApp();
  const [plans, setPlans] = useState<RobustPlan[] | null>(null);
  const [loading, setLoading] = useState(false);
  const r = robustness(decisions);
  const scores = r.outcomes.filter((o) => o.valid).map((o) => o.score!);
  const max = Math.max(...scores, 0);
  const min = Math.min(...scores, max) - 1;
  const eventName = (id: string | null) => (id ? tr.event(id).title : tr.t("noEvent"));

  const find = async () => {
    setLoading(true);
    try {
      setPlans((await (await fetch("/api/robust")).json()).plans);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        {!complete ? (
          <p className="text-sm text-ink-3">{tr.t("needPlanStress")}</p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-2">
              {r.failed ? (
                <StatusBadge kind="crit">{tr.t("failedIn", { n: r.failed, m: r.outcomes.length })}</StatusBadge>
              ) : (
                <StatusBadge kind="good">{tr.t("allPass", { m: r.outcomes.length })}</StatusBadge>
              )}
              {r.worst !== null && (
                <StatusBadge kind="info">
                  {tr.t("worstCase")}: {r.worst.toFixed(2)} · {eventName(r.worstEvent)}
                </StatusBadge>
              )}
            </div>
            <ul className="space-y-1.5">
              {r.outcomes.map((o) => (
                <li key={o.eventId ?? "none"} className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-3 text-sm">
                  <span className="truncate" title={eventName(o.eventId)}>
                    {o.eventId ? "⚠ " : ""}
                    {eventName(o.eventId)}
                  </span>
                  {o.valid ? (
                    <span className="flex items-center gap-2">
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-card-2">
                        <span
                          className={`block h-full rounded-full ${o.eventId === r.worstEvent ? "bg-warn" : "bg-accent"}`}
                          style={{ width: `${Math.max(8, ((o.score! - min) / Math.max(0.1, max - min)) * 100)}%` }}
                        />
                      </span>
                      <b className="tabular-nums">{o.score!.toFixed(2)}</b>
                    </span>
                  ) : (
                    <span title={o.reason}>
                      <StatusBadge kind="crit">{tr.t("infeasible")}</StatusBadge>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={find} disabled={loading}>
            {loading ? tr.t("robustRunning") : tr.t("robustRun")}
          </Button>
        </div>
        <p className="mb-3 text-xs text-ink-2">{tr.t("robustHint")}</p>
        {plans && (
          <ol className="space-y-2">
            {plans.map((p, i) => (
              <li key={i} className="rounded-xl bg-card-2 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">#{i + 1}</span>
                  <span className="font-bold text-accent-strong">
                    {tr.t("robustWorst")} {p.worst.toFixed(2)}
                  </span>
                  <span className="text-xs text-ink-3">
                    {tr.t("robustBase")} {p.base.toFixed(2)} · {tr.t("cost")} {p.cost}
                  </span>
                  <Button onClick={() => onApply(p.decisions)} className="ml-auto px-2 py-0.5 text-xs">
                    {tr.t("apply")}
                  </Button>
                </div>
                <div className="mt-1 text-xs text-ink-2">{p.decisions.map((d) => `${d.measureId} ${tr.district(d.districtId)}`).join(" · ")}</div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
