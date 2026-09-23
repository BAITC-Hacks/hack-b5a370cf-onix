import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { checkAiRateLimit, createMemoryRateLimiter } from "./ai-rate-limit.ts";

test("local AI quota limits each visitor and the whole demo, then expires", () => {
  let now = 0;
  const consume = createMemoryRateLimiter(() => now);
  const limits = [2, 3, 4];
  const windows = [600, 600, 86_400];
  const visitor = (id: string) => [`ip:${id}`, "global:10m", "global:day"];

  assert.equal(consume(visitor("a"), limits, windows).allowed, true);
  assert.equal(consume(visitor("a"), limits, windows).allowed, true);
  assert.deepEqual(consume(visitor("a"), limits, windows), { allowed: false, retryAfter: 600 });
  assert.equal(consume(visitor("b"), limits, windows).allowed, true);
  assert.deepEqual(consume(visitor("b"), limits, windows), { allowed: false, retryAfter: 600 });

  now = 600_001;
  assert.equal(consume(visitor("b"), limits, windows).allowed, true);
  assert.deepEqual(consume(visitor("b"), limits, windows), { allowed: false, retryAfter: 85_800 });

  now = 86_400_001;
  assert.equal(consume(visitor("b"), limits, windows).allowed, true);
});

test("Vercel refuses paid AI calls when Redis is not configured", async () => {
  const previous = {
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
    vercel: process.env.VERCEL,
  };
  const previousError = console.error;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.VERCEL = "1";
  console.error = () => {};
  try {
    const response = await checkAiRateLimit(new Request("https://example.test/api/agent"), "agent");
    assert.ok(response);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Retry-After"), "30");
  } finally {
    if (previous.url === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = previous.url;
    if (previous.token === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = previous.token;
    if (previous.vercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previous.vercel;
    console.error = previousError;
  }
});

test("Redis denial returns 429 and a retry interval without exposing the client IP", async () => {
  const previous = {
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
    vercel: process.env.VERCEL,
    fetch: globalThis.fetch,
  };
  process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
  process.env.VERCEL = "1";
  globalThis.fetch = async (_input, init) => {
    const command = JSON.parse(String(init?.body)) as unknown[];
    assert.equal(command[0], "EVAL");
    assert.equal(command[2], 3);
    assert.equal(JSON.stringify(command).includes("203.0.113.5"), false);
    assert.equal(command[3], `ai-limit:explain:ip:${createHash("sha256").update("203.0.113.5").digest("hex").slice(0, 32)}`);
    return Response.json({ result: [0, 42] });
  };
  try {
    const request = new Request("https://example.test/api/explain", {
      headers: { "x-vercel-forwarded-for": "203.0.113.5", "x-forwarded-for": "198.51.100.10" },
    });
    const response = await checkAiRateLimit(request, "explain");
    assert.ok(response);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("Retry-After"), "42");
  } finally {
    if (previous.url === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = previous.url;
    if (previous.token === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = previous.token;
    if (previous.vercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previous.vercel;
    globalThis.fetch = previous.fetch;
  }
});
