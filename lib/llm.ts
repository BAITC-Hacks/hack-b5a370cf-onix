// Единый выбор LLM-провайдера для анализа, советника и health-check.
export type ProviderName = "openai" | "anthropic";

/** Приоритет: LLM_PROVIDER (если для него есть ключ), иначе Anthropic при наличии ключа, иначе OpenAI, иначе null. */
export function activeProvider(): { name: ProviderName; model: string } | null {
  const hasA = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasO = Boolean(process.env.OPENAI_API_KEY);
  const pref = process.env.LLM_PROVIDER;
  const anthropic = { name: "anthropic" as const, model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5" };
  const openai = { name: "openai" as const, model: process.env.OPENAI_MODEL || "gpt-4.1-mini" };
  if (pref === "openai" && hasO) return openai;
  if (pref === "anthropic" && hasA) return anthropic;
  if (hasA) return anthropic;
  if (hasO) return openai;
  return null;
}

/** Клиенту уходит только категория ошибки; полный текст — в лог сервера. */
export function publicError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[llm]", msg);
  if (/abort/i.test(msg)) return "llm_timeout";
  const m = msg.match(/API (\d{3})/);
  return m ? `llm_http_${m[1]}` : "llm_unavailable";
}
