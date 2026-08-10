"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@metavchim/ui";
import { apiPost, ApiError } from "@/lib/api";
import { useRequireAuth } from "@/lib/use-auth";
import { VoiceRecorder } from "../voice-recorder";

/**
 * מרכז הפקודות הקוליות — המתווך אומר משפט אחד, המערכת מזהה מה הוא
 * רוצה ומנתבת. הפעולה לעולם לא מתבצעת ישירות: תמיד מוצג "הבנתי: X"
 * עם אישור, כדי שדיבור לא יהפוך בטעות לפעולה מול לקוח.
 */

const ACTION_LABELS: Record<string, string> = {
  add_property: "🏠 הוספת נכס",
  add_buyer: "👤 הוספת קונה",
  add_lead: "📞 הוספת ליד",
  schedule_appointment: "📅 קביעת פגישה",
  send_offer: "📤 שליחת הצעה ללקוח",
  search: "🔍 חיפוש",
  unknown: "לא זוהתה פקודה",
};

interface RouteResult {
  action: keyof typeof ACTION_LABELS;
  confidence: "high" | "low";
  matched?: string;
  query?: string;
  content: string;
  appointment?: { startsAt?: string; timeExplicit: boolean; kind: string };
}

const dateTimeFmt = new Intl.DateTimeFormat("he-IL", { dateStyle: "full", timeStyle: "short" });

export default function VoiceCommandPage() {
  const { loading: authLoading } = useRequireAuth();
  const router = useRouter();
  const [transcript, setTranscript] = useState("");
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function analyze() {
    if (transcript.trim().length < 2) {
      setError("אמרו או הקלידו משהו קודם");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await apiPost<RouteResult>("/voice/route", { transcript: transcript.trim() });
      setRoute(result);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "ניתוח הפקודה נכשל");
    } finally {
      setBusy(false);
    }
  }

  /** מעבר למסך הייעודי עם התוכן — שם מאשרים ומשלימים פרטים. */
  function proceed() {
    if (!route) return;
    const content = encodeURIComponent(route.content || transcript.trim());
    switch (route.action) {
      case "add_property":
        router.push(`/properties/voice?t=${content}`);
        break;
      case "add_buyer":
        router.push(`/buyers/voice?t=${content}`);
        break;
      case "add_lead":
        router.push(`/leads/voice?t=${content}`);
        break;
      case "schedule_appointment": {
        const params = new URLSearchParams({ notes: route.content || transcript.trim() });
        if (route.appointment?.startsAt) params.set("startsAt", route.appointment.startsAt);
        if (route.appointment?.kind) params.set("kind", route.appointment.kind);
        router.push(`/calendar/new?${params.toString()}`);
        break;
      }
      case "send_offer":
        // מסך אישור ייעודי — הזיהוי מול המאגר נעשה שם, והשליחה
        // דורשת לחיצה מפורשת על ההתאמה הנכונה
        router.push(`/voice/offer?t=${encodeURIComponent(transcript.trim())}`);
        break;
      case "search":
        router.push(`/search?q=${encodeURIComponent(route.query ?? route.content)}`);
        break;
      default:
        break;
    }
  }

  if (authLoading) return <p aria-live="polite">טוען…</p>;

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-2 text-2xl font-bold">🎤 פקודה קולית</h1>
      <p className="mb-6" style={{ color: "var(--color-text-muted)" }}>
        אמרו מה לעשות — המערכת תזהה ותכין את המסך המתאים לאישורכם.
        למשל: &quot;תוסיף קונה משה כהן, 4 חדרים בבני ברק עד 2.3 מיליון&quot;,
        &quot;קבע פגישה מחר בעשר&quot;, &quot;חפש את שרה לוי&quot;.
      </p>

      {error ? (
        <p role="alert" className="mb-4 rounded-lg border p-3" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}

      <VoiceRecorder
        value={transcript}
        onChange={(v) => {
          setTranscript(v);
          setRoute(null);
        }}
        label="מה לעשות?"
        placeholder='לדוגמה: "תוסיף קונה משה כהן 050-1234567, מחפש 4 חדרים בבני ברק עד 2.3 מיליון, חייב מעלית"'
        onError={setError}
      />

      {route ? (
        <div
          className="mb-4 rounded-xl border p-4"
          style={{
            borderColor: route.action === "unknown" ? "var(--color-danger)" : "var(--color-primary)",
            background: "var(--color-surface)",
          }}
        >
          <p className="mb-1 font-semibold">
            הבנתי: {ACTION_LABELS[route.action] ?? route.action}
            {route.confidence === "low" && route.action !== "unknown" ? (
              <span className="font-normal" style={{ color: "var(--color-text-muted)" }}> (ניחוש — ודאו שזה נכון)</span>
            ) : null}
          </p>
          {route.action === "unknown" ? (
            /*
              הדוגמאות הן משפטים שלמים כפי שאומרים אותם, ולא רשימת
              מילות מפתח: "פתחו במילה מפורשת" שולח את המתווך לנסח
              כמו מכונה, וזה בדיוק מה שגורם לו להפסיק לדבר.
            */
            <p style={{ color: "var(--color-text-muted)" }}>
              לא הצלחתי לזהות פעולה. אפשר לומר משפט רגיל — למשל
              &quot;פגישה עם שמוליק מחר בעשר&quot;, &quot;תוסיף נכס דירת 4 חדרים
              ברמת גן&quot;, &quot;דיברתי עם יוסי שמחפש דירה&quot; או
              &quot;חפש את משה כהן&quot;.
            </p>
          ) : (
            <>
              <p className="mb-1" style={{ color: "var(--color-text-muted)" }}>
                {route.action === "search"
                  ? `חיפוש: ${route.query || route.content}`
                  : route.content}
              </p>
              {route.appointment?.startsAt ? (
                <p className="mb-3 font-medium">
                  📅 {dateTimeFmt.format(new Date(route.appointment.startsAt))}
                  {route.appointment.timeExplicit ? null : (
                    <span className="font-normal" style={{ color: "var(--color-text-muted)" }}>
                      {" "}(שעה לא נאמרה — נבחרה 10:00, אפשר לשנות)
                    </span>
                  )}
                </p>
              ) : route.action === "schedule_appointment" ? (
                <p className="mb-3" style={{ color: "var(--color-text-muted)" }}>
                  לא זוהה תאריך — תבחרו אותו במסך הבא.
                </p>
              ) : null}
              <Button onClick={proceed}>המשך →</Button>
            </>
          )}
        </div>
      ) : (
        <Button onClick={() => void analyze()} disabled={busy} className="w-full">
          {busy ? "מנתח…" : "מה לעשות עם זה?"}
        </Button>
      )}
    </div>
  );
}
