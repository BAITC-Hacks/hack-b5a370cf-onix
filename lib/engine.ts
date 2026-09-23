// Детерминированный движок расчёта Astana Quality of Life Score.
// Все числа считаются здесь; LLM получает только готовый результат и объясняет его.

import {
  CONFLICTS,
  DIRECTION_LABELS,
  DISTRICTS,
  EVENTS,
  INDICATOR_INFO,
  INDICATORS,
  MEASURES,
  RULES,
  SYNERGIES,
  type CityEvent,
  type Direction,
  type Indicator,
  type IndicatorValues,
  type Measure,
} from "./data.ts";

export interface Decision {
  measureId: string;
  districtId?: string | null;
}

export type IssueCode = "unknown" | "needDistrict" | "badDistrict" | "cityNoDistrict" | "count" | "duplicate" | "budget" | "direction" | "conflict" | "conflictSame";

/** Структурированное нарушение правила — UI переводит его на нужный язык. */
export interface Issue {
  code: IssueCode;
  measureId?: string;
  otherId?: string;
  districtId?: string;
  direction?: Direction;
  n?: number;
  limit?: number;
}

export interface ValidationResult {
  ok: boolean;
  /** Причины на русском — для API, LLM и тестов. */
  errors: string[];
  issues: Issue[];
  cost: number;
}

const round = (x: number, p = 2) => Math.round(x * 10 ** p) / 10 ** p;
const clip = (x: number) => Math.min(100, Math.max(0, x));

const measureById = new Map(MEASURES.map((m) => [m.id, m]));
const districtById = new Map(DISTRICTS.map((d) => [d.id, d]));

export const getMeasure = (id: string): Measure | undefined => measureById.get(id);
export const districtName = (id?: string | null) => (id ? districtById.get(id)?.name ?? id : "весь город");

export const getEvent = (id?: string | null): CityEvent | undefined => (id ? EVENTS.find((e) => e.id === id) : undefined);
export const budgetFor = (eventId?: string | null) => RULES.budget - (getEvent(eventId)?.budgetCut ?? 0);

/** Стартовые значения районов с учётом события (до принятия мер). */
function startValues(eventId?: string | null): Map<string, IndicatorValues> {
  const map = new Map<string, IndicatorValues>(DISTRICTS.map((d) => [d.id, { ...d.values }]));
  for (const sh of getEvent(eventId)?.shocks ?? []) {
    const vals = map.get(sh.districtId)!;
    vals[sh.indicator] = clip(vals[sh.indicator] + sh.delta);
  }
  return map;
}

export function realizedShare(m: Measure): number {
  return (RULES.horizon - m.lag) / RULES.horizon;
}

/**
 * Доля эффекта, накопленная к кварталу q (0…8): мера начинает работать после лага и набирает 1/8 за квартал.
 * При q = 8 совпадает с формулой ТЗ (8 − L)/8.
 */
export function shareAt(m: Measure, quarter: number): number {
  return Math.max(0, Math.min(quarter, RULES.horizon) - m.lag) / RULES.horizon;
}

export function validate(decisions: Decision[], eventId?: string | null): ValidationResult {
  const errors: string[] = [];
  const issues: Issue[] = [];
  const fail = (issue: Issue, text: string) => {
    issues.push(issue);
    errors.push(text);
  };
  let cost = 0;

  for (const d of decisions) {
    const m = measureById.get(d.measureId);
    if (!m) {
      fail({ code: "unknown", measureId: d.measureId }, `Неизвестное мероприятие ${d.measureId}.`);
      continue;
    }
    cost += m.cost;
    if (m.scope === "district" && !d.districtId) fail({ code: "needDistrict", measureId: m.id }, `${m.id} «${m.name}»: нужно выбрать район.`);
    if (m.scope === "district" && d.districtId && !districtById.has(d.districtId))
      fail({ code: "badDistrict", measureId: m.id, districtId: d.districtId }, `${m.id}: неизвестный район ${d.districtId}.`);
    if (m.scope === "city" && d.districtId) fail({ code: "cityNoDistrict", measureId: m.id }, `${m.id} — городская мера, район не указывается.`);
  }

  if (decisions.length !== RULES.decisions)
    fail({ code: "count", n: decisions.length, limit: RULES.decisions }, `Нужно ровно ${RULES.decisions} решений, выбрано ${decisions.length}.`);

  const seen = new Set<string>();
  for (const d of decisions) {
    if (seen.has(d.measureId)) fail({ code: "duplicate", measureId: d.measureId }, `${d.measureId} выбрано повторно — каждое мероприятие максимум один раз.`);
    seen.add(d.measureId);
  }

  const budget = budgetFor(eventId);
  if (cost > budget) fail({ code: "budget", n: cost, limit: budget }, `Бюджет превышен: ${cost} из ${budget}.`);

  const perDirection = new Map<Direction, number>();
  for (const d of decisions) {
    const m = measureById.get(d.measureId);
    if (m) perDirection.set(m.direction, (perDirection.get(m.direction) ?? 0) + 1);
  }
  for (const [dir, n] of perDirection)
    if (n > RULES.maxPerDirection)
      fail(
        { code: "direction", direction: dir, n, limit: RULES.maxPerDirection },
        `Направление «${DIRECTION_LABELS[dir]}»: ${n} меры, допускается не более ${RULES.maxPerDirection}.`,
      );

  for (const c of CONFLICTS) {
    const a = decisions.find((d) => d.measureId === c.a);
    const b = decisions.find((d) => d.measureId === c.b);
    if (!a || !b) continue;
    if (!c.sameDistrictOnly) fail({ code: "conflict", measureId: c.a, otherId: c.b }, `${c.a} и ${c.b} несовместимы: ${c.reason}.`);
    else if (a.districtId && a.districtId === b.districtId)
      fail(
        { code: "conflictSame", measureId: c.a, otherId: c.b, districtId: a.districtId },
        `${c.a} и ${c.b} в районе ${districtName(a.districtId)}: ${c.reason}.`,
      );
  }

  return { ok: errors.length === 0, errors, issues, cost };
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
  /** Базовый Score без события — для сравнения. */
  baseScoreNoEvent: number;
  delta: number;
  cost: number;
  budget: number;
  remainingBudget: number;
  dAvg: number;
  minD: number;
  weakestDistrict: string;
  criticalCount: number;
  critical: CriticalCell[];
  districts: DistrictResult[];
  synergies: { pair: string; indicator: Indicator; bonus: number; district: string }[];
}


function districtScore(values: IndicatorValues): number {
  let s = 0;
  for (const k of INDICATORS) s += INDICATOR_INFO[k].weight * values[k];
  return s;
}

/** Ядро расчёта без валидации — используется и оптимизатором. */
function compute(decisions: Decision[], eventId?: string | null, quarter: number = RULES.horizon) {
  const start = startValues(eventId);
  const raw = new Map<string, IndicatorValues>([...start].map(([id, v]) => [id, { ...v }]));
  // Целевые районы: городская мера — все районы; районная — только известный выбранный район (иначе эффекта нет).
  const targets = (m: Measure, d: Decision) => (m.scope === "city" ? DISTRICTS.map((x) => x.id) : d.districtId && districtById.has(d.districtId) ? [d.districtId] : []);

  for (const d of decisions) {
    const m = measureById.get(d.measureId);
    if (!m) continue; // мусор из ссылки/API не должен ронять расчёт — валидатор сообщит о нём отдельно
    const share = shareAt(m, quarter);
    for (const id of targets(m, d)) {
      const vals = raw.get(id)!;
      for (const [k, e] of Object.entries(m.effects) as [Indicator, number][]) vals[k] += e * share;
    }
  }

  const appliedSynergies: SimulationResult["synergies"] = [];
  for (const s of SYNERGIES) {
    const first = decisions.find((d) => d.measureId === s.first);
    const second = decisions.find((d) => d.measureId === s.second);
    if (!first || !second) continue;
    // Синергия появляется, когда обе меры уже заработали.
    if (shareAt(measureById.get(s.first)!, quarter) <= 0 || shareAt(measureById.get(s.second)!, quarter) <= 0) continue;
    for (const id of targets(measureById.get(s.first)!, first)) raw.get(id)![s.indicator] += s.bonus;
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
      before: start.get(d.id)!,
      after,
      scoreBefore: districtScore(start.get(d.id)!),
      scoreAfter: districtScore(after),
    };
  });

  const dAvg = districts.reduce((s, d) => s + d.population * d.scoreAfter, 0);
  const weakest = districts.reduce((a, b) => (b.scoreAfter < a.scoreAfter ? b : a));
  const score = RULES.avgWeight * dAvg + RULES.minWeight * weakest.scoreAfter - RULES.criticalPenalty * critical.length;

  return { score, dAvg, weakest, critical, districts, appliedSynergies };
}

export const BASE_SCORE = compute([]).score;

export function scoreOnly(decisions: Decision[], eventId?: string | null): number {
  return compute(decisions, eventId).score;
}

export function simulate(decisions: Decision[], eventId?: string | null): SimulationResult {
  const r = compute(decisions, eventId);
  const base = eventId ? compute([], eventId).score : BASE_SCORE;
  const cost = decisions.reduce((s, d) => s + (measureById.get(d.measureId)?.cost ?? 0), 0);
  return {
    score: round(r.score),
    baseScore: round(base),
    baseScoreNoEvent: round(BASE_SCORE),
    delta: round(r.score - base),
    cost,
    budget: budgetFor(eventId),
    remainingBudget: budgetFor(eventId) - cost,
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
export function contributions(decisions: Decision[], eventId?: string | null): Contribution[] {
  const full = scoreOnly(decisions, eventId);
  return decisions.flatMap((d) => {
    const m = measureById.get(d.measureId);
    if (!m) return [];
    const share = realizedShare(m);
    const without = scoreOnly(decisions.filter((x) => x !== d), eventId);
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

const optimumCache = new Map<string, RankedPlan[]>();

export interface PlanConstraints {
  /** Меры, которые обязательно должны быть в плане (id), опционально с районом. */
  mustInclude?: Decision[];
  /** Меры, которые нельзя использовать. */
  exclude?: string[];
  /** Районы, в которые нельзя ставить районные меры. */
  excludeDistricts?: string[];
  /** Дополнительный потолок бюджета (не выше бюджета правил). */
  maxCost?: number;
  /** Что максимизировать: итоговый Score (по умолчанию) или балл конкретного района. */
  objective?: "score" | string;
}

export interface ConstrainedPlan extends RankedPlan {
  objectiveValue: number;
}


// ---------- Быстрый числовой путь для перебора (те же правила и формула, без объектов и строк) ----------

const N_IND = INDICATORS.length;
const IDX = (d: number, k: number) => d * N_IND + k;
const districtIndex = new Map(DISTRICTS.map((d, i) => [d.id, i]));
const weights = INDICATORS.map((k) => INDICATOR_INFO[k].weight);
const pops = DISTRICTS.map((d) => d.population);

/** Стартовые значения (с учётом события) в плоском массиве 5×10. */
const startCache = new Map<string, Float64Array>();
function startFlat(eventId?: string | null): Float64Array {
  const key = getEvent(eventId)?.id ?? "";
  let arr = startCache.get(key);
  if (!arr) {
    arr = new Float64Array(DISTRICTS.length * N_IND);
    const start = startValues(eventId);
    DISTRICTS.forEach((d, di) => INDICATORS.forEach((k, ki) => (arr![IDX(di, ki)] = start.get(d.id)![k])));
    startCache.set(key, arr);
  }
  return arr;
}

/** Вклад меры в конкретном районе (или во всех для городских) за полный горизонт. */
const deltaCache = new Map<string, Float64Array>();
function deltaFlat(m: Measure, districtId: string | null): Float64Array {
  const key = `${m.id}:${districtId ?? "*"}`;
  let arr = deltaCache.get(key);
  if (!arr) {
    arr = new Float64Array(DISTRICTS.length * N_IND);
    const share = realizedShare(m);
    const targets = m.scope === "city" ? DISTRICTS.map((_, i) => i) : districtIndex.has(districtId ?? "") ? [districtIndex.get(districtId!)!] : [];
    for (const di of targets) for (const [k, e] of Object.entries(m.effects) as [Indicator, number][]) arr[IDX(di, INDICATORS.indexOf(k))] += e * share;
    deltaCache.set(key, arr);
  }
  return arr;
}

const synergyFast = SYNERGIES.map((s) => ({ ...s, k: INDICATORS.indexOf(s.indicator) }));

/** Score и баллы районов для набора — численно идентично compute() при quarter = 8. */
export function evalFast(decisions: Decision[], eventId?: string | null): { score: number; districts: number[] } {
  const vals = Float64Array.from(startFlat(eventId));
  for (const d of decisions) {
    const m = measureById.get(d.measureId);
    if (!m) continue;
    const delta = deltaFlat(m, d.districtId ?? null);
    for (let i = 0; i < vals.length; i++) vals[i] += delta[i];
  }
  for (const s of synergyFast) {
    const first = decisions.find((d) => d.measureId === s.first);
    if (!first || !decisions.some((d) => d.measureId === s.second)) continue;
    const fm = measureById.get(s.first)!;
    if (fm.scope === "city") for (let di = 0; di < DISTRICTS.length; di++) vals[IDX(di, s.k)] += s.bonus;
    else if (districtIndex.has(first.districtId ?? "")) vals[IDX(districtIndex.get(first.districtId!)!, s.k)] += s.bonus;
  }
  let crit = 0;
  let avg = 0;
  let min = Infinity;
  const districts: number[] = [];
  for (let di = 0; di < DISTRICTS.length; di++) {
    let dScore = 0;
    for (let ki = 0; ki < N_IND; ki++) {
      let v = vals[IDX(di, ki)];
      v = v < 0 ? 0 : v > 100 ? 100 : v;
      if (v < RULES.criticalThreshold) crit++;
      dScore += weights[ki] * v;
    }
    districts.push(dScore);
    avg += pops[di] * dScore;
    if (dScore < min) min = dScore;
  }
  return { score: RULES.avgWeight * avg + RULES.minWeight * min - RULES.criticalPenalty * crit, districts };
}

/** Быстрая проверка правил для перебора: направления и несовместимости (остальное гарантирует сама генерация). */
function comboAllowed(ms: Measure[]): boolean {
  const perDir = new Map<Direction, number>();
  for (const m of ms) {
    const n = (perDir.get(m.direction) ?? 0) + 1;
    if (n > RULES.maxPerDirection) return false;
    perDir.set(m.direction, n);
  }
  for (const c of CONFLICTS) if (!c.sameDistrictOnly && ms.some((m) => m.id === c.a) && ms.some((m) => m.id === c.b)) return false;
  return true;
}
function placementAllowed(plan: Decision[]): boolean {
  for (const c of CONFLICTS) {
    if (!c.sameDistrictOnly) continue;
    const a = plan.find((d) => d.measureId === c.a);
    const b = plan.find((d) => d.measureId === c.b);
    if (a && b && a.districtId && a.districtId === b.districtId) return false;
  }
  return true;
}

/** Обходит все допустимые по правилам наборы из 5 мер с учётом ограничений и вызывает cb для каждого. */
export function forEachPlan(eventId: string | null | undefined, constraints: PlanConstraints, cb: (plan: Decision[], cost: number) => void) {
  const budget = Math.min(budgetFor(eventId), constraints.maxCost ?? Infinity);
  const exclude = new Set(constraints.exclude ?? []);
  const excludeDistricts = new Set(constraints.excludeDistricts ?? []);
  const must = constraints.mustInclude ?? [];
  const ids = MEASURES.map((m) => m.id).filter((id) => !exclude.has(id));

  const combos: string[][] = [];
  const walk = (start: number, acc: string[]) => {
    if (acc.length === RULES.decisions) return void combos.push(acc);
    for (let i = start; i < ids.length; i++) walk(i + 1, [...acc, ids[i]]);
  };
  walk(0, []);

  for (const combo of combos) {
    if (!must.every((m) => combo.includes(m.measureId))) continue;
    const ms = combo.map((id) => measureById.get(id)!);
    const cost = ms.reduce((s, m) => s + m.cost, 0);
    if (cost > budget || !comboAllowed(ms)) continue;
    const options = ms.map((m) => {
      if (m.scope === "city") return [null];
      const fixed = must.find((x) => x.measureId === m.id)?.districtId;
      if (fixed) return [fixed];
      return DISTRICTS.map((d) => d.id).filter((id) => !excludeDistricts.has(id));
    });
    const place = (i: number, acc: Decision[]) => {
      if (i === ms.length) {
        if (placementAllowed(acc)) cb(acc, cost);
        return;
      }
      for (const districtId of options[i]) place(i + 1, [...acc, { measureId: ms[i].id, districtId }]);
    };
    place(0, []);
  }
}

/**
 * Перебор всех допустимых наборов (~700 тыс. без ограничений) с учётом события и ограничений.
 * Без ограничений результат кэшируется — это глобальный оптимум по правилам ТЗ.
 */
export function optimize(top = 5, eventId?: string | null, constraints: PlanConstraints = {}): ConstrainedPlan[] {
  const constrained = Object.values(constraints).some((v) => (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== "score"));
  const key = getEvent(eventId)?.id ?? "";
  const cached = !constrained && optimumCache.get(key);
  if (cached) return cached.slice(0, top) as ConstrainedPlan[];

  const objective = constraints.objective && constraints.objective !== "score" ? constraints.objective : null;
  if (objective && !districtById.has(objective)) throw new Error(`Неизвестная цель оптимизации: ${objective}`);
  const keep = Math.max(20, top);
  const best: ConstrainedPlan[] = [];
  const objIndex = objective ? districtIndex.get(objective)! : -1;
  forEachPlan(eventId, constraints, (acc, cost) => {
    const r = evalFast(acc, eventId);
    const value = objective ? r.districts[objIndex] : r.score;
    const worst = best[best.length - 1];
    if (best.length < keep || value > worst.objectiveValue || (value === worst.objectiveValue && r.score > worst.score)) {
      best.push({ decisions: acc, score: r.score, cost, objectiveValue: value });
      best.sort((a, b) => b.objectiveValue - a.objectiveValue || b.score - a.score);
      if (best.length > keep) best.pop();
    }
  });

  const ranked = best.map((p) => ({ ...p, score: round(p.score), objectiveValue: round(p.objectiveValue) }));
  if (!constrained) optimumCache.set(key, ranked);
  return ranked.slice(0, top);
}

export interface SwapSuggestion {
  remove: Decision;
  add: Decision;
  newScore: number;
  gain: number;
}

/** Лучшая замена одной меры на другую (с учётом всех правил) — практичная подсказка «что поменять». */
export function bestSwap(decisions: Decision[], eventId?: string | null): SwapSuggestion | null {
  const current = scoreOnly(decisions, eventId);
  let best: SwapSuggestion | null = null;
  decisions.forEach((out, i) => {
    for (const m of MEASURES) {
      if (decisions.some((d) => d.measureId === m.id && d !== out)) continue;
      for (const districtId of m.scope === "city" ? [null] : DISTRICTS.map((d) => d.id)) {
        const add = { measureId: m.id, districtId };
        if (add.measureId === out.measureId && add.districtId === (out.districtId ?? null)) continue;
        const next = decisions.map((d, j) => (j === i ? add : d));
        if (!validate(next, eventId).ok) continue;
        const s = scoreOnly(next, eventId);
        if (s - current > 0.005 && (!best || s > best.newScore))
          best = { remove: out, add, newScore: round(s), gain: round(s - current) };
      }
    }
  });
  return best;
}

export interface QuarterPoint {
  quarter: number;
  score: number;
  districts: DistrictResult[];
  /** Меры, уже приносящие эффект в этом квартале. */
  active: string[];
}

/** Траектория плана по кварталам 0…8 — как Score растёт по мере срабатывания мер. */
export function timeline(decisions: Decision[], eventId?: string | null): QuarterPoint[] {
  return Array.from({ length: RULES.horizon + 1 }, (_, q) => {
    const r = compute(decisions, eventId, q);
    return {
      quarter: q,
      score: round(r.score),
      districts: r.districts.map((d) => ({
        ...d,
        after: Object.fromEntries(INDICATORS.map((k) => [k, round(d.after[k])])) as IndicatorValues,
        scoreBefore: round(d.scoreBefore),
        scoreAfter: round(d.scoreAfter),
      })),
      active: decisions.filter((d) => measureById.has(d.measureId) && shareAt(measureById.get(d.measureId)!, q) > 0).map((d) => d.measureId),
    };
  });
}

export interface ScenarioOutcome {
  eventId: string | null;
  valid: boolean;
  score: number | null;
  /** Причина невалидности (например, план не влезает в урезанный бюджет). */
  reason?: string;
}

export interface Robustness {
  outcomes: ScenarioOutcome[];
  /** Худший Score среди сценариев, где план валиден. */
  worst: number | null;
  worstEvent: string | null;
  /** Сценарии, в которых план невыполним (урезанный бюджет). */
  failed: number;
}

/** Стресс-тест: план прогоняется без события и через все события сразу. */
export function robustness(decisions: Decision[]): Robustness {
  const scenarios: (string | null)[] = [null, ...EVENTS.map((e) => e.id)];
  const outcomes = scenarios.map((eventId) => {
    const v = validate(decisions, eventId);
    return v.ok ? { eventId, valid: true, score: round(scoreOnly(decisions, eventId)) } : { eventId, valid: false, score: null, reason: v.errors[0] };
  });
  const valid = outcomes.filter((o) => o.valid);
  const worstO = valid.reduce<ScenarioOutcome | null>((a, o) => (!a || (o.score ?? 0) < (a.score ?? 0) ? o : a), null);
  return { outcomes, worst: worstO?.score ?? null, worstEvent: worstO?.eventId ?? null, failed: outcomes.length - valid.length };
}

export interface RobustPlan {
  decisions: Decision[];
  cost: number;
  worst: number;
  worstEvent: string | null;
  base: number;
}

let robustCache: RobustPlan[] | null = null;

/**
 * Устойчивый оптимум (максимин): план, который валиден во всех событиях (влезает в самый урезанный бюджет)
 * и максимизирует худший Score по всем сценариям.
 */
export function optimizeRobust(top = 3): RobustPlan[] {
  if (robustCache) return robustCache.slice(0, top);
  const scenarios: (string | null)[] = [null, ...EVENTS.map((e) => e.id)];
  const minBudget = Math.min(...scenarios.map((e) => budgetFor(e)));
  const best: RobustPlan[] = [];
  const keep = 10;
  forEachPlan(null, { maxCost: minBudget }, (plan, cost) => {
    let worst = Infinity;
    let worstEvent: string | null = null;
    let base = 0;
    for (const e of scenarios) {
      const sc = evalFast(plan, e).score;
      if (e === null) base = sc;
      if (sc < worst) {
        worst = sc;
        worstEvent = e;
      }
      if (best.length >= keep && worst <= best[best.length - 1].worst) return;
    }
    best.push({ decisions: plan, cost, worst, worstEvent, base });
    best.sort((a, b) => b.worst - a.worst || b.base - a.base);
    if (best.length > keep) best.pop();
  });
  for (const p of best) {
    p.worst = round(p.worst);
    p.base = round(p.base);
  }
  robustCache = best;
  return best.slice(0, top);
}

/** Приводит произвольный вход (ссылка, localStorage, API) к списку решений с известными мерами и районами. */
export function sanitizeDecisions(input: unknown, max = RULES.decisions): Decision[] {
  if (!Array.isArray(input)) return [];
  const out: Decision[] = [];
  for (const x of input) {
    if (!x || typeof x !== "object") continue;
    const { measureId, districtId } = x as { measureId?: unknown; districtId?: unknown };
    if (typeof measureId !== "string" || !measureById.has(measureId)) continue;
    const district = measureById.get(measureId)!.scope === "district" && typeof districtId === "string" && districtById.has(districtId) ? districtId : null;
    const dup = out.find((d) => d.measureId === measureId);
    if (dup) {
      if (!dup.districtId && district) dup.districtId = district; // из дубликатов оставляем тот, где район корректен
      continue;
    }
    out.push({ measureId, districtId: district });
    if (out.length >= max) break;
  }
  return out;
}

/** Нормализует id события: неизвестные значения превращаются в null (без события). */
export const normalizeEventId = (raw: unknown): string | null => (typeof raw === "string" && getEvent(raw) ? raw : null);

/** Прогрев кэшей оптимума и устойчивого плана (вызывается при старте сервера). */
export function warmUp() {
  const t0 = Date.now();
  optimize(5, null);
  for (const e of EVENTS) optimize(5, e.id);
  optimizeRobust(3);
  return Date.now() - t0;
}
