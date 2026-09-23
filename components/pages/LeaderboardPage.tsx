"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { LeaderboardEntry } from "@/lib/leaderboard";
import { encodePlan } from "@/lib/plan-url";
import { useApp } from "../AppState";
import { Button, Card, CardTitle, PageHeader, StatusBadge } from "../ui";

const TEAM_KEY = "akim.team";
const OWNER_KEY_PREFIX = "akim.leaderboard.owner.v1.";

function ownerTokenFor(team: string): string {
  const normalized = team.replace(/\s+/g, " ").trim().slice(0, 40).toLowerCase();
  const storageKey = `${OWNER_KEY_PREFIX}${encodeURIComponent(normalized)}`;
  let token = localStorage.getItem(storageKey);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    // Persist before sending: a lost response must not lose ownership of a saved row.
    localStorage.setItem(storageKey, token);
  }
  return token;
}

/** Общий рейтинг команд: план отправляется на сервер, Score и худший случай считает движок. */
export default function LeaderboardPage() {
  const { tr, decisions, eventId, result, complete } = useApp();
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [team, setTeam] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "good" | "crit"; text: string } | null>(null);
  const [origin, setOrigin] = useState("");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/leaderboard", { cache: "no-store" });
      if (!res.ok) throw new Error("Leaderboard unavailable");
      const data = await res.json();
      if (!Array.isArray(data.entries)) throw new Error("Invalid leaderboard response");
      setEntries(data.entries);
      setLoadError(false);
    } catch {
      setEntries((current) => current ?? []);
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    try {
      setTeam(localStorage.getItem(TEAM_KEY) ?? "");
    } catch {}
    setOrigin(location.origin);
    /* eslint-enable react-hooks/set-state-in-effect */
    refresh();
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const t = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 60_000);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    try {
      localStorage.setItem(TEAM_KEY, team);
    } catch {}
    try {
      let ownerToken: string;
      try {
        ownerToken = ownerTokenFor(team);
      } catch {
        throw new Error(tr.t("lbStorageUnavailable"));
      }
      const res = await fetch("/api/leaderboard", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ team, decisions, eventId, ownerToken }) });
      const data = await res.json();
      if (res.status === 503) throw new Error(tr.t("lbUnavailable"));
      if (res.status === 429) throw new Error(tr.t("lbTooMany"));
      if (data.code === "team_taken") throw new Error(tr.t("lbTeamTaken"));
      if (data.code === "not_ranked") throw new Error(tr.t("lbNotRanked"));
      if (data.code === "baseline_only") throw new Error(tr.t("lbBaselineOnly"));
      if (data.code === "invalid_token") throw new Error(tr.t("lbStorageUnavailable"));
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
          {loadError && (
            <div className="mb-3">
              <StatusBadge kind="crit">{tr.t("lbUnavailable")}</StatusBadge>
            </div>
          )}
          {!entries ? (
            <div className="h-24 animate-pulse rounded-xl bg-card-2" />
          ) : entries.length === 0 && !loadError ? (
            <p className="text-sm text-ink-3">{tr.t("lbEmpty")}</p>
          ) : entries.length > 0 ? (
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
          ) : null}
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
                  {complete ? `Score ${result.score.toFixed(2)}` : tr.t("scoreProvisional")} · {tr.t("budget")} {result.cost}
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
            placeholder="Onix Demo"
            className="mt-1 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <Button variant="primary" onClick={submit} disabled={!complete || eventId !== null || busy || team.trim().length < 2} className="mt-3 w-full">
            {busy ? "…" : tr.t("lbSubmit")}
          </Button>
          {!complete && <p className="mt-2 text-xs text-ink-3">{tr.t("aiNeedPlan")}</p>}
          {eventId !== null && <p className="mt-2 text-xs text-ink-3">{tr.t("lbBaselineOnly")}</p>}
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
