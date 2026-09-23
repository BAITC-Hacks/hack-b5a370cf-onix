import { runAgent, type AgentMessage } from "@/lib/agent";
import { normalizeEventId, sanitizeDecisions } from "@/lib/engine";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const history: AgentMessage[] = Array.isArray(body?.messages)
    ? body.messages
        .filter((m: unknown): m is AgentMessage => !!m && typeof m === "object" && ((m as AgentMessage).role === "user" || (m as AgentMessage).role === "assistant") && typeof (m as AgentMessage).content === "string")
        .map((m: AgentMessage) => ({ role: m.role, content: m.content.slice(0, 2000) }))
    : [];
  if (!history.length || history[history.length - 1].role !== "user") return Response.json({ error: "Нужен вопрос пользователя" }, { status: 400 });
  const current = sanitizeDecisions(body?.decisions);
  const eventId = normalizeEventId(body?.eventId);
  return Response.json(await runAgent(history, current, eventId, body?.lang === "kz" ? "kz" : "ru"));
}
