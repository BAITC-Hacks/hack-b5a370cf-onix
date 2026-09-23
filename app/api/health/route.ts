import { BASE_SCORE, optimize } from "@/lib/engine";
import { EVENTS, MEASURES, DISTRICTS } from "@/lib/data";

/** Проверка окружения для экспертов: движок, ключи LLM, доступность подложки карты. */
export async function GET() {
  const tilesOk = await fetch("https://tiles.openfreemap.org/styles/liberty", { method: "HEAD", signal: AbortSignal.timeout(3000) })
    .then((r) => r.ok)
    .catch(() => false);
  return Response.json({
    ok: true,
    version: process.env.npm_package_version ?? "0.1.0",
    engine: { baseScore: Math.round(BASE_SCORE * 100) / 100, optimum: optimize(1)[0]?.score, measures: MEASURES.length, districts: DISTRICTS.length, events: EVENTS.length },
    llm: { openai: Boolean(process.env.OPENAI_API_KEY), anthropic: Boolean(process.env.ANTHROPIC_API_KEY), model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini" },
    map: { tilesOnline: tilesOk, districtsGeojson: "/data/astana-districts.geojson" },
  });
}
