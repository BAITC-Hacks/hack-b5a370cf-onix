// Компактная сериализация набора в URL: ?p=M7.nura,M12,M5.saryarka&e=heating — для ссылки на отчёт и «поделиться».
import type { Decision } from "./engine.ts";

export function encodePlan(decisions: Decision[], eventId?: string | null): string {
  const params = new URLSearchParams();
  params.set("p", decisions.map((d) => (d.districtId ? `${d.measureId}.${d.districtId}` : d.measureId)).join(","));
  if (eventId) params.set("e", eventId);
  return params.toString();
}

export function decodePlan(params: URLSearchParams): { decisions: Decision[]; eventId: string | null } {
  const raw = params.get("p") ?? "";
  const decisions = raw
    .split(",")
    .filter(Boolean)
    .map((part) => {
      const [measureId, districtId] = part.split(".");
      return { measureId, districtId: districtId ?? null };
    });
  return { decisions, eventId: params.get("e") };
}
