import { normalizeEventId, optimize } from "@/lib/engine";

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("event");
  const eventId = normalizeEventId(raw);
  if (raw && !eventId) return Response.json({ error: "Неизвестное событие" }, { status: 400 });
  return Response.json({ plans: optimize(5, eventId) });
}
