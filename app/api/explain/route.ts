import { explain } from "@/lib/explain";
import { normalizeEventId, sanitizeDecisions, validate } from "@/lib/engine";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const decisions = sanitizeDecisions(body?.decisions);
  // Сервер не доверяет клиенту: набор проверяется заново перед анализом.
  const eventId = normalizeEventId(body?.eventId);
  const v = validate(decisions, eventId);
  if (!v.ok) return Response.json({ error: "Набор невалиден", reasons: v.errors }, { status: 400 });
  return Response.json(await explain(decisions, eventId, body?.lang === "kz" ? "kz" : "ru"));
}
