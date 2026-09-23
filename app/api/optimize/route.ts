import { optimize } from "@/lib/engine";

export async function GET() {
  return Response.json({ plans: optimize(5) });
}
