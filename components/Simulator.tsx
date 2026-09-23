"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DIRECTION_LABELS,
  DIRECTIONS,
  DISTRICTS,
  INDICATOR_INFO,
  INDICATORS,
  MEASURES,
  RULES,
  SYNERGIES,
  CONFLICTS,
  EVENTS,
  type Measure,
} from "@/lib/data";
import { districtName, getEvent, getMeasure, simulate, validate, type Decision, type RankedPlan } from "@/lib/engine";
import type { Explanation } from "@/lib/explain";

const fmt = (x: number) => (x > 0 ? `+${x}` : `${x}`);

function cellColor(v: number) {
  if (v < 40) return "bg-red-100 text-red-800";
  if (v < 50) return "bg-orange-50 text-orange-800";
  if (v < 60) return "bg-amber-50 text-amber-900";
  if (v < 70) return "bg-lime-50 text-lime-900";
  return "bg-emerald-50 text-emerald-900";
}

interface SavedScenario {
  name: string;
  decisions: Decision[];
  score: number;
  cost: number;
}

const STORAGE_KEY = "akim.scenarios.v1";

export default function Simulator() {
  const [decisions, setDecisionsRaw] = useState<Decision[]>([]);
  const [pickDistrict, setPickDistrict] = useState<Record<string, string>>({});
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [optimum, setOptimum] = useState<RankedPlan[] | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [saved, setSaved] = useState<SavedScenario[]>([]);
  const [eventId, setEventIdRaw] = useState<string | null>(null);
  const event = getEvent(eventId);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      // Чтение localStorage возможно только после гидратации.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setSaved(JSON.parse(raw));
    } catch {}
  }, []);

  // Любое изменение набора сбрасывает устаревший AI-анализ.
  const setDecisions = (next: Decision[]) => {
    setDecisionsRaw(next);
    setExplanation(null);
    setExplainError(null);
  };

  // Событие меняет стартовые условия: сбрасываем устаревший анализ и оптимум.
  const setEventId = (id: string | null) => {
    setEventIdRaw(id);
    setExplanation(null);
    setExplainError(null);
    setOptimum(null);
  };

  const randomEvent = () => {
    const pool = EVENTS.filter((e) => e.id !== eventId);
    setEventId(pool[Math.floor(Math.random() * pool.length)].id);
  };

  const persist = (list: SavedScenario[]) => {
    setSaved(list);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {}
  };

  const result = useMemo(() => simulate(decisions, eventId), [decisions, eventId]);
  const validation = useMemo(() => validate(decisions, eventId), [decisions, eventId]);
  const complete = decisions.length === RULES.decisions && validation.ok;

  /** Причина, по которой меру нельзя добавить (с учётом всех правил, кроме «ровно 5»). */
  const blockReason = (m: Measure): string | null => {
    if (decisions.some((d) => d.measureId === m.id)) return "Уже выбрана";
    if (decisions.length >= RULES.decisions) return `Уже выбрано ${RULES.decisions} решений`;
    if (m.scope === "district" && !pickDistrict[m.id]) return "Выберите район";
    const next = [...decisions, { measureId: m.id, districtId: m.scope === "district" ? pickDistrict[m.id] : null }];
    const errs = validate(next, eventId).errors.filter((e) => !e.startsWith("Нужно ровно"));
    return errs[0] ?? null;
  };

  const add = (m: Measure) => {
    if (blockReason(m)) return;
    setDecisions([...decisions, { measureId: m.id, districtId: m.scope === "district" ? pickDistrict[m.id] : null }]);
  };

  const remove = (id: string) => setDecisions(decisions.filter((d) => d.measureId !== id));

  const runExplain = async () => {
    setExplaining(true);
    setExplainError(null);
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decisions, eventId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.reasons?.join(" ") ?? data.error ?? "Ошибка анализа");
      setExplanation(data);
    } catch (e) {
      setExplainError(e instanceof Error ? e.message : String(e));
    } finally {
      setExplaining(false);
    }
  };

  const runOptimize = async () => {
    setOptimizing(true);
    try {
      const res = await fetch(`/api/optimize${eventId ? `?event=${eventId}` : ""}`);
      setOptimum((await res.json()).plans);
    } finally {
      setOptimizing(false);
    }
  };

  const saveScenario = () => {
    const name = `Сценарий ${saved.length + 1}${event ? ` · ${event.title}` : ""}`;
    persist([...saved, { name, decisions, score: result.score, cost: result.cost }]);
  };

  const budgetPct = Math.min(100, (result.cost / result.budget) * 100);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-sky-700">Astana Innovations · HackAlem AI</p>
          <h1 className="text-3xl font-bold">Аким на 5 часов</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Бюджет {RULES.budget} у.е., ровно {RULES.decisions} решений, горизонт 2 года. Движок считает Astana Quality of Life Score по
            формуле ТЗ, AI объясняет результат и компромиссы.
          </p>
        </div>
        <div className="flex gap-3">
          <Stat label="Quality of Life Score" value={result.score.toFixed(2)} sub={`${fmt(result.delta)} к базе ${result.baseScore}`} accent />
          <Stat label="Бюджет" value={`${result.cost} / ${result.budget}`} sub={`остаток ${result.remainingBudget}`} />
          <Stat label="Решений" value={`${decisions.length} / ${RULES.decisions}`} sub={complete ? "набор валиден" : "выберите все 5"} />
        </div>
      </header>

      <div className="mb-6 h-2 w-full overflow-hidden rounded-full bg-slate-200" aria-label="Использование бюджета">
        <div className={`h-full ${result.cost > result.budget ? "bg-red-500" : "bg-sky-600"}`} style={{ width: `${budgetPct}%` }} />
      </div>

      <div className={`mb-6 rounded-xl border p-4 ${event ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-white"}`}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-wider text-amber-700">Городское событие</div>
            {event ? (
              <>
                <div className="font-semibold">{event.title}</div>
                <p className="text-sm text-slate-700">{event.description}</p>
                <p className="mt-1 text-xs text-slate-600">
                  {[
                    ...event.shocks.map((sh) => `${districtName(sh.districtId)}: ${sh.indicator} ${fmt(sh.delta)}`),
                    ...(event.budgetCut ? [`бюджет −${event.budgetCut}`] : []),
                  ].join(" · ")}{" "}
                  · базовый Score {result.baseScoreNoEvent} → {result.baseScore}
                </p>
              </>
            ) : (
              <p className="text-sm text-slate-600">Проверьте устойчивость плана: случайное событие ухудшит показатели района или урежет бюджет, и план придётся пересобрать.</p>
            )}
          </div>
          <select
            value={eventId ?? ""}
            onChange={(e) => setEventId(e.target.value || null)}
            className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
            aria-label="Выбор события"
          >
            <option value="">Без события</option>
            {EVENTS.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
          <button onClick={randomEvent} className="rounded bg-amber-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-600">
            Случайное событие
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* Каталог мер */}
        <section>
          <h2 className="mb-3 text-lg font-semibold">Каталог мероприятий</h2>
          <div className="space-y-5">
            {DIRECTIONS.map((dir) => (
              <div key={dir}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {DIRECTION_LABELS[dir]} · выбрано {decisions.filter((d) => getMeasure(d.measureId)?.direction === dir).length}/{RULES.maxPerDirection}
                </h3>
                <div className="space-y-2">
                  {MEASURES.filter((m) => m.direction === dir).map((m) => {
                    const chosen = decisions.find((d) => d.measureId === m.id);
                    const reason = blockReason(m);
                    return (
                      <div key={m.id} className={`rounded-lg border bg-white p-3 ${chosen ? "border-sky-500 ring-1 ring-sky-500" : "border-slate-200"}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-medium">
                              <span className="mr-1 text-slate-400">{m.id}</span>
                              {m.name}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                              {m.scope === "city" ? "Весь город" : "Один район"} · лаг {m.lag} кв. (срабатывает {Math.round(((RULES.horizon - m.lag) / RULES.horizon) * 100)}%) ·{" "}
                              {Object.entries(m.effects)
                                .map(([k, e]) => `${k} ${fmt(e as number)}`)
                                .join(", ")}
                            </div>
                          </div>
                          <div className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-sm font-semibold">{m.cost}</div>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          {chosen ? (
                            <>
                              <span className="text-xs text-sky-700">Выбрано: {districtName(chosen.districtId)}</span>
                              <button onClick={() => remove(m.id)} className="ml-auto rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">
                                Убрать
                              </button>
                            </>
                          ) : (
                            <>
                              {m.scope === "district" && (
                                <select
                                  value={pickDistrict[m.id] ?? ""}
                                  onChange={(e) => setPickDistrict({ ...pickDistrict, [m.id]: e.target.value })}
                                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                                  aria-label={`Район для ${m.id}`}
                                >
                                  <option value="">Район…</option>
                                  {DISTRICTS.map((d) => (
                                    <option key={d.id} value={d.id}>
                                      {d.name}
                                    </option>
                                  ))}
                                </select>
                              )}
                              <span className="truncate text-xs text-slate-400">{reason && reason !== "Выберите район" ? reason : ""}</span>
                              <button
                                onClick={() => add(m)}
                                disabled={!!reason}
                                title={reason ?? ""}
                                className="ml-auto rounded bg-sky-600 px-3 py-1 text-xs font-medium text-white enabled:hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                              >
                                Добавить
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600">
            <div className="font-semibold text-slate-700">Правила</div>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              <li>Ровно {RULES.decisions} мер, без повторов, не более {RULES.maxPerDirection} из одного направления, бюджет ≤ {result.budget}.</li>
              {CONFLICTS.map((c) => (
                <li key={c.a + c.b}>
                  {c.a} и {c.b}: {c.reason}.
                </li>
              ))}
              {SYNERGIES.map((s) => (
                <li key={s.first + s.second}>
                  Синергия {s.first}+{s.second}: {s.indicator} +{s.bonus} в районе {s.first}.
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Результаты */}
        <section className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">Ваш сценарий</h2>
              <div className="ml-auto flex gap-2">
                <button onClick={() => setDecisions([])} disabled={!decisions.length} className="rounded border border-slate-300 px-3 py-1 text-sm disabled:opacity-40">
                  Сбросить
                </button>
                <button onClick={saveScenario} disabled={!complete} className="rounded border border-slate-300 px-3 py-1 text-sm disabled:opacity-40">
                  Сохранить для сравнения
                </button>
              </div>
            </div>
            {decisions.length === 0 ? (
              <p className="text-sm text-slate-500">Добавьте меры из каталога. Score пересчитывается сразу.</p>
            ) : (
              <ol className="space-y-1 text-sm">
                {decisions.map((d, i) => {
                  const m = getMeasure(d.measureId)!;
                  return (
                    <li key={d.measureId} className="flex gap-2">
                      <span className="w-5 text-slate-400">{i + 1}.</span>
                      <span className="flex-1">
                        <b>{m.id}</b> {m.name} — <span className="text-sky-700">{districtName(d.districtId)}</span>
                      </span>
                      <span className="text-slate-500">{m.cost}</span>
                    </li>
                  );
                })}
              </ol>
            )}
            {decisions.length > 0 && !validation.ok && (
              <ul className="mt-3 space-y-0.5 text-xs text-amber-700">
                {validation.errors.map((e) => (
                  <li key={e}>• {e}</li>
                ))}
              </ul>
            )}
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <Mini label="Средний балл города" value={result.dAvg} />
              <Mini label={`Слабейший: ${result.weakestDistrict}`} value={result.minD} />
              <Mini label="Показателей < 40" value={result.criticalCount} warn={result.criticalCount > 0} />
              <Mini label="Синергий" value={result.synergies.length} />
            </div>
          </div>

          {/* Карта районов */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-lg font-semibold">Показатели районов: до → после</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-separate border-spacing-0.5 text-center text-xs">
                <thead>
                  <tr className="text-slate-500">
                    <th className="text-left font-medium">Район</th>
                    {INDICATORS.map((k) => (
                      <th key={k} className="font-medium" title={INDICATOR_INFO[k].name}>
                        {k}
                      </th>
                    ))}
                    <th className="font-medium">Балл D</th>
                  </tr>
                </thead>
                <tbody>
                  {result.districts.map((d) => (
                    <tr key={d.id}>
                      <td className="pr-2 text-left">
                        <div className="font-medium">{d.name}</div>
                        <div className="text-[10px] text-slate-400">{Math.round(d.population * 100)}% жителей</div>
                      </td>
                      {INDICATORS.map((k) => {
                        const delta = Math.round((d.after[k] - d.before[k]) * 100) / 100;
                        return (
                          <td key={k} className={`rounded px-1 py-1 ${cellColor(d.after[k])}`} title={`${INDICATOR_INFO[k].name}: ${d.before[k]} → ${d.after[k]}`}>
                            <div className="font-semibold">{Math.round(d.after[k] * 10) / 10}</div>
                            <div className={`text-[10px] ${delta ? (delta > 0 ? "text-emerald-700" : "text-red-700") : "text-transparent"}`}>{delta ? fmt(delta) : "0"}</div>
                          </td>
                        );
                      })}
                      <td className="px-1">
                        <div className="font-semibold">{d.scoreAfter}</div>
                        <div className="text-[10px] text-slate-500">было {d.scoreBefore}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              {INDICATORS.map((k) => `${k} — ${INDICATOR_INFO[k].name}`).join(" · ")}. Красным — критические значения ниже 40 (штраф −1 к Score за каждое).
            </p>
          </div>

          {/* AI-анализ */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-lg font-semibold">AI-анализ сценария</h2>
              <button
                onClick={runExplain}
                disabled={!complete || explaining}
                className="ml-auto rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white enabled:hover:bg-sky-700 disabled:bg-slate-300"
              >
                {explaining ? "Анализирую…" : "Проанализировать"}
              </button>
            </div>
            {!complete && <p className="text-sm text-slate-500">Соберите валидный набор из {RULES.decisions} мер, чтобы получить анализ.</p>}
            {explainError && <p className="text-sm text-red-700">{explainError}</p>}
            {explanation && <ExplanationView e={explanation} />}
          </div>

          {/* Оптимизатор */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-lg font-semibold">Лучшие наборы (полный перебор)</h2>
              <button onClick={runOptimize} disabled={optimizing} className="ml-auto rounded border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-40">
                {optimizing ? "Перебираю ~700 тыс. наборов…" : optimum ? "Обновить" : "Найти оптимум"}
              </button>
            </div>
            {!optimum && <p className="text-sm text-slate-500">Движок перебирает все допустимые наборы по правилам ТЗ и показывает топ-5 — ориентир для сравнения.</p>}
            {optimum && (
              <ol className="space-y-2">
                {optimum.map((p, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2 text-sm">
                    <span className="font-semibold">#{i + 1}</span>
                    <span className="rounded bg-emerald-100 px-2 font-semibold text-emerald-800">{p.score.toFixed(2)}</span>
                    <span className="text-slate-500">стоимость {p.cost}</span>
                    <span className="basis-full text-xs text-slate-700">
                      {p.decisions.map((d) => `${d.measureId} (${districtName(d.districtId)})`).join(" · ")}
                    </span>
                    <button onClick={() => setDecisions(p.decisions)} className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs">
                      Применить
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* Сравнение */}
          {saved.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center">
                <h2 className="text-lg font-semibold">Сравнение сценариев</h2>
                <button onClick={() => persist([])} className="ml-auto text-xs text-slate-500 underline">
                  Очистить
                </button>
              </div>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-500">
                  <tr>
                    <th>Сценарий</th>
                    <th>Меры</th>
                    <th className="text-right">Стоимость</th>
                    <th className="text-right">Score</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {[...saved]
                    .sort((a, b) => b.score - a.score)
                    .map((s) => (
                      <tr key={s.name} className="border-t border-slate-100">
                        <td className="py-1">{s.name}</td>
                        <td className="text-xs text-slate-600">{s.decisions.map((d) => `${d.measureId}${d.districtId ? `/${districtName(d.districtId)}` : ""}`).join(", ")}</td>
                        <td className="text-right">{s.cost}</td>
                        <td className="text-right font-semibold">{s.score.toFixed(2)}</td>
                        <td className="text-right">
                          <button onClick={() => setDecisions(s.decisions)} className="text-xs text-sky-700 underline">
                            Загрузить
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <footer className="mt-10 text-xs text-slate-400">
        Score = 0.7 × средний балл города (по населению) + 0.3 × балл слабейшего района − 1 × число показателей ниже 40. Данные синтетические, из ТЗ Astana
        Innovations.
      </footer>
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border px-4 py-2 ${accent ? "border-sky-600 bg-sky-600 text-white" : "border-slate-200 bg-white"}`}>
      <div className={`text-[11px] ${accent ? "text-sky-100" : "text-slate-500"}`}>{label}</div>
      <div className="text-2xl font-bold">{value}</div>
      <div className={`text-[11px] ${accent ? "text-sky-100" : "text-slate-500"}`}>{sub}</div>
    </div>
  );
}

function Mini({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={`rounded-lg p-2 ${warn ? "bg-red-50" : "bg-slate-50"}`}>
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`text-lg font-semibold ${warn ? "text-red-700" : ""}`}>{value}</div>
    </div>
  );
}

function ExplanationView({ e }: { e: Explanation }) {
  const sections: [string, string[], string][] = [
    ["Сильные стороны", e.strengths, "text-emerald-700"],
    ["Риски и последствия", e.risks, "text-red-700"],
    ["Компромиссы", e.tradeoffs, "text-amber-700"],
    ["Рекомендации", e.recommendations, "text-sky-700"],
  ];
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-2 text-[11px]">
        <span className="rounded bg-slate-100 px-2 py-0.5">
          {e.source === "fallback" ? "Шаблонный анализ (LLM не подключён)" : `LLM: ${e.source} · ${e.model}`}
        </span>
        {e.error && <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-800">LLM недоступен, показан шаблон: {e.error.slice(0, 80)}</span>}
        {e.unverifiedNumbers && e.unverifiedNumbers.length > 0 && (
          <span className="rounded bg-red-100 px-2 py-0.5 text-red-800">Числа не из расчёта: {e.unverifiedNumbers.join(", ")}</span>
        )}
        {e.unverifiedNumbers && e.unverifiedNumbers.length === 0 && <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-800">Все числа сверены с расчётом</span>}
      </div>
      <p className="font-medium">{e.summary}</p>
      {sections.map(([title, items, color]) =>
        items.length ? (
          <div key={title}>
            <div className={`text-xs font-semibold uppercase tracking-wider ${color}`}>{title}</div>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {items.map((it, i) => (
                <li key={i}>{it}</li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </div>
  );
}
