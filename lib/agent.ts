// AI-советник акима: агент с инструментами поверх детерминированного движка.
// LLM планирует шаги и формулирует ответ, но каждое число получает только из вызовов инструментов.

import { DIRECTION_LABELS, DISTRICTS, INDICATOR_INFO, MEASURES, RULES } from "./data.ts";
import { districtName, getEvent, optimize, optimizeRobust, robustness, simulate, validate, type Decision, type PlanConstraints } from "./engine.ts";
import { findUnverifiedNumbersInText } from "./explain.ts";
import { activeProvider, publicError } from "./llm.ts";

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentStep {
  tool: string;
  summary: string;
}

export interface AgentReply {
  reply: string;
  steps: AgentStep[];
  proposal?: { decisions: Decision[]; score: number; cost: number; rationale: string };
  model?: string;
  unverifiedNumbers?: string[];
  error?: string;
}

const districtIds = DISTRICTS.map((d) => d.id);

const decisionSchema = {
  type: "object",
  properties: {
    measure_id: { type: "string", enum: MEASURES.map((m) => m.id) },
    district: { type: ["string", "null"], enum: [...districtIds, null], description: "id района для районных мер; null для городских" },
  },
  required: ["measure_id", "district"],
  additionalProperties: false,
};

const TOOLS = [
  {
    type: "function",
    function: {
      name: "simulate_plan",
      description: "Посчитать план (любое число мер от 0 до 5): валидность по правилам, Score, баллы районов, критические показатели. Используй для проверки гипотез «что если».",
      parameters: { type: "object", properties: { decisions: { type: "array", items: decisionSchema } }, required: ["decisions"], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "find_best_plans",
      description: "Полный перебор всех допустимых планов из 5 мер с ограничениями. Возвращает лучшие по Score или по баллу выбранного района.",
      parameters: {
        type: "object",
        properties: {
          must_include: { type: "array", items: decisionSchema, description: "Меры, обязательные в плане (district=null — любой район)" },
          exclude: { type: "array", items: { type: "string", enum: MEASURES.map((m) => m.id) }, description: "Запрещённые меры" },
          exclude_districts: { type: "array", items: { type: "string", enum: districtIds }, description: "Районы, куда нельзя ставить районные меры" },
          max_cost: { type: "number", description: "Потолок стоимости плана" },
          objective: { type: "string", enum: ["score", ...districtIds], description: "score — итоговый Score, либо id района, чей балл максимизировать" },
          top: { type: "integer", minimum: 1, maximum: 5 },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stress_test_plan",
      description: "Прогнать план из 5 мер через все сценарии сразу (без события + 5 городских событий): Score в каждом, где план невыполним, худший случай.",
      parameters: { type: "object", properties: { decisions: { type: "array", items: decisionSchema } }, required: ["decisions"], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "find_robust_plan",
      description: "Найти устойчивый план (максимин): выполним во всех событиях и даёт лучший Score в худшем сценарии.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_plan",
      description: "Предложить пользователю итоговый план из ровно 5 мер (он сможет применить его одной кнопкой). Вызывай, когда рекомендуешь конкретный план.",
      parameters: {
        type: "object",
        properties: { decisions: { type: "array", items: decisionSchema }, rationale: { type: "string" } },
        required: ["decisions", "rationale"],
        additionalProperties: false,
      },
    },
  },
];

const toDecisions = (arr: { measure_id: string; district?: string | null }[] = []): Decision[] =>
  arr.map((d) => ({ measureId: d.measure_id, districtId: d.district ?? null }));

const planText = (ds: Decision[]) => ds.map((d) => `${d.measureId}${d.districtId ? `/${districtName(d.districtId)}` : ""}`).join(", ");

function simulateTool(decisions: Decision[], eventId: string | null) {
  const v = validate(decisions, eventId);
  if (v.issues.some((i) => i.code === "unknown" || i.code === "badDistrict")) return { план: planText(decisions), валиден_как_итоговый: false, нарушения: v.errors };
  const r = simulate(decisions, eventId);
  return {
    план: planText(decisions),
    валиден_как_итоговый: v.ok,
    нарушения: v.errors,
    score: r.score,
    изменение_к_старту: r.delta,
    стоимость: r.cost,
    бюджет: r.budget,
    слабейший_район: `${r.weakestDistrict} (${r.minD})`,
    баллы_районов: Object.fromEntries(r.districts.map((d) => [d.name, `${d.scoreBefore} → ${d.scoreAfter}`])),
    критические_ниже_40: r.critical.map((c) => `${c.district}: ${c.indicator} = ${c.value}`),
    синергии: r.synergies.map((s) => s.pair),
  };
}

function systemPrompt(current: Decision[], eventId: string | null) {
  const ev = getEvent(eventId);
  const catalog = MEASURES.map(
    (m) =>
      `${m.id} ${m.name} [${DIRECTION_LABELS[m.direction]}; ${m.scope === "city" ? "весь город" : "один район"}; стоимость ${m.cost}; лаг ${m.lag}; эффекты ${Object.entries(m.effects)
        .map(([k, e]) => `${k}${(e as number) > 0 ? "+" : ""}${e}`)
        .join(" ")}]`,
  ).join("\n");
  return `Ты — AI-советник акима Астаны в симуляторе «Аким на 5 часов». Отвечай по-русски, кратко и по делу (до 120 слов).

Правила: ровно ${RULES.decisions} мер, бюджет ${ev ? RULES.budget - ev.budgetCut : RULES.budget}, без повторов, не более ${RULES.maxPerDirection} мер из одного направления; M1 и M3 несовместимы; M4+M7 и M5+M13 нельзя в одном районе.
Score = 0.7 × средний балл города (по населению) + 0.3 × балл слабейшего района − 1 × число показателей ниже 40. Эффект меры масштабируется (8 − лаг)/8.
Показатели: ${Object.entries(INDICATOR_INFO)
    .map(([k, i]) => `${k} ${i.name}`)
    .join("; ")}.
Районы (id): ${DISTRICTS.map((d) => `${d.id} = ${d.name} (${Math.round(d.population * 100)}% жителей; ${d.profile})`).join("; ")}.
Каталог:
${catalog}
${ev ? `\nАКТИВНО СОБЫТИЕ: ${ev.title}. ${ev.description}` : ""}
Текущий план пользователя: ${current.length ? `${planText(current)} → ${JSON.stringify(simulateTool(current, eventId))}` : "пока пуст"}.

Как работать:
- НИКОГДА не считай Score и баллы в уме. Любое число бери только из результатов инструментов.
- Для «что если» — simulate_plan. Для «как лучше/оптимизируй/подними район» — find_best_plans с нужными ограничениями.
- ОБЯЗАТЕЛЬНО вызывай propose_plan каждый раз, когда в ответе рекомендуешь конкретный план из 5 мер — иначе пользователь не сможет его применить.
- В ответе сравни с текущим планом пользователя (если он есть) и назови компромисс: что теряем ради цели.
- Про кризисы, риски, «выдержит ли план» — stress_test_plan; для плана, устойчивого ко всем событиям, — find_robust_plan.
- Если запрос невыполним по правилам — объясни, какое правило мешает.`;
}

interface ToolCall {
  id: string;
  name: string;
  args: string;
}

/** Один шаг диалога с LLM: провайдер сам ведёт свою историю сообщений в своём формате. */
interface Provider {
  model: string;
  name: "openai" | "anthropic";
  step(signal: AbortSignal): Promise<{ text: string; calls: ToolCall[] }>;
  addToolResults(results: { id: string; output: unknown }[]): void;
}

function openaiProvider(system: string, history: AgentMessage[]): Provider {
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const messages: unknown[] = [{ role: "system", content: system }, ...history];
  return {
    model,
    name: "openai",
    async step(signal) {
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({ model, temperature: 0.2, messages, tools: TOOLS, tool_choice: "auto" }),
      });
      if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const message = (await res.json()).choices[0].message;
      messages.push(message);
      const calls = ((message.tool_calls ?? []) as { id: string; function: { name: string; arguments: string } }[]).map((c) => ({ id: c.id, name: c.function.name, args: c.function.arguments }));
      return { text: String(message.content ?? ""), calls };
    },
    addToolResults(results) {
      for (const r of results) messages.push({ role: "tool", tool_call_id: r.id, content: JSON.stringify(r.output) });
    },
  };
}

function anthropicProvider(system: string, history: AgentMessage[]): Provider {
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
  const messages: unknown[] = history.map((m) => ({ role: m.role, content: m.content }));
  const tools = TOOLS.map((t) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters }));
  return {
    model,
    name: "anthropic",
    async step(signal) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
        // Без temperature: Claude Sonnet 5 отвечает 400 на не-дефолтные sampling-параметры.
        body: JSON.stringify({ model, max_tokens: 2000, system, tools, messages }),
      });
      if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      const content: { type: string; text?: string; id?: string; name?: string; input?: unknown }[] = data.content ?? [];
      messages.push({ role: "assistant", content });
      return {
        text: content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim(),
        calls: content.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id!, name: b.name!, args: JSON.stringify(b.input ?? {}) })),
      };
    },
    addToolResults(results) {
      messages.push({ role: "user", content: results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: JSON.stringify(r.output) })) });
    },
  };
}

/** Приоритет провайдера: LLM_PROVIDER, иначе Anthropic при наличии ключа, иначе OpenAI. */
function pickProvider(system: string, history: AgentMessage[]): Provider | null {
  const active = activeProvider();
  if (!active) return null;
  return active.name === "anthropic" ? anthropicProvider(system, history) : openaiProvider(system, history);
}

export const agentAvailable = () => activeProvider() !== null;

export async function runAgent(history: AgentMessage[], current: Decision[], eventId: string | null, lang: "ru" | "kz" = "ru"): Promise<AgentReply> {
  if (!agentAvailable()) {
    return {
      reply: "AI-советнику нужен LLM: добавьте OPENAI_API_KEY или ANTHROPIC_API_KEY в .env.local. Остальные функции симулятора (расчёт, оптимум, шаблонный анализ) работают без ключа.",
      steps: [],
      error: "no-key",
    };
  }

  const langRule = lang === "kz" ? "\n\nВАЖНО: отвечай пользователю на казахском языке (қазақ тілі); районы: Есіл, Алматы, Сарыарқа, Байқоңыр, Нұра." : "";
  const recent = history.slice(-8);
  while (recent.length && recent[0].role !== "user") recent.shift(); // Anthropic требует первым сообщением user
  const provider = pickProvider(systemPrompt(current, eventId) + langRule, recent)!;
  const steps: AgentStep[] = [];
  const toolOutputs: unknown[] = [history.filter((m) => m.role === "user").map((m) => m.content), current.length ? simulateTool(current, eventId) : null];
  let proposal: AgentReply["proposal"];
  // Лучший план, найденный инструментами, — страховка, если модель забыла вызвать propose_plan.
  let lastFound: Decision[] | null = null;
  const attachFallback = () => {
    if (proposal || !lastFound || !validate(lastFound, eventId).ok) return;
    const r = simulate(lastFound, eventId);
    proposal = { decisions: lastFound, score: r.score, cost: r.cost, rationale: "Лучший план, найденный инструментом" };
  };
  const model = `${provider.name} · ${provider.model}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    for (let turn = 0; turn < 6; turn++) {
      const { text, calls } = await provider.step(controller.signal);
      if (!calls.length) {
        const reply = text.trim();
        attachFallback();
        return { reply, steps, proposal, model, unverifiedNumbers: findUnverifiedNumbersInText(reply, toolOutputs) };
      }
      const results: { id: string; output: unknown }[] = [];
      for (const call of calls) {
        let output: unknown;
        try {
          const args = JSON.parse(call.args || "{}");
          if (call.name === "simulate_plan") {
            const ds = toDecisions(args.decisions);
            output = simulateTool(ds, eventId);
            steps.push({ tool: "Симуляция", summary: `${planText(ds) || "пустой план"} → Score ${(output as { score: number }).score}` });
          } else if (call.name === "find_best_plans") {
            if (args.objective && args.objective !== "score" && !districtIds.includes(args.objective))
              throw new Error(`objective должен быть "score" или id района: ${districtIds.join(", ")}`);
            const c: PlanConstraints = {
              mustInclude: toDecisions(args.must_include),
              exclude: args.exclude,
              excludeDistricts: args.exclude_districts,
              maxCost: args.max_cost,
              objective: args.objective,
            };
            const plans = optimize(Math.min(args.top ?? 3, 5), eventId, c);
            if (plans[0]) lastFound = plans[0].decisions;
            output = plans.length
              ? plans.map((p) => ({ план: planText(p.decisions), score: p.score, стоимость: p.cost, ...(c.objective && c.objective !== "score" ? { [`балл_${districtName(c.objective)}`]: p.objectiveValue } : {}) }))
              : "Нет ни одного допустимого плана с такими ограничениями.";
            const parts = [
              c.objective && c.objective !== "score" ? `цель: балл ${districtName(c.objective)}` : "цель: Score",
              c.mustInclude?.length ? `обязательно ${planText(c.mustInclude)}` : "",
              c.exclude?.length ? `без ${c.exclude.join(", ")}` : "",
              c.excludeDistricts?.length ? `не трогать ${c.excludeDistricts.map((d) => districtName(d)).join(", ")}` : "",
              c.maxCost ? `бюджет ≤ ${c.maxCost}` : "",
            ].filter(Boolean);
            steps.push({ tool: "Перебор планов", summary: `${parts.join(" · ")} → ${plans.length ? `лучший ${plans[0].score}` : "решений нет"}` });
          } else if (call.name === "stress_test_plan") {
            const ds = toDecisions(args.decisions);
            const r = robustness(ds);
            output = {
              план: planText(ds),
              сценарии: r.outcomes.map((o) => ({ событие: o.eventId ? getEvent(o.eventId)!.title : "без события", score: o.score, выполним: o.valid, причина: o.reason })),
              худший_score: r.worst,
              худшее_событие: r.worstEvent ? getEvent(r.worstEvent)!.title : "без события",
              невыполним_в_сценариях: r.failed,
            };
            steps.push({ tool: "Стресс-тест", summary: `${planText(ds)} → худший ${r.worst ?? "—"}, провалов ${r.failed}` });
          } else if (call.name === "find_robust_plan") {
            const plans = optimizeRobust(3);
            if (plans[0]) lastFound = plans[0].decisions;
            output = plans.map((p) => ({ план: planText(p.decisions), худший_score: p.worst, score_без_событий: p.base, стоимость: p.cost }));
            steps.push({ tool: "Поиск устойчивого плана", summary: `лучший худший случай ${plans[0]?.worst}` });
          } else if (call.name === "propose_plan") {
            const ds = toDecisions(args.decisions);
            const v = validate(ds, eventId);
            if (v.ok) {
              const r = simulate(ds, eventId);
              proposal = { decisions: ds, score: r.score, cost: r.cost, rationale: String(args.rationale ?? "") };
              output = { принято: true, score: r.score, стоимость: r.cost };
              steps.push({ tool: "Предложение", summary: `${planText(ds)} → Score ${r.score}` });
            } else {
              output = { принято: false, нарушения: v.errors };
              steps.push({ tool: "Предложение отклонено валидатором", summary: v.errors[0] });
            }
          } else output = { ошибка: "неизвестный инструмент" };
        } catch (e) {
          output = { ошибка: e instanceof Error ? e.message : String(e) };
        }
        toolOutputs.push(output);
        results.push({ id: call.id, output });
      }
      provider.addToolResults(results);
    }
    attachFallback();
    return {
      reply: proposal ? `Агент не уложился в лимит шагов, но лучший найденный план готов: ${planText(proposal.decisions)} → Score ${proposal.score}.` : "Агент не уложился в лимит шагов — уточните запрос.",
      steps,
      proposal,
      model,
    };
  } catch (e) {
    return { reply: "AI-советник временно недоступен.", steps, proposal, model, error: publicError(e) };
  } finally {
    clearTimeout(timer);
  }
}
