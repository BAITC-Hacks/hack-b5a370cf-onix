// Детерминированный движок расчёта Astana Quality of Life Score.
// Все числа считаются здесь; LLM получает только готовый результат и объясняет его.

import {
  CONFLICTS,
  DIRECTION_LABELS,
  DISTRICTS,
  INDICATOR_INFO,
  INDICATORS,
  MEASURES,
  RULES,
  SYNERGIES,
  type Direction,
  type Indicator,
  type IndicatorValues,
  type Measure,
} from "./data.ts";

export interface Decision {
  measureId: string;
  districtId?: string | null;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  cost: number;
}

const measureById = new Map(MEASURES.map((m) => [m.id, m]));
const districtById = new Map(DISTRICTS.map((d) => [d.id, d]));

export const getMeasure = (id: string): Measure | undefined => measureById.get(id);
export const districtName = (id?: string | null) => (id ? districtById.get(id)?.name ?? id : "весь город");

export function realizedShare(m: Measure): number {
  return (RULES.horizon - m.lag) / RULES.horizon;
}

export function validate(decisions: Decision[]): ValidationResult {
  const errors: string[] = [];
  let cost = 0;

  for (const d of decisions) {
    const m = measureById.get(d.measureId);
    if (!m) {
      errors.push(`Неизвестное мероприятие ${d.measureId}.`);
      continue;
    }
    cost += m.cost;
    if (m.scope === "district" && !d.districtId) errors.push(`${m.id} «${m.name}»: нужно выбрать район.`);
    if (m.scope === "district" && d.districtId && !districtById.has(d.districtId))
      errors.push(`${m.id}: неизвестный район ${d.districtId}.`);
    if (m.scope === "city" && d.districtId) errors.push(`${m.id} — городская мера, район не указывается.`);
  }

  if (decisions.length !== RULES.decisions)
    errors.push(`Нужно ровно ${RULES.decisions} решений, выбрано ${decisions.length}.`);

  const seen = new Set<string>();
  for (const d of decisions) {
    if (seen.has(d.measureId)) errors.push(`${d.measureId} выбрано повторно — каждое мероприятие максимум один раз.`);
    seen.add(d.measureId);
  }

  if (cost > RULES.budget) errors.push(`Бюджет превышен: ${cost} из ${RULES.budget}.`);

  const perDirection = new Map<Direction, number>();
  for (const d of decisions) {
    const m = measureById.get(d.measureId);
    if (m) perDirection.set(m.direction, (perDirection.get(m.direction) ?? 0) + 1);
  }
  for (const [dir, n] of perDirection)
    if (n > RULES.maxPerDirection)
      errors.push(`Направление «${DIRECTION_LABELS[dir]}»: ${n} меры, допускается не более ${RULES.maxPerDirection}.`);

  for (const c of CONFLICTS) {
    const a = decisions.find((d) => d.measureId === c.a);
    const b = decisions.find((d) => d.measureId === c.b);
    if (!a || !b) continue;
    if (!c.sameDistrictOnly) errors.push(`${c.a} и ${c.b} несовместимы: ${c.reason}.`);
    else if (a.districtId && a.districtId === b.districtId)
      errors.push(`${c.a} и ${c.b} в районе ${districtName(a.districtId)}: ${c.reason}.`);
  }

  return { ok: errors.length === 0, errors, cost };
}

export interface DistrictResult {
  id: string;
  name: string;
  population: number;
  before: IndicatorValues;
  after: IndicatorValues;
  scoreBefore: number;
  scoreAfter: number;
}

export interface Contribution {
  measureId: string;
  name: string;
  district: string;
  cost: number;
  lag: number;
  realizedShare: number;
  /** На сколько упадёт Score, если убрать эту меру (при прочих равных). */
  marginalScore: number;
  /** Прирост показателей по районам (до clip) от самой меры. */
  deltas: { district: string; indicator: Indicator; delta: number }[];
}

export interface CriticalCell {
  district: string;
  indicator: Indicator;
  value: number;
}

export interface SimulationResult {
  score: number;
  baseScore: number;
  delta: number;
  cost: number;
  remainingBudget: number;
  dAvg: number;
  minD: number;
  weakestDistrict: string;
  criticalCount: number;
  critical: CriticalCell[];
  districts: DistrictResult[];
  synergies: { pair: string; indicator: Indicator; bonus: number; district: string }[];
}

const round = (x: number, p = 2) => Math.round(x * 10 ** p) / 10 ** p;
const clip = (x: number) => Math.min(100, Math.max(0, x));

function districtScore(values: IndicatorValues): number {
  let s = 0;
  for (const k of INDICATORS) s += INDICATOR_INFO[k].weight * values[k];
  return s;
}

/** Ядро расчёта без валидации — используется и оптимизатором. */
function compute(decisions: Decision[]) {
  const raw = new Map<string, IndicatorValues>(DISTRICTS.map((d) => [d.id, { ...d.values }]));
  const targets = (d: Decision) => (d.districtId ? [d.districtId] : DISTRICTS.map((x) => x.id));

  for (const d of decisions) {
    const m = measureById.get(d.measureId)!;
    const share = realizedShare(m);
    for (const id of targets(d)) {
      const vals = raw.get(id)!;
      for (const [k, e] of Object.entries(m.effects) as [Indicator, number][]) vals[k] += e * share;
    }
  }

  const appliedSynergies: SimulationResult["synergies"] = [];
  for (const s of SYNERGIES) {
    const first = decisions.find((d) => d.measureId === s.first);
    const second = decisions.find((d) => d.measureId === s.second);
    if (!first || !second) continue;
    for (const id of targets(first)) raw.get(id)![s.indicator] += s.bonus;
    appliedSynergies.push({ pair: `${s.first}+${s.second}`, indicator: s.indicator, bonus: s.bonus, district: districtName(first.districtId) });
  }

  const critical: CriticalCell[] = [];
  const districts: DistrictResult[] = DISTRICTS.map((d) => {
    const after = { ...raw.get(d.id)! };
    for (const k of INDICATORS) {
      after[k] = clip(after[k]);
      if (after[k] < RULES.criticalThreshold) critical.push({ district: d.name, indicator: k, value: round(after[k]) });
    }
    return {
      id: d.id,
      name: d.name,
      population: d.population,
      before: d.values,
      after,
      scoreBefore: districtScore(d.values),
      scoreAfter: districtScore(after),
    };
  });

  const dAvg = districts.reduce((s, d) => s + d.population * d.scoreAfter, 0);
  const weakest = districts.reduce((a, b) => (b.scoreAfter < a.scoreAfter ? b : a));
  const score = RULES.avgWeight * dAvg + RULES.minWeight * weakest.scoreAfter - RULES.criticalPenalty * critical.length;

  return { score, dAvg, weakest, critical, districts, appliedSynergies };
}

export const BASE_SCORE = compute([]).score;

export function scoreOnly(decisions: Decision[]): number {
  return compute(decisions).score;
}

export function simulate(decisions: Decision[]): SimulationResult {
  const r = compute(decisions);
  const cost = decisions.reduce((s, d) => s + (measureById.get(d.measureId)?.cost ?? 0), 0);
  return {
    score: round(r.score),
    baseScore: round(BASE_SCORE),
    delta: round(r.score - BASE_SCORE),
    cost,
    remainingBudget: RULES.budget - cost,
    dAvg: round(r.dAvg),
    minD: round(r.weakest.scoreAfter),
    weakestDistrict: r.weakest.name,
    criticalCount: r.critical.length,
    critical: r.critical,
    districts: r.districts.map((d) => ({
      ...d,
      after: Object.fromEntries(INDICATORS.map((k) => [k, round(d.after[k])])) as IndicatorValues,
      scoreBefore: round(d.scoreBefore),
      scoreAfter: round(d.scoreAfter),
    })),
    synergies: r.appliedSynergies,
  };
}

/** Вклад каждой меры: leave-one-out по Score + прямые приросты показателей. */
export function contributions(decisions: Decision[]): Contribution[] {
  const full = scoreOnly(decisions);
  return decisions.map((d) => {
    const m = measureById.get(d.measureId)!;
    const share = realizedShare(m);
    const without = scoreOnly(decisions.filter((x) => x !== d));
    const targets = d.districtId ? [districtName(d.districtId)] : ["весь город"];
    return {
      measureId: m.id,
      name: m.name,
      district: districtName(d.districtId),
      cost: m.cost,
      lag: m.lag,
      realizedShare: share,
      marginalScore: round(full - without),
      deltas: targets.flatMap((t) =>
        (Object.entries(m.effects) as [Indicator, number][]).map(([k, e]) => ({ district: t, indicator: k, delta: round(e * share) })),
      ),
    };
  });
}

export interface RankedPlan {
  decisions: Decision[];
  score: number;
  cost: number;
}

let optimumCache: RankedPlan[] | null = null;

/** Полный перебор всех допустимых наборов (~700 тыс.) — находит глобальный оптимум по правилам ТЗ. */
export function optimize(top = 5): RankedPlan[] {
  if (optimumCache) return optimumCache.slice(0, top);
  const best: RankedPlan[] = [];
  const keep = 20;
  const ids = MEASURES.map((m) => m.id);

  const combos = (start: number, acc: string[]): string[][] => {
    if (acc.length === RULES.decisions) return [acc];
    const out: string[][] = [];
    for (let i = start; i < ids.length; i++) out.push(...combos(i + 1, [...acc, ids[i]]));
    return out;
  };

  for (const combo of combos(0, [])) {
    const ms = combo.map((id) => measureById.get(id)!);
    if (ms.reduce((s, m) => s + m.cost, 0) > RULES.budget) continue;
    const options = ms.map((m) => (m.scope === "city" ? [null] : DISTRICTS.map((d) => d.id)));
    const place = (i: number, acc: Decision[]) => {
      if (i === ms.length) {
        if (!validate(acc).ok) return;
        const score = scoreOnly(acc);
        if (best.length < keep || score > best[best.length - 1].score) {
          best.push({ decisions: acc, score, cost: ms.reduce((s, m) => s + m.cost, 0) });
          best.sort((a, b) => b.score - a.score);
          if (best.length > keep) best.pop();
        }
        return;
      }
      for (const districtId of options[i]) place(i + 1, [...acc, { measureId: ms[i].id, districtId }]);
    };
    place(0, []);
  }

  optimumCache = best.map((p) => ({ ...p, score: round(p.score) }));
  return optimumCache.slice(0, top);
}

export interface SwapSuggestion {
  remove: Decision;
  add: Decision;
  newScore: number;
  gain: number;
}

/** Лучшая замена одной меры на другую (с учётом всех правил) — практичная подсказка «что поменять». */
export function bestSwap(decisions: Decision[]): SwapSuggestion | null {
  const current = scoreOnly(decisions);
  let best: SwapSuggestion | null = null;
  decisions.forEach((out, i) => {
    for (const m of MEASURES) {
      if (decisions.some((d) => d.measureId === m.id && d !== out)) continue;
      for (const districtId of m.scope === "city" ? [null] : DISTRICTS.map((d) => d.id)) {
        const add = { measureId: m.id, districtId };
        if (add.measureId === out.measureId && add.districtId === (out.districtId ?? null)) continue;
        const next = decisions.map((d, j) => (j === i ? add : d));
        if (!validate(next).ok) continue;
        const s = scoreOnly(next);
        if (s - current > 0.005 && (!best || s > best.newScore))
          best = { remove: out, add, newScore: round(s), gain: round(s - current) };
      }
    }
  });
  return best;
}
