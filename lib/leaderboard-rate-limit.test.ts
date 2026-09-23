import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemorySubmissionLimiter, checkLeaderboardRateLimit } from "./leaderboard-rate-limit.ts";

test("local leaderboard submissions stop after 30 requests and reset after ten minutes", () => {
  let now = 0;
  const consume = createMemorySubmissionLimiter(() => now);
  for (let i = 0; i < 30; i++) assert.equal(consume().allowed, true);
  assert.deepEqual(consume(), { allowed: false, retryAfter: 600 });
  now = 600_000;
  assert.deepEqual(consume(), { allowed: true, retryAfter: 0 });
});

test("Redis leaderboard limit uses a hashed trusted IP and returns retry time", async () => {
  const originalUrl = process.env.UPSTASH_REDIS_REST_URL;
  const originalToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const originalVercel = process.env.VERCEL;
  const originalFetch = globalThis.fetch;
  const commands: unknown[][] = [];
  try {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
    process.env.VERCEL = "1";
    globalThis.fetch = async (_input, init) => {
      const command = JSON.parse(String(init?.body)) as unknown[];
      commands.push(command);
      return Response.json({ result: commands.length === 1 ? [1, 0] : [0, 42] });
    };
    const request = new Request("https://example.com/api/leaderboard", {
      headers: { "x-vercel-forwarded-for": "203.0.113.7" },
    });
    assert.equal(await checkLeaderboardRateLimit(request), null);
    const limited = await checkLeaderboardRateLimit(request);
    assert.equal(limited?.status, 429);
    assert.equal(limited?.headers.get("Retry-After"), "42");
    assert.equal(commands[0][0], "EVAL");
    assert.equal(commands[0][2], 1);
    assert.equal(commands[0][4], 30);
    assert.equal(commands[0][5], 600);
    assert.equal(String(commands[0][3]).includes("203.0.113.7"), false);
    assert.equal(commands[0][3], commands[1][3]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = originalUrl;
    if (originalToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = originalToken;
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
  }
});
