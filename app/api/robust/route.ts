import { optimizeRobust } from "@/lib/engine";

export async function GET() {
  return Response.json({ plans: optimizeRobust(3) });
}
