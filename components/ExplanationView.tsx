"use client";

import type { Explanation } from "@/lib/explain";
import { useApp } from "./AppState";
import { StatusBadge } from "./ui";

export function ExplanationView({ e }: { e: Explanation }) {
  const { tr } = useApp();
  const sections: [string, string[], string][] = [
    [tr.t("strengths"), e.strengths, "border-good"],
    [tr.t("risks"), e.risks, "border-crit"],
    [tr.t("tradeoffs"), e.tradeoffs, "border-warn"],
    [tr.t("recommendations"), e.recommendations, "border-accent"],
  ];
  const unverifiedNumbers = e.unverifiedNumbers ?? [];
  const unverifiedClaims = e.unverifiedClaims ?? [];
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap gap-2">
        <StatusBadge kind="info">{e.source === "fallback" ? tr.t("srcFallback") : `LLM · ${e.model}`}</StatusBadge>
        {e.error && <StatusBadge kind="warn">{e.error === "llm_unverified" ? tr.t("llmUnverified") : tr.t("llmDown")}</StatusBadge>}
        {unverifiedNumbers.length > 0 && <StatusBadge kind="crit">{tr.t("notFromCalc")}: {unverifiedNumbers.join(", ")}</StatusBadge>}
        {unverifiedClaims.length > 0 && <StatusBadge kind="crit">{tr.t("notFromCalcClaims")}: {unverifiedClaims.join("; ")}</StatusBadge>}
        {e.source !== "fallback" && e.unverifiedNumbers && e.unverifiedClaims && unverifiedNumbers.length === 0 && unverifiedClaims.length === 0 && <StatusBadge kind="good">{tr.t("verified")}</StatusBadge>}
      </div>
      <p className="text-base leading-relaxed">{e.summary}</p>
      <div className="grid gap-4 md:grid-cols-2">
        {sections.map(([title, items, border]) =>
          items.length ? (
            <div key={title} className={`border-l-2 pl-3 ${border}`}>
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-2">{title}</div>
              <ul className="mt-1.5 space-y-1.5">
                {items.map((it, i) => (
                  <li key={i} className="leading-snug">
                    {it}
                  </li>
                ))}
              </ul>
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
}
