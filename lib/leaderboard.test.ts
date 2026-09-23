import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const plan = [
  { measureId: "M7", districtId: "nura" },
  { measureId: "M8", districtId: "nura" },
  { measureId: "M10", districtId: "nura" },
  { measureId: "M12" },
  { measureId: "M5", districtId: "saryarka" },
];
const OWNER_A = "a1".repeat(32);
const OWNER_B = "b2".repeat(32);
const OWNER_HASH_A = createHash("sha256").update(OWNER_A).digest("hex");

test("ошибка записи рейтинга не блокирует следующую отправку; проваленный стресс-тест не имеет worst", async () => {
  const originalDir = process.cwd();
  const originalUrl = process.env.UPSTASH_REDIS_REST_URL;
  const originalToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const tempDir = await mkdtemp(path.join(tmpdir(), "akim-leaderboard-"));
  const file = path.join(tempDir, "data", "leaderboard.json");
  try {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    process.chdir(tempDir);
    await mkdir(file, { recursive: true }); // Вместо файла существует каталог: запись закономерно ошибётся.
    const moduleUrl = new URL("./leaderboard.ts", import.meta.url);
    moduleUrl.searchParams.set("isolated", tempDir);
    const { submitEntry, listEntries } = await import(moduleUrl.href) as typeof import("./leaderboard.ts");

    await assert.rejects(submitEntry({ team: "Onix", decisions: plan, ownerToken: OWNER_A }), { code: "EISDIR" });
    await rmdir(file);

    const result = await submitEntry({ team: "Onix", decisions: plan, ownerToken: OWNER_A });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.rank, 1);
    assert.ok(result.entry.failed > 0);
    assert.equal(result.entry.worst, null);
    assert.equal("ownerHash" in result.entry, false);
    const stolen = await submitEntry({ team: "ONIX", decisions: plan, ownerToken: OWNER_B });
    assert.equal(stolen.ok, false);
    if (!stolen.ok) assert.equal(stolen.code, "team_taken");
    const updated = await submitEntry({ team: "ONIX", decisions: plan, ownerToken: OWNER_A });
    assert.equal(updated.ok, true);
    const publicEntries = await listEntries();
    assert.equal(publicEntries[0].team, "ONIX");
    assert.equal("ownerHash" in publicEntries[0], false);
    const stored = JSON.parse(await readFile(file, "utf8"));
    assert.equal(stored.length, 1);
    assert.equal(stored[0].worst, null);
    assert.equal(stored[0].ownerHash, OWNER_HASH_A);
    assert.equal("ownerToken" in stored[0], false);
    const contenders = await Promise.all([
      submitEntry({ team: "Race", decisions: plan, ownerToken: OWNER_A }),
      submitEntry({ team: "Race", decisions: plan, ownerToken: OWNER_B }),
    ]);
    assert.equal(contenders.filter((outcome) => outcome.ok).length, 1);
    assert.equal(contenders.filter((outcome) => !outcome.ok && outcome.code === "team_taken").length, 1);
  } finally {
    process.chdir(originalDir);
    if (originalUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = originalUrl;
    if (originalToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = originalToken;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("legacy local entry remains reserved and its owner hash is never returned", async () => {
  const originalDir = process.cwd();
  const originalUrl = process.env.UPSTASH_REDIS_REST_URL;
  const originalToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const tempDir = await mkdtemp(path.join(tmpdir(), "akim-legacy-leaderboard-"));
  const file = path.join(tempDir, "data", "leaderboard.json");
  try {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    process.chdir(tempDir);
    await mkdir(path.dirname(file), { recursive: true });
    const legacy = { id: "old", team: "Onix", decisions: plan, eventId: null,
      score: 56.54, cost: 95, worst: null, failed: 1, createdAt: "2026-09-23T00:00:00.000Z" };
    const historicalEvent = { ...legacy, id: "old-event", team: "Event Team", eventId: "heating" };
    await writeFile(file, JSON.stringify([legacy, historicalEvent]));
    const moduleUrl = new URL("./leaderboard.ts", import.meta.url);
    moduleUrl.searchParams.set("legacy-test", tempDir);
    const { submitEntry, listEntries } = await import(moduleUrl.href) as typeof import("./leaderboard.ts");
    const rejected = await submitEntry({ team: "ONIX", decisions: plan, ownerToken: OWNER_A });
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.equal(rejected.code, "team_taken");
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), [legacy, historicalEvent]);
    assert.deepEqual(await listEntries(), [legacy]);
    const newTeam = await submitEntry({ team: "New Team", decisions: plan, ownerToken: OWNER_A });
    assert.equal(newTeam.ok, true);
    assert.equal(JSON.parse(await readFile(file, "utf8")).some((e: { id: string }) => e.id === "old-event"), true);
    assert.equal((await listEntries()).some((e) => e.id === "old-event"), false);
  } finally {
    process.chdir(originalDir);
    if (originalUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = originalUrl;
    if (originalToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = originalToken;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("a plan below the top 500 does not claim a team name or rewrite the file", async () => {
  const originalDir = process.cwd();
  const originalUrl = process.env.UPSTASH_REDIS_REST_URL;
  const originalToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const tempDir = await mkdtemp(path.join(tmpdir(), "akim-full-leaderboard-"));
  const file = path.join(tempDir, "data", "leaderboard.json");
  try {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    process.chdir(tempDir);
    await mkdir(path.dirname(file), { recursive: true });
    const rows = Array.from({ length: 500 }, (_, i) => ({
      id: `high-${i}`, team: `High ${i}`, decisions: plan, eventId: null,
      score: 1000 + i, cost: 90, worst: null, failed: 1, createdAt: "2026-09-23T00:00:00.000Z",
    }));
    const original = JSON.stringify(rows);
    await writeFile(file, original);
    const moduleUrl = new URL("./leaderboard.ts", import.meta.url);
    moduleUrl.searchParams.set("full-test", tempDir);
    const { submitEntry } = await import(moduleUrl.href) as typeof import("./leaderboard.ts");
    const outcome = await submitEntry({ team: "Below", decisions: plan, ownerToken: OWNER_A });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.code, "not_ranked");
    assert.equal(await readFile(file, "utf8"), original);
  } finally {
    process.chdir(originalDir);
    if (originalUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = originalUrl;
    if (originalToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = originalToken;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("corrupt local leaderboard is not silently reset by a submission", async () => {
  const originalDir = process.cwd();
  const originalUrl = process.env.UPSTASH_REDIS_REST_URL;
  const originalToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const tempDir = await mkdtemp(path.join(tmpdir(), "akim-corrupt-leaderboard-"));
  const file = path.join(tempDir, "data", "leaderboard.json");
  try {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    process.chdir(tempDir);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "{broken");
    const moduleUrl = new URL("./leaderboard.ts", import.meta.url);
    moduleUrl.searchParams.set("corrupt-test", tempDir);
    const { submitEntry } = await import(moduleUrl.href) as typeof import("./leaderboard.ts");
    await assert.rejects(submitEntry({ team: "Onix", decisions: plan, ownerToken: OWNER_A }), SyntaxError);
    assert.equal(await readFile(file, "utf8"), "{broken");
  } finally {
    process.chdir(originalDir);
    if (originalUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = originalUrl;
    if (originalToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = originalToken;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("Upstash REST stores one row per team and does not poison later writes after an error", async () => {
  const originalUrl = process.env.UPSTASH_REDIS_REST_URL;
  const originalToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const originalFetch = globalThis.fetch;
  const commands: unknown[][] = [];
  let stored: string | null = null;
  let failNextWrite = true;
  try {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io/";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
    globalThis.fetch = async (input, init) => {
      assert.equal(input, "https://example.upstash.io");
      assert.equal(init?.method, "POST");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-token");
      assert.equal(new Headers(init?.headers).get("content-type"), "application/json");
      const command = JSON.parse(String(init?.body)) as unknown[];
      commands.push(command);
      if (command[0] === "GET") return Response.json({ result: stored });
      assert.equal(command[0], "EVAL");
      assert.equal(command[2], 1);
      assert.equal(command[3], "akim:leaderboard:v1");
      assert.equal(command[6], 500);
      if (failNextWrite) {
        failNextWrite = false;
        return Response.json({ error: "temporary failure" });
      }
      const entry = JSON.parse(String(command[5]));
      const prior = stored ? JSON.parse(stored) as Array<Record<string, unknown>> : [];
      if (prior.some((row) => row.eventId === null && typeof row.teamKey !== "string"))
        return Response.json({ result: -2 });
      if (command[4] === "below") return Response.json({ result: 0 });
      const previous = prior.find((row) => row.teamKey === command[4]);
      if (previous && previous.ownerHash !== command[7]) return Response.json({ result: -1 });
      const kept = prior.filter((row) => row.teamKey !== command[4]);
      kept.push({ ...entry, teamKey: command[4] });
      stored = JSON.stringify(kept);
      return Response.json({ result: 1 });
    };

    const moduleUrl = new URL("./leaderboard.ts", import.meta.url);
    moduleUrl.searchParams.set("redis-test", String(Date.now()));
    const { submitEntry, listEntries } = await import(moduleUrl.href) as typeof import("./leaderboard.ts");

    await assert.rejects(submitEntry({ team: "Onix", decisions: plan, ownerToken: OWNER_A }), /Upstash Redis command failed/);
    const first = await submitEntry({ team: "Onix", decisions: plan, ownerToken: OWNER_A });
    assert.equal(first.ok, true);
    const second = await submitEntry({ team: "ONIX", decisions: plan, ownerToken: OWNER_A });
    assert.equal(second.ok, true);
    const stolen = await submitEntry({ team: "onix", decisions: plan, ownerToken: OWNER_B });
    assert.equal(stolen.ok, false);
    if (!stolen.ok) assert.equal(stolen.code, "team_taken");
    assert.deepEqual(commands.filter((command) => command[0] === "EVAL").map((command) => command[4]), ["onix", "onix", "onix", "onix"]);
    const listed = await listEntries();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].team, "ONIX");
    assert.equal("teamKey" in listed[0], false);
    assert.equal("ownerHash" in listed[0], false);
    assert.equal("ownerHash" in first, false);
    assert.equal(JSON.parse(String(stored))[0].ownerHash, OWNER_HASH_A);
    assert.deepEqual(commands.at(-1)?.slice(0, 2), ["GET", "akim:leaderboard:v1"]);

    const baselineOnly = await submitEntry({ team: "Crisis", decisions: plan, eventId: "heating", ownerToken: OWNER_A });
    assert.equal(baselineOnly.ok, false);
    if (!baselineOnly.ok) assert.equal(baselineOnly.code, "baseline_only");

    const legacy = { ...JSON.parse(String(stored))[0], id: "legacy", team: "Legacy", teamKey: "legacy" };
    delete legacy.ownerHash;
    stored = JSON.stringify([legacy]);
    const legacyConflict = await submitEntry({ team: "Legacy", decisions: plan, ownerToken: OWNER_A });
    assert.equal(legacyConflict.ok, false);
    if (!legacyConflict.ok) assert.equal(legacyConflict.code, "team_taken");
    assert.equal(JSON.parse(String(stored))[0].id, "legacy");

    const missingKey = { ...legacy };
    delete missingKey.teamKey;
    stored = JSON.stringify([missingKey]);
    await assert.rejects(submitEntry({ team: "Different", decisions: plan, ownerToken: OWNER_A }), /migration/);
    assert.equal(JSON.parse(String(stored))[0].id, "legacy");

    const base = JSON.parse(String(stored))[0];
    stored = JSON.stringify(Array.from({ length: 501 }, (_, i) => ({
      ...base, id: `team-${i}`, team: `Team ${i}`, teamKey: `team ${i}`, score: i,
    })));
    const top = await listEntries();
    assert.equal(top.length, 500);
    assert.equal(top[0].score, 500);
    assert.equal(top.at(-1)?.score, 1);
    const tooLow = await submitEntry({ team: "Below", decisions: plan, ownerToken: OWNER_A });
    assert.equal(tooLow.ok, false);
    if (!tooLow.ok) assert.equal(tooLow.code, "not_ranked");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = originalUrl;
    if (originalToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = originalToken;
  }
});

test("Vercel deployment requires both Redis credentials instead of writing to a temporary file", async () => {
  const originalVercel = process.env.VERCEL;
  const originalUrl = process.env.UPSTASH_REDIS_REST_URL;
  const originalToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  try {
    process.env.VERCEL = "1";
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const moduleUrl = new URL("./leaderboard.ts", import.meta.url);
    moduleUrl.searchParams.set("vercel-test", String(Date.now()));
    const { listEntries } = await import(moduleUrl.href) as typeof import("./leaderboard.ts");
    await assert.rejects(listEntries(), /requires Upstash Redis on Vercel/);

    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    await assert.rejects(listEntries(), /Both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN/);
  } finally {
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
    if (originalUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = originalUrl;
    if (originalToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = originalToken;
  }
});
