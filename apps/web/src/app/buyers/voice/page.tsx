"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@metavchim/ui";
import { apiPost, ApiError } from "@/lib/api";
import { formatPrice, shekelsToAgorot } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";
import { IconMic } from "../../icons";
import { VoiceRecorder } from "../../voice-recorder";

/**
 * "קונה בקול" — במקביל ל"נכס בקול": המתווך מדבר, המערכת מחלצת,
 * והוא מאשר/משלים לפני היצירה. אף רשומה לא נוצרת מדיבור בלבד.
 */

const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-bg)" } as const;

interface ExtractedPerson {
  name?: string;
  phone?: string;
  cities: string[];
  dealType?: "sale" | "rent";
  budgetMinAgorot?: number;
  budgetMaxAgorot?: number;
  roomsMin?: number;
  roomsMax?: number;
  areaSqmMin?: number;
  maturity?: string;
  financing?: string;
  features: Record<string, "must" | "nice">;
}

const FEATURE_LABELS: Record<string, string> = {
  hasElevator: "מעלית",
  hasParking: "חניה",
  hasBalcony: "מרפסת",
  hasSafeRoom: 'ממ"ד',
  hasStorage: "מחסן",
};

function BuyerVoiceForm() {
  const { loading: authLoading } = useRequireAuth();
  const router = useRouter();
  const initial = useSearchParams().get("t") ?? "";
  const [transcript, setTranscript] = useState(initial);
  const [person, setPerson] = useState<ExtractedPerson | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function analyze() {
    if (transcript.trim().length < 2) {
      setError("ספרו על הקונה — לפחות כמה מילים");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await apiPost<{ person: ExtractedPerson; missing: string[] }>("/voice/preview", {
        transcript: transcript.trim(),
        target: "buyer",
      });
      setPerson(result.person);
      setMissing(result.missing);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "החילוץ נכשל");
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!person) return;
    setBusy(true);
    setError(null);
    const f = new FormData(event.currentTarget);
    const num = (name: string): number | undefined => {
      const v = String(f.get(name) ?? "").trim();
      return v === "" ? undefined : Number(v);
    };
    const budgetMax = num("budgetMax");
    try {
      const created = await apiPost<{ id: string }>("/voice/buyers", {
        transcript: transcript.trim(),
        name: String(f.get("name")).trim(),
        phone: String(f.get("phone")).trim(),
        cities: String(f.get("cities"))
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean),
        dealType: String(f.get("dealType")),
        budgetMaxAgorot: budgetMax === undefined ? 0 : shekelsToAgorot(budgetMax),
        ...(person.budgetMinAgorot !== undefined ? { budgetMinAgorot: person.budgetMinAgorot } : {}),
        ...(person.roomsMin !== undefined ? { roomsMin: person.roomsMin } : {}),
        ...(person.roomsMax !== undefined ? { roomsMax: person.roomsMax } : {}),
        ...(person.areaSqmMin !== undefined ? { areaSqmMin: person.areaSqmMin } : {}),
        features: person.features,
        ...(person.maturity !== undefined ? { maturity: person.maturity } : {}),
        ...(person.financing !== undefined ? { financing: person.financing } : {}),
      });
      router.replace(`/buyers/${created.id}`);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "יצירת הקונה נכשלה");
      setBusy(false);
    }
  }

  if (authLoading) return <p aria-live="polite">טוען…</p>;

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-2 text-2xl font-bold"><IconMic s={22} /> הוסף קונה בקול</h1>
      <p className="mb-6" style={{ color: "var(--color-text-muted)" }}>
        ספרו על הקונה — שם, טלפון, מה הוא מחפש, תקציב ומה חשוב לו.
        המערכת תפרק לשדות ותציג לאישור.
      </p>

      {error ? (
        <p role="alert" className="mb-4 rounded-lg border p-3" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}

      {!person ? (
        <>
          <VoiceRecorder
            value={transcript}
            onChange={setTranscript}
            label="תיאור הקונה"
            placeholder='לדוגמה: "דיברתי עם משה כהן, 050-1234567, מחפש 4 חדרים בבני ברק עד 2.3 מיליון, חייב מעלית וממ״ד, יש לו אישור עקרוני"'
            onError={setError}
          />
          <Button onClick={() => void analyze()} disabled={busy} className="w-full">
            {busy ? "מנתח…" : "נתח ובדוק"}
          </Button>
        </>
      ) : (
        <form onSubmit={(e) => void submit(e)} noValidate>
          {missing.length > 0 ? (
            <p role="status" className="mb-4 rounded-lg border p-3" style={{ borderColor: "var(--color-danger)", background: "var(--color-surface)" }}>
              יש להשלים: {missing.join(", ")}
            </p>
          ) : (
            <p role="status" className="mb-4 rounded-lg border p-3" style={{ borderColor: "var(--color-success)", background: "var(--color-surface)" }}>
              ✓ כל הפרטים זוהו — בדקו ואשרו
            </p>
          )}

          <div className="mb-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="name" className="mb-1 block font-medium">שם *</label>
              <input id="name" name="name" required minLength={2} defaultValue={person.name ?? ""} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="phone" className="mb-1 block font-medium">טלפון *</label>
              <input id="phone" name="phone" required dir="ltr" placeholder="+972501234567" defaultValue={person.phone ?? ""} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="cities" className="mb-1 block font-medium">ערים * <span className="font-normal">(בפסיק)</span></label>
              <input id="cities" name="cities" required defaultValue={person.cities.join(", ")} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="budgetMax" className="mb-1 block font-medium">תקציב עד (₪) *</label>
              <input
                id="budgetMax"
                name="budgetMax"
                type="number"
                required
                min="1000"
                step="10000"
                inputMode="numeric"
                defaultValue={person.budgetMaxAgorot === undefined ? "" : Math.round(person.budgetMaxAgorot / 100)}
                className="w-full rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
            </div>
            <div>
              <label htmlFor="dealType" className="mb-1 block font-medium">סוג עסקה</label>
              <select id="dealType" name="dealType" defaultValue={person.dealType ?? "sale"} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle}>
                <option value="sale">קנייה</option>
                <option value="rent">שכירות</option>
              </select>
            </div>
          </div>

          <div className="mb-6 rounded-xl border p-3" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
            <p className="mb-1 font-medium">מה עוד זוהה:</p>
            <ul className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              {person.roomsMin !== undefined ? (
                <li>חדרים: {person.roomsMin}{person.roomsMax !== undefined && person.roomsMax !== person.roomsMin ? `–${person.roomsMax}` : ""}</li>
              ) : null}
              {person.budgetMinAgorot !== undefined ? <li>תקציב מ-: {formatPrice(person.budgetMinAgorot)}</li> : null}
              {person.areaSqmMin !== undefined ? <li>שטח מינימלי: {person.areaSqmMin} מ&quot;ר</li> : null}
              {Object.keys(person.features).length > 0 ? (
                <li>
                  מאפיינים:{" "}
                  {Object.entries(person.features)
                    .map(([k, level]) => `${FEATURE_LABELS[k] ?? k} (${level === "must" ? "חובה" : "עדיפות"})`)
                    .join(", ")}
                </li>
              ) : null}
              {person.maturity ? <li>בשלות זוהתה</li> : null}
              {person.financing ? <li>מימון זוהה</li> : null}
            </ul>
            <p className="mt-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
              אפשר לערוך הכול בכרטיס הקונה אחרי היצירה.
            </p>
          </div>

          <div className="flex gap-3">
            <Button type="submit" disabled={busy}>{busy ? "יוצר…" : "צור קונה"}</Button>
            <Button type="button" variant="ghost" onClick={() => setPerson(null)}>חזרה לעריכת הטקסט</Button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function BuyerVoicePage() {
  return (
    <Suspense fallback={<p aria-live="polite">טוען…</p>}>
      <BuyerVoiceForm />
    </Suspense>
  );
}
