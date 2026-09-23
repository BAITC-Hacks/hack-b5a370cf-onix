"use client";

import { EVENTS } from "@/lib/data";
import { useApp } from "../AppState";
import { Button } from "../ui";

const fmt = (x: number) => (x > 0 ? `+${x}` : `${x}`);

export function EventBar() {
  const { tr, event, eventId, setEventId, result } = useApp();
  const ev = event ? tr.event(event.id) : null;
  return (
    <section className={`rounded-2xl border p-4 ${event ? "border-warn bg-warn-soft" : "border-line bg-card"}`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-2">{tr.t("eventKicker")}</div>
          {event && ev ? (
            <>
              <div className="mt-1 text-lg font-semibold">⚠ {ev.title}</div>
              <p className="text-sm text-ink-2">{ev.description}</p>
              <p className="mt-1 text-xs text-ink-2">
                {[
                  ...event.shocks.map((s) => `${tr.district(s.districtId)}: ${tr.indicator(s.indicator)} ${fmt(s.delta)}`),
                  ...(event.budgetCut ? [`${tr.t("budgetWord")} −${event.budgetCut}`] : []),
                ].join(" · ")}{" "}
                · {tr.t("startScore")} {result.baseScoreNoEvent} → {result.baseScore}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-ink-2">{tr.t("eventEmpty")}</p>
          )}
        </div>
        <select
          value={eventId ?? ""}
          onChange={(e) => setEventId(e.target.value || null)}
          className="max-w-full rounded-lg border border-line bg-card px-2 py-1.5 text-sm"
          aria-label={tr.t("eventKicker")}
        >
          <option value="">{tr.t("eventNone")}</option>
          {EVENTS.map((e) => (
            <option key={e.id} value={e.id}>
              {tr.event(e.id).title}
            </option>
          ))}
        </select>
        <Button
          variant="warn"
          onClick={() => {
            const pool = EVENTS.filter((e) => e.id !== eventId);
            setEventId(pool[Math.floor(Math.random() * pool.length)].id);
          }}
        >
          {tr.t("eventRandom")}
        </Button>
      </div>
    </section>
  );
}
