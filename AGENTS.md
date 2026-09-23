<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Контекст проекта для AI-агентов

Перед любым изменением прочитай `docs/HANDOFF.md`: там ТЗ, контрольные числа, архитектура, правила хакатона и правила работы в этом репозитории. Кратко:

- Все числа считает `lib/engine.ts`; LLM только объясняет и не считает (требование ТЗ). Каждое число в ответе LLM сверяется с расчётом.
- Не менять `lib/data.ts` и формулу Score. Контрольные числа: база 52.56, пример ТЗ 56.54, оптимум 57.24, устойчивый план 55.69 — защищены тестами.
- Перед коммитом: `npm run check`. Новые строки интерфейса — в обе локали `lib/i18n.ts`. Вход от клиента — через `sanitizeDecisions` / `normalizeEventId`.
- Секреты только в `.env.local`. Коммитить и пушить минимум раз в час до 17:45 (правило хакатона). Сценарий демо: `docs/DEMO.md`.
