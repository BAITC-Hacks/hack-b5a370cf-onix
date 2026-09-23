import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { hasUpstash, upstashCommand } from "./upstash.ts";

const LIMIT = 30;
const WINDOW_SECONDS = 600;
const SCRIPT = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count >= tonumber(ARGV[1]) then
  local ttl = redis.call('TTL', KEYS[1])
  if ttl < 1 then ttl = tonumber(ARGV[2]) end
  return {0, ttl}
end
count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2])) end
return {1, 0}
`;

type Quota = { allowed: boolean; retryAfter: number };

// Local development has one small, bounded counter. A public Vercel deployment
// uses its trusted client-IP header and a shared Redis counter instead.
export function createMemorySubmissionLimiter(now = Date.now) {
  let count = 0;
  let expiresAt = 0;
  return (): Quota => {
    const time = now();
    if (time >= expiresAt) {
      count = 0;
      expiresAt = time + WINDOW_SECONDS * 1000;
    }
    if (count >= LIMIT) return { allowed: false, retryAfter: Math.max(1, Math.ceil((expiresAt - time) / 1000)) };
    count++;
    return { allowed: true, retryAfter: 0 };
  };
}

const consumeLocal = createMemorySubmissionLimiter();

async function consume(request: Request): Promise<Quota> {
  if (!hasUpstash()) {
    if (process.env.VERCEL === "1") throw new Error("Redis required on Vercel");
    return consumeLocal();
  }
  const forwarded = process.env.VERCEL === "1" ? request.headers.get("x-vercel-forwarded-for") : null;
  const ip = forwarded?.split(",", 1)[0]?.trim() ?? "";
  // Without a trusted proxy, share one quota rather than trust a spoofable header.
  const identity = isIP(ip) ? ip : "unknown";
  const key = `leaderboard-limit:${createHash("sha256").update(identity).digest("hex").slice(0, 32)}`;
  const result = await upstashCommand<unknown>(["EVAL", SCRIPT, 1, key, LIMIT, WINDOW_SECONDS]);
  if (!Array.isArray(result) || result.length !== 2 || (result[0] !== 0 && result[0] !== 1) ||
      typeof result[1] !== "number" || !Number.isFinite(result[1])) throw new Error("Invalid Redis rate limit response");
  return { allowed: result[0] === 1, retryAfter: Math.max(1, Math.ceil(result[1])) };
}

export async function checkLeaderboardRateLimit(request: Request): Promise<Response | null> {
  let quota: Quota;
  try {
    quota = await consume(request);
  } catch {
    return Response.json({ code: "unavailable", error: "Рейтинг временно недоступен." }, {
      status: 503, headers: { "Retry-After": "30", "Cache-Control": "no-store" },
    });
  }
  if (quota.allowed) return null;
  return Response.json({ code: "rate_limited", error: "Слишком много отправок. Попробуйте позже." }, {
    status: 429,
    headers: { "Retry-After": String(quota.retryAfter), "Cache-Control": "no-store" },
  });
}
