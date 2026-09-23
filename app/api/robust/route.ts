import { optimizeRobust } from "@/lib/engine";

const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" };

export async function GET() {
  return Response.json({ plans: optimizeRobust(3) }, { headers: CACHE_HEADERS });
}
