"use client";

import Link from "next/link";
import { useEffect } from "react";
import { RULES } from "@/lib/data";
import { getMeasure, simulate } from "@/lib/engine";
import { useApp } from "./AppState";
import { ContributionChart, DistrictDumbbell } from "./charts";
import { ExplanationView } from "./ExplanationView";
import { Heatmap } from "./Heatmap";
import { Button, StatusBadge } from "./ui";

const fmt = (x: number) => (x > 0 ? `+${x}` : `${x}`);

const TXT = {
  ru: {
    invalid: "План невалиден",
    back: "Вернуться к плану",
    print: "Сохранить PDF / Печать",
    openSim: "Открыть в симуляторе",
    kicker: "Astana Quality of Life · отчёт о решении",
    title: "План развития Астаны на 2 года",
    sub: "Симулятор «Аким на 5 часов»",
    withEvent: "с учётом события",
    five: "Пять решений",
    measure: "Мера",
    where: "Где",
    contrib: "Вклад в Score",
    synergies: "Синергии",
    aiTitle: "AI-разбор решения",
    foot: "Числа рассчитаны детерминированным движком; AI объясняет готовые результаты. Команда Onix · HackAlem AI 2026.",
  },
  kz: {
    invalid: "Жоспар жарамсыз",
    back: "Жоспарға оралу",
    print: "PDF сақтау / Басып шығару",
    openSim: "Симуляторда ашу",
    kicker: "Astana Quality of Life · шешім туралы есеп",
    title: "Астананы 2 жылға дамыту жоспары",
    sub: "«5 сағатқа әкім» симуляторы",
    withEvent: "оқиғаны ескере отырып",
    five: "Бес шешім",
    measure: "Шара",
    where: "Қайда",
    contrib: "Score-ға үлесі",
    synergies: "Синергиялар",
    aiTitle: "Шешімді AI-талдау",
    foot: "Сандарды детерминацияланған қозғалтқыш есептеген; AI дайын нәтижелерді түсіндіреді. Onix командасы · HackAlem AI 2026.",
  },
};

/** Одностраничный отчёт-презентация решения команды: печатается в PDF из браузера. */
export default function Report() {
  const app = useApp();
  const { tr, lang, ready, decisions, event, result, contrib, validation, complete, explanation, explaining, explainError, runExplain, planQuery } = app;
  const x = TXT[lang];

  useEffect(() => {
    if (ready && complete && !explanation && !explaining && !explainError) runExplain();
  }, [ready, complete, explanation, explaining, explainError, runExplain]);

  if (!ready) return null;
  if (!complete)
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-bold">{x.invalid}</h1>
        <ul className="mt-3 space-y-1">
          {validation.issues.map((i, k) => (
            <li key={k}>
              <StatusBadge kind="crit">{tr.issue(i)}</StatusBadge>
            </li>
          ))}
        </ul>
        <Link href="/plan" className="mt-4 inline-block text-accent-strong underline">
          {x.back}
        </Link>
      </div>
    );

  const now = new Date();
  const siteDecision = decisions.find((d) => d.districtId === "nura" && (d.measureId === "M4" || d.measureId === "M7"));
  const siteIndicator = siteDecision?.measureId === "M7" ? "S1" as const : "E1" as const;
  const siteDistrict = result.districts.find((d) => d.id === "nura")!;
  const siteWithout = siteDecision
    ? simulate(decisions.filter((d) => d !== siteDecision), app.eventId).districts.find((d) => d.id === "nura")!
    : null;
  const KZ_MONTHS = ["қаңтар", "ақпан", "наурыз", "сәуір", "мамыр", "маусым", "шілде", "тамыз", "қыркүйек", "қазан", "қараша", "желтоқсан"];
  const date = lang === "kz" ? `${now.getDate()} ${KZ_MONTHS[now.getMonth()]} ${now.getFullYear()} ж.` : now.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="mx-auto max-w-4xl space-y-6 print:max-w-none">
      <div className="no-print flex gap-2">
        <Button variant="primary" onClick={() => print()}>
          {x.print}
        </Button>
        <Link href={`/plan?${planQuery}`} className="inline-flex items-center rounded-lg border border-line px-3 py-1.5 text-sm">
          {x.openSim}
        </Link>
      </div>

      <header className="border-b border-line pb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">{x.kicker}</p>
        <h1 className="mt-2 text-3xl font-bold">{x.title}</h1>
        <p className="mt-1 text-sm text-ink-2">
          {x.sub} · {date}
          {event && ` · ${x.withEvent} «${tr.event(event.id).title}»`}
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-2xl bg-accent p-4 text-white sm:col-span-2 print:border print:border-black print:bg-white print:text-black">
          <div className="text-sm opacity-85">Astana {tr.t("score")}</div>
          <div className="text-5xl font-bold">{result.score.toFixed(2)}</div>
          <div className="text-sm">
            {fmt(result.delta)} {tr.t("toStart")} {result.baseScore}
          </div>
        </div>
        <Kpi label={tr.t("budget")} value={`${result.cost} / ${result.budget}`} />
        <Kpi label={`${tr.t("weakest")} · ${tr.districtByName(result.weakestDistrict)}`} value={result.minD.toFixed(2)} />
      </section>

      {siteDecision && (
        <section className="break-inside-avoid rounded-xl border border-accent/30 bg-accent-soft/20 px-4 py-3 text-sm">
          <div className="font-semibold">{tr.t("projectSite")} · {siteDecision.measureId === "M7" ? tr.t("projectSchool") : tr.t("projectPark")}</div>
          <div className="mt-1 text-ink-2">
            {tr.t("projectMarginalChange", {
              name: `${siteIndicator} ${tr.indicator(siteIndicator)}`,
              before: siteWithout!.after[siteIndicator],
              after: siteDistrict.after[siteIndicator],
            })} · {tr.t("projectCostLag", { cost: getMeasure(siteDecision.measureId)!.cost, quarter: getMeasure(siteDecision.measureId)!.lag + 1 })}
          </div>
          <p className="mt-1 text-xs text-ink-3">{tr.t("projectSiteDisclaimer")}</p>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-lg font-semibold">{x.five}</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-ink-3">
            <tr>
              <th className="py-1 font-medium">{x.measure}</th>
              <th className="font-medium">{x.where}</th>
              <th className="text-right font-medium">{tr.t("cost")}</th>
              <th className="text-right font-medium">{tr.t("lag")}</th>
              <th className="text-right font-medium">{x.contrib}</th>
            </tr>
          </thead>
          <tbody>
            {decisions.map((d) => {
              const m = getMeasure(d.measureId)!;
              const c = contrib.find((y) => y.measureId === d.measureId)!;
              return (
                <tr key={d.measureId} className="border-t border-line">
                  <td className="py-1.5">
                    <b>{m.id}</b> {tr.measure(m.id)}
                  </td>
                  <td>{tr.district(d.districtId)}</td>
                  <td className="text-right">{m.cost}</td>
                  <td className="text-right">{m.lag}</td>
                  <td className="text-right font-semibold">{fmt(c.marginalScore)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {result.synergies.length > 0 && (
          <p className="mt-2 text-xs text-ink-2">
            {x.synergies}: {result.synergies.map((s) => `${s.pair} (${s.indicator} +${s.bonus}, ${tr.districtByName(s.district)})`).join(", ")}
          </p>
        )}
      </section>

      <section className="grid gap-6 break-inside-avoid md:grid-cols-2">
        <div>
          <h2 className="mb-3 text-lg font-semibold">{tr.t("districtsTitle")}</h2>
          <DistrictDumbbell districts={result.districts} weakest={result.weakestDistrict} />
        </div>
        <div>
          <h2 className="mb-3 text-lg font-semibold">{tr.t("contribTitle")}</h2>
          <ContributionChart items={contrib} />
        </div>
      </section>

      <section className="break-inside-avoid">
        <h2 className="mb-3 text-lg font-semibold">{x.aiTitle}</h2>
        {explanation ? (
          <ExplanationView e={explanation} />
        ) : explainError ? (
          <StatusBadge kind="crit">{explainError}</StatusBadge>
        ) : (
          <div className="h-24 animate-pulse rounded-xl bg-card-2" />
        )}
      </section>

      <section className="break-inside-avoid">
        <h2 className="mb-3 text-lg font-semibold">{tr.t("heatTitle")}</h2>
        <Heatmap districts={result.districts} />
      </section>

      <footer className="border-t border-line pt-3 text-xs text-ink-3">
        {tr.t("m4").replace("40", String(RULES.criticalThreshold))}. {x.foot}
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
