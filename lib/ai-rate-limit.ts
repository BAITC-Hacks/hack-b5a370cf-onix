import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { hasUpstash, upstashCommand } from "./upstash.ts";

type AiEndpoint = "agent" | "explain";
type QuotaResult = { allowed: boolean; retryAfter: number };
type Counter = { count: number; expiresAt: number };

// One request can make several LLM calls, so cap both individual visitors and
// the public demo as a whole. Redis counters expire relative to the first call.
const limits: Record<AiEndpoint, readonly number[]> = {
  agent: [5, 40, 200],
  explain: [20, 120, 1000],
};
const windows = [600, 600, 86_400] as const;

const consumeScript = `
local retry = 0
for i = 1, #KEYS do
  local count = tonumber(redis.call("GET", KEYS[i]) or "0")
  if count >= tonumber(ARGV[i]) then
    local ttl = redis.call("TTL", KEYS[i])
    if ttl < 1 then ttl = tonumber(ARGV[#KEYS + i]) end
    if ttl > retry then retry = ttl end
  end
end
if retry > 0 then return {0, retry} end
for i = 1, #KEYS do
  local count = redis.call("INCR", KEYS[i])
  if count == 1 then redis.call("EXPIRE", KEYS[i], tonumber(ARGV[#KEYS + i])) end
end
return {1, 0}
`;

function clientId(request: Request): string {
  // Only Vercel's own header is trusted. A caller can spoof x-forwarded-for.
  const forwarded = process.env.VERCEL === "1" ? request.headers.get("x-vercel-forwarded-for") : null;
  const ip = forwarded?.split(",", 1)[0]?.trim() ?? "";
  const safeIp = isIP(ip) ? ip : "unknown";
  return createHash("sha256").update(safeIp).digest("hex").slice(0, 32);
}

function quotaKeys(request: Request, endpoint: AiEndpoint): string[] {
  return [
    `ai-limit:${endpoint}:ip:${clientId(request)}`,
    `ai-limit:${endpoint}:global-10m`,
    `ai-limit:${endpoint}:global-day`,
  ];
}

// Local development fallback; each process has its own counters by design.
export function createMemoryRateLimiter(now = Date.now) {
  const counters = new Map<string, Counter>();
  let checks = 0;
  return (keys: readonly string[], allowedCounts: readonly number[], ttlSeconds: readonly number[]): QuotaResult => {
    const time = now();
    if (++checks % 128 === 0) {
      for (const [key, counter] of counters) {
        if (counter.expiresAt <= time) counters.delete(key);
      }
    }
    let retryAfter = 0;
    for (let i = 0; i < keys.length; i++) {
      const counter = counters.get(keys[i]);
      if (counter && counter.expiresAt > time && counter.count >= allowedCounts[i]) {
        retryAfter = Math.max(retryAfter, Math.ceil((counter.expiresAt - time) / 1000));
      }
    }
    if (retryAfter) return { allowed: false, retryAfter };
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const counter = counters.get(key);
      counters.set(key, counter && counter.expiresAt > time
        ? { ...counter, count: counter.count + 1 }
        : { count: 1, expiresAt: time + ttlSeconds[i] * 1000 });
    }
    return { allowed: true, retryAfter: 0 };
  };
}

const consumeInMemory = createMemoryRateLimiter();

async function consumeQuota(request: Request, endpoint: AiEndpoint): Promise<QuotaResult> {
  const keys = quotaKeys(request, endpoint);
  const allowedCounts = limits[endpoint];
  if (!hasUpstash()) {
    // Serverless instances do not share memory. Never leave paid routes open on
    // Vercel when the Redis credentials are missing.
    // AKIM_DEMO_MODE=1 — осознанный режим демо на хакатоне: лимиты в памяти каждого инстанса вместо Redis.
    if ((process.env.VERCEL || process.env.VERCEL_ENV) && process.env.AKIM_DEMO_MODE !== "1") throw new Error("Redis required on Vercel");
    return consumeInMemory(keys, allowedCounts, windows);
  }
  const result = await upstashCommand<unknown>([
    "EVAL", consumeScript, keys.length, ...keys, ...allowedCounts, ...windows,
  ]);
  if (!Array.isArray(result) || result.length !== 2 ||
      (result[0] !== 0 && result[0] !== 1) ||
      typeof result[1] !== "number" || !Number.isFinite(result[1])) {
    throw new Error("Invalid Redis rate limit response");
  }
  return { allowed: result[0] === 1, retryAfter: Math.max(1, Math.ceil(result[1])) };
}

export async function checkAiRateLimit(request: Request, endpoint: AiEndpoint): Promise<Response | null> {
  let quota: QuotaResult;
  try {
    quota = await consumeQuota(request, endpoint);
  } catch {
    // Failing closed prevents a Redis outage or misconfiguration from
    // accidentally sending unbounded requests to the paid LLM provider.
    console.error(`AI rate limit unavailable for ${endpoint}`);
    return Response.json({ error: "AI временно недоступен. Попробуйте позже." }, {
      status: 503,
      headers: { "Retry-After": "30", "Cache-Control": "no-store" },
    });
  }
  if (quota.allowed) return null;
  return Response.json({ error: "Слишком много запросов к AI. Попробуйте позже." }, {
    status: 429,
    headers: { "Retry-After": String(quota.retryAfter), "Cache-Control": "no-store" },
  });
}
