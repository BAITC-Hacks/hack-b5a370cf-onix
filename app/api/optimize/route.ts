import { optimize } from "@/lib/engine";

export async function GET(request: Request) {
  const eventId = new URL(request.url).searchParams.get("event");
  return Response.json({ plans: optimize(5, eventId) });
}
