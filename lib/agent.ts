// AI-советник акима: агент с инструментами поверх детерминированного движка.
// LLM планирует шаги и формулирует ответ, но каждое число получает только из вызовов инструментов.

import { DIRECTION_LABELS, DISTRICTS, INDICATOR_INFO, MEASURES, RULES } from "./data.ts";
import { districtName, getEvent, optimize, simulate, validate, type Decision, type PlanConstraints } from "./engine.ts";
import { findUnverifiedNumbersInText } from "./explain.ts";

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
- Если запрос невыполним по правилам — объясни, какое правило мешает.`;
}

async function chat(messages: unknown[], signal: AbortSignal) {
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model, temperature: 0.2, messages, tools: TOOLS, tool_choice: "auto" }),
  });
  if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return { message: data.choices[0].message, model };
}

export const agentAvailable = () => Boolean(process.env.OPENAI_API_KEY);

export async function runAgent(history: AgentMessage[], current: Decision[], eventId: string | null): Promise<AgentReply> {
  if (!agentAvailable()) {
    return {
      reply: "AI-советнику нужен LLM: добавьте OPENAI_API_KEY в .env.local. Остальные функции симулятора (расчёт, оптимум, шаблонный анализ) работают без ключа.",
      steps: [],
      error: "no-key",
    };
  }

  const messages: unknown[] = [{ role: "system", content: systemPrompt(current, eventId) }, ...history.slice(-8)];
  const steps: AgentStep[] = [];
  const toolOutputs: unknown[] = [history, current.length ? simulateTool(current, eventId) : null];
  let proposal: AgentReply["proposal"];
  let model: string | undefined;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    for (let turn = 0; turn < 6; turn++) {
      const { message, model: m } = await chat(messages, controller.signal);
      model = m;
      messages.push(message);
      const calls: { id: string; function: { name: string; arguments: string } }[] = message.tool_calls ?? [];
      if (!calls.length) {
        const reply = String(message.content ?? "").trim();
        return { reply, steps, proposal, model, unverifiedNumbers: findUnverifiedNumbersInText(reply, toolOutputs) };
      }
      for (const call of calls) {
        let output: unknown;
        try {
          const args = JSON.parse(call.function.arguments || "{}");
          if (call.function.name === "simulate_plan") {
            const ds = toDecisions(args.decisions);
            output = simulateTool(ds, eventId);
            steps.push({ tool: "Симуляция", summary: `${planText(ds) || "пустой план"} → Score ${(output as { score: number }).score}` });
          } else if (call.function.name === "find_best_plans") {
            const c: PlanConstraints = {
              mustInclude: toDecisions(args.must_include),
              exclude: args.exclude,
              excludeDistricts: args.exclude_districts,
              maxCost: args.max_cost,
              objective: args.objective,
            };
            const plans = optimize(Math.min(args.top ?? 3, 5), eventId, c);
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
          } else if (call.function.name === "propose_plan") {
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
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(output) });
      }
    }
    return { reply: "Агент не уложился в лимит шагов — уточните запрос.", steps, proposal, model };
  } catch (e) {
    return { reply: "AI-советник временно недоступен.", steps, proposal, model, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}
