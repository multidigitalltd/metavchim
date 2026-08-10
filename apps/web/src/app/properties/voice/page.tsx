"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@metavchim/ui";
import { apiPost, ApiError } from "@/lib/api";
import { useRequireAuth } from "@/lib/use-auth";
import { IconMic } from "../../icons";
import { VoiceRecorder } from "../../voice-recorder";

/**
 * "הוסף נכס בקול" (אפיון §6) — המקליט המשותף (VoiceRecorder) מזהה דיבור
 * בעברית בדפדפן, והמתווך עורך לפני שליחה. הפרמטר ?t= מגיע ממסך הפקודה
 * הקולית הכללי, כך שאפשר לומר משפט אחד ולהמשיך ישר לכאן.
 */

function VoiceIntakeForm() {
  useRequireAuth();
  const router = useRouter();
  const initial = useSearchParams().get("t") ?? "";
  const [transcript, setTranscript] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (transcript.trim().length < 5) {
      setError("ספרו על הנכס — לפחות כמה מילים");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await apiPost<{ property: { id: string } }>("/voice-intakes", {
        transcript: transcript.trim(),
      });
      router.replace(`/properties/${result.property.id}`);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "קליטת הנכס נכשלה");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-2 text-2xl font-bold"><IconMic s={22} /> הוסף נכס בקול</h1>
      <p className="mb-6" style={{ color: "var(--color-text-muted)" }}>
        ספרו על הנכס בקול חופשי — עיר, רחוב, חדרים, קומה, מחיר, מאפיינים.
        המערכת תפרק הכל לשדות ותסמן מה חסר.
      </p>

      {error ? (
        <p role="alert" className="mb-4 rounded-lg border p-3" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}

      <VoiceRecorder
        value={transcript}
        onChange={setTranscript}
        label="תיאור הנכס"
        placeholder='לדוגמה: "דירת 3 חדרים בבני ברק, רחוב הרב שך, קומה 2 מתוך 4, בלי מעלית, 68 מטר, משופצת, מחיר 2.15 מיליון"'
        onError={setError}
      />

      <Button onClick={() => void submit()} disabled={submitting} className="w-full">
        {submitting ? "מעבד את הנכס…" : "צור כרטיס נכס"}
      </Button>
    </div>
  );
}

export default function VoiceIntakePage() {
  return (
    <Suspense fallback={<p aria-live="polite">טוען…</p>}>
      <VoiceIntakeForm />
    </Suspense>
  );
}
