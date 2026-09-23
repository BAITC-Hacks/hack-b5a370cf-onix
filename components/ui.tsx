"use client";

import { useEffect, useState, type ReactNode } from "react";

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
      {theme === "dark" ? "☀︎ Светлая" : "☾ Тёмная"}
    </button>
  );
}
