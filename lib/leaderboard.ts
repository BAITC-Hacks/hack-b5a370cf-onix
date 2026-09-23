// Общий рейтинг команд: Upstash в деплое, локальный файл без Redis. Score считает движок, а не клиент.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { robustness, sanitizeDecisions, simulate, validate, type Decision } from "./engine.ts";
import { hasUpstash, upstashCommand } from "./upstash.ts";

export interface LeaderboardEntry {
  id: string;
  team: string;
  decisions: Decision[];
  eventId: string | null;
  score: number;
  cost: number;
  /** Худший Score по всем сценариям стресс-теста (null, если план где-то невыполним). */
  worst: number | null;
  failed: number;
  createdAt: string;
}

// Never return these fields to the browser. Legacy rows have no ownerHash and
// remain reserved until an administrator deliberately migrates them.
type StoredEntry = LeaderboardEntry & { ownerHash?: string; teamKey?: string };
type SubmitFailure = { ok: false; code: "invalid_team" | "invalid_token" | "invalid_plan" | "baseline_only" | "team_taken" | "not_ranked"; errors: string[] };
type SubmitResult = { ok: true; entry: LeaderboardEntry; rank: number } | SubmitFailure;

// На Vercel файловая система только для чтения, кроме /tmp: демо-режим хранит рейтинг там (в пределах жизни инстанса).
const FILE = process.env.VERCEL === "1" ? path.join(os.tmpdir(), "akim-leaderboard.json") : path.join(process.cwd(), "data", "leaderboard.json");
const REDIS_KEY = "akim:leaderboard:v1";
const MAX_ENTRIES = 500;
let cache: StoredEntry[] | null = null;
let queue: Promise<void> = Promise.resolve();

const teamKey = (team: string) => team.toLowerCase();
const ownerHashFor = (token: string) => createHash("sha256").update(token).digest("hex");
const ownsEntry = (entry: StoredEntry, hash: string) =>
  typeof entry.ownerHash === "string" && /^[0-9a-f]{64}$/.test(entry.ownerHash) &&
  timingSafeEqual(Buffer.from(entry.ownerHash, "hex"), Buffer.from(hash, "hex"));

function publicEntry(entry: StoredEntry): LeaderboardEntry {
  return {
    id: entry.id, team: entry.team, decisions: entry.decisions, eventId: entry.eventId ?? null,
    score: entry.score, cost: entry.cost, worst: entry.worst,
    failed: entry.failed, createdAt: entry.createdAt,
  };
}

function redisStorageEnabled(): boolean {
  const configured = hasUpstash();
  if (!configured && process.env.VERCEL === "1" && process.env.AKIM_DEMO_MODE !== "1") {
    throw new Error("The leaderboard requires Upstash Redis on Vercel.");
  }
  return configured;
}

// Redis serializes each EVAL invocation, so concurrent Vercel instances cannot overwrite each other.
// Keep the full top 500 in one key: ranking and replacing a team's previous entry are one atomic write.
const SUBMIT_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
local entries = raw and cjson.decode(raw) or {}
local kept = {}
local historicalEvents = {}
for _, old in ipairs(entries) do
  if old.eventId == nil or old.eventId == cjson.null then
    -- A manually imported row without a canonical team key cannot be matched
    -- safely in Redis Lua (string.lower is ASCII-only), so reserve the table.
    if type(old.teamKey) ~= 'string' then return -2 end
    local oldKey = old.teamKey
    if oldKey == ARGV[1] then
      if type(old.ownerHash) ~= 'string' or old.ownerHash ~= ARGV[4] then return -1 end
    else
      table.insert(kept, old)
    end
  else
    table.insert(historicalEvents, old)
  end
end
local entry = cjson.decode(ARGV[2])
entry.teamKey = ARGV[1]
table.insert(kept, entry)
local function worst(item)
  if item.failed > 0 or type(item.worst) ~= 'number' then return -1 end
  return item.worst
end
table.sort(kept, function(a, b)
  if a.score ~= b.score then return a.score > b.score end
  if worst(a) ~= worst(b) then return worst(a) > worst(b) end
  if a.cost ~= b.cost then return a.cost < b.cost end
  if a.createdAt ~= b.createdAt then return a.createdAt < b.createdAt end
  return a.id < b.id
end)
local newRank = 0
for rank, item in ipairs(kept) do
  if item.id == entry.id then newRank = rank; break end
end
if newRank > tonumber(ARGV[3]) then return 0 end
while #kept > tonumber(ARGV[3]) do table.remove(kept) end
for _, old in ipairs(historicalEvents) do table.insert(kept, old) end
redis.call('SET', KEYS[1], cjson.encode(kept))
return newRank
`;

function compareEntries(a: LeaderboardEntry, b: LeaderboardEntry): number {
  const aWorst = a.failed > 0 ? null : a.worst;
  const bWorst = b.failed > 0 ? null : b.worst;
  return b.score - a.score || (bWorst ?? -1) - (aWorst ?? -1) || a.cost - b.cost ||
    (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

async function load(): Promise<StoredEntry[]> {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("Leaderboard file has an invalid format.");
    cache = parsed as StoredEntry[];
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    cache = [];
  }
  return cache;
}

async function persist(entries: StoredEntry[]) {
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(entries, null, 1), "utf8");
}

export async function listEntries(): Promise<LeaderboardEntry[]> {
  if (redisStorageEnabled()) {
    const raw = await upstashCommand<string | null>(["GET", REDIS_KEY]);
    if (raw === null) return [];
    if (typeof raw !== "string") throw new Error("Upstash leaderboard has an invalid format.");
    const stored: unknown = JSON.parse(raw);
    if (!Array.isArray(stored)) throw new Error("Upstash leaderboard has an invalid format.");
    return (stored as StoredEntry[]).filter((entry) => entry.eventId == null)
      .map(publicEntry).sort(compareEntries).slice(0, MAX_ENTRIES);
  }
  const entries = await load();
  return entries.filter((entry) => entry.eventId == null)
    .map(publicEntry).sort(compareEntries);
}

export async function submitEntry(input: { team?: unknown; decisions?: unknown; eventId?: unknown; ownerToken?: unknown }): Promise<SubmitResult> {
  const team = typeof input.team === "string" ? input.team.replace(/\s+/g, " ").trim().slice(0, 40) : "";
  if (team.length < 2) return { ok: false, code: "invalid_team", errors: ["Название команды: от 2 до 40 символов."] };
  if (typeof input.ownerToken !== "string" || !/^[0-9a-f]{64}$/.test(input.ownerToken))
    return { ok: false, code: "invalid_token", errors: ["Не удалось сохранить право на название команды. Обновите страницу и повторите попытку."] };
  if (input.eventId !== null && input.eventId !== undefined && input.eventId !== "")
    return { ok: false, code: "baseline_only", errors: ["В рейтинг можно отправить только план без городского события."] };
  const decisions = sanitizeDecisions(input.decisions);
  const eventId = null;
  const v = validate(decisions, eventId);
  if (!v.ok) return { ok: false, code: "invalid_plan", errors: v.errors };
  const ownerHash = ownerHashFor(input.ownerToken);
  const r = simulate(decisions, eventId);
  const rb = robustness(decisions);
  const entry: LeaderboardEntry = {
    id: randomUUID(),
    team,
    decisions,
    eventId,
    score: r.score,
    cost: r.cost,
    worst: rb.failed > 0 ? null : rb.worst,
    failed: rb.failed,
    createdAt: new Date().toISOString(),
  };
  const storedEntry: StoredEntry = { ...entry, ownerHash };
  if (redisStorageEnabled()) {
    const rank = await upstashCommand<number>([
      "EVAL", SUBMIT_SCRIPT, 1, REDIS_KEY, teamKey(team), JSON.stringify(storedEntry), MAX_ENTRIES, ownerHash,
    ]);
    if (rank === -1) return { ok: false, code: "team_taken", errors: ["Это название команды уже занято."] };
    if (rank === -2) throw new Error("Legacy Redis entries require explicit team-key migration.");
    if (rank === 0) return { ok: false, code: "not_ranked", errors: ["План не вошёл в топ-500. Улучшите Score и отправьте снова."] };
    if (!Number.isInteger(rank) || rank < 0 || rank > MAX_ENTRIES) {
      throw new Error("Upstash leaderboard returned an invalid rank.");
    }
    return { ok: true, entry, rank };
  }
  // Записи сериализуются, чтобы параллельные отправки не затирали файл друг друга.
  let rank = 0;
  let conflict = false;
  const submission = queue.then(async () => {
    const allEntries = await load();
    const entries = allEntries.filter((e) => e.eventId == null);
    const historicalEvents = allEntries.filter((e) => e.eventId != null);
    const previous = entries.find((e) => teamKey(e.team) === teamKey(team));
    if (previous && !ownsEntry(previous, ownerHash)) {
      conflict = true;
      return;
    }
    // Проверка владельца и замена строки выполняются в одной очереди записи.
    const kept = entries.filter((e) => teamKey(e.team) !== teamKey(team));
    kept.push(storedEntry);
    kept.sort(compareEntries);
    rank = kept.findIndex((e) => e.id === entry.id) + 1;
    if (rank > MAX_ENTRIES) {
      rank = 0;
      return;
    }
    const next = [...kept.slice(0, MAX_ENTRIES), ...historicalEvents];
    await persist(next);
    cache = next;
  });
  // Ошибка записи возвращается текущему запросу, но не останавливает следующую запись.
  queue = submission.then(() => undefined, () => undefined);
  await submission;
  if (conflict) return { ok: false, code: "team_taken", errors: ["Это название команды уже занято."] };
  if (rank === 0) return { ok: false, code: "not_ranked", errors: ["План не вошёл в топ-500. Улучшите Score и отправьте снова."] };
  return { ok: true, entry, rank };
}
