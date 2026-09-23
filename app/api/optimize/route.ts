import { normalizeEventId, optimize } from "@/lib/engine";

const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" };

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("event");
  const eventId = normalizeEventId(raw);
  if (raw && !eventId) return Response.json({ error: "Неизвестное событие" }, { status: 400 });
  return Response.json({ plans: optimize(5, eventId) }, { headers: CACHE_HEADERS });
}
