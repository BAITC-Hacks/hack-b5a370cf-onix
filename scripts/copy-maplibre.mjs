// Копирует воркер MapLibre в public/, чтобы браузер мог его загрузить (сборщик не видит динамический URL воркера).
import { cpSync, mkdirSync } from "node:fs";

mkdirSync("public/maplibre", { recursive: true });
for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) cpSync(`node_modules/maplibre-gl/dist/${f}`, `public/maplibre/${f}`);
