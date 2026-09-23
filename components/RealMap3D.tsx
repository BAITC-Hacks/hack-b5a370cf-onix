"use client";

import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MLMap, Marker, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { INDICATORS, RULES, type Indicator } from "@/lib/data";
import type { DistrictResult } from "@/lib/engine";
import { useApp } from "./AppState";
import { PROJECT_POINT, projectIsOpen, type MapProject } from "./map-project";

/**
 * Реальная 3D-карта Астаны: границы районов из OpenStreetMap (скачаны в public/data, работают офлайн),
 * подложка с 3D-зданиями OpenFreeMap (если есть интернет). Высота района = балл или выбранный показатель.
 */

type Ring = [number, number][];
type Geo = { type: "FeatureCollection"; features: { type: "Feature"; properties: Record<string, unknown>; geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown } }[] };

const ONLINE_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const OFFLINE_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#eef0ea" } }],
};

// Камера над центром Астаны: все пять районов в кадре, наклон для 3D.
const CAMERA = { center: [71.43, 51.09] as [number, number], zoom: 10.2, pitch: 50, bearing: -15 };

// Условный контур площадки в Нуре. Он показывает выбор на карте, но не обозначает кадастровые границы.
const PROJECT_FOOTPRINT: [number, number][] = [
  [71.345, 51.127],
  [71.355, 51.128],
  [71.357, 51.133],
  [71.347, 51.132],
  [71.345, 51.127],
];

type ProjectKind = MapProject["kind"];
function footprintData(kind: ProjectKind | undefined, open: boolean, nuraValue: number) {
  const color = kind === "site" ? "#36a0f2" : !open ? "#f4bd57" : kind === "park" ? "#2abe74" : "#f0935b";
  const base = heightOf(nuraValue) + 12;
  return {
    type: "FeatureCollection" as const,
    features: kind
      ? [{ type: "Feature" as const, geometry: { type: "Polygon" as const, coordinates: [PROJECT_FOOTPRINT] }, properties: { base, height: base + 45, color } }]
      : [],
  };
}

const colorOf = (v: number) => (v < RULES.criticalThreshold ? "#d03b3b" : v < 50 ? "#9ec5f4" : v < 60 ? "#6da7ec" : v < 70 ? "#3987e5" : "#1c5cab");
/** Высота в метрах: разница 35–80 баллов заметна на фоне реальных зданий. */
const heightOf = (v: number) => Math.max(60, (v - 30) * 40);

/** Центроид самого большого кольца (для подписи района). */
function labelPoint(geometry: Geo["features"][number]["geometry"]): [number, number] {
  const rings: Ring[] = geometry.type === "Polygon" ? [(geometry.coordinates as Ring[])[0]] : (geometry.coordinates as Ring[][]).map((p) => p[0]);
  let best: [number, number] = [0, 0];
  let bestArea = -1;
  for (const r of rings) {
    let a = 0,
      cx = 0,
      cy = 0;
    for (let i = 0; i < r.length - 1; i++) {
      const f = r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
      a += f;
      cx += (r[i][0] + r[i + 1][0]) * f;
      cy += (r[i][1] + r[i + 1][1]) * f;
    }
    if (Math.abs(a) > bestArea) {
      bestArea = Math.abs(a);
      best = [cx / (3 * a), cy / (3 * a)];
    }
  }
  return best;
}

async function styleAvailable(): Promise<boolean> {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 4000);
    const r = await fetch(ONLINE_STYLE, { signal: c.signal });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}

export function RealMap3D({ districts, weakest, project, quarter = RULES.horizon }: { districts: DistrictResult[]; weakest: string; project?: MapProject | null; quarter?: number }) {
  const { tr } = useApp();
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const maplibreRef = useRef<typeof import("maplibre-gl") | null>(null);
  const geoRef = useRef<Geo | null>(null);
  const markers = useRef<Record<string, Marker>>({});
  const projectMarker = useRef<Marker | null>(null);
  const projectVisual = useRef<{ kind: ProjectKind | undefined; open: boolean }>({ kind: undefined, open: false });
  const shown = useRef<Record<string, number>>({});
  const [metric, setMetric] = useState<"D" | Indicator>("D");
  const [status, setStatus] = useState<"loading" | "online" | "offline" | "error">("loading");
  const [hover, setHover] = useState<string | null>(null);
  const [projectInfo, setProjectInfo] = useState(false);
  const projectKind = project?.kind;
  const projectOpen = project ? projectIsOpen(project, quarter) : false;
  const projectName = projectKind ? tr.t(projectKind === "site" ? "projectSite" : projectKind === "park" ? "projectPark" : "projectSchool") : "";
  const projectState = tr.t(projectKind === "site" ? "projectAwaitingChoice" : projectOpen ? "projectOpen" : "projectBuilding");

  const valueOf = (d: DistrictResult, when: "before" | "after") => (metric === "D" ? (when === "before" ? d.scoreBefore : d.scoreAfter) : d[when][metric]);
  const targets = Object.fromEntries(districts.map((d) => [d.id, valueOf(d, "after")]));
  const befores = Object.fromEntries(districts.map((d) => [d.id, valueOf(d, "before")]));
  const targetKey = JSON.stringify([targets, befores]);
  const latest = useRef(targets);
  useEffect(() => {
    latest.current = targets;
  });

  /** GeoJSON с высотой и цветом по текущим значениям. */
  const withValues = (geo: Geo, values: Record<string, number>) => ({
    ...geo,
    features: geo.features.map((f) => {
      const v = values[String(f.properties.id)] ?? 50;
      return { ...f, properties: { ...f.properties, height: heightOf(v), color: colorOf(v) } };
    }),
  });

  // Инициализация карты один раз.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [ml, geoRes, online] = await Promise.all([import("maplibre-gl"), fetch("/data/astana-districts.geojson"), styleAvailable()]);
      if (cancelled || !box.current) return;
      ml.setWorkerUrl(`${location.origin}/maplibre/maplibre-gl-worker.mjs`);
      const geo: Geo = await geoRes.json();
      geoRef.current = geo;
      maplibreRef.current = ml;
      const map = new ml.Map({
        container: box.current,
        style: online ? ONLINE_STYLE : OFFLINE_STYLE,
        center: CAMERA.center,
        zoom: CAMERA.zoom,
        pitch: CAMERA.pitch,
        bearing: CAMERA.bearing,
        attributionControl: { compact: true, customAttribution: "Границы районов © OpenStreetMap contributors (ODbL)" },
      });
      mapRef.current = map;
      map.addControl(new ml.NavigationControl({ visualizePitch: true }), "top-right");
      map.on("error", (e) => console.warn("map", e.error?.message));
      map.once("style.load", () => {
        if (cancelled) return;
        shown.current = { ...latest.current };
        map.addSource("districts", { type: "geojson", data: withValues(geo, latest.current) as never });
        map.addLayer({
          id: "districts-3d",
          type: "fill-extrusion",
          source: "districts",
          paint: {
            "fill-extrusion-color": ["get", "color"],
            "fill-extrusion-height": ["get", "height"],
            "fill-extrusion-base": 0,
            "fill-extrusion-opacity": 0.55,
          },
        });
        map.addLayer({ id: "districts-outline", type: "line", source: "districts", paint: { "line-color": "#0d366b", "line-width": 1.5 } });
        map.addSource("project-footprint", { type: "geojson", data: footprintData(undefined, false, latest.current.nura ?? 50) as never });
        map.addLayer({
          id: "project-footprint-3d",
          type: "fill-extrusion",
          source: "project-footprint",
          paint: {
            "fill-extrusion-color": ["get", "color"],
            "fill-extrusion-base": ["get", "base"],
            "fill-extrusion-height": ["get", "height"],
            "fill-extrusion-opacity": 0.94,
          },
        });
        map.on("mousemove", "districts-3d", (e) => {
          map.getCanvas().style.cursor = "pointer";
          setHover(String(e.features?.[0]?.properties?.id ?? ""));
        });
        map.on("mouseleave", "districts-3d", () => {
          map.getCanvas().style.cursor = "";
          setHover(null);
        });
        for (const f of geo.features) {
          const el = document.createElement("div");
          el.className = "akim-map-label";
          markers.current[String(f.properties.id)] = new ml.Marker({ element: el }).setLngLat(labelPoint(f.geometry)).addTo(map);
        }
        setStatus(online ? "online" : "offline");
      });
    })().catch((e) => {
      console.warn(e);
      setStatus("error");
    });
    return () => {
      cancelled = true;
      projectMarker.current?.remove();
      projectMarker.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      maplibreRef.current = null;
    };
  }, []);

  // Маркер поверх 3D-района: место учебное, но сам выбранный объект виден на карте.
  useEffect(() => {
    projectMarker.current?.remove();
    projectMarker.current = null;
    projectVisual.current = { kind: projectKind, open: projectOpen };
    const map = mapRef.current;
    const ml = maplibreRef.current;
    if (map && status !== "loading" && status !== "error") {
      (map.getSource("project-footprint") as GeoJSONSource | undefined)?.setData(footprintData(projectKind, projectOpen, shown.current.nura ?? latest.current.nura ?? 50) as never);
    }
    if (!projectKind || !map || !ml || status === "loading" || status === "error") return;

    const marker = document.createElement("button");
    marker.type = "button";
    marker.setAttribute("aria-label", `${projectName}: ${projectState}`);
    marker.title = `${projectName}: ${projectState}`;
    const markerColor = projectKind === "site" ? "#2a78d6" : !projectOpen ? "#a96812" : projectKind === "park" ? "#167447" : "#bd5b33";
    marker.style.cssText = `display:flex;align-items:center;gap:7px;padding:7px 9px;border:2px solid ${markerColor};border-radius:12px;background:#fff;color:#172535;box-shadow:0 4px 18px #17253555;font:600 12px/1.2 system-ui;cursor:pointer;white-space:nowrap;`;
    const icon = document.createElement("span");
    icon.textContent = projectKind === "site" ? "◇" : projectOpen ? (projectKind === "park" ? "🌳" : "🏫") : "🚧";
    icon.setAttribute("aria-hidden", "true");
    icon.style.fontSize = "18px";
    const text = document.createElement("span");
    text.textContent = `${projectName} · ${projectState}`;
    marker.append(icon, text);
    marker.addEventListener("click", (event) => {
      event.stopPropagation();
      setProjectInfo((open) => !open);
    });
    projectMarker.current = new ml.Marker({ element: marker, anchor: "bottom", offset: [0, -30] }).setLngLat(PROJECT_POINT).addTo(map);
    return () => {
      projectMarker.current?.remove();
      projectMarker.current = null;
    };
  }, [projectKind, projectName, projectOpen, projectState, status]);

  // Анимация высот и обновление подписей при изменении плана/показателя.
  useEffect(() => {
    const map = mapRef.current;
    const geo = geoRef.current;
    if (!map || !geo || status === "loading" || status === "error") return;
    const [dst, before] = JSON.parse(targetKey) as [Record<string, number>, Record<string, number>];
    const src = { ...dst, ...shown.current };
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / 800);
      const e = 1 - Math.pow(1 - k, 3);
      const cur = Object.fromEntries(Object.keys(dst).map((id) => [id, src[id] + (dst[id] - src[id]) * e]));
      shown.current = cur;
      (map.getSource("districts") as GeoJSONSource | undefined)?.setData(withValues(geo, cur) as never);
      const visual = projectVisual.current;
      (map.getSource("project-footprint") as GeoJSONSource | undefined)?.setData(footprintData(visual.kind, visual.open, cur.nura ?? 50) as never);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    for (const d of districts) {
      const el = markers.current[d.id]?.getElement();
      if (!el) continue;
      const delta = Math.round((dst[d.id] - before[d.id]) * 10) / 10;
      const crit = metric === "D" && INDICATORS.some((k) => d.after[k] < RULES.criticalThreshold);
      el.innerHTML = `<div class="akim-map-chip${d.name === weakest && metric === "D" ? " weak" : ""}">
        <b>${tr.district(d.id)}${crit ? ' <span class="crit">!</span>' : ""}</b>
        <span>${dst[d.id].toFixed(1)}${delta ? ` <i class="${delta > 0 ? "up" : "down"}">${delta > 0 ? "+" : ""}${delta}</i>` : ""}</span>
      </div>`;
    }
    return () => cancelAnimationFrame(raf);
    // districts/tr/weakest входят в targetKey и язык; отдельная зависимость не нужна
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, status, tr.lang, weakest]);

  const hovered = districts.find((d) => d.id === hover);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="text-xs text-ink-3" htmlFor="real-map-metric">
          {tr.lang === "kz" ? "Биіктік" : "Высота"}:
        </label>
        <select id="real-map-metric" value={metric} onChange={(e) => setMetric(e.target.value as "D" | Indicator)} className="rounded-lg border border-line bg-card px-2 py-1 text-sm">
          <option value="D">{tr.lang === "kz" ? "Аудан балы (D)" : "Балл района (D)"}</option>
          {INDICATORS.map((k) => (
            <option key={k} value={k}>
              {k} · {tr.indicator(k)}
            </option>
          ))}
        </select>
        <span className="ml-auto flex flex-wrap items-center gap-3 text-[11px] text-ink-3">
          {[
            ["#d03b3b", "< 40"],
            ["#9ec5f4", "40–50"],
            ["#6da7ec", "50–60"],
            ["#3987e5", "60–70"],
            ["#1c5cab", "70+"],
          ].map(([c, l]) => (
            <span key={l} className="flex items-center gap-1">
              <span className="inline-block size-2.5 rounded-sm" style={{ background: c }} /> {l}
            </span>
          ))}
        </span>
      </div>
      <div className="relative overflow-hidden rounded-xl border border-line">
        <div ref={box} className="h-[520px] w-full bg-card-2" />
        <button
          onClick={() => mapRef.current?.flyTo({ ...CAMERA, duration: 1200 })}
          className="absolute bottom-10 right-2 rounded-md border border-line bg-card px-2 py-1 text-xs shadow"
        >
          ⟲ {tr.lang === "kz" ? "Қалаға оралу" : "К городу"}
        </button>
        {status === "loading" && <div className="absolute inset-0 grid place-items-center text-sm text-ink-3">{tr.lang === "kz" ? "Карта жүктелуде…" : "Загружаю карту…"}</div>}
        {status === "offline" && (
          <div className="absolute left-2 top-2 rounded-md bg-card/90 px-2 py-1 text-[11px] text-ink-2">
            {tr.lang === "kz" ? "Желі жоқ: қала астары жоқ, аудан шекаралары — жергілікті OSM деректері" : "Нет сети: без подложки, границы районов — локальные данные OSM"}
          </div>
        )}
        {status === "error" && <div className="absolute inset-0 grid place-items-center text-sm text-crit">WebGL недоступен</div>}
        {project && projectInfo && (
          <div className="absolute bottom-2 left-2 max-w-64 rounded-lg border border-line bg-card px-3 py-2 text-xs shadow-lg">
            <div className="font-semibold">{projectName}</div>
            <div className="text-ink-2">{projectState}</div>
            <div className="mt-1 text-ink-3">{tr.t("projectSiteDisclaimer")}</div>
          </div>
        )}
        {hovered && !(project && projectInfo) && (
          <div className="pointer-events-none absolute bottom-2 left-2 max-w-72 rounded-lg border border-line bg-card px-3 py-2 text-xs shadow-lg">
            <div className="font-semibold">{tr.district(hovered.id)}</div>
            <div className="text-ink-2">
              {Math.round(hovered.population * 100)}% {tr.t("residents")} · {tr.profile(hovered.id)}
            </div>
            <div className="mt-1">
              D: {hovered.scoreBefore} → <b>{hovered.scoreAfter}</b>
            </div>
            <div className="mt-1 grid grid-cols-5 gap-x-2 gap-y-0.5">
              {INDICATORS.map((k) => (
                <span key={k} className={hovered.after[k] < RULES.criticalThreshold ? "font-semibold text-crit" : ""}>
                  {k} {Math.round(hovered.after[k])}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      <p className="mt-1 text-[11px] text-ink-3">
        {tr.lang === "kz"
          ? "Аудан шекаралары — OpenStreetMap (ODbL), астары — OpenFreeMap. Биіктік пен түс — таңдалған көрсеткіш."
          : "Границы районов — OpenStreetMap (ODbL), подложка — OpenFreeMap. Высота и цвет — выбранный показатель."}
        {project && ` ${tr.t("projectSiteDisclaimer")}`}
      </p>
    </div>
  );
}
