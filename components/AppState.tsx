"use client";

import { createContext, Suspense, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { RULES } from "@/lib/data";
import { contributions, getEvent, normalizeEventId, sanitizeDecisions, simulate, validate, type Decision, type RankedPlan } from "@/lib/engine";
import type { Explanation } from "@/lib/explain";
import { makeT, type Lang } from "@/lib/i18n";
import { decodePlan, encodePlan } from "@/lib/plan-url";

export interface SavedScenario {
  name: string;
  decisions: Decision[];
  eventId: string | null;
  score: number;
  cost: number;
}

const STATE_KEY = "akim.state.v1";
const SAVED_KEY = "akim.scenarios.v2";

function normalizeSaved(input: unknown): SavedScenario[] {
  if (!Array.isArray(input)) return [];
  return input.slice(-100).flatMap((item): SavedScenario[] => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 80) : "";
    if (!name) return [];
    const decisions = sanitizeDecisions(raw.decisions);
    const eventId = normalizeEventId(raw.eventId);
    if (!validate(decisions, eventId).ok) return [];
    const { score, cost } = simulate(decisions, eventId);
    return [{ name, decisions, eventId, score, cost }];
  });
}

// Layout сохраняется при переходе между страницами, поэтому читаем URL при каждой навигации.
function RoutePlanSync({ ready, apply }: { ready: boolean; apply: (params: URLSearchParams, key: string) => void }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();

  useEffect(() => {
    if (!ready) return;
    apply(new URLSearchParams(query), `${pathname}?${query}`);
  }, [apply, pathname, query, ready]);

  return null;
}

function useAppStateValue() {
  const [decisions, setDecisionsRaw] = useState<Decision[]>([]);
  const [eventId, setEventIdRaw] = useState<string | null>(null);
  const [lang, setLangRaw] = useState<Lang>("ru");
  const [saved, setSaved] = useState<SavedScenario[]>([]);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [optimum, setOptimum] = useState<RankedPlan[] | null>(null);
  const [ready, setReady] = useState(false);
  const explainRequest = useRef(0);
  const explainController = useRef<AbortController | null>(null);
  const appliedUrl = useRef<string | null>(null);

  const resetDerived = useCallback(() => {
    explainRequest.current += 1;
    explainController.current?.abort();
    explainController.current = null;
    setExplanation(null);
    setExplaining(false);
    setExplainError(null);
  }, []);

  const applyUrl = useCallback((params: URLSearchParams, key: string) => {
    if (appliedUrl.current === key) return;
    appliedUrl.current = key;
    if (params.has("p")) {
      const fromUrl = decodePlan(params);
      setDecisionsRaw(fromUrl.decisions);
      setEventIdRaw(fromUrl.eventId);
      setOptimum(null);
      resetDerived();
    }
    const urlLang = params.get("lang");
    if (urlLang === "kz" || urlLang === "ru") {
      setLangRaw(urlLang);
      resetDerived();
    }
  }, [resetDerived]);

  // Восстановление: ссылка (?p=&e=) важнее сохранённого состояния. Доступно только в браузере.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    try {
      const st = JSON.parse(localStorage.getItem(STATE_KEY) ?? "null");
      if (st?.lang === "kz" || st?.lang === "ru") setLangRaw(st.lang);
      if (Array.isArray(st?.decisions)) setDecisionsRaw(sanitizeDecisions(st.decisions));
      setEventIdRaw(normalizeEventId(st?.eventId));
    } catch {}
    try {
      const sv = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "null");
      setSaved(normalizeSaved(sv));
    } catch {}
    const params = new URLSearchParams(location.search);
    applyUrl(params, `${location.pathname}?${params.toString()}`);
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [applyUrl]);

  useEffect(() => () => {
    explainRequest.current += 1;
    explainController.current?.abort();
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({ decisions, eventId, lang }));
    } catch {}
    document.documentElement.lang = lang === "kz" ? "kk" : "ru";
  }, [decisions, eventId, lang, ready]);

  const setDecisions = (next: Decision[]) => {
    resetDerived();
    setDecisionsRaw(next);
  };
  const setEventId = (id: string | null) => {
    resetDerived();
    setEventIdRaw(id);
    setOptimum(null);
  };
  const setLang = (l: Lang) => {
    resetDerived();
    setLangRaw(l);
  };
  const persistSaved = (list: SavedScenario[]) => {
    const safe = normalizeSaved(list);
    setSaved(safe);
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(safe));
    } catch {}
  };

  const result = simulate(decisions, eventId);
  const validation = validate(decisions, eventId);
  const contrib = contributions(decisions, eventId);
  const complete = decisions.length === RULES.decisions && validation.ok;

  const runExplain = async () => {
    explainController.current?.abort();
    const requestId = ++explainRequest.current;
    const controller = new AbortController();
    explainController.current = controller;
    setExplaining(true);
    setExplainError(null);
    setExplanation(null);
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decisions, eventId, lang }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.reasons?.join(" ") ?? data.error ?? "Ошибка анализа");
      if (requestId !== explainRequest.current) return;
      setExplanation(data);
    } catch (e) {
      if (requestId !== explainRequest.current || controller.signal.aborted) return;
      setExplainError(e instanceof Error ? e.message : String(e));
    } finally {
      if (requestId === explainRequest.current) {
        explainController.current = null;
        setExplaining(false);
      }
    }
  };

  return {
    ready,
    decisions,
    setDecisions,
    eventId,
    setEventId,
    event: getEvent(eventId),
    lang,
    setLang,
    tr: makeT(lang),
    saved,
    persistSaved,
    result,
    validation,
    contrib,
    complete,
    planQuery: encodePlan(decisions, eventId),
    explanation,
    explaining,
    explainError,
    runExplain,
    optimum,
    setOptimum,
    applyUrl,
  };
}

export type AppState = ReturnType<typeof useAppStateValue>;

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const value = useAppStateValue();
  return (
    <Ctx.Provider value={value}>
      <Suspense fallback={null}>
        <RoutePlanSync ready={value.ready} apply={value.applyUrl} />
      </Suspense>
      {children}
    </Ctx.Provider>
  );
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp вне AppStateProvider");
  return v;
}
