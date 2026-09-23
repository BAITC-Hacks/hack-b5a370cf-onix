"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
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

  // Восстановление: ссылка (?p=&e=) важнее сохранённого состояния. Доступно только в браузере.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    try {
      const st = JSON.parse(localStorage.getItem(STATE_KEY) ?? "null");
      if (st?.lang === "kz" || st?.lang === "ru") setLangRaw(st.lang);
      if (Array.isArray(st?.decisions)) setDecisionsRaw(sanitizeDecisions(st.decisions));
      setEventIdRaw(normalizeEventId(st?.eventId));
      const sv = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "null");
      if (Array.isArray(sv)) setSaved(sv);
    } catch {}
    const fromUrl = decodePlan(new URLSearchParams(location.search));
    if (fromUrl.decisions.length) {
      setDecisionsRaw(fromUrl.decisions);
      setEventIdRaw(fromUrl.eventId);
    }
    const urlLang = new URLSearchParams(location.search).get("lang");
    if (urlLang === "kz" || urlLang === "ru") setLangRaw(urlLang);
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({ decisions, eventId, lang }));
    } catch {}
    document.documentElement.lang = lang === "kz" ? "kk" : "ru";
  }, [decisions, eventId, lang, ready]);

  const resetDerived = () => {
    setExplanation(null);
    setExplainError(null);
  };
  const setDecisions = (next: Decision[]) => {
    setDecisionsRaw(next);
    resetDerived();
  };
  const setEventId = (id: string | null) => {
    setEventIdRaw(id);
    setOptimum(null);
    resetDerived();
  };
  const setLang = (l: Lang) => {
    setLangRaw(l);
    resetDerived();
  };
  const persistSaved = (list: SavedScenario[]) => {
    setSaved(list);
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(list));
    } catch {}
  };

  const result = simulate(decisions, eventId);
  const validation = validate(decisions, eventId);
  const contrib = contributions(decisions, eventId);
  const complete = decisions.length === RULES.decisions && validation.ok;

  const runExplain = async () => {
    setExplaining(true);
    setExplainError(null);
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decisions, eventId, lang }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.reasons?.join(" ") ?? data.error ?? "Ошибка анализа");
      setExplanation(data);
    } catch (e) {
      setExplainError(e instanceof Error ? e.message : String(e));
    } finally {
      setExplaining(false);
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
  };
}

export type AppState = ReturnType<typeof useAppStateValue>;

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const value = useAppStateValue();
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp вне AppStateProvider");
  return v;
}
