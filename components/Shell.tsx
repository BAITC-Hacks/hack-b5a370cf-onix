"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { LANGS } from "@/lib/i18n";
import { useApp } from "./AppState";
import { ThemeToggle } from "./ui";

const ICONS: Record<string, string> = { "/": "⌂", "/plan": "☰", "/results": "◔", "/advisor": "✦", "/leaderboard": "🏆", "/method": "∑" };

export function Shell({ children }: { children: ReactNode }) {
  const { tr, lang, setLang, result, decisions } = useApp();
  const path = usePathname();
  const links: [string, string][] = [
    ["/", tr.t("navHome")],
    ["/plan", tr.t("navPlan")],
    ["/results", tr.t("navResults")],
    ["/advisor", tr.t("navAdvisor")],
    ["/leaderboard", tr.t("navLeaderboard")],
    ["/method", tr.t("navMethod")],
  ];
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <div className="flex min-h-screen flex-col">
      <header className="no-print sticky top-0 z-30 border-b border-line bg-page/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5 sm:px-6">
          <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold">
            <span className="grid size-8 place-items-center rounded-lg bg-accent text-sm text-white">А</span>
            <span className="hidden sm:inline">{tr.t("brand")}</span>
          </Link>
          <nav className="ml-2 hidden gap-1 text-sm text-ink-2 lg:flex">
            {links.map(([href, label]) => (
              <Link key={href} href={href} className={`rounded-md px-2.5 py-1 ${isActive(href) ? "bg-card-2 font-medium text-ink" : "hover:bg-card-2 hover:text-ink"}`}>
                {label}
                {href === "/plan" && decisions.length > 0 && <span className="ml-1 text-xs text-accent-strong">{decisions.length}/5</span>}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Link href="/results" className="rounded-lg bg-accent px-2.5 py-1 text-right text-white">
              <div className="text-[10px] leading-none opacity-80">Score</div>
              <div className="text-sm font-bold leading-tight">{result.score.toFixed(2)}</div>
            </Link>
            <div className="flex rounded-lg border border-line p-0.5 text-xs font-semibold" role="group" aria-label="Язык / Тіл">
              {LANGS.map((l) => (
                <button key={l} onClick={() => setLang(l)} className={`rounded-md px-2 py-1 uppercase ${lang === l ? "bg-accent text-white" : "text-ink-2 hover:text-ink"}`} aria-pressed={lang === l}>
                  {l === "kz" ? "ҚАЗ" : "РУС"}
                </button>
              ))}
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 pb-24 sm:px-6 lg:pb-8">{children}</main>

      {/* Мобильная нижняя навигация */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-page/95 backdrop-blur lg:hidden" aria-label="Навигация">
        <ul className="mx-auto grid max-w-lg grid-cols-6">
          {links.map(([href], i) => (
            <li key={href}>
              <Link href={href} className={`flex flex-col items-center gap-0.5 py-2 text-[10px] ${isActive(href) ? "text-accent-strong" : "text-ink-3"}`}>
                <span className={`grid size-7 place-items-center rounded-lg text-base ${isActive(href) ? "bg-accent-soft" : ""}`}>{ICONS[href]}</span>
                <span className="truncate">{tr.navShort[i]}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <footer className="no-print border-t border-line py-6 text-center text-xs text-ink-3">{tr.t("footer")}</footer>
    </div>
  );
}
