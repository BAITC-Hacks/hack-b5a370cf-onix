"use client";

import { useState } from "react";
import type { DistrictResult } from "@/lib/engine";
import { useApp } from "./AppState";
import { CityMap3D } from "./CityMap3D";
import { RealMap3D } from "./RealMap3D";
import type { MapProject } from "./map-project";

/** Переключатель: реальная карта (MapLibre + OSM) или схема (SVG, без сети). */
export function CityMap(props: { districts: DistrictResult[]; weakest: string; project?: MapProject | null; quarter?: number }) {
  const { tr } = useApp();
  const [mode, setMode] = useState<"real" | "schema">("real");
  const tabs: ["real" | "schema", string][] = [
    ["real", tr.lang === "kz" ? "Нақты карта" : "Реальная карта"],
    ["schema", tr.lang === "kz" ? "Схема" : "Схема"],
  ];
  return (
    <div>
      <div className="mb-3 inline-flex rounded-lg border border-line p-0.5 text-sm" role="tablist">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={mode === id}
            onClick={() => setMode(id)}
            className={`rounded-md px-3 py-1 ${mode === id ? "bg-accent text-white" : "text-ink-2 hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "real" ? <RealMap3D {...props} /> : <CityMap3D {...props} />}
    </div>
  );
}
