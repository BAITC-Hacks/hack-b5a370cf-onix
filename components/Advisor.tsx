"use client";

import { useRef, useState } from "react";
import type { Decision } from "@/lib/engine";
import type { AgentReply } from "@/lib/agent";
import { useApp } from "./AppState";
import { Button, StatusBadge } from "./ui";

interface ChatItem {
  role: "user" | "assistant";
  content: string;
  reply?: AgentReply;
}

const TOOL_KZ: Record<string, string> = {
  Симуляция: "Симуляция",
  "Перебор планов": "Жоспарларды іріктеу",
  Предложение: "Ұсыныс",
  "Предложение отклонено валидатором": "Ұсынысты валидатор қабылдамады",
  "Стресс-тест": "Стресс-тест",
  "Поиск устойчивого плана": "Тұрақты жоспарды іздеу",
};

/** Чат с AI-советником: агент вызывает инструменты движка и предлагает план, который применяется одной кнопкой. */
export function Advisor({ decisions, eventId, onApply }: { decisions: Decision[]; eventId: string | null; onApply: (d: Decision[]) => void }) {
  const { tr, lang } = useApp();
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || loading) return;
    const next: ChatItem[] = [...items, { role: "user", content: q }];
    setItems(next);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })), decisions, eventId, lang }),
      });
      const data: AgentReply & { error?: string } = await res.json();
      setItems([...next, { role: "assistant", content: data.reply ?? data.error ?? "Ошибка", reply: data }]);
    } catch (e) {
      setItems([...next, { role: "assistant", content: `Ошибка сети: ${e instanceof Error ? e.message : e}` }]);
    } finally {
      setLoading(false);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
    }
  };

  return (
    <div>
      {items.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {tr.suggestions.map((s) => (
            <button key={s} onClick={() => ask(s)} className="rounded-full border border-line bg-card-2 px-3 py-1.5 text-left text-sm text-ink-2 hover:border-accent hover:text-ink">
              {s}
            </button>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div className="max-h-[560px] space-y-4 overflow-y-auto pr-1">
          {items.map((it, i) =>
            it.role === "user" ? (
              <div key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-accent px-4 py-2 text-sm text-white">
                {it.content}
              </div>
            ) : (
              <div key={i} className="max-w-[92%] space-y-2">
                {it.reply?.steps?.length ? (
                  <ol className="space-y-1 border-l-2 border-line pl-3 text-xs text-ink-2">
                    {it.reply.steps.map((s, j) => (
                      <li key={j}>
                        <span className="font-semibold text-ink">⚙ {lang === "kz" ? (TOOL_KZ[s.tool] ?? s.tool) : s.tool}:</span> {s.summary}
                      </li>
                    ))}
                  </ol>
                ) : null}
                <div className="rounded-2xl rounded-bl-sm bg-card-2 px-4 py-2.5 text-sm leading-relaxed">{it.content}</div>
                <div className="flex flex-wrap gap-2">
                  {it.reply?.model && <StatusBadge kind="info">{tr.t("agent")} · {it.reply.model}</StatusBadge>}
                  {it.reply?.unverifiedNumbers && it.reply.unverifiedNumbers.length === 0 && <StatusBadge kind="good">{tr.t("verified")}</StatusBadge>}
                  {it.reply?.unverifiedNumbers && it.reply.unverifiedNumbers.length > 0 && (
                    <StatusBadge kind="crit">{tr.t("notFromCalc")}: {it.reply.unverifiedNumbers.join(", ")}</StatusBadge>
                  )}
                  {it.reply?.error && it.reply.error !== "no-key" && <StatusBadge kind="warn">{it.reply.error === "llm_unverified" ? tr.t("llmUnverified") : it.reply.error.slice(0, 80)}</StatusBadge>}
                </div>
                {it.reply?.proposal && (
                  <div className="rounded-xl border border-accent bg-card p-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{tr.t("proposed")}</span>
                      <span className="font-bold text-accent-strong">Score {it.reply.proposal.score.toFixed(2)}</span>
                      <span className="text-xs text-ink-3">{tr.t("cost")} {it.reply.proposal.cost}</span>
                      <Button variant="primary" onClick={() => onApply(it.reply!.proposal!.decisions)} className="ml-auto px-2.5 py-1 text-xs">
                        {tr.t("apply")}
                      </Button>
                    </div>
                    <div className="mt-1 text-xs text-ink-2">
                      {it.reply.proposal.decisions.map((d) => `${d.measureId} ${tr.district(d.districtId)}`).join(" · ")}
                    </div>
                  </div>
                )}
              </div>
            ),
          )}
          {loading && (
            <div className="flex items-center gap-2 text-sm text-ink-3">
              <span className="inline-block size-2 animate-pulse rounded-full bg-accent" /> {tr.t("agentThinking")}
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="mt-4 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={tr.t("advisorPlaceholder")}
          className="min-w-0 flex-1 rounded-lg border border-line bg-card px-3 py-2 text-sm outline-none focus:border-accent"
          aria-label={tr.t("advisorTitle")}
        />
        <Button variant="primary" disabled={loading || !input.trim()} className="px-4">
          {tr.t("ask")}
        </Button>
        {items.length > 0 && (
          <Button variant="ghost" onClick={() => setItems([])} disabled={loading}>
            {tr.t("clear")}
          </Button>
        )}
      </form>
    </div>
  );
}
