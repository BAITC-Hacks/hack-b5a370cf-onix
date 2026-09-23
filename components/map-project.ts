import { MEASURES } from "@/lib/data";

/** Учебный проект для одного подготовленного участка в Нуре. */
export type MapProject = { kind: "site" | "park" | "school"; districtId: "nura" };

// Точка выбрана внутри границ Нуры только для иллюстрации сценария.
// Это не кадастровый участок и не предложение о реальном размещении.
export const PROJECT_POINT: [number, number] = [71.35, 51.13];

export function projectIsOpen(project: MapProject, quarter: number): boolean {
  if (project.kind === "site") return false;
  const measureId = project.kind === "park" ? "M4" : "M7";
  const measure = MEASURES.find((item) => item.id === measureId);
  return quarter > (measure?.lag ?? 0);
}
