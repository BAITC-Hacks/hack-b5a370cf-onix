// Проверочные сценарии из ТЗ. Запуск: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE_SCORE, normalizeEventId, optimize, optimizeRobust, robustness, sanitizeDecisions, simulate, timeline, validate, type Decision } from "./engine.ts";

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

test("городские события: удар по показателям и сокращение бюджета", () => {
  const heating = simulate([], "heating");
  assert.ok(heating.baseScore < 52.56);
  assert.ok(heating.critical.some((c) => c.district === "Алматы" && c.indicator === "C1"));
  assert.equal(validate(example, "transfer").ok, false, "пример за 95 не влезает в бюджет 85");
  assert.ok(validate(example, "transfer").errors.some((e) => e.includes("из 85")));
  assert.ok(validate(example).ok);
});

test("оптимизатор с ограничениями: обязательная мера, исключения, цель по району", () => {
  const [withoutM3] = optimize(1, null, { exclude: ["M3"] });
  assert.ok(!withoutM3.decisions.some((d) => d.measureId === "M3"));
  const [withM13] = optimize(1, null, { mustInclude: [{ measureId: "M13", districtId: "almaty" }] });
  assert.ok(withM13.decisions.some((d) => d.measureId === "M13" && d.districtId === "almaty"));
  const [cheap] = optimize(1, null, { maxCost: 70 });
  assert.ok(cheap.cost <= 70);
  const [esil] = optimize(1, null, { objective: "esil" });
  const esilScore = simulate(esil.decisions).districts.find((d) => d.id === "esil")!.scoreAfter;
  assert.equal(esil.objectiveValue, esilScore);
  assert.ok(esilScore > 65);
});

test("траектория по кварталам: старт = база, 8-й квартал = итоговый Score", () => {
  const tl = timeline(example);
  assert.equal(tl.length, 9);
  assert.equal(tl[0].score, 52.56);
  assert.equal(tl[8].score, simulate(example).score);
  for (let q = 1; q < tl.length; q++) assert.ok(tl[q].score >= tl[q - 1].score);
  assert.deepEqual(tl[1].active, []);
  assert.ok(tl[2].active.includes("M10"));
});

test("стресс-тест и устойчивый оптимум", () => {
  const r = robustness(example);
  assert.equal(r.outcomes.length, 6);
  assert.ok(r.failed >= 1, "пример за 95 не влезает в урезанный бюджет");
  const t0 = Date.now();
  const [robust] = optimizeRobust(1);
  console.log("robust", robust, Date.now() - t0, "ms");
  const rr = robustness(robust.decisions);
  assert.equal(rr.failed, 0);
  assert.equal(rr.worst, robust.worst);
});

test("мусор на входе не роняет расчёт: неизвестные меры/районы, районная мера без района", () => {
  const junk = sanitizeDecisions([{ measureId: "ZZ" }, { measureId: "M7", districtId: "mars" }, { measureId: "M12", districtId: "nura" }, 5, null, { measureId: "M7", districtId: "nura" }]);
  assert.deepEqual(junk, [
    { measureId: "M7", districtId: null },
    { measureId: "M12", districtId: null },
  ]);
  // simulate не должен бросать даже на несанитизированном входе
  const r = simulate([{ measureId: "ZZ" } as Decision, { measureId: "M7", districtId: null }]);
  assert.equal(r.score, 52.56, "районная мера без района не даёт эффекта (раньше применялась ко всему городу)");
  assert.equal(validate([{ measureId: "M7", districtId: null }]).issues.some((i) => i.code === "needDistrict"), true);
  assert.equal(normalizeEventId("bogus"), null);
  assert.equal(normalizeEventId("heating"), "heating");
});
