import { listEntries, submitEntry } from "@/lib/leaderboard";

export async function GET() {
  return Response.json({ entries: (await listEntries()).slice(0, 100) });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const result = await submitEntry(body ?? {});
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
