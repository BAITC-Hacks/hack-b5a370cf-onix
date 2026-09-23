// Проверка детектора «придуманных» чисел: не должен ругаться на годы, id мер, доли и перечисления.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findUnverifiedNumbersInText } from "./explain.ts";

const facts = { score: 56.54, delta: 3.98, population: 0.27, weight: 0.3, list: [45, 62, 68] };

test("допустимые числа не помечаются", () => {
  assert.deepEqual(findUnverifiedNumbersInText("К 2026 году Score 56.54 (+3.98). Есиль — 27% жителей, вес 30%. Замените M13 на M9. Показатели 45,62,68. Лаг 3, стоимость 24.", facts), []);
});

test("придуманные числа помечаются", () => {
  assert.deepEqual(findUnverifiedNumbersInText("Score вырастет до 61.7, а Нура получит 88 баллов", facts), ["61.7", "88"]);
});
