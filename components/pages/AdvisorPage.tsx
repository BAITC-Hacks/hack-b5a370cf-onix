"use client";

import { useRouter } from "next/navigation";
import { Advisor } from "../Advisor";
import { useApp } from "../AppState";
import { Card, PageHeader } from "../ui";
import { EventBar } from "./EventBar";

export default function AdvisorPage() {
  const { tr, decisions, eventId, setDecisions, result } = useApp();
  const router = useRouter();
  return (
    <div className="space-y-6">
      <PageHeader step={3} title={tr.t("advisorTitle")} sub={tr.t("advisorHint")} />
      <EventBar />
      <Card>
        <div className="mb-4 rounded-xl bg-card-2 px-3 py-2 text-sm">
          <span className="font-semibold">{tr.t("currentPlan")}: </span>
          {decisions.length ? (
            <>
              {decisions.map((d) => `${d.measureId} ${tr.district(d.districtId)}`).join(" · ")} — <b>Score {result.score.toFixed(2)}</b>
            </>
          ) : (
            <span className="text-ink-2">{tr.t("emptyPlan")}</span>
          )}
        </div>
        <Advisor
          decisions={decisions}
          eventId={eventId}
          onApply={(d) => {
            setDecisions(d);
            router.push("/plan");
          }}
        />
      </Card>
    </div>
  );
}
