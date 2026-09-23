import { runAgent, type AgentMessage } from "@/lib/agent";
import type { Decision } from "@/lib/engine";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const history: AgentMessage[] = Array.isArray(body?.messages)
    ? body.messages
        .filter((m: AgentMessage) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .map((m: AgentMessage) => ({ role: m.role, content: m.content.slice(0, 2000) }))
    : [];
  if (!history.length || history[history.length - 1].role !== "user") return Response.json({ error: "Нужен вопрос пользователя" }, { status: 400 });
  const current: Decision[] = Array.isArray(body?.decisions) ? body.decisions.slice(0, 5) : [];
  const eventId: string | null = typeof body?.eventId === "string" ? body.eventId : null;
  return Response.json(await runAgent(history, current, eventId, body?.lang === "kz" ? "kz" : "ru"));
}
