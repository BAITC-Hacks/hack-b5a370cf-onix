"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RULES } from "@/lib/data";
import { contributions, districtName, getEvent, getMeasure, simulate, validate, type Decision } from "@/lib/engine";
import type { Explanation } from "@/lib/explain";
import { decodePlan } from "@/lib/plan-url";
import { ContributionChart, DistrictDumbbell } from "./charts";
import { ExplanationView } from "./ExplanationView";
import { Heatmap } from "./Heatmap";
import { Button, StatusBadge } from "./ui";

const fmt = (x: number) => (x > 0 ? `+${x}` : `${x}`);

/** Одностраничный отчёт-презентация решения команды: печатается в PDF из браузера. */
export default function Report() {
  const [plan, setPlan] = useState<{ decisions: Decision[]; eventId: string | null } | null>(null);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // URL доступен только в браузере.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlan(decodePlan(new URLSearchParams(location.search)));
  }, []);

  const decisions = plan?.decisions ?? [];
  const eventId = plan?.eventId ?? null;
  const validation = validate(decisions, eventId);
  const result = simulate(decisions, eventId);
  const contrib = contributions(decisions, eventId);
  const event = getEvent(eventId);

  useEffect(() => {
    if (!plan || !validation.ok) return;
    fetch("/api/explain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(plan) })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.reasons?.join(" ") ?? data.error);
        setExplanation(data);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, [plan, validation.ok]);

  if (!plan) return null;
  if (!validation.ok)
    return (
      <div className="mx-auto max-w-2xl p-8">
        <h1 className="text-2xl font-bold">План невалиден</h1>
        <ul className="mt-3 space-y-1">
          {validation.errors.map((e) => (
            <li key={e}>
              <StatusBadge kind="crit">{e}</StatusBadge>
            </li>
          ))}
        </ul>
        <Link href="/" className="mt-4 inline-block text-accent-strong underline">
          Вернуться в симулятор
        </Link>
      </div>
    );

  const date = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-8 print:max-w-none print:p-0">
      <div className="no-print flex gap-2">
        <Button variant="primary" onClick={() => print()}>
          Сохранить PDF / Печать
        </Button>
        <a href={`/?${location.search.slice(1)}`} className="inline-flex items-center rounded-lg border border-line px-3 py-1.5 text-sm">
          Открыть в симуляторе
        </a>
      </div>

      <header className="border-b border-line pb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Astana Quality of Life · отчёт о решении</p>
        <h1 className="mt-2 text-3xl font-bold">План развития Астаны на 2 года</h1>
        <p className="mt-1 text-sm text-ink-2">
          Симулятор «Аким на 5 часов» · {date}
          {event && ` · с учётом события «${event.title}»`}
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-2xl bg-accent p-4 text-white sm:col-span-2 print:border print:border-black print:bg-white print:text-black">
          <div className="text-sm opacity-85">Astana Quality of Life Score</div>
          <div className="text-5xl font-bold">{result.score.toFixed(2)}</div>
          <div className="text-sm">
            {fmt(result.delta)} к стартовому {result.baseScore}
          </div>
        </div>
        <Kpi label="Бюджет" value={`${result.cost} / ${result.budget}`} />
        <Kpi label={`Слабейший район · ${result.weakestDistrict}`} value={result.minD.toFixed(2)} />
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Пять решений</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-ink-3">
            <tr>
              <th className="py-1 font-medium">Мера</th>
              <th className="font-medium">Где</th>
              <th className="text-right font-medium">Стоимость</th>
              <th className="text-right font-medium">Лаг</th>
              <th className="text-right font-medium">Вклад в Score</th>
            </tr>
          </thead>
          <tbody>
            {decisions.map((d) => {
              const m = getMeasure(d.measureId)!;
              const c = contrib.find((x) => x.measureId === d.measureId)!;
              return (
                <tr key={d.measureId} className="border-t border-line">
                  <td className="py-1.5">
                    <b>{m.id}</b> {m.name}
                  </td>
                  <td>{districtName(d.districtId)}</td>
                  <td className="text-right">{m.cost}</td>
                  <td className="text-right">{m.lag} кв.</td>
                  <td className="text-right font-semibold">{fmt(c.marginalScore)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {result.synergies.length > 0 && (
          <p className="mt-2 text-xs text-ink-2">Синергии: {result.synergies.map((s) => `${s.pair} (${s.indicator} +${s.bonus}, ${s.district})`).join(", ")}</p>
        )}
      </section>

      <section className="grid gap-6 break-inside-avoid md:grid-cols-2">
        <div>
          <h2 className="mb-3 text-lg font-semibold">Районы: до и после</h2>
          <DistrictDumbbell districts={result.districts} weakest={result.weakestDistrict} />
        </div>
        <div>
          <h2 className="mb-3 text-lg font-semibold">Вклад мер</h2>
          <ContributionChart items={contrib} />
        </div>
      </section>

      <section className="break-inside-avoid">
        <h2 className="mb-3 text-lg font-semibold">AI-разбор решения</h2>
        {explanation ? <ExplanationView e={explanation} /> : error ? <StatusBadge kind="crit">{error}</StatusBadge> : <div className="h-24 animate-pulse rounded-xl bg-card-2" />}
      </section>

      <section className="break-inside-avoid">
        <h2 className="mb-3 text-lg font-semibold">Показатели районов</h2>
        <Heatmap districts={result.districts} />
      </section>

      <footer className="border-t border-line pt-3 text-xs text-ink-3">
        Score = 0.7 × средний балл города (по населению) + 0.3 × балл слабейшего района − 1 × число показателей ниже {RULES.criticalThreshold}. Числа рассчитаны
        детерминированным движком; AI объясняет готовые результаты. Команда Onix · HackAlem AI 2026.
      </footer>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-card p-4">
      <div className="text-xs text-ink-3">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}
