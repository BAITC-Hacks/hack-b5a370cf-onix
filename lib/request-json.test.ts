import assert from "node:assert/strict";
import test from "node:test";
import { readJsonBody } from "./request-json.ts";

function request(body: string, contentType = "application/json") {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  });
}

test("accepts a small JSON object", async () => {
  const result = await readJsonBody(request('{"messages":[]}'));
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, { messages: [] });
});

test("rejects malformed and non-object JSON", async () => {
  for (const body of ["{", "[]", "null"]) {
    const result = await readJsonBody(request(body));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.response.status, 400);
  }
});

test("rejects oversized body even without Content-Length", async () => {
  const result = await readJsonBody(request(JSON.stringify({ value: "x".repeat(33_000) })));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.response.status, 413);
});

test("applies a route-specific byte limit", async () => {
  const result = await readJsonBody(request(JSON.stringify({ value: "x".repeat(100) })), 64);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.response.status, 413);
});

test("rejects a non-JSON content type", async () => {
  const result = await readJsonBody(request("{}", "text/plain"));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.response.status, 415);
});
