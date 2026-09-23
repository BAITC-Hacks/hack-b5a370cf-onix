"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { LeaderboardEntry } from "@/lib/leaderboard";
import { encodePlan } from "@/lib/plan-url";
import { useApp } from "../AppState";
import { Button, Card, CardTitle, PageHeader, StatusBadge } from "../ui";

const TEAM_KEY = "akim.team";

/** Общий рейтинг команд: план отправляется на сервер, Score и худший случай считает движок. */
export default function LeaderboardPage() {
  const { tr, decisions, eventId, result, complete } = useApp();
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [team, setTeam] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "good" | "crit"; text: string } | null>(null);
  const [origin, setOrigin] = useState("");

  const refresh = async () => {
    try {
      const res = await fetch("/api/leaderboard", { cache: "no-store" });
      setEntries((await res.json()).entries);
    } catch {
      setEntries([]);
    }
  };

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    try {
      setTeam(localStorage.getItem(TEAM_KEY) ?? "");
    } catch {}
    setOrigin(location.origin);
    /* eslint-enable react-hooks/set-state-in-effect */
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, []);

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    try {
      localStorage.setItem(TEAM_KEY, team);
    } catch {}
    try {
      const res = await fetch("/api/leaderboard", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ team, decisions, eventId }) });
      const data = await res.json();
      if (!res.ok) throw new Error((data.errors ?? [data.error]).join(" "));
      setMsg({ kind: "good", text: `${tr.t("lbSent")} #${data.rank}` });
      await refresh();
    } catch (e) {
      setMsg({ kind: "crit", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const eventTitle = (id: string | null) => (id ? tr.event(id).title : tr.t("noEvent"));

  return (
    <div className="space-y-6">
      <PageHeader step={4} title={tr.t("lbTitle")} sub={tr.t("lbHint")} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          {!entries ? (
            <div className="h-24 animate-pulse rounded-xl bg-card-2" />
          ) : entries.length === 0 ? (
            <p className="text-sm text-ink-3">{tr.t("lbEmpty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="text-left text-xs text-ink-3">
                  <tr>
                    <th className="py-1 font-medium">#</th>
                    <th className="font-medium">{tr.t("lbTeam")}</th>
                    <th className="text-right font-medium">Score</th>
                    <th className="text-right font-medium">{tr.t("worstCase")}</th>
                    <th className="text-right font-medium">{tr.t("budget")}</th>
                    <th className="font-medium">{tr.t("navPlan")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e, i) => (
                    <tr key={e.id} className={`border-t border-line ${e.team === team ? "bg-accent-soft/40" : ""}`}>
                      <td className="py-1.5 font-semibold">{i === 0 ? "🏆" : i + 1}</td>
                      <td>
                        <div className="font-medium">{e.team}</div>
                        {e.eventId && <div className="text-[11px] text-ink-3">⚠ {eventTitle(e.eventId)}</div>}
                      </td>
                      <td className="text-right font-bold text-accent-strong">{e.score.toFixed(2)}</td>
                      <td className="text-right">
                        {e.failed > 0 ? (
                          <StatusBadge kind="crit">{tr.t("failedIn", { n: e.failed, m: 6 })}</StatusBadge>
                        ) : typeof e.worst === "number" ? e.worst.toFixed(2) : "—"}
                      </td>
                      <td className="text-right">{e.cost}</td>
                      <td className="text-xs text-ink-2">{e.decisions.map((d) => `${d.measureId}${d.districtId ? `/${tr.district(d.districtId)}` : ""}`).join(", ")}</td>
                      <td className="text-right">
                        <Link href={`/plan?${encodePlan(e.decisions, e.eventId)}`} className="text-xs text-accent-strong underline">
                          {tr.t("open")}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-3 flex items-center gap-3 text-xs text-ink-3">
            <button onClick={refresh} className="underline">
              {tr.t("optRefresh")}
            </button>
            {origin && (
              <span>
                {tr.t("lbShareHint")}: <code className="rounded bg-card-2 px-1">{origin}/plan</code>
              </span>
            )}
          </div>
        </Card>

        <Card>
          <CardTitle hint={tr.t("lbSubmitHint")}>{tr.t("lbSubmit")}</CardTitle>
          <div className="mb-3 rounded-xl bg-card-2 px-3 py-2 text-sm">
            <div className="text-xs text-ink-3">{tr.t("currentPlan")}</div>
            {decisions.length ? (
              <>
                <div>{decisions.map((d) => `${d.measureId} ${tr.district(d.districtId)}`).join(" · ")}</div>
                <div className="mt-1 font-semibold">
                  Score {result.score.toFixed(2)} · {tr.t("budget")} {result.cost}
                </div>
              </>
            ) : (
              <span className="text-ink-2">{tr.t("emptyPlan")}</span>
            )}
          </div>
          <label className="block text-xs text-ink-3" htmlFor="team">
            {tr.t("lbTeam")}
          </label>
          <input
            id="team"
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            maxLength={40}
            placeholder="Onix"
            className="mt-1 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <Button variant="primary" onClick={submit} disabled={!complete || busy || team.trim().length < 2} className="mt-3 w-full">
            {busy ? "…" : tr.t("lbSubmit")}
          </Button>
          {!complete && <p className="mt-2 text-xs text-ink-3">{tr.t("aiNeedPlan")}</p>}
          {msg && (
            <div className="mt-2">
              <StatusBadge kind={msg.kind}>{msg.text}</StatusBadge>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
