// Проверочные сценарии из ТЗ. Запуск: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE_SCORE, optimize, simulate, validate, type Decision } from "./engine.ts";

const example: Decision[] = [
  { measureId: "M7", districtId: "nura" },
  { measureId: "M8", districtId: "nura" },
  { measureId: "M10", districtId: "nura" },
  { measureId: "M12" },
  { measureId: "M5", districtId: "saryarka" },
];

test("базовый Score без действий = 52.56", () => {
  assert.equal(Math.round(BASE_SCORE * 100) / 100, 52.56);
});

test("пример из ТЗ: стоимость 95, Score ≈ 56.5, синергия M10+M12", () => {
  assert.ok(validate(example).ok);
  const r = simulate(example);
  assert.equal(r.cost, 95);
  assert.equal(r.score, 56.54);
  assert.ok(r.synergies.some((s) => s.pair === "M10+M12"));
});

test("самый дешёвый набор (61) валиден", () => {
  const cheap: Decision[] = [
    { measureId: "M9", districtId: "nura" },
    { measureId: "M11", districtId: "nura" },
    { measureId: "M10", districtId: "nura" },
    { measureId: "M12" },
    { measureId: "M4", districtId: "nura" },
  ];
  const v = validate(cheap);
  assert.ok(v.ok, v.errors.join("; "));
  assert.equal(v.cost, 61);
});

test("превышение бюджета отклоняется", () => {
  const v = validate([
    { measureId: "M3", districtId: "nura" },
    { measureId: "M13", districtId: "almaty" },
    { measureId: "M7", districtId: "esil" },
    { measureId: "M5", districtId: "saryarka" },
    { measureId: "M12" },
  ]);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("Бюджет превышен")));
});

test("несовместимости и лимиты направлений", () => {
  assert.ok(validate([{ measureId: "M1", districtId: "nura" }, { measureId: "M3", districtId: "esil" }]).errors.some((e) => e.includes("несовместимы")));
  assert.ok(validate([{ measureId: "M4", districtId: "nura" }, { measureId: "M7", districtId: "nura" }]).errors.some((e) => e.includes("участок")));
  assert.ok(
    validate([{ measureId: "M1", districtId: "nura" }, { measureId: "M2" }, { measureId: "M3", districtId: "esil" }]).errors.some((e) =>
      e.includes("не более 2"),
    ),
  );
  assert.ok(validate([{ measureId: "M2", districtId: "nura" }]).errors.some((e) => e.includes("городская")));
  assert.ok(validate([{ measureId: "M7" }]).errors.some((e) => e.includes("выбрать район")));
});

test("изменение набора меняет Score", () => {
  const other = [...example.slice(0, 4), { measureId: "M5", districtId: "almaty" }];
  assert.notEqual(simulate(example).score, simulate(other).score);
});

test("оптимизатор находит набор лучше примера", () => {
  const [best] = optimize(1);
  assert.ok(validate(best.decisions).ok);
  assert.ok(best.score >= 57.2, `best=${best.score}`);
});
