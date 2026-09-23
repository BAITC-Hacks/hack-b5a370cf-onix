import { BASE_SCORE, optimize } from "@/lib/engine";
import { EVENTS, MEASURES, DISTRICTS } from "@/lib/data";
import { activeProvider } from "@/lib/llm";

let cachedTiles: { ok: boolean; expiresAt: number } | null = null;
let tileProbe: Promise<boolean> | null = null;

function tilesOnline(): Promise<boolean> {
  if (cachedTiles && cachedTiles.expiresAt > Date.now()) return Promise.resolve(cachedTiles.ok);
  if (!tileProbe) {
    tileProbe = fetch("https://tiles.openfreemap.org/styles/liberty", { method: "HEAD", signal: AbortSignal.timeout(3000) })
      .then((r) => r.ok)
      .catch(() => false)
      .then((ok) => {
        cachedTiles = { ok, expiresAt: Date.now() + 60_000 };
        return ok;
      })
      .finally(() => { tileProbe = null; });
  }
  return tileProbe;
}

/** Проверка окружения для экспертов: движок, ключи LLM, доступность подложки карты. */
export async function GET() {
  const tilesOk = await tilesOnline();
  return Response.json({
    ok: true,
    version: process.env.npm_package_version ?? "0.1.0",
    engine: { baseScore: Math.round(BASE_SCORE * 100) / 100, optimum: optimize(1)[0]?.score, measures: MEASURES.length, districts: DISTRICTS.length, events: EVENTS.length },
    llm: { openai: Boolean(process.env.OPENAI_API_KEY), anthropic: Boolean(process.env.ANTHROPIC_API_KEY), active: activeProvider() ?? { name: "fallback", model: "шаблонный аналитик" } },
    map: { tilesOnline: tilesOk, districtsGeojson: "/data/astana-districts.geojson" },
  });
}
