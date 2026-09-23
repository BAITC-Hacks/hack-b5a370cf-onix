import { runAgent, type AgentMessage } from "@/lib/agent";
import { checkAiRateLimit } from "@/lib/ai-rate-limit";
import { normalizeEventId, sanitizeDecisions } from "@/lib/engine";
import { readJsonBody } from "@/lib/request-json";

export const maxDuration = 60;

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value;
  const history: AgentMessage[] = [];
  if (Array.isArray(body.messages)) {
    // Keep the recent conversation bounded before sending it to a paid model.
    for (let i = body.messages.length - 1; i >= 0 && history.length < 12; i--) {
      const m: unknown = body.messages[i];
      if (!m || typeof m !== "object") continue;
      const message = m as AgentMessage;
      if ((message.role !== "user" && message.role !== "assistant") || typeof message.content !== "string") continue;
      history.push({ role: message.role, content: message.content.slice(0, 2000) });
    }
    history.reverse();
  }
  if (!history.length || history[history.length - 1].role !== "user") return Response.json({ error: "Нужен вопрос пользователя" }, { status: 400 });
  const current = sanitizeDecisions(body.decisions);
  const eventId = normalizeEventId(body.eventId);
  const limited = await checkAiRateLimit(request, "agent");
  if (limited) return limited;
  return Response.json(await runAgent(history, current, eventId, body.lang === "kz" ? "kz" : "ru"));
}
