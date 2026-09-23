import { explain } from "@/lib/explain";
import { checkAiRateLimit } from "@/lib/ai-rate-limit";
import { normalizeEventId, sanitizeDecisions, validate } from "@/lib/engine";
import { readJsonBody } from "@/lib/request-json";

export const maxDuration = 60;

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value;
  const decisions = sanitizeDecisions(body.decisions);
  // Сервер не доверяет клиенту: набор проверяется заново перед анализом.
  const eventId = normalizeEventId(body.eventId);
  const v = validate(decisions, eventId);
  if (!v.ok) return Response.json({ error: "Набор невалиден", reasons: v.errors }, { status: 400 });
  const limited = await checkAiRateLimit(request, "explain");
  if (limited) return limited;
  return Response.json(await explain(decisions, eventId, body.lang === "kz" ? "kz" : "ru"));
}
