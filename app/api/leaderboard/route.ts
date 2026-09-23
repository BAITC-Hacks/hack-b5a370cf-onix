import { listEntries, submitEntry } from "@/lib/leaderboard";
import { checkLeaderboardRateLimit } from "@/lib/leaderboard-rate-limit";
import { readJsonBody } from "@/lib/request-json";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    return Response.json({ entries: (await listEntries()).slice(0, 100) }, { headers: NO_STORE });
  } catch {
    return Response.json({ error: "Рейтинг временно недоступен." }, { status: 503, headers: NO_STORE });
  }
}

export async function POST(request: Request) {
  const parsed = await readJsonBody(request, 16_384);
  if (!parsed.ok) {
    parsed.response.headers.set("Cache-Control", "no-store");
    return parsed.response;
  }
  const limited = await checkLeaderboardRateLimit(request);
  if (limited) return limited;
  try {
    const result = await submitEntry(parsed.value);
    return Response.json(result, { status: result.ok ? 200 : result.code === "team_taken" ? 409 : result.code === "not_ranked" ? 422 : 400, headers: NO_STORE });
  } catch {
    return Response.json({ error: "Рейтинг временно недоступен." }, { status: 503, headers: NO_STORE });
  }
}
