// AI-слой: LLM получает только посчитанные движком факты и объясняет их.
// Числа LLM не считает. Если ключа нет или API упал — детерминированный шаблон с той же структурой.

import { DIRECTION_LABELS, DISTRICTS, INDICATOR_INFO, MEASURES, RULES, type Direction, type Indicator } from "./data.ts";
import { activeProvider, publicError } from "./llm.ts";
import {
  bestSwap,
  contributions,
  districtName,
  getEvent,
  getMeasure,
  optimize,
  simulate,
  type Contribution,
  type Decision,
  type RankedPlan,
  type SimulationResult,
} from "./engine.ts";

export interface Explanation {
  summary: string;
  strengths: string[];
  risks: string[];
  tradeoffs: string[];
  recommendations: string[];
  source: "anthropic" | "openai" | "fallback";
  model?: string;
  /** Числа из ответа LLM, которых нет в исходных фактах — показываем как предупреждение. */
  unverifiedNumbers?: string[];
  /** Утверждения о показателях, которые противоречат результату расчёта. */
  unverifiedClaims?: string[];
  error?: string;
}

export interface ExplainContext {
  decisions: Decision[];
  eventId: string | null;
  result: SimulationResult;
  contributions: Contribution[];
  optimum: RankedPlan;
  optimumScore: number;
  planLabel: string[];
  optimumLabel: string[];
}

const label = (d: Decision) => {
  const m = getMeasure(d.measureId)!;
  return `${m.id} «${m.name}» — ${districtName(d.districtId)} (стоимость ${m.cost}, лаг ${m.lag} кв.)`;
};

export function buildContext(decisions: Decision[], eventId: string | null = null): ExplainContext {
  const [optimum] = optimize(1, eventId);
  return {
    decisions,
    eventId,
    result: simulate(decisions, eventId),
    contributions: contributions(decisions, eventId),
    optimum,
    optimumScore: optimum.score,
    planLabel: decisions.map(label),
    optimumLabel: optimum.decisions.map(label),
  };
}

/** Компактный набор фактов для LLM — всё, на что он имеет право ссылаться. */
function factsForLLM(ctx: ExplainContext) {
  const r = ctx.result;
  const before = simulate([], ctx.eventId);
  const roundedDifference = (after: number, start: number) => Math.round((after - start) * 100) / 100;
  return {
    городское_событие: (() => {
      const ev = getEvent(ctx.eventId);
      return ev
        ? {
            название: ev.title,
            описание: ev.description,
            сокращение_бюджета: ev.budgetCut,
            удар_по_показателям: ev.shocks.map((s) => `${districtName(s.districtId)}: ${INDICATOR_INFO[s.indicator].name} ${s.delta}`),
            базовый_score_без_события: r.baseScoreNoEvent,
          }
        : "нет";
    })(),
    правила: { бюджет: r.budget, решений: RULES.decisions, горизонт_кварталов: RULES.horizon, порог_критического_значения: RULES.criticalThreshold },
    формула: "Score = 0.7 × средневзвешенный по населению балл районов + 0.3 × балл самого слабого района − 1 × число показателей ниже 40",
    выбранный_набор: ctx.planLabel,
    итог: {
      score: r.score,
      базовый_score: r.baseScore,
      изменение: r.delta,
      потрачено: r.cost,
      остаток_бюджета: r.remainingBudget,
      средний_балл_города_до: before.dAvg,
      средний_балл_города_после: r.dAvg,
      средний_балл_города_прирост: roundedDifference(r.dAvg, before.dAvg),
      разрыв_до_оптимума: roundedDifference(ctx.optimumScore, r.score),
      самый_слабый_район: r.weakestDistrict,
      балл_слабого_района: r.minD,
      критических_значений: r.criticalCount,
      критические: r.critical.map((c) => `${c.district}: ${INDICATOR_INFO[c.indicator].name} = ${c.value}`),
      сработавшие_синергии: r.synergies.map((s) => ({
        пара: s.pair,
        показатель: s.indicator,
        название_показателя: INDICATOR_INFO[s.indicator].name,
        прирост: s.bonus,
        район: s.district,
      })),
    },
    районы: r.districts.map((d) => ({
      район: d.name,
      доля_населения: d.population,
      балл_до: d.scoreBefore,
      балл_после: d.scoreAfter,
      изменение_балла: roundedDifference(d.scoreAfter, d.scoreBefore),
      изменения: Object.fromEntries(
        (Object.keys(d.after) as Indicator[])
          .filter((k) => d.after[k] !== d.before[k])
          .map((k) => [INDICATOR_INFO[k].name, `${d.before[k]} → ${d.after[k]}`]),
      ),
    })),
    вклад_мер: ctx.contributions.map((c) => ({
      мера: `${c.measureId} «${c.name}»`,
      район: c.district,
      потеря_score_если_убрать: c.marginalScore,
      реализованная_доля_эффекта: `${Math.round(c.realizedShare * 100)}%`,
    })),
    лучшая_одиночная_замена: (() => {
      const s = bestSwap(ctx.decisions, ctx.eventId);
      return s ? { убрать: label(s.remove), добавить: label(s.add), новый_score: s.newScore, прирост: s.gain } : "замен, улучшающих Score, нет";
    })(),
    оптимальный_набор_по_полному_перебору: { score: ctx.optimumScore, меры: ctx.optimumLabel },
    набор_уже_оптимален: ctx.optimumScore - r.score <= 0.01,
  };
}

const SYSTEM_PROMPT = `Ты — аналитик городского развития Астаны в симуляторе «Аким на 5 часов».
Тебе дают ГОТОВЫЕ результаты расчёта (JSON). Твоя задача — объяснить их управленцу простым языком на русском.
Жёсткие правила:
- Используй ТОЛЬКО числа из переданного JSON. Ничего не пересчитывай и не придумывай новых цифр.
- Не вычитай значения «до» и «после» самостоятельно. Для разницы используй только готовые поля: «изменение» для Score, «средний_балл_города_прирост» для D_avg, «изменение_балла» в строке района, «разрыв_до_оптимума» для сравнения с лучшим планом. Если готового прироста нет, не называй его числом.
- Различай Score и средний балл города (D_avg): это разные числа. Сравнивай «до → после» только внутри одной метрики из одноимённых полей JSON. Балл отдельного района бери только из его строки в «районы».
- Не выдумывай факты о районах сверх данных.
- Говори конкретно: какая мера, в каком районе, какой показатель, как изменился.
- Описывай синергии только по полю «сработавшие_синергии»: пара, точный показатель, прирост и район. M10+M12 даёт бонус к B1 «Безопасность улиц»; скорость решения обращений (C2) — отдельный эффект M12, не эффект этой синергии.
- Отдельно отметь компромиссы: что пришлось не делать и какой район/направление остался без внимания.
- Рекомендации строй ТОЛЬКО на полях «лучшая_одиночная_замена» и «оптимальный_набор_по_полному_перебору». Не предлагай ничего, что нарушает правила: лаг и эффект меры изменить нельзя, меру нельзя повторить, решений ровно 5, бюджет фиксирован.
- Если «набор_уже_оптимален» = true — прямо скажи, что это лучший возможный набор по правилам, и вместо замен опиши, чем пришлось пожертвовать (районы и направления без вложений) и за чем следить.
- Если есть городское событие — оцени, насколько сценарий на него отвечает (закрыт ли удар по показателям, хватило ли урезанного бюджета).
Ответ строго JSON без markdown:
{"summary": "2-3 предложения", "strengths": ["..."], "risks": ["..."], "tradeoffs": ["..."], "recommendations": ["..."]}
В каждом списке 2-4 пункта, каждый пункт — одно-два предложения.`;

async function callAnthropic(prompt: string, signal: AbortSignal) {
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    // Без temperature: Claude Sonnet 5 отвечает 400 на любые не-дефолтные sampling-параметры.
    body: JSON.stringify({ model, max_tokens: 4000, system: SYSTEM_PROMPT, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return { text: data.content?.map((c: { text?: string }) => c.text ?? "").join("") ?? "", model };
}

async function callOpenAI(prompt: string, signal: AbortSignal) {
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return { text: data.choices?.[0]?.message?.content ?? "", model };
}

function parseLLM(text: string): Omit<Explanation, "source"> {
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const o = JSON.parse(json);
  const list = (x: unknown) => (Array.isArray(x) ? x.map(String).filter(Boolean) : []);
  if (typeof o.summary !== "string") throw new Error("LLM вернул ответ без summary");
  return { summary: o.summary, strengths: list(o.strengths), risks: list(o.risks), tradeoffs: list(o.tradeoffs), recommendations: list(o.recommendations) };
}

/** Константы каталога и правил: их числа LLM вправе называть без специальной передачи в фактах. */
const CATALOG_NUMBERS: number[] = [
  ...Object.values(RULES),
  ...MEASURES.flatMap((m) => [m.cost, m.lag, ...Object.values(m.effects)]),
  ...DISTRICTS.flatMap((d) => [d.population, Math.round(d.population * 100), ...Object.values(d.values)]),
  ...Object.values(INDICATOR_INFO).flatMap((i) => [i.weight, Math.round(i.weight * 100)]),
];

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const numeric = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const numberInText = (raw: string) => Number(raw.replace(",", "."));
const METRIC_NUMBER = "(-?\\d+(?:[.,]\\d+)?)";
const metricRange = new RegExp(`^\\s*(?:(?:повысился|повысилась|вырос|выросла|увеличился|увеличилась|изменился|изменилась|снизился|снизилась)\\s+)?с\\s*${METRIC_NUMBER}\\s+до\\s+${METRIC_NUMBER}`, "i");
const metricChange = new RegExp(`^\\s*[:—–-]?\\s*(?:(?:повысился|повысилась|вырос|выросла|увеличился|увеличилась|изменился|изменилась|снизился|снизилась)\\s+на|(?:прирост|изменение)(?:\\s+составил[оа]?)?)\\s*${METRIC_NUMBER}`, "i");
const metricValue = new RegExp(`^\\s*(?:(?:равен|равна|составляет|составил|составила|стал|стала|достиг|достигла|будет|вырос\\s+до|повысился\\s+до|после\\s+мер|до\\s+мер)\\s*)?(?:[:=—–-]\\s*)?${METRIC_NUMBER}`, "i");

/** Проверка только явно названной метрики; числа из соседних полей её не подтверждают. */
function checkNamedMetric(text: string, name: RegExp, before: number | undefined, after: number | undefined, change: number | undefined, suspicious: Set<string>) {
  if (before === undefined && after === undefined && change === undefined) return;
  for (const match of text.matchAll(name)) {
    const tail = text.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 100)
      .split(/,\s+|;\s*|[!?]\s+|\.\s+(?=[A-Za-zА-ЯЁҚҰӨІ])/u)[0];
    const range = tail.match(metricRange);
    if (range) {
      if (before !== undefined && numberInText(range[1]) !== before) suspicious.add(range[1]);
      if (after !== undefined && numberInText(range[2]) !== after) suspicious.add(range[2]);
      continue;
    }
    const delta = tail.match(metricChange)?.[1];
    if (delta) {
      if (change !== undefined && Math.abs(numberInText(delta)) !== Math.abs(change)) suspicious.add(delta);
      continue;
    }
    const single = tail.match(metricValue)?.[1];
    if (single && (before !== undefined || after !== undefined) && numberInText(single) !== before && numberInText(single) !== after) suspicious.add(single);
  }
}

const DISTRICT_FORMS: Record<string, string[]> = {
  esil: ["Есиля", "Есіл"],
  almaty: ["Алматы"],
  saryarka: ["Сарыарки", "Сарыарқа"],
  baikonur: ["Байконура", "Байқоңыр"],
  nura: ["Нуры", "Нұра"],
};
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function checkStructuredMetrics(text: string, facts: unknown, suspicious: Set<string>) {
  const root = asRecord(facts);
  const result = asRecord(root?.итог);
  if (!result) return; // В ответах агента нет структуры аналитика: остаётся общая проверка Score.

  const avgBefore = numeric(result.средний_балл_города_до);
  const avgAfter = numeric(result.средний_балл_города_после) ?? numeric(result.средний_балл_города);
  checkNamedMetric(text, /(?:общий\s+)?(?:средневзвешенный|средний)\s+(?:по\s+населению\s+)?балл\s+(?:города|районов)|D[_\s-]?avg/gi,
    avgBefore, avgAfter, numeric(result.средний_балл_города_прирост), suspicious);
  checkNamedMetric(text, /\bScore\b/gi, undefined, undefined, numeric(result.изменение), suspicious);
  checkNamedMetric(text, /разрыв\s+до\s+оптимума|отставание\s+от\s+оптимума/gi,
    undefined, numeric(result.разрыв_до_оптимума), undefined, suspicious);

  for (const item of Array.isArray(root?.районы) ? root.районы : []) {
    const district = asRecord(item);
    if (!district || typeof district.район !== "string") continue;
    const id = DISTRICTS.find((d) => d.name === district.район)?.id;
    const forms = [...new Set([district.район, ...(id ? DISTRICT_FORMS[id] ?? [] : [])])].map(escapeRegExp).join("|");
    const name = new RegExp(`(?:балл(?:а)?\\s+(?:района\\s+)?(?:${forms})|(?:${forms})\\s*[:—–-]?\\s*балл(?:а)?(?:\\s+района)?)`, "gi");
    checkNamedMetric(text, name, numeric(district.балл_до), numeric(district.балл_после), numeric(district.изменение_балла), suspicious);
  }
}

/**
 * Находит в тексте LLM числа, которых нет ни в фактах, ни в каталоге (защита от «придуманных» цифр).
 * Для заявленного Score сравнивает только с рассчитанными Score: бюджет 100 не доказывает Score 100.
 * Учитывает доли (0.27 → 27%), годы, идентификаторы мер/показателей и десятичную запятую.
 */
export function findUnverifiedNumbersInText(text: string, facts: unknown): string[] {
  const allowed = new Set<string>();
  const scoreValues = new Set<string>();
  const add = (n: number) => {
    allowed.add(String(Math.abs(n)));
    if (Math.abs(n) < 1) allowed.add(String(Math.round(Math.abs(n) * 100)));
  };
  const collectScores = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (/score/i.test(key) && typeof item === "number" && Number.isFinite(item)) scoreValues.add(String(item));
      collectScores(item);
    }
  };
  collectScores(facts);
  for (const n of JSON.stringify(facts).match(/-?\d+(?:\.\d+)?/g) ?? []) add(Number(n));
  for (const n of CATALOG_NUMBERS) add(n);
  const cleaned = text
    .replace(/\b(?:M|T|E|S|B|C)\d{1,2}\b/g, " ") // id мер и показателей (M13, T1)
    .replace(/\b(?:19|20)\d{2}\b/g, " "); // годы
  const suspicious = new Set<string>();
  // Абсолютное значение Score должно встречаться в расчётах именно как Score.
  // Прирост «Score вырос на 3.98» остаётся обычным числом и проверяется ниже.
  const scoreClaim = /\bScore\b\s*(?:(?:равен|составляет|составит|будет|достигнет|вырастет\s+до|увеличится\s+до)\s*|[=:—–-]\s*)?(\d+(?:[.,]\d+)?)/gi;
  for (const match of text.matchAll(scoreClaim)) {
    const raw = match[1];
    // В записи формулы «Score = 0.7 × ...» число — коэффициент, а не итог.
    if (/^[×*]/.test(text.slice((match.index ?? 0) + match[0].length).trimStart())) continue;
    if (raw && !scoreValues.has(String(Number(raw.replace(",", "."))))) suspicious.add(raw);
  }
  checkStructuredMetrics(text, facts, suspicious);
  const ok = (raw: string) => {
    const n = Number(raw.replace(",", "."));
    if (Number.isInteger(n) && n <= 10) return true; // мелкие счётные числа (5 решений, 2 района)
    if (allowed.has(String(n))) return true;
    // «45,62» — перечисление, а не десятичная дробь
    if (raw.includes(",")) return raw.split(",").every((part) => allowed.has(part) || Number(part) <= 10);
    return false;
  };
  for (const raw of cleaned.match(/\d+(?:[.,]\d+)?/g) ?? []) if (!ok(raw)) suspicious.add(raw);
  return [...suspicious];
}

/** Синергия привязана к одному показателю; совпадение числа бонуса не доказывает другой эффект. */
export function findUnverifiedClaimsInText(text: string, facts: unknown): string[] {
  const synergies = asRecord(asRecord(facts)?.итог)?.сработавшие_синергии;
  if (!Array.isArray(synergies)) return [];
  const warnings = new Set<string>();
  for (const value of synergies) {
    const synergy = asRecord(value);
    if (typeof synergy?.пара !== "string" || typeof synergy.показатель !== "string") continue;
    const indicator = synergy.показатель as Indicator;
    if (!INDICATOR_INFO[indicator]) continue;
    const pair = synergy.пара;
    const ids = pair.match(/^(M\d+)\+(M\d+)$/);
    const pairPattern = ids
      ? `\\b(?:${ids[1]}\\s*(?:\\+|и|&|and)\\s*${ids[2]}|${ids[2]}\\s*(?:\\+|и|&|and)\\s*${ids[1]})\\b`
      : escapeRegExp(pair);
    for (const match of text.matchAll(new RegExp(pairPattern, "gi"))) {
      const afterPair = (match.index ?? 0) + match[0].length;
      const clause = text.slice(afterPair, afterPair + 140)
        .split(/,\s+|[.;\n]|\s+(?:и|а)\s+M\d+\b/i)[0];
      const otherIndicator = (Object.keys(INDICATOR_INFO) as Indicator[]).some((key) =>
        key !== indicator && (new RegExp(`\\b${key}\\b`, "i").test(clause) || clause.toLocaleLowerCase("ru").includes(INDICATOR_INFO[key].name.toLocaleLowerCase("ru"))));
      const wronglyAsResponseSpeed = pair === "M10+M12" && /(?:скорост\w*|быстр\w*|реакц\w*)[^.;]{0,40}обращен\w*/i.test(clause);
      if (otherIndicator || wronglyAsResponseSpeed)
        warnings.add(`Синергия ${pair} влияет на ${indicator} «${INDICATOR_INFO[indicator].name}»`);
    }
  }
  return [...warnings];
}

function findUnverifiedNumbers(e: Omit<Explanation, "source">, facts: unknown): string[] {
  return findUnverifiedNumbersInText([e.summary, ...e.strengths, ...e.risks, ...e.tradeoffs, ...e.recommendations].join(" "), facts);
}

function findUnverifiedClaims(e: Omit<Explanation, "source">, facts: unknown): string[] {
  return findUnverifiedClaimsInText([e.summary, ...e.strengths, ...e.risks, ...e.tradeoffs, ...e.recommendations].join(" "), facts);
}

export async function explain(decisions: Decision[], eventId: string | null = null, lang: "ru" | "kz" = "ru"): Promise<Explanation> {
  const ctx = buildContext(decisions, eventId);
  const facts = factsForLLM(ctx);
  const langRule = lang === "kz" ? "\n\nВАЖНО: весь ответ (все значения JSON) напиши на казахском языке (қазақ тілі), названия районов по-казахски: Есіл, Алматы, Сарыарқа, Байқоңыр, Нұра." : "";
  const prompt = `Результаты расчёта сценария:\n${JSON.stringify(facts, null, 1)}${langRule}`;

  const active = activeProvider();
  if (!active) return fallbackExplanation(ctx);
  const provider = active.name;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const { text, model } = provider === "anthropic" ? await callAnthropic(prompt, controller.signal) : await callOpenAI(prompt, controller.signal);
    const parsed = parseLLM(text);
    return { ...parsed, source: provider, model, unverifiedNumbers: findUnverifiedNumbers(parsed, facts), unverifiedClaims: findUnverifiedClaims(parsed, facts) };
  } catch (err) {
    return { ...fallbackExplanation(ctx), error: publicError(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** Детерминированное объяснение без LLM — те же разделы, собранные правилами из результата расчёта. */
export function fallbackExplanation(ctx: ExplainContext): Explanation {
  const r = ctx.result;
  const sorted = [...ctx.contributions].sort((a, b) => b.marginalScore - a.marginalScore);
  const fmt = (x: number) => (x > 0 ? `+${x}` : `${x}`);

  const strengths = sorted
    .filter((c) => c.marginalScore > 0)
    .slice(0, 3)
    .map((c) => {
      const top = [...c.deltas].sort((a, b) => b.delta - a.delta)[0];
      return `${c.measureId} «${c.name}» (${c.district}) даёт ${fmt(c.marginalScore)} к Score: ${INDICATOR_INFO[top.indicator].name} ${fmt(top.delta)}.`;
    });
  for (const s of r.synergies) strengths.push(`Сработала синергия ${s.pair}: ${INDICATOR_INFO[s.indicator].name} +${s.bonus} (${s.district}).`);

  const risks: string[] = [];
  for (const c of r.critical) risks.push(`${c.district}: ${INDICATOR_INFO[c.indicator].name} = ${c.value} — ниже порога 40, штраф −1 к Score.`);
  risks.push(`Самый слабый район — ${r.weakestDistrict} (${r.minD}); он определяет 30% итоговой оценки.`);
  const slow = ctx.contributions.filter((c) => c.lag >= 3);
  if (slow.length)
    risks.push(`Долгие проекты за 2 года срабатывают не полностью: ${slow.map((c) => `${c.measureId} — ${Math.round(c.realizedShare * 100)}% эффекта`).join(", ")}.`);
  const weak = sorted.filter((c) => c.marginalScore <= 0.2);
  for (const c of weak.slice(0, 2)) risks.push(`${c.measureId} «${c.name}» почти не влияет на Score (${fmt(c.marginalScore)}) — бюджет ${c.cost} можно использовать эффективнее.`);

  const used = new Set(ctx.contributions.map((c) => getMeasure(c.measureId)!.direction));
  const missing = (Object.keys(DIRECTION_LABELS) as Direction[]).filter((d) => !used.has(d));
  const touched = new Set(ctx.contributions.filter((c) => c.district !== "весь город").map((c) => c.district));
  const cityWide = ctx.contributions.some((c) => c.district === "весь город");
  const untouched = DISTRICTS.map((d) => d.name).filter((n) => !touched.has(n));
  const tradeoffs: string[] = [];
  if (missing.length) tradeoffs.push(`Без вложений остались направления: ${missing.map((d) => DIRECTION_LABELS[d]).join(", ")}.`);
  if (untouched.length)
    tradeoffs.push(`Районы без адресных мер: ${untouched.join(", ")}${cityWide ? " (получают только эффект городских программ)" : ""}.`);
  if (r.remainingBudget > 0) tradeoffs.push(`Остаток бюджета ${r.remainingBudget} не даёт бонуса — его можно направить на ещё одну меру через замену.`);

  const ev = getEvent(ctx.eventId);
  if (ev) {
    for (const sh of ev.shocks) {
      const d = r.districts.find((x) => x.id === sh.districtId)!;
      const v = d.after[sh.indicator];
      const answered = v > d.before[sh.indicator];
      risks.unshift(
        `Событие «${ev.title}»: ${d.name}, ${INDICATOR_INFO[sh.indicator].name} = ${v}${v < RULES.criticalThreshold ? " — всё ещё ниже порога 40" : ""}${answered ? " (сценарий реагирует на удар)" : " (сценарий не реагирует на удар)"}.`,
      );
    }
    if (ev.budgetCut) tradeoffs.unshift(`Из-за события бюджет сокращён на ${ev.budgetCut}: доступно ${r.budget}.`);
  }

  const recommendations: string[] = [];
  const swap = bestSwap(ctx.decisions, ctx.eventId);
  if (swap) recommendations.push(`Лучшая одиночная замена: ${label(swap.remove)} → ${label(swap.add)}. Score станет ${swap.newScore} (+${swap.gain}).`);
  const gap = Math.round((ctx.optimumScore - r.score) * 100) / 100;
  if (gap <= 0.01) recommendations.push(`Ваш набор совпадает с оптимумом полного перебора (Score ${ctx.optimumScore}).`);
  else {
    const mine = new Set(ctx.planLabel);
    const add = ctx.optimumLabel.filter((l) => !mine.has(l));
    const opt = new Set(ctx.optimumLabel);
    const drop = ctx.planLabel.filter((l) => !opt.has(l));
    recommendations.push(`Оптимальный набор даёт Score ${ctx.optimumScore} (на ${gap} больше).`);
    if (drop.length) recommendations.push(`Убрать: ${drop.join("; ")}.`);
    if (add.length) recommendations.push(`Добавить: ${add.join("; ")}.`);
  }

  return {
    summary: `${ev ? `С учётом события «${ev.title}» с` : "С"}ценарий стоит ${r.cost} из ${r.budget} и даёт Astana Quality of Life Score ${r.score} (${fmt(r.delta)} к базе ${r.baseScore}). Средний балл города ${r.dAvg}, самый слабый район — ${r.weakestDistrict} (${r.minD}), критических значений: ${r.criticalCount}.`,
    strengths: strengths.length ? strengths : ["Ни одна мера заметно не повлияла на Score."],
    risks,
    tradeoffs: tradeoffs.length ? tradeoffs : ["Заметных компромиссов нет: затронуты все направления и районы."],
    recommendations,
    source: "fallback",
  };
}
