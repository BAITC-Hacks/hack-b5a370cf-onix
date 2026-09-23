// Общий рейтинг команд: файл на сервере (data/leaderboard.json), Score считает движок, а не клиент.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { robustness, sanitizeDecisions, simulate, validate, normalizeEventId, type Decision } from "./engine.ts";

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

const FILE = path.join(process.cwd(), "data", "leaderboard.json");
const MAX_ENTRIES = 500;
let cache: LeaderboardEntry[] | null = null;
let queue: Promise<void> = Promise.resolve();

async function load(): Promise<LeaderboardEntry[]> {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8"));
    cache = Array.isArray(parsed) ? parsed : [];
  } catch {
    cache = [];
  }
  return cache;
}

async function persist(entries: LeaderboardEntry[]) {
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(entries, null, 1), "utf8");
}

export async function listEntries(): Promise<LeaderboardEntry[]> {
  const entries = await load();
  return [...entries].sort((a, b) => b.score - a.score || (b.worst ?? -1) - (a.worst ?? -1) || a.cost - b.cost);
}

export async function submitEntry(input: { team?: unknown; decisions?: unknown; eventId?: unknown }): Promise<{ ok: true; entry: LeaderboardEntry; rank: number } | { ok: false; errors: string[] }> {
  const team = String(input.team ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (team.length < 2) return { ok: false, errors: ["Название команды: от 2 до 40 символов."] };
  const decisions = sanitizeDecisions(input.decisions);
  const eventId = normalizeEventId(input.eventId);
  const v = validate(decisions, eventId);
  if (!v.ok) return { ok: false, errors: v.errors };
  const r = simulate(decisions, eventId);
  const rb = robustness(decisions);
  const entry: LeaderboardEntry = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    team,
    decisions,
    eventId,
    score: r.score,
    cost: r.cost,
    worst: rb.worst,
    failed: rb.failed,
    createdAt: new Date().toISOString(),
  };
  // Записи сериализуются, чтобы параллельные отправки не затирали файл друг друга.
  let rank = 0;
  queue = queue.then(async () => {
    const entries = await load();
    // Одна команда — одна строка: новая отправка заменяет предыдущую.
    const kept = entries.filter((e) => e.team.toLowerCase() !== team.toLowerCase());
    kept.push(entry);
    kept.sort((a, b) => b.score - a.score);
    cache = kept.slice(0, MAX_ENTRIES);
    await persist(cache);
    rank = (await listEntries()).findIndex((e) => e.id === entry.id) + 1;
  });
  await queue;
  return { ok: true, entry, rank };
}
