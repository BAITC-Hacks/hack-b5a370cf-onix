import type { Explanation } from "@/lib/explain";
import { StatusBadge } from "./ui";

export function ExplanationView({ e }: { e: Explanation }) {
  const sections: [string, string[], string][] = [
    ["Сильные стороны", e.strengths, "border-good"],
    ["Риски и последствия", e.risks, "border-crit"],
    ["Компромиссы", e.tradeoffs, "border-warn"],
    ["Рекомендации", e.recommendations, "border-accent"],
  ];
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap gap-2">
        <StatusBadge kind="info">{e.source === "fallback" ? "Шаблонный аналитик (без LLM)" : `LLM · ${e.model}`}</StatusBadge>
        {e.error && <StatusBadge kind="warn">LLM недоступен, показан шаблон</StatusBadge>}
        {e.unverifiedNumbers && e.unverifiedNumbers.length > 0 && <StatusBadge kind="crit">Числа не из расчёта: {e.unverifiedNumbers.join(", ")}</StatusBadge>}
        {e.source !== "fallback" && e.unverifiedNumbers && e.unverifiedNumbers.length === 0 && <StatusBadge kind="good">Все числа сверены с движком</StatusBadge>}
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
