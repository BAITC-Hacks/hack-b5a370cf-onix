"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DIRECTIONS, DISTRICTS, MEASURES, RULES, type Indicator, type Measure } from "@/lib/data";
import { getMeasure, validate, type Decision } from "@/lib/engine";
import { useApp } from "../AppState";
import { Button, StatusBadge } from "../ui";
import { EventBar } from "./EventBar";

const fmt = (x: number) => (x > 0 ? `+${x}` : `${x}`);

export default function PlanPage() {
  const app = useApp();
  const { tr, decisions, setDecisions, eventId, event, result, validation, complete, planQuery, saved, persistSaved } = app;
  const router = useRouter();
  const [copied, setCopied] = useState(false);

  /** Почему нельзя добавить меру в этот район (все правила, кроме «ровно 5»). */
  const blockReason = (m: Measure, districtId: string | null): string | null => {
    if (decisions.some((d) => d.measureId === m.id)) return tr.issue({ code: "duplicate", measureId: m.id });
    if (decisions.length >= RULES.decisions) return tr.issue({ code: "count", n: decisions.length, limit: RULES.decisions });
    const issues = validate([...decisions, { measureId: m.id, districtId }], eventId).issues.filter((i) => i.code !== "count");
    return issues[0] ? tr.issue(issues[0]) : null;
  };
  const add = (m: Measure, districtId: string | null) => {
    if (!blockReason(m, districtId)) setDecisions([...decisions, { measureId: m.id, districtId }]);
  };
  const remove = (id: string) => setDecisions(decisions.filter((d) => d.measureId !== id));

  const share = async () => {
    const url = `${location.origin}/plan?${planQuery}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      prompt(tr.t("share"), url);
    }
  };

  const budgetPct = Math.min(100, (result.cost / result.budget) * 100);

  return (
    <div className="space-y-6">
      <EventBar />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="min-w-0">
          <div className="mb-4">
            <h1 className="text-2xl font-bold">{tr.t("catalog")}</h1>
            <p className="text-sm text-ink-2">{tr.t("catalogHint")}</p>
          </div>
          <div className="space-y-6">
            {DIRECTIONS.map((dir) => {
              const used = decisions.filter((d) => getMeasure(d.measureId)?.direction === dir).length;
              return (
                <div key={dir}>
                  <div className="mb-2 flex items-center gap-2">
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-2">{tr.direction(dir)}</h2>
                    <span className={`text-xs ${used >= RULES.maxPerDirection ? "text-ink" : "text-ink-3"}`}>
                      {used}/{RULES.maxPerDirection}
                    </span>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {MEASURES.filter((m) => m.direction === dir).map((m) => (
                      <MeasureCard key={m.id} m={m} chosen={decisions.find((d) => d.measureId === m.id)} blockReason={blockReason} onAdd={add} onRemove={remove} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <aside className="min-w-0">
          <div className="space-y-4 lg:sticky lg:top-20">
            <div className="rounded-2xl bg-accent p-5 text-white">
              <div className="text-sm opacity-85">Astana {tr.t("score")}</div>
              <div className="mt-1 flex items-end gap-3">
                <span className="text-5xl font-bold leading-none">{result.score.toFixed(2)}</span>
                <span className="pb-1 text-sm font-medium">
                  {fmt(result.delta)} {tr.t("toStart")} {result.baseScore}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="opacity-80">{tr.t("cityAvg")}</div>
                  <div className="text-base font-semibold">{result.dAvg}</div>
                </div>
                <div>
                  <div className="opacity-80">
                    {tr.t("weakest")} · {tr.districtByName(result.weakestDistrict)}
                  </div>
                  <div className="text-base font-semibold">{result.minD}</div>
                </div>
                <div>
                  <div className="opacity-80">{tr.t("critical")}</div>
                  <div className="text-base font-semibold">{result.criticalCount}</div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-line bg-card p-4">
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-semibold">{tr.t("budget")}</span>
                <span>
                  <b>{result.cost}</b> / {result.budget} · {tr.t("left")} {result.remainingBudget}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-card-2" role="progressbar" aria-valuenow={result.cost} aria-valuemax={result.budget}>
                <div className={`h-full rounded-full ${result.cost > result.budget ? "bg-crit" : "bg-accent"}`} style={{ width: `${budgetPct}%` }} />
              </div>

              <div className="mt-4 text-sm font-semibold">
                {tr.t("decisions")} {decisions.length}/{RULES.decisions}
              </div>
              <ol className="mt-2 space-y-1.5">
                {Array.from({ length: RULES.decisions }).map((_, i) => {
                  const d = decisions[i];
                  const m = d && getMeasure(d.measureId);
                  return m ? (
                    <li key={d.measureId} className="flex items-center gap-2 rounded-lg bg-card-2 px-2.5 py-1.5 text-sm">
                      <span className="w-8 text-xs font-semibold text-ink-3">{m.id}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{tr.measure(m.id)}</span>
                        <span className={`text-xs ${d.districtId || m.scope === "city" ? "text-accent-strong" : "text-crit"}`}>{tr.district(d.districtId, m.scope)}</span>
                      </span>
                      <span className="text-xs text-ink-2">{m.cost}</span>
                      <button onClick={() => remove(m.id)} className="rounded px-1 text-ink-3 hover:bg-card hover:text-ink" aria-label={`${tr.t("remove")} ${m.id}`}>
                        ✕
                      </button>
                    </li>
                  ) : (
                    <li key={`slot-${i}`} className="rounded-lg border border-dashed border-line px-2.5 py-2 text-xs text-ink-3">
                      {tr.t("slot")} {i + 1} — {tr.t("slotHint")}
                    </li>
                  );
                })}
              </ol>

              <div className="mt-3 space-y-1">
                {complete ? (
                  <StatusBadge kind="good">{tr.t("planValid")}</StatusBadge>
                ) : decisions.length > 0 ? (
                  <ul className="space-y-1">
                    {validation.issues.map((i, k) => (
                      <li key={k}>
                        <StatusBadge kind={i.code === "count" ? "info" : "crit"}>{tr.issue(i)}</StatusBadge>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {result.synergies.map((s) => (
                  <div key={s.pair}>
                    <StatusBadge kind="good">
                      {tr.t("synergy")} {s.pair}: {s.indicator} +{s.bonus}
                    </StatusBadge>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button
                  variant="primary"
                  disabled={!complete}
                  onClick={() => {
                    app.runExplain();
                    router.push("/results#ai");
                  }}
                  className="col-span-2"
                >
                  {tr.t("aiAnalyze")}
                </Button>
                <Link
                  href={`/report?${planQuery}`}
                  target="_blank"
                  aria-disabled={!complete}
                  className={`inline-flex items-center justify-center rounded-lg border border-line px-3 py-1.5 text-sm font-medium ${complete ? "hover:bg-card-2" : "pointer-events-none opacity-40"}`}
                >
                  {tr.t("report")}
                </Link>
                <Button onClick={share} disabled={!decisions.length}>
                  {copied ? tr.t("copied") : tr.t("share")}
                </Button>
                <Button
                  onClick={() =>
                    persistSaved([
                      ...saved,
                      {
                        name: `${tr.t("scenario")} ${saved.length + 1}${event ? ` · ${tr.event(event.id).title}` : ""}`,
                        decisions,
                        eventId,
                        score: result.score,
                        cost: result.cost,
                      },
                    ])
                  }
                  disabled={!complete}
                >
                  {tr.t("toCompare")}
                </Button>
                <Button variant="ghost" onClick={() => setDecisions([])} disabled={!decisions.length}>
                  {tr.t("reset")}
                </Button>
                <Link
                  href="/leaderboard"
                  aria-disabled={!complete}
                  className={`inline-flex items-center justify-center rounded-lg border border-line px-3 py-1.5 text-sm font-medium ${complete ? "hover:bg-card-2" : "pointer-events-none opacity-40"}`}
                >
                  🏆 {tr.t("lbSubmit")}
                </Link>
                <Link href="/results" className="inline-flex items-center justify-center text-sm font-medium text-accent-strong hover:underline">
                  {tr.t("toResults")}
                </Link>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function MeasureCard({
  m,
  chosen,
  blockReason,
  onAdd,
  onRemove,
}: {
  m: Measure;
  chosen?: Decision;
  blockReason: (m: Measure, districtId: string | null) => string | null;
  onAdd: (m: Measure, districtId: string | null) => void;
  onRemove: (id: string) => void;
}) {
  const { tr } = useApp();
  const share = Math.round(((RULES.horizon - m.lag) / RULES.horizon) * 100);
  const cityReason = m.scope === "city" ? blockReason(m, null) : null;
  return (
    <div className={`rounded-xl border bg-card p-3 transition ${chosen ? "border-accent ring-1 ring-accent" : "border-line"}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium leading-snug">
            <span className="mr-1 text-ink-3">{m.id}</span>
            {tr.measure(m.id)}
          </div>
          <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
            {(Object.entries(m.effects) as [Indicator, number][]).map(([k, e]) => (
              <span key={k} className={`rounded px-1.5 py-0.5 ${e < 0 ? "bg-crit-soft text-crit" : "bg-card-2 text-ink-2"}`} title={tr.indicator(k)}>
                {k} {fmt(e)}
              </span>
            ))}
            <span className="rounded px-1.5 py-0.5 text-ink-3">
              {tr.t("lag")} {m.lag} · {share}%
            </span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-lg font-bold leading-none">{m.cost}</div>
          <div className="text-[10px] text-ink-3">{tr.t("units")}</div>
        </div>
      </div>
      <div className="mt-2.5">
        {chosen ? (
          <div className="flex items-center gap-2 text-xs">
            <StatusBadge kind="good">
              {tr.t("inPlan")} · {tr.district(chosen.districtId)}
            </StatusBadge>
            <button onClick={() => onRemove(m.id)} className="ml-auto text-ink-3 underline hover:text-ink">
              {tr.t("remove")}
            </button>
          </div>
        ) : m.scope === "city" ? (
          <button
            onClick={() => onAdd(m, null)}
            disabled={!!cityReason}
            title={cityReason ?? tr.t("addCity")}
            className="w-full rounded-lg border border-line py-1 text-xs font-medium enabled:hover:border-accent enabled:hover:text-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
          >
            {tr.t("addCity")}
          </button>
        ) : (
          <div className="grid grid-cols-5 gap-1">
            {DISTRICTS.map((d) => {
              const r = blockReason(m, d.id);
              return (
                <button
                  key={d.id}
                  onClick={() => onAdd(m, d.id)}
                  disabled={!!r}
                  title={r ?? tr.district(d.id)}
                  className="truncate rounded-lg border border-line px-1 py-1 text-[11px] font-medium enabled:hover:border-accent enabled:hover:text-accent-strong disabled:cursor-not-allowed disabled:opacity-35"
                >
                  {tr.district(d.id)}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
