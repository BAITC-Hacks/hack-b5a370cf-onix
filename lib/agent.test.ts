// Цикл инструментов советника с подменённой сетью: оба провайдера (OpenAI и Anthropic) без реальных ключей.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { runAgent } from "./agent.ts";

const realFetch = globalThis.fetch;
const env = { ...process.env };
afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = { ...env };
});

const plan = [
  { measure_id: "M2", district: null },
  { measure_id: "M3", district: "nura" },
  { measure_id: "M8", district: "nura" },
  { measure_id: "M9", district: "nura" },
  { measure_id: "M14", district: null },
];

/** Сценарий модели: шаг 1 — вызвать find_best_plans, шаг 2 — propose_plan, шаг 3 — текст. */
function openaiMock() {
  let step = 0;
  const calls: unknown[] = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    calls.push(body);
    step++;
    const message =
      step === 1
        ? { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "find_best_plans", arguments: JSON.stringify({ objective: "nura", top: 1 }) } }] }
        : step === 2
          ? { role: "assistant", content: null, tool_calls: [{ id: "c2", type: "function", function: { name: "propose_plan", arguments: JSON.stringify({ decisions: plan, rationale: "лучший для Нуры" }) } }] }
          : { role: "assistant", content: "Предлагаю план для Нуры: Score 57.24, стоимость 98." };
    return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });
  }) as typeof fetch;
  return calls;
}

function anthropicMock() {
  let step = 0;
  const calls: { messages: { role: string; content: unknown }[] }[] = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    calls.push(body);
    step++;
    const content =
      step === 1
        ? [{ type: "tool_use", id: "t1", name: "stress_test_plan", input: { decisions: plan } }]
        : step === 2
          ? [{ type: "tool_use", id: "t2", name: "find_robust_plan", input: {} }]
          : [{ type: "text", text: "Ваш план не выдерживает 2 сценария; устойчивый план даёт худший случай 55.69." }];
    return new Response(JSON.stringify({ content }), { status: 200 });
  }) as typeof fetch;
  return calls;
}

test("OpenAI: tool calling → propose_plan → предложение с проверенными числами", async () => {
  process.env.OPENAI_API_KEY = "test";
  delete process.env.ANTHROPIC_API_KEY;
  const calls = openaiMock();
  const r = await runAgent([{ role: "user", content: "Подними Нуру" }], [], null);
  assert.equal(calls.length, 3);
  assert.ok(r.proposal && r.proposal.score === 57.24);
  assert.deepEqual(r.unverifiedNumbers, []);
  assert.deepEqual(r.steps.map((s) => s.tool), ["Перебор планов", "Предложение"]);
  // Результаты инструментов вернулись модели в формате OpenAI
  const last = (calls[2] as { messages: { role: string }[] }).messages;
  assert.ok(last.some((m) => m.role === "tool"));
});

test("Anthropic: tool_use/tool_result, история начинается с user, план из find_robust_plan подхватывается", async () => {
  process.env.ANTHROPIC_API_KEY = "test";
  delete process.env.OPENAI_API_KEY;
  const calls = anthropicMock();
  const history = [
    { role: "assistant" as const, content: "старый ответ" },
    { role: "user" as const, content: "Выдержит ли мой план кризисы?" },
  ];
  const r = await runAgent(history, plan.map((d) => ({ measureId: d.measure_id, districtId: d.district })), null);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].messages[0].role, "user", "ведущий assistant должен быть отброшен");
  assert.ok(!("temperature" in calls[0]), "для Anthropic temperature не передаётся");
  const toolResult = calls[1].messages.at(-1)!;
  assert.equal(toolResult.role, "user");
  assert.equal((toolResult.content as { type: string }[])[0].type, "tool_result");
  assert.ok(r.proposal, "страховка: лучший устойчивый план прикреплён без propose_plan");
  assert.equal(r.proposal!.score, 56.9);
  assert.deepEqual(r.unverifiedNumbers, []);
  assert.match(r.model!, /anthropic/);
});

test("без ключей советник честно отказывается", async () => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const r = await runAgent([{ role: "user", content: "привет" }], [], null);
  assert.equal(r.error, "no-key");
});

test("слова пользователя не подтверждают придуманные моделью числа", async () => {
  process.env.OPENAI_API_KEY = "test";
  delete process.env.ANTHROPIC_API_KEY;
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Score равен 100, прирост 999." } }] }), { status: 200 })) as typeof fetch;
  const r = await runAgent([{ role: "user", content: "У меня Score 100 и прирост 999?" }], [], null);
  assert.equal(r.error, "llm_unverified");
  assert.doesNotMatch(r.reply, /100|999/);
  assert.equal(r.unverifiedNumbers, undefined);
});

test("число вызовов инструментов ограничено даже при множественном tool calling", async () => {
  process.env.OPENAI_API_KEY = "test";
  delete process.env.ANTHROPIC_API_KEY;
  let requests = 0;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    requests++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.max_completion_tokens, 2000);
    const tool_calls = Array.from({ length: 9 }, (_, i) => ({
      id: `c${i}`, type: "function", function: { name: "simulate_plan", arguments: JSON.stringify({ decisions: [] }) },
    }));
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls } }] }), { status: 200 });
  }) as typeof fetch;
  const r = await runAgent([{ role: "user", content: "Посчитай варианты" }], [], null);
  assert.equal(requests, 1);
  assert.equal(r.steps.length, 8);
  assert.equal(r.error, "tool-limit");
});

test("выполненный поиск подтверждает свой лимит стоимости", async () => {
  process.env.OPENAI_API_KEY = "test";
  delete process.env.ANTHROPIC_API_KEY;
  let step = 0;
  globalThis.fetch = (async () => {
    step++;
    const message = step === 1
      ? { role: "assistant", content: null, tool_calls: [{ id: "limit", type: "function", function: { name: "find_best_plans", arguments: JSON.stringify({ exclude: ["M3"], max_cost: 80, top: 1 }) } }] }
      : { role: "assistant", content: "Лучший план без ЛРТ найден при лимите стоимости 80." };
    return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });
  }) as typeof fetch;
  const r = await runAgent([{ role: "user", content: "Найди лучший план без ЛРТ и в бюджете 80" }], [], null);
  assert.equal(step, 2);
  assert.deepEqual(r.unverifiedNumbers, []);
});
