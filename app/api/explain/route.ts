import { explain } from "@/lib/explain";
import { validate, type Decision } from "@/lib/engine";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const decisions: Decision[] = Array.isArray(body?.decisions) ? body.decisions : [];
  // Сервер не доверяет клиенту: набор проверяется заново перед анализом.
  const v = validate(decisions);
  if (!v.ok) return Response.json({ error: "Набор невалиден", reasons: v.errors }, { status: 400 });
  return Response.json(await explain(decisions));
}
