// Проверка детектора «придуманных» чисел: не должен ругаться на годы, id мер, доли и перечисления.
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { explain, findUnverifiedClaimsInText, findUnverifiedNumbersInText } from "./explain.ts";

const realFetch = globalThis.fetch;
const env = { ...process.env };
afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = { ...env };
});

const facts = { score: 56.54, delta: 3.98, population: 0.27, weight: 0.3, list: [45, 62, 68] };

test("допустимые числа не помечаются", () => {
  assert.deepEqual(findUnverifiedNumbersInText("К 2026 году Score 56.54 (+3.98). Есиль — 27% жителей, вес 30%. Замените M13 на M9. Показатели 45,62,68. Лаг 3, стоимость 24.", facts), []);
});

test("придуманные числа помечаются", () => {
  assert.deepEqual(findUnverifiedNumbersInText("Score вырастет до 61.7, а Нура получит 88 баллов", facts), ["61.7", "88"]);
});

test("бюджетное число не подтверждает неверное значение Score", () => {
  assert.deepEqual(findUnverifiedNumbersInText("Score равен 100, бюджет 100.", facts), ["100"]);
  assert.deepEqual(findUnverifiedNumbersInText("Score 56,54, бюджет 100.", facts), []);
  assert.deepEqual(findUnverifiedNumbersInText("Score вырос на 3.98.", facts), []);
  assert.deepEqual(findUnverifiedNumbersInText("Score = 0.7 × средний балл + 0.3 × минимум.", facts), []);
});

const scenarioFacts = {
  итог: {
    score: 56.54,
    базовый_score: 52.56,
    изменение: 3.98,
    средний_балл_города_до: 56.86,
    средний_балл_города_после: 58.08,
    средний_балл_города_прирост: 1.22,
    разрыв_до_оптимума: 0.7,
    сработавшие_синергии: [{ пара: "M10+M12", показатель: "B1", название_показателя: "Безопасность улиц", прирост: 2, район: "Нура" }],
  },
  районы: [{ район: "Нура", балл_до: 49.18, балл_после: 52.96, изменение_балла: 3.78 }],
};

test("числа Score не подтверждают утверждение о среднем балле города", () => {
  assert.deepEqual(findUnverifiedNumbersInText("Общий средневзвешенный балл города повысился с 52.56 до 56.54.", scenarioFacts), ["52.56", "56.54"]);
  assert.deepEqual(findUnverifiedNumbersInText("Средневзвешенный балл города вырос с 56.86 до 58.08. Score вырос с 52.56 до 56.54.", scenarioFacts), []);
});

test("балл конкретного района проверяется по его строке", () => {
  assert.deepEqual(findUnverifiedNumbersInText("Балл Нуры вырос с 52.56 до 56.54.", scenarioFacts), ["52.56", "56.54"]);
  assert.deepEqual(findUnverifiedNumbersInText("Балл Нуры вырос с 49.18 до 52.96.", scenarioFacts), []);
});

test("готовые приросты подтверждают разницу только своей метрики", () => {
  assert.deepEqual(findUnverifiedNumbersInText("Средний балл города вырос на 1.22. Балл Нуры вырос на 3.78. Разрыв до оптимума составляет 0.7.", scenarioFacts), []);
  assert.deepEqual(findUnverifiedNumbersInText("Средний балл города вырос на 3.78. Балл Нуры вырос на 1.22.", scenarioFacts), ["3.78", "1.22"]);
});

test("синергия с верным бонусом, но неверным показателем получает предупреждение", () => {
  assert.deepEqual(findUnverifiedClaimsInText("Синергия M10+M12 даёт +2 к B1 «Безопасность улиц» в Нуре.", scenarioFacts), []);
  assert.deepEqual(findUnverifiedClaimsInText("Синергия M10+M12 даёт +2 к C2.", scenarioFacts), ["Синергия M10+M12 влияет на B1 «Безопасность улиц»"]);
  assert.deepEqual(findUnverifiedClaimsInText("Синергия M10+M12 повышает скорость реакции на обращения жителей.", scenarioFacts), ["Синергия M10+M12 влияет на B1 «Безопасность улиц»"]);
  assert.deepEqual(findUnverifiedClaimsInText("Синергия мер M10 и M12 повышает скорость решения обращений жителей.", scenarioFacts), ["Синергия M10+M12 влияет на B1 «Безопасность улиц»"]);
  assert.deepEqual(findUnverifiedClaimsInText("Синергия M10 & M12 повышает C2.", scenarioFacts), ["Синергия M10+M12 влияет на B1 «Безопасность улиц»"]);
  assert.deepEqual(findUnverifiedClaimsInText("Синергия M10 и M12 усиливает безопасность улиц.", scenarioFacts), []);
  assert.deepEqual(findUnverifiedClaimsInText("M10+M12 даёт бонус к B1, а M12 отдельно ускоряет обращения.", scenarioFacts), []);
});

test("AI-анализ передаёт метрики, скрывает неподтверждённый ответ и принимает проверенный", async () => {
  process.env.LLM_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "test";
  let prompt = "";
  let summary = "Общий средневзвешенный балл города повысился с 52.56 до 56.54. Синергия M10+M12 ускоряет реакцию на обращения.";
  globalThis.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    prompt = body.messages[1].content;
    const content = JSON.stringify({
      summary,
      strengths: [], risks: [], tradeoffs: [], recommendations: [],
    });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }) as typeof fetch;
  const plan = [
    { measureId: "M7", districtId: "nura" },
    { measureId: "M8", districtId: "nura" },
    { measureId: "M10", districtId: "nura" },
    { measureId: "M12" },
    { measureId: "M5", districtId: "saryarka" },
  ];
  const result = await explain(plan);
  assert.match(prompt, /"средний_балл_города_до": 56\.86/);
  assert.match(prompt, /"средний_балл_города_после": 58\.08/);
  assert.match(prompt, /"средний_балл_города_прирост": 1\.22/);
  assert.match(prompt, /"разрыв_до_оптимума": 0\.7/);
  assert.match(prompt, /"изменение_балла": 3\.78/);
  assert.match(prompt, /"название_показателя": "Безопасность улиц"/);
  assert.equal(result.source, "fallback");
  assert.equal(result.error, "llm_unverified");
  assert.notEqual(result.summary, summary);
  assert.doesNotMatch(result.summary, /ускоряет реакцию на обращения/);
  assert.equal(result.unverifiedNumbers, undefined);
  assert.equal(result.unverifiedClaims, undefined);

  summary = "Score станет 61.7.";
  const inventedNumber = await explain(plan);
  assert.equal(inventedNumber.source, "fallback");
  assert.equal(inventedNumber.error, "llm_unverified");
  assert.doesNotMatch(inventedNumber.summary, /61\.7/);

  summary = "Синергия M10+M12 ускоряет реакцию на обращения.";
  const falseClaim = await explain(plan);
  assert.equal(falseClaim.source, "fallback");
  assert.equal(falseClaim.error, "llm_unverified");
  assert.doesNotMatch(falseClaim.summary, /ускоряет реакцию на обращения/);

  summary = "Средний балл города вырос с 56.86 до 58.08, прирост 1.22. Балл Нуры вырос с 49.18 до 52.96, прирост 3.78. Разрыв до оптимума составляет 0.7. Синергия мер M10 и M12 улучшает безопасность улиц.";
  const verified = await explain(plan);
  assert.equal(verified.source, "openai");
  assert.equal(verified.summary, summary);
  assert.deepEqual(verified.unverifiedNumbers, []);
  assert.deepEqual(verified.unverifiedClaims, []);
});
