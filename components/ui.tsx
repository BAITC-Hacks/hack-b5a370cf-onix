"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "./AppState";

export function Card({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`rounded-2xl border border-line bg-card p-5 ${className}`}>
      {children}
    </section>
  );
}

export function CardTitle({ children, hint, action }: { children: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-semibold leading-tight">{children}</h2>
        {hint && <p className="mt-1 text-sm text-ink-2">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  variant = "secondary",
  title,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "ghost" | "warn";
  title?: string;
  className?: string;
}) {
  const styles = {
    primary: "bg-accent text-white enabled:hover:bg-accent-strong",
    secondary: "border border-line bg-card text-ink enabled:hover:bg-card-2",
    ghost: "text-ink-2 enabled:hover:bg-card-2",
    warn: "bg-warn text-black enabled:hover:brightness-95",
  }[variant];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

/** Статус всегда с иконкой и подписью, не только цветом. */
export function StatusBadge({ kind, children }: { kind: "good" | "warn" | "crit" | "info"; children: ReactNode }) {
  const map = {
    good: ["✓", "bg-good/15 text-good-ink"],
    warn: ["!", "bg-warn-soft text-ink"],
    crit: ["✕", "bg-crit-soft text-crit"],
    info: ["i", "bg-card-2 text-ink-2"],
  } as const;
  const [icon, cls] = map[kind];
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${cls}`}>
      <span aria-hidden className="font-bold">
        {icon}
      </span>
      {children}
    </span>
  );
}

const THEME_KEY = "akim.theme";

export function ThemeToggle() {
  const { tr } = useApp();
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(THEME_KEY);
    } catch {}
    const initial = saved === "light" || saved === "dark" ? saved : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.dataset.theme = initial;
    // Тема известна только в браузере.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(initial);
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {}
  };

  return (
    <button onClick={toggle} className="rounded-lg border border-line px-2.5 py-1.5 text-sm text-ink-2 hover:bg-card-2" aria-label="Переключить тему">
      {theme === "dark" ? tr.t("themeLight") : tr.t("themeDark")}
    </button>
  );
}

const STEP_ROUTES = ["/plan", "/results", "/advisor", "/leaderboard"];

/** Полоса шагов 1→4: одинаковая на всех рабочих страницах, текущий шаг подсвечен. */
export function Steps({ current }: { current: number }) {
  const { tr } = useApp();
  return (
    <ol className="flex flex-wrap items-center gap-1 text-xs" aria-label={tr.t("stepWord")}>
      {tr.steps.map((label, i) => {
        const n = i + 1;
        const state = n === current ? "current" : n < current ? "done" : "todo";
        return (
          <li key={label} className="flex items-center gap-1">
            <a
              href={STEP_ROUTES[i]}
              className={`inline-flex items-center gap-1.5 rounded-full py-1 pl-1 pr-3 ${state === "current" ? "bg-accent text-white" : state === "done" ? "bg-card-2 text-ink" : "text-ink-3 hover:bg-card-2"}`}
              aria-current={state === "current" ? "step" : undefined}
            >
              <span className={`grid size-5 place-items-center rounded-full text-[11px] font-bold ${state === "current" ? "bg-white/25" : state === "done" ? "bg-good text-white" : "bg-card-2"}`}>
                {state === "done" ? "✓" : n}
              </span>
              {label}
            </a>
            {n < tr.steps.length && <span className="text-ink-3">›</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** Единая шапка страницы: шаг, заголовок в одну строку, подзаголовок и одно главное действие. */
export function PageHeader({ step, title, sub, action }: { step?: number; title: string; sub?: string; action?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {step && (
          <div className="mb-2">
            <Steps current={step} />
          </div>
        )}
        <h1 className="text-2xl font-bold leading-tight sm:text-3xl">{title}</h1>
        {sub && <p className="mt-1 text-sm text-ink-2">{sub}</p>}
      </div>
      {action}
    </header>
  );
}

/** Раскрывающийся блок для второстепенного содержимого — чтобы страница не превращалась в простыню. */
export function Details({ title, children, open }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group rounded-2xl border border-line bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 text-base font-semibold [&::-webkit-details-marker]:hidden">
        <span className="grid size-6 place-items-center rounded-md bg-card-2 text-sm transition group-open:rotate-90">›</span>
        {title}
      </summary>
      <div className="space-y-6 px-5 pb-5">{children}</div>
    </details>
  );
}

/** Большой Score с дельтой и тремя цифрами — один и тот же блок на «Плане» и «Результатах». */
export function ScoreHero({ compact }: { compact?: boolean }) {
  const { tr, result, decisions } = useApp();
  const delta = result.delta;
  return (
    <div className={`rounded-2xl bg-accent text-white ${compact ? "p-4" : "p-5"}`}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-sm opacity-85">Astana {tr.t("score")}</div>
        <div className="text-xs opacity-75">{decisions.length ? `${decisions.length}/5` : tr.t("noPlanYet")}</div>
      </div>
      <div className="mt-1 flex items-end gap-3">
        <span className={`font-bold leading-none ${compact ? "text-4xl" : "text-5xl"}`}>{result.score.toFixed(2)}</span>
        <span className={`pb-1 text-sm font-semibold ${delta > 0 ? "text-white" : "text-white/70"}`}>
          {delta > 0 ? "▲ +" : delta < 0 ? "▼ " : ""}
          {delta === 0 ? `= ${result.baseScore}` : `${Math.abs(delta).toFixed(2)}`}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="opacity-80">{tr.t("cityAvg")}</div>
          <div className="text-base font-semibold">{result.dAvg}</div>
        </div>
        <div>
          <div className="truncate opacity-80">
            {tr.t("weakest")} · {tr.districtByName(result.weakestDistrict)}
          </div>
          <div className="text-base font-semibold">{result.minD}</div>
        </div>
        <div>
          <div className="opacity-80">{tr.t("critical")}</div>
          <div className="text-base font-semibold">{result.criticalCount}</div>
        </div>
      </div>
    </div>
  );
}
