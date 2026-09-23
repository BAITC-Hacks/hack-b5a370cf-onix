// Исходные данные симулятора — перенесены 1:1 из «Датасет районов.docx» (HackAlem AI, Astana Innovations).

export const INDICATORS = ["T1", "T2", "E1", "E2", "S1", "S2", "B1", "B2", "C1", "C2"] as const;
export type Indicator = (typeof INDICATORS)[number];

export const DIRECTIONS = ["transport", "ecology", "social", "safety", "services"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const DIRECTION_LABELS: Record<Direction, string> = {
  transport: "Транспорт",
  ecology: "Экология",
  social: "Соцсфера",
  safety: "Безопасность",
  services: "Сервисы",
};

export const INDICATOR_INFO: Record<Indicator, { direction: Direction; name: string; weight: number }> = {
  T1: { direction: "transport", name: "Разгрузка дорог", weight: 0.1 },
  T2: { direction: "transport", name: "Доступность общественного транспорта", weight: 0.1 },
  E1: { direction: "ecology", name: "Озеленение", weight: 0.09 },
  E2: { direction: "ecology", name: "Качество воздуха", weight: 0.11 },
  S1: { direction: "social", name: "Школы и детсады", weight: 0.11 },
  S2: { direction: "social", name: "Поликлиники и первичная медпомощь", weight: 0.11 },
  B1: { direction: "safety", name: "Безопасность улиц", weight: 0.09 },
  B2: { direction: "safety", name: "Безопасность дорожного движения", weight: 0.09 },
  C1: { direction: "services", name: "Надёжность ЖКХ", weight: 0.1 },
  C2: { direction: "services", name: "Скорость решения обращений жителей", weight: 0.1 },
};

export type IndicatorValues = Record<Indicator, number>;

export interface District {
  id: string;
  name: string;
  population: number;
  profile: string;
  values: IndicatorValues;
}

const v = (arr: number[]): IndicatorValues =>
  Object.fromEntries(INDICATORS.map((k, i) => [k, arr[i]])) as IndicatorValues;

export const DISTRICTS: District[] = [
  { id: "esil", name: "Есиль", population: 0.27, profile: "Богатый, но с пробками на мостах и переполненными школами.", values: v([45, 62, 68, 72, 48, 55, 78, 60, 75, 70]) },
  { id: "almaty", name: "Алматы", population: 0.24, profile: "Старый ЖКХ и пробки.", values: v([40, 75, 50, 55, 60, 65, 62, 52, 50, 60]) },
  { id: "saryarka", name: "Сарыарка", population: 0.2, profile: "Смог от частного сектора, слабое озеленение.", values: v([50, 70, 42, 40, 62, 68, 58, 55, 45, 55]) },
  { id: "baikonur", name: "Байконур", population: 0.13, profile: "Середняк без ярких перекосов.", values: v([52, 68, 55, 50, 58, 60, 52, 58, 55, 58]) },
  { id: "nura", name: "Нура", population: 0.16, profile: "Главный «аутсайдер» по соцсфере и транспорту.", values: v([55, 40, 45, 65, 38, 35, 55, 50, 60, 50]) },
];

export type Scope = "district" | "city";

export interface Measure {
  id: string;
  direction: Direction;
  name: string;
  scope: Scope;
  cost: number;
  lag: number;
  effects: Partial<IndicatorValues>;
}

export const MEASURES: Measure[] = [
  { id: "M1", direction: "transport", name: "Выделенные полосы для автобусов", scope: "district", cost: 18, lag: 2, effects: { T1: 6, T2: 9 } },
  { id: "M2", direction: "transport", name: "Умные светофоры (адаптивное управление)", scope: "city", cost: 22, lag: 2, effects: { T1: 4, B2: 3 } },
  { id: "M3", direction: "transport", name: "Линия ЛРТ / расширение", scope: "district", cost: 30, lag: 4, effects: { T1: 16, T2: 20, E2: 4 } },
  { id: "M4", direction: "ecology", name: "Парк / сквер", scope: "district", cost: 15, lag: 2, effects: { E1: 12, E2: 3, B1: 2 } },
  { id: "M5", direction: "ecology", name: "Перевод частного сектора на чистое топливо", scope: "district", cost: 25, lag: 3, effects: { E2: 14, C1: 4 } },
  { id: "M6", direction: "ecology", name: "Городская программа озеленения и ветрозащитных полос", scope: "city", cost: 20, lag: 4, effects: { E1: 5, E2: 3 } },
  { id: "M7", direction: "social", name: "Школа + детсад (модульное строительство)", scope: "district", cost: 24, lag: 3, effects: { S1: 16 } },
  { id: "M8", direction: "social", name: "Центр семейного здоровья / поликлиника", scope: "district", cost: 20, lag: 3, effects: { S2: 14 } },
  { id: "M9", direction: "social", name: "Дворовые спорт-хабы", scope: "district", cost: 10, lag: 1, effects: { S1: 3, S2: 3, B1: 3 } },
  { id: "M10", direction: "safety", name: "Освещение и камеры (расширение Safe City)", scope: "district", cost: 12, lag: 1, effects: { B1: 12, B2: 2 } },
  { id: "M11", direction: "safety", name: "Безопасные переходы и школьные зоны", scope: "district", cost: 10, lag: 1, effects: { B2: 12, T1: -2 } },
  { id: "M12", direction: "services", name: "Единая цифровая платформа обращений", scope: "city", cost: 14, lag: 1, effects: { C2: 5 } },
  { id: "M13", direction: "services", name: "Модернизация тепло- и водосетей", scope: "district", cost: 28, lag: 4, effects: { C1: 18, E2: 2 } },
  { id: "M14", direction: "services", name: "Аварийные бригады ЖКХ + раннее оповещение", scope: "city", cost: 16, lag: 1, effects: { C1: 5, C2: 2 } },
];

export interface Synergy {
  first: string;
  second: string;
  indicator: Indicator;
  bonus: number;
}

// Бонус даётся в районе первой меры пары (или по всему городу, если первая мера городская); лагом не масштабируется.
export const SYNERGIES: Synergy[] = [
  { first: "M1", second: "M2", indicator: "T1", bonus: 2 },
  { first: "M10", second: "M12", indicator: "B1", bonus: 2 },
  { first: "M5", second: "M6", indicator: "E2", bonus: 2 },
];

export interface Conflict {
  a: string;
  b: string;
  sameDistrictOnly: boolean;
  reason: string;
}

export const CONFLICTS: Conflict[] = [
  { a: "M1", b: "M3", sameDistrictOnly: false, reason: "либо BRT, либо ЛРТ — в любом районе" },
  { a: "M4", b: "M7", sameDistrictOnly: true, reason: "конфликт за участок в одном районе" },
  { a: "M5", b: "M13", sameDistrictOnly: true, reason: "дублирование программы в одном районе" },
];

export const RULES = {
  budget: 100,
  decisions: 5,
  maxPerDirection: 2,
  horizon: 8,
  criticalThreshold: 40,
  criticalPenalty: 1,
  avgWeight: 0.7,
  minWeight: 0.3,
} as const;

export interface CityEvent {
  id: string;
  title: string;
  description: string;
  /** Сокращение доступного бюджета. */
  budgetCut: number;
  /** Мгновенное ухудшение показателей района до принятия мер. */
  shocks: { districtId: string; indicator: Indicator; delta: number }[];
}

// Неожиданные городские события (опциональный пункт ТЗ): меняют стартовые условия и требуют перераспределить бюджет.
export const EVENTS: CityEvent[] = [
  {
    id: "heating",
    title: "Прорыв теплотрассы в Алматы",
    description: "Авария на магистральной теплосети посреди зимы: надёжность ЖКХ в районе падает ниже критического порога, растёт поток жалоб.",
    budgetCut: 0,
    shocks: [
      { districtId: "almaty", indicator: "C1", delta: -12 },
      { districtId: "almaty", indicator: "C2", delta: -5 },
    ],
  },
  {
    id: "transfer",
    title: "Сокращение трансферта из республиканского бюджета",
    description: "Городу урезали финансирование: на программы остаётся на 15 у.е. меньше.",
    budgetCut: 15,
    shocks: [],
  },
  {
    id: "smog",
    title: "Аномальный смог в Сарыарке",
    description: "Безветренная морозная неделя: качество воздуха в частном секторе проваливается ниже порога.",
    budgetCut: 0,
    shocks: [{ districtId: "saryarka", indicator: "E2", delta: -8 }],
  },
  {
    id: "baby-boom",
    title: "Новый жилой массив в Есиле",
    description: "Сдали крупный ЖК: школы и детсады района переполнены, часть классов уходит во вторую смену.",
    budgetCut: 0,
    shocks: [{ districtId: "esil", indicator: "S1", delta: -10 }],
  },
  {
    id: "flood",
    title: "Весенний паводок в Байконуре",
    description: "Подтопление улиц и сетей: страдают ЖКХ и дороги, часть бюджета уходит на ликвидацию последствий.",
    budgetCut: 10,
    shocks: [
      { districtId: "baikonur", indicator: "C1", delta: -10 },
      { districtId: "baikonur", indicator: "T1", delta: -8 },
    ],
  },
];
