"use client";

import { useEffect, useState } from "react";
import { CONFLICTS, DIRECTION_LABELS, DIRECTIONS, DISTRICTS, EVENTS, INDICATOR_INFO, MEASURES, RULES, SYNERGIES, type Measure } from "@/lib/data";
import { contributions, districtName, getEvent, getMeasure, simulate, validate, type Decision, type RankedPlan } from "@/lib/engine";
import type { Explanation } from "@/lib/explain";
import { decodePlan, encodePlan } from "@/lib/plan-url";
import { Advisor } from "./Advisor";
import { ContributionChart, DistrictDumbbell } from "./charts";
import { ExplanationView } from "./ExplanationView";
import { Heatmap } from "./Heatmap";
import { Button, Card, CardTitle, StatusBadge, ThemeToggle } from "./ui";

const fmt = (x: number) => (x > 0 ? `+${x}` : `${x}`);

const TZ_EXAMPLE: Decision[] = [
  { measureId: "M7", districtId: "nura" },
  { measureId: "M8", districtId: "nura" },
  { measureId: "M10", districtId: "nura" },
  { measureId: "M12", districtId: null },
  { measureId: "M5", districtId: "saryarka" },
];

interface SavedScenario {
  name: string;
  decisions: Decision[];
  eventId: string | null;
  score: number;
  cost: number;
}

const STORAGE_KEY = "akim.scenarios.v2";

export default function Simulator() {
  const [decisions, setDecisionsRaw] = useState<Decision[]>([]);
  const [eventId, setEventIdRaw] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [optimum, setOptimum] = useState<RankedPlan[] | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [saved, setSaved] = useState<SavedScenario[]>([]);
  const [copied, setCopied] = useState(false);

  // Состояние из ссылки (?p=...&e=...) и сохранённые сценарии — только после гидратации.
  useEffect(() => {
    const fromUrl = decodePlan(new URLSearchParams(location.search));
    /* eslint-disable react-hooks/set-state-in-effect */
    if (fromUrl.decisions.length) setDecisionsRaw(fromUrl.decisions);
    if (getEvent(fromUrl.eventId)) setEventIdRaw(fromUrl.eventId);
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setSaved(JSON.parse(raw));
    } catch {}
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const event = getEvent(eventId);
  const result = simulate(decisions, eventId);
  const validation = validate(decisions, eventId);
  const contrib = contributions(decisions, eventId);
  const complete = decisions.length === RULES.decisions && validation.ok;
  const planQuery = encodePlan(decisions, eventId);

  const resetDerived = () => {
    setExplanation(null);
    setExplainError(null);
  };
  const setDecisions = (next: Decision[]) => {
    setDecisionsRaw(next);
    resetDerived();
  };
  const setEventId = (id: string | null) => {
    setEventIdRaw(id);
    setOptimum(null);
    resetDerived();
  };
  const persist = (list: SavedScenario[]) => {
    setSaved(list);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {}
  };

  /** Почему нельзя добавить меру в этот район (все правила, кроме «ровно 5»). */
  const blockReason = (m: Measure, districtId: string | null): string | null => {
    if (decisions.some((d) => d.measureId === m.id)) return "Мера уже в плане";
    if (decisions.length >= RULES.decisions) return `В плане уже ${RULES.decisions} решений`;
    const errs = validate([...decisions, { measureId: m.id, districtId }], eventId).errors.filter((e) => !e.startsWith("Нужно ровно"));
    return errs[0] ?? null;
  };

  const add = (m: Measure, districtId: string | null) => {
    if (!blockReason(m, districtId)) setDecisions([...decisions, { measureId: m.id, districtId }]);
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

  const share = async () => {
    const url = `${location.origin}/?${planQuery}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      prompt("Ссылка на сценарий", url);
    }
  };

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const budgetPct = Math.min(100, (result.cost / result.budget) * 100);

  return (
    <div className="min-h-screen">
      {/* Верхняя панель */}
      <header className="sticky top-0 z-30 border-b border-line bg-page/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2 font-semibold">
            <span className="grid size-7 place-items-center rounded-lg bg-accent text-sm text-white">А</span>
            Аким на 5 часов
          </div>
          <nav className="ml-4 hidden gap-1 text-sm text-ink-2 md:flex">
            {[
              ["plan", "План"],
              ["results", "Результаты"],
              ["ai", "AI-анализ"],
              ["advisor", "AI-советник"],
              ["method", "Как считается"],
            ].map(([id, label]) => (
              <button key={id} onClick={() => scrollTo(id)} className="rounded-md px-2.5 py-1 hover:bg-card-2 hover:text-ink">
                {label}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="text-[11px] text-ink-3">Quality of Life Score</div>
              <div className="font-bold leading-none">{result.score.toFixed(2)}</div>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
        {/* Hero */}
        <section className="grid items-center gap-8 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Astana Innovations · HackAlem AI</p>
            <h1 className="mt-3 text-4xl font-bold leading-tight sm:text-5xl">Вы — аким Астаны на&nbsp;5&nbsp;часов</h1>
            <p className="mt-4 max-w-xl text-lg text-ink-2">
              Один бюджет в {RULES.budget} у.е., пять решений и пять районов с разными проблемами. Движок честно считает Astana Quality of Life Score, а AI
              объясняет, что сработало, чем пришлось пожертвовать и как сделать лучше.
            </p>
            <ol className="mt-6 grid gap-3 sm:grid-cols-3">
              {[
                ["1", "Соберите план", "5 мер из 14, район — в один клик"],
                ["2", "Проверьте на прочность", "Случайное событие урежет бюджет или ударит по району"],
                ["3", "Получите разбор", "AI-анализ, оптимум и отчёт в PDF"],
              ].map(([n, t, d]) => (
                <li key={n} className="rounded-xl border border-line bg-card p-3">
                  <div className="text-xs font-semibold text-accent">Шаг {n}</div>
                  <div className="font-medium">{t}</div>
                  <div className="text-xs text-ink-2">{d}</div>
                </li>
              ))}
            </ol>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => scrollTo("plan")} className="px-4 py-2">
                Собрать свой план
              </Button>
              <Button onClick={() => setDecisions(TZ_EXAMPLE)} className="px-4 py-2">
                Загрузить пример из ТЗ
              </Button>
            </div>
          </div>

          {/* Обзор города */}
          <div className="rounded-2xl border border-line bg-card p-5">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="font-semibold">Город сегодня</h2>
              <span className="text-xs text-ink-3">балл района 0–100, без мер</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {result.districts.map((d) => {
                const profile = DISTRICTS.find((x) => x.id === d.id)!.profile;
                const weakest = d.scoreBefore === Math.min(...result.districts.map((x) => x.scoreBefore));
                const crit = INDICATOR_KEYS.filter((k) => d.before[k] < RULES.criticalThreshold).length;
                return (
                  <div key={d.id} className={`rounded-xl p-3 ${weakest ? "bg-warn-soft" : "bg-card-2"}`}>
                    <div className="flex items-baseline justify-between">
                      <span className="font-medium">{d.name}</span>
                      <span className="text-[11px] text-ink-3">{Math.round(d.population * 100)}%</span>
                    </div>
                    <div className="mt-1 text-2xl font-bold">{d.scoreBefore.toFixed(1)}</div>
                    <p className="mt-1 text-[11px] leading-snug text-ink-2">{profile}</p>
                    {crit > 0 && (
                      <div className="mt-1.5">
                        <StatusBadge kind="crit">{crit} ниже 40</StatusBadge>
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="rounded-xl border border-dashed border-line p-3">
                <div className="text-[11px] text-ink-3">Стартовый Score</div>
                <div className="text-2xl font-bold">{result.baseScore.toFixed(2)}</div>
                <p className="mt-1 text-[11px] leading-snug text-ink-2">0.7 × средний по городу + 0.3 × слабейший район − штрафы</p>
              </div>
            </div>
          </div>
        </section>

        {/* Событие */}
        <section className={`rounded-2xl border p-5 ${event ? "border-warn bg-warn-soft" : "border-line bg-card"}`}>
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-2">Городское событие · стресс-тест плана</div>
              {event ? (
                <>
                  <div className="mt-1 text-lg font-semibold">⚠ {event.title}</div>
                  <p className="text-sm text-ink-2">{event.description}</p>
                  <p className="mt-1 text-xs text-ink-2">
                    {[...event.shocks.map((s) => `${districtName(s.districtId)}: ${INDICATOR_INFO[s.indicator].name} ${fmt(s.delta)}`), ...(event.budgetCut ? [`бюджет −${event.budgetCut}`] : [])].join(" · ")} · стартовый
                    Score {result.baseScoreNoEvent} → {result.baseScore}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-sm text-ink-2">Настоящий аким не планирует в вакууме. Включите событие — и посмотрите, выдержит ли ваш план аварию, смог или урезанный бюджет.</p>
              )}
            </div>
            <select
              value={eventId ?? ""}
              onChange={(e) => setEventId(e.target.value || null)}
              className="rounded-lg border border-line bg-card px-2 py-1.5 text-sm"
              aria-label="Выбор события"
            >
              <option value="">Без события</option>
              {EVENTS.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
            <Button
              variant="warn"
              onClick={() => {
                const pool = EVENTS.filter((e) => e.id !== eventId);
                setEventId(pool[Math.floor(Math.random() * pool.length)].id);
              }}
            >
              🎲 Случайное событие
            </Button>
          </div>
        </section>

        {/* План: каталог + панель */}
        <div id="plan" className="grid scroll-mt-20 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <section className="min-w-0">
            <div className="mb-4">
              <h2 className="text-2xl font-bold">Каталог мероприятий</h2>
              <p className="text-sm text-ink-2">
                Нажмите на район, чтобы добавить меру. Недоступные варианты объясняют причину при наведении. Эффект масштабируется лагом: за 2 года мера с лагом L
                срабатывает на (8 − L)/8.
              </p>
            </div>
            <div className="space-y-6">
              {DIRECTIONS.map((dir) => {
                const used = decisions.filter((d) => getMeasure(d.measureId)?.direction === dir).length;
                return (
                  <div key={dir}>
                    <div className="mb-2 flex items-center gap-2">
                      <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-2">{DIRECTION_LABELS[dir]}</h3>
                      <span className={`text-xs ${used >= RULES.maxPerDirection ? "text-ink" : "text-ink-3"}`}>
                        {used}/{RULES.maxPerDirection}
                      </span>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      {MEASURES.filter((m) => m.direction === dir).map((m) => (
                        <MeasureCard key={m.id} m={m} chosen={decisions.find((d) => d.measureId === m.id)} blockReason={blockReason} onAdd={add} onRemove={remove} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Панель плана */}
          <aside className="min-w-0">
            <div className="space-y-4 lg:sticky lg:top-20">
              <div className="rounded-2xl bg-accent p-5 text-white">
                <div className="text-sm opacity-85">Astana Quality of Life Score</div>
                <div className="mt-1 flex items-end gap-3">
                  <span className="text-5xl font-bold leading-none">{result.score.toFixed(2)}</span>
                  <span className="pb-1 text-sm font-medium">
                    {fmt(result.delta)} к старту {result.baseScore}
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="opacity-80">Средний по городу</div>
                    <div className="text-base font-semibold">{result.dAvg}</div>
                  </div>
                  <div>
                    <div className="opacity-80">Слабейший · {result.weakestDistrict}</div>
                    <div className="text-base font-semibold">{result.minD}</div>
                  </div>
                  <div>
                    <div className="opacity-80">Ниже 40</div>
                    <div className="text-base font-semibold">{result.criticalCount}</div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-line bg-card p-4">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-semibold">Бюджет</span>
                  <span>
                    <b>{result.cost}</b> / {result.budget} · остаток {result.remainingBudget}
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-card-2" role="progressbar" aria-valuenow={result.cost} aria-valuemax={result.budget}>
                  <div className={`h-full rounded-full ${result.cost > result.budget ? "bg-crit" : "bg-accent"}`} style={{ width: `${budgetPct}%` }} />
                </div>

                <div className="mt-4 text-sm font-semibold">
                  Решения {decisions.length}/{RULES.decisions}
                </div>
                <ol className="mt-2 space-y-1.5">
                  {Array.from({ length: RULES.decisions }).map((_, i) => {
                    const d = decisions[i];
                    const m = d && getMeasure(d.measureId);
                    return m ? (
                      <li key={d.measureId} className="flex items-center gap-2 rounded-lg bg-card-2 px-2.5 py-1.5 text-sm">
                        <span className="w-8 text-xs font-semibold text-ink-3">{m.id}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{m.name}</span>
                          <span className="text-xs text-accent-strong">{districtName(d.districtId)}</span>
                        </span>
                        <span className="text-xs text-ink-2">{m.cost}</span>
                        <button onClick={() => remove(m.id)} className="rounded px-1 text-ink-3 hover:bg-card hover:text-ink" aria-label={`Убрать ${m.id}`}>
                          ✕
                        </button>
                      </li>
                    ) : (
                      <li key={`slot-${i}`} className="rounded-lg border border-dashed border-line px-2.5 py-2 text-xs text-ink-3">
                        Слот {i + 1} — выберите меру в каталоге
                      </li>
                    );
                  })}
                </ol>

                <div className="mt-3 space-y-1">
                  {complete ? (
                    <StatusBadge kind="good">План валиден</StatusBadge>
                  ) : decisions.length > 0 ? (
                    <ul className="space-y-1">
                      {validation.errors.map((e) => (
                        <li key={e}>
                          <StatusBadge kind={e.startsWith("Нужно ровно") ? "info" : "crit"}>{e}</StatusBadge>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {result.synergies.map((s) => (
                    <div key={s.pair}>
                      <StatusBadge kind="good">
                        Синергия {s.pair}: {s.indicator} +{s.bonus}
                      </StatusBadge>
                    </div>
                  ))}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Button
                    variant="primary"
                    disabled={!complete || explaining}
                    onClick={() => {
                      runExplain();
                      scrollTo("ai");
                    }}
                    className="col-span-2"
                  >
                    {explaining ? "AI анализирует…" : "✦ AI-анализ плана"}
                  </Button>
                  <a
                    href={complete ? `/report?${planQuery}` : undefined}
                    target="_blank"
                    rel="noopener"
                    aria-disabled={!complete}
                    className={`inline-flex items-center justify-center rounded-lg border border-line px-3 py-1.5 text-sm font-medium ${complete ? "hover:bg-card-2" : "pointer-events-none opacity-40"}`}
                  >
                    Отчёт / PDF
                  </a>
                  <Button onClick={share} disabled={!decisions.length}>
                    {copied ? "Скопировано ✓" : "Поделиться"}
                  </Button>
                  <Button
                    onClick={() =>
                      persist([
                        ...saved,
                        { name: `Сценарий ${saved.length + 1}${event ? ` · ${event.title}` : ""}`, decisions, eventId, score: result.score, cost: result.cost },
                      ])
                    }
                    disabled={!complete}
                  >
                    В сравнение
                  </Button>
                  <Button variant="ghost" onClick={() => setDecisions([])} disabled={!decisions.length}>
                    Сбросить
                  </Button>
                </div>
              </div>
            </div>
          </aside>
        </div>

        {/* Результаты */}
        <div id="results" className="grid scroll-mt-20 gap-6 lg:grid-cols-2">
          <Card>
            <CardTitle hint="Балл района — взвешенная сумма 10 показателей. Слабейший район весит 30% итогового Score.">Районы: до и после</CardTitle>
            <DistrictDumbbell districts={result.districts} weakest={result.weakestDistrict} />
          </Card>
          <Card>
            <CardTitle hint="Какая мера сколько даёт итоговому Score — видно, где бюджет работает, а где нет.">Вклад мер в Score</CardTitle>
            {contrib.length ? <ContributionChart items={contrib} /> : <p className="text-sm text-ink-3">Добавьте меры, чтобы увидеть их вклад.</p>}
          </Card>
        </div>

        <Card>
          <CardTitle hint="Цвет — уровень показателя, под значением — изменение от ваших мер.">Все показатели по районам</CardTitle>
          <Heatmap districts={result.districts} />
        </Card>

        <Card id="ai" className="scroll-mt-20">
          <CardTitle
            hint="Числа считает движок. LLM получает только готовые факты и объясняет их; каждое число в ответе сверяется с расчётом."
            action={
              <Button variant="primary" onClick={runExplain} disabled={!complete || explaining}>
                {explaining ? "Анализирую…" : explanation ? "Обновить анализ" : "Проанализировать"}
              </Button>
            }
          >
            AI-анализ сценария
          </CardTitle>
          {!complete && !explanation && <p className="text-sm text-ink-3">Соберите валидный план из {RULES.decisions} мер.</p>}
          {explaining && !explanation && <div className="h-24 animate-pulse rounded-xl bg-card-2" />}
          {explainError && <StatusBadge kind="crit">{explainError}</StatusBadge>}
          {explanation && <ExplanationView e={explanation} />}
        </Card>

        <Card id="advisor" className="scroll-mt-20">
          <CardTitle hint="Агент с инструментами: сам запускает симуляции и перебор планов с вашими ограничениями, показывает каждый шаг и предлагает план, который применяется одной кнопкой.">
            AI-советник акима
          </CardTitle>
          <Advisor decisions={decisions} eventId={eventId} onApply={(d) => { setDecisions(d); scrollTo("plan"); }} />
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardTitle
              hint="Движок перебирает все ~700 тыс. допустимых планов по правилам ТЗ (с учётом события)."
              action={
                <Button onClick={runOptimize} disabled={optimizing}>
                  {optimizing ? "Перебираю…" : optimum ? "Обновить" : "Найти оптимум"}
                </Button>
              }
            >
              Лучшие планы
            </CardTitle>
            {optimum ? (
              <ol className="space-y-2">
                {optimum.map((p, i) => (
                  <li key={i} className="rounded-xl bg-card-2 p-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">#{i + 1}</span>
                      <span className="font-bold text-accent-strong">{p.score.toFixed(2)}</span>
                      <span className="text-xs text-ink-3">стоимость {p.cost}</span>
                      {i === 0 && complete && (
                        <span className="text-xs text-ink-2">{result.score >= p.score - 0.005 ? "ваш план оптимален" : `ваш план −${(p.score - result.score).toFixed(2)}`}</span>
                      )}
                      <Button onClick={() => setDecisions(p.decisions)} className="ml-auto px-2 py-0.5 text-xs">
                        Применить
                      </Button>
                    </div>
                    <div className="mt-1 text-xs text-ink-2">{p.decisions.map((d) => `${d.measureId} ${districtName(d.districtId)}`).join(" · ")}</div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-ink-3">Ориентир для сравнения: насколько ваш план далёк от лучшего возможного.</p>
            )}
          </Card>

          <Card>
            <CardTitle hint="Сохраняйте варианты и сравнивайте — например, планы разных команд или план до и после события.">Сравнение сценариев</CardTitle>
            {saved.length ? (
              <>
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-ink-3">
                    <tr>
                      <th className="py-1 font-medium">Сценарий</th>
                      <th className="text-right font-medium">Бюджет</th>
                      <th className="text-right font-medium">Score</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {[...saved]
                      .sort((a, b) => b.score - a.score)
                      .map((s, i) => (
                        <tr key={s.name} className="border-t border-line">
                          <td className="py-1.5">
                            <div className="font-medium">
                              {i === 0 && "🏆 "}
                              {s.name}
                            </div>
                            <div className="text-xs text-ink-3">{s.decisions.map((d) => d.measureId).join(", ")}</div>
                          </td>
                          <td className="text-right">{s.cost}</td>
                          <td className="text-right font-semibold">{s.score.toFixed(2)}</td>
                          <td className="text-right">
                            <button
                              onClick={() => {
                                setEventId(s.eventId);
                                setDecisions(s.decisions);
                              }}
                              className="text-xs text-accent-strong underline"
                            >
                              Открыть
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                <button onClick={() => persist([])} className="mt-3 text-xs text-ink-3 underline">
                  Очистить
                </button>
              </>
            ) : (
              <p className="text-sm text-ink-3">Соберите план и нажмите «В сравнение».</p>
            )}
          </Card>
        </div>

        {/* Методика */}
        <Card id="method" className="scroll-mt-20">
          <CardTitle hint="Всё детерминировано и воспроизводимо: одинаковый план всегда даёт одинаковый Score.">Как считается Score</CardTitle>
          <div className="grid gap-6 text-sm md:grid-cols-2">
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                Показатель после мер: <code className="rounded bg-card-2 px-1">I′ = clip(I + Σ эффект × (8 − лаг)/8 + синергии, 0, 100)</code>
              </li>
              <li>Балл района: взвешенная сумма 10 показателей (веса 0.09–0.11, сумма 1).</li>
              <li>Средний по городу: баллы районов, взвешенные по доле населения.</li>
              <li>
                <b>Score = 0.7 × средний по городу + 0.3 × слабейший район − 1 × (число показателей ниже 40)</b>
              </li>
            </ol>
            <ul className="space-y-1 text-ink-2">
              <li>• Ровно {RULES.decisions} мер, без повторов, бюджет ≤ {result.budget}, не более {RULES.maxPerDirection} из одного направления.</li>
              {CONFLICTS.map((c) => (
                <li key={c.a + c.b}>
                  • {c.a} и {c.b}: {c.reason}.
                </li>
              ))}
              {SYNERGIES.map((s) => (
                <li key={s.first + s.second}>
                  • Синергия {s.first} + {s.second}: {INDICATOR_INFO[s.indicator].name} +{s.bonus} в районе {s.first}.
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </main>

      <footer className="border-t border-line py-6 text-center text-xs text-ink-3">
        Команда Onix · HackAlem AI 2026 · Спец-трек Astana Innovations · данные синтетические, из ТЗ
      </footer>
    </div>
  );
}

const INDICATOR_KEYS = Object.keys(INDICATOR_INFO) as (keyof typeof INDICATOR_INFO)[];

function MeasureCard({
  m,
  chosen,
  blockReason,
  onAdd,
  onRemove,
}: {
  m: Measure;
  chosen?: Decision;
  blockReason: (m: Measure, districtId: string | null) => string | null;
  onAdd: (m: Measure, districtId: string | null) => void;
  onRemove: (id: string) => void;
}) {
  const share = Math.round(((RULES.horizon - m.lag) / RULES.horizon) * 100);
  const cityReason = m.scope === "city" ? blockReason(m, null) : null;
  return (
    <div className={`rounded-xl border bg-card p-3 transition ${chosen ? "border-accent ring-1 ring-accent" : "border-line"}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium leading-snug">
            <span className="mr-1 text-ink-3">{m.id}</span>
            {m.name}
          </div>
          <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
            {Object.entries(m.effects).map(([k, e]) => (
              <span
                key={k}
                className={`rounded px-1.5 py-0.5 ${(e as number) < 0 ? "bg-crit-soft text-crit" : "bg-card-2 text-ink-2"}`}
                title={INDICATOR_INFO[k as keyof typeof INDICATOR_INFO].name}
              >
                {k} {fmt(e as number)}
              </span>
            ))}
            <span className="rounded px-1.5 py-0.5 text-ink-3">
              лаг {m.lag} · {share}%
            </span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-lg font-bold leading-none">{m.cost}</div>
          <div className="text-[10px] text-ink-3">у.е.</div>
        </div>
      </div>
      <div className="mt-2.5">
        {chosen ? (
          <div className="flex items-center gap-2 text-xs">
            <StatusBadge kind="good">В плане · {districtName(chosen.districtId)}</StatusBadge>
            <button onClick={() => onRemove(m.id)} className="ml-auto text-ink-3 underline hover:text-ink">
              Убрать
            </button>
          </div>
        ) : m.scope === "city" ? (
          <button
            onClick={() => onAdd(m, null)}
            disabled={!!cityReason}
            title={cityReason ?? "Добавить для всего города"}
            className="w-full rounded-lg border border-line py-1 text-xs font-medium enabled:hover:border-accent enabled:hover:text-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
          >
            + Весь город
          </button>
        ) : (
          <div className="grid grid-cols-5 gap-1">
            {DISTRICTS.map((d) => {
              const r = blockReason(m, d.id);
              return (
                <button
                  key={d.id}
                  onClick={() => onAdd(m, d.id)}
                  disabled={!!r}
                  title={r ?? `Добавить: ${d.name}`}
                  className="truncate rounded-lg border border-line px-1 py-1 text-[11px] font-medium enabled:hover:border-accent enabled:hover:text-accent-strong disabled:cursor-not-allowed disabled:opacity-35"
                >
                  {d.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
