"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { API_BASE, apiGet } from "@/lib/api";
import {
  CALL_OUTCOME_LABELS,
  formatJerusalemDate,
  formatJerusalemTime,
  type CallHighlights,
} from "@metavchim/shared";
import { CallHighlightFields, CallTranscript } from "../../calls/call-parts";
import { Notice } from "../../notice";

/**
 * השיחות של הליד — בכרטיס עצמו, ולא רק במסך השיחות.
 *
 * מה שהיה: תוכן השיחה הגיע לכרטיס כהערת מערכת בציר הזמן —
 * „סיכום שיחה: …” ואחריו התמלול, טקסט אחד ארוך בתוך רשימת
 * האירועים. אין נגן, אין שדות, ואי אפשר להבחין בין מה שנאמר
 * למה שנרשם. מתווך שרצה לשמוע את השיחה היה צריך לעבור למסך
 * השיחות ולחפש אותה שם לפי שם וזמן.
 *
 * הנתיב `GET /calls?leadId=` והשמעת ההקלטה כבר היו קיימים ומורשים
 * לצפייה — כולל הערה בשרת שההשמעה נועדה „בכרטיס הלקוח”. מה שחסר
 * היה החיבור.
 */

interface LeadCall {
  id: string;
  direction: "inbound" | "outbound";
  occurredAt: string;
  durationMinutes?: number;
  outcome: string;
  summary?: string;
  transcript?: string;
  transcriptionStatus?: string;
  hasRecording?: boolean;
  highlights?: CallHighlights;
}

export function LeadCalls({ leadId }: { leadId: string }): React.JSX.Element {
  const [calls, setCalls] = useState<LeadCall[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    apiGet<{ items: LeadCall[] }>(`/calls?leadId=${leadId}`)
      .then((res) => {
        if (live) setCalls(res.items);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [leadId]);

  /*
   * כשל בטעינה אינו „אין שיחות”. השתיקה הזו היא בדיוק מה שגורם
   * למתווך להאמין שאין תיעוד, ולהתקשר ללקוח בלי לדעת מה כבר נאמר.
   */
  if (failed) {
    return <Notice tone="danger">טעינת השיחות נכשלה. רעננו את העמוד כדי לנסות שוב.</Notice>;
  }
  if (calls === null) return <p aria-live="polite">טוען שיחות…</p>;
  if (calls.length === 0) {
    return (
      <div
        className="rounded-[13px] border p-5 text-sm"
        style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
      >
        <p className="m-0 mb-1 font-bold" style={{ color: "var(--color-text)" }}>
          אין שיחות מתועדות לליד הזה.
        </p>
        <p className="m-0">
          שיחות ממרכזייה מחוברת נכנסות לכאן מעצמן. אפשר גם לתעד שיחה ידנית{" "}
          <Link href="/calls" className="underline">
            במסך השיחות
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <ol className="m-0 list-none p-0">
      {calls.map((call) => (
        <li key={call.id} className="mb-4 last:mb-0">
          <LeadCallCard call={call} />
        </li>
      ))}
    </ol>
  );
}

function LeadCallCard({ call }: { call: LeadCall }): React.JSX.Element {
  const [showTranscript, setShowTranscript] = useState(false);
  const at = new Date(call.occurredAt);
  return (
    <article
      className="rounded-[13px] border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-card)" }}
    >
      <p className="m-0 mb-2 text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>
        <span style={{ fontWeight: 800, color: "var(--color-text)" }}>
          {call.direction === "inbound" ? "שיחה נכנסת" : "שיחה יוצאת"}
        </span>{" "}
        · <span dir="ltr">{formatJerusalemDate(at)}</span>{" "}
        <span dir="ltr">{formatJerusalemTime(at)}</span>
        {call.durationMinutes !== undefined ? (
          <>
            {" · משך "}
            <span dir="ltr">{call.durationMinutes}</span> דק׳
          </>
        ) : null}
        {" · "}
        {CALL_OUTCOME_LABELS[call.outcome] ?? call.outcome}
      </p>

      {call.summary !== undefined ? (
        <p className="m-0 text-sm" style={{ lineHeight: 1.55 }}>
          {call.summary}
        </p>
      ) : (
        <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
          לא נרשם סיכום.
        </p>
      )}

      <CallHighlightFields highlights={call.highlights ?? {}} />

      {/*
       * ההקלטה מושמעת כאן, ולא רק במסך השיחות. `preload="none"` —
       * כרטיס עם חמש שיחות לא ימשוך חמישה קבצי אודיו לפני שביקשו.
       */}
      {call.hasRecording === true ? (
        <audio controls preload="none" className="mt-3 w-full" src={`${API_BASE}/calls/${call.id}/recording`}>
          הדפדפן שלכם אינו תומך בהשמעת אודיו.
        </audio>
      ) : null}

      {call.transcript !== undefined ? (
        <div className="mt-3">
          <button
            type="button"
            className="mv-btn-plain"
            aria-expanded={showTranscript}
            onClick={() => setShowTranscript((v) => !v)}
          >
            {showTranscript ? "הסתר תמלול" : "הצג תמלול"}
          </button>
          {showTranscript ? <CallTranscript transcript={call.transcript} /> : null}
        </div>
      ) : null}
    </article>
  );
}
