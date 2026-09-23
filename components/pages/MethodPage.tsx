"use client";

import { CONFLICTS, INDICATOR_INFO, INDICATORS, RULES, SYNERGIES } from "@/lib/data";
import { useApp } from "../AppState";
import { Card, CardTitle } from "../ui";

export default function MethodPage() {
  const { tr, result } = useApp();
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="lg:col-span-2">
        <CardTitle hint={tr.t("methodHint")}>{tr.t("methodTitle")}</CardTitle>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>
            <code className="rounded bg-card-2 px-1">{tr.t("m1")}</code>
          </li>
          <li>{tr.t("m2")}</li>
          <li>{tr.t("m3")}</li>
          <li>
            <b>{tr.t("m4")}</b>
          </li>
        </ol>
      </Card>
      <Card>
        <CardTitle>{tr.t("rulesTitle")}</CardTitle>
        <ul className="space-y-1.5 text-sm text-ink-2">
          <li>• {tr.t("rule1", { b: result.budget })}</li>
          {CONFLICTS.map((c) => (
            <li key={c.a + c.b}>• {tr.t(c.sameDistrictOnly ? "conflictSameRule" : "conflictAny", { a: c.a, b: c.b })}</li>
          ))}
          {SYNERGIES.map((s) => (
            <li key={s.first + s.second}>• {tr.t("synergyRule", { a: s.first, b: s.second, k: tr.indicator(s.indicator), v: s.bonus })}</li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardTitle>{tr.t("weightsTitle")}</CardTitle>
        <table className="w-full text-sm">
          <tbody>
            {INDICATORS.map((k) => (
              <tr key={k} className="border-t border-line first:border-0">
                <td className="w-10 py-1 font-semibold text-ink-3">{k}</td>
                <td className="py-1">{tr.indicator(k)}</td>
                <td className="py-1 text-right">{INDICATOR_INFO[k].weight.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-ink-3">
          0.7 / 0.3 · {RULES.criticalThreshold} · −{RULES.criticalPenalty}
        </p>
      </Card>
      <Card className="lg:col-span-2">
        <CardTitle>{tr.t("aiRoleTitle")}</CardTitle>
        <ul className="grid gap-3 text-sm sm:grid-cols-2">
          {(["aiRole1", "aiRole2", "aiRole3", "aiRole4"] as const).map((k) => (
            <li key={k} className="rounded-xl bg-card-2 p-3">
              {tr.t(k)}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
