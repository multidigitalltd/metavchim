"use client";

import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@metavchim/ui";
import {
  JERUSALEM_TZ,
  jerusalemWallErrorMessage,
  jerusalemWallParts,
  resolveJerusalemWall,
  withQuery,
} from "@metavchim/shared";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { waMeUrl } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";
import { DictateFor } from "../../dictation-field";
import { IconChat } from "../../icons";
import { Notice } from "../../notice";
import { saveDraft, takeDraft } from "./draft";
import {
  PersonPicker,
  PropertyPicker,
  type PickedPerson,
  type PickedProperty,
} from "./link-pickers";

const inputStyle = { borderColor: "var(--color-input-border)", background: "var(--color-field)" } as const;

const KIND_LABELS: Record<string, string> = {
  viewing: "סיור בנכס",
  meeting: "פגישה",
  call: "שיחה",
};

/** מסלול החזרה מטופסי הקליטה — חייב להתאים ל-`safeReturnPath`. */
const SELF = "/calendar/new";

function NewAppointmentForm() {
  useRequireAuth();
  const router = useRouter();
  const params = useSearchParams();
  const formRef = useRef<HTMLFormElement>(null);
  const leadId = params.get("leadId") ?? undefined;
  const buyerId = params.get("buyerId") ?? undefined;
  const propertyId = params.get("propertyId") ?? undefined;
  // מהפקודה הקולית: הטקסט נכנס כהערות, והתאריך/שעה/סוג שזוהו ממלאים
  // את הטופס מראש — המתווך רק מאשר או מתקן
  const initialNotes = params.get("notes") ?? "";
  const startsAtParam = params.get("startsAt");
  const initialKind = params.get("kind") ?? "viewing";
  const parsedStart = startsAtParam ? new Date(startsAtParam) : null;
  const validStart = parsedStart && !Number.isNaN(parsedStart.getTime()) ? parsedStart : null;
  /*
   * ‎**שדות הטופס בשעת הקיר הישראלית.**
   *
   * ‎`getHours()` היה נותן את שעת הדפדפן: פקודה קולית „מחר בתשע”
   * שהשרת פירש כתשע בישראל הייתה נפתחת בטופס על 02:00 בניו-יורק,
   * והמתווך היה מאשר מועד אחר מזה שאמר. אותו זוג פונקציות לקריאה
   * ולכתיבה, כמו בעריכה שביומן (ביקורת Codex).
   */
  const initialWall = validStart ? jerusalemWallParts(validStart) : null;
  const initialDate = initialWall?.date ?? "";
  const initialTime = initialWall?.time ?? "";
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** אחרי היצירה, כשהפגישה מקושרת ללקוח: הצעה לעדכן אותו בוואטסאפ. */
  const [notify, setNotify] = useState<{ waUrl: string } | null>(null);

  /*
   * שני צדי הפגישה — מי ואיפה — הם state ולא פרמטרים בלבד.
   *
   * הכתובת נותנת את הצד שממנו הגיעו (מכרטיס הנכס: הנכס; מכרטיס
   * הלקוח: הלקוח), והמסך משלים את השני. גם הצד שהגיע מהכתובת ניתן
   * להחלפה כאן: מי שלחץ „קבע סיור” בנכס הלא נכון לא צריך לחזור
   * אחורה כדי לתקן.
   */
  const [property, setProperty] = useState<PickedProperty | null>(null);
  const [person, setPerson] = useState<PickedPerson | null>(null);
  const [resolving, setResolving] = useState(
    propertyId !== undefined || leadId !== undefined || buyerId !== undefined,
  );

  useEffect(() => {
    if (!resolving) return;
    let live = true;
    /*
     * המזהה מהכתובת בא בלי תווית, והמסך חייב להראות **מה** נבחר ולא
     * רק שמשהו נבחר — אחרת „הנכס: ✓” הוא הבטחה שאי אפשר לבדוק.
     * כישלון אינו עוצר: הפגישה עדיין תיווצר עם המזהה שבכתובת.
     */
    const jobs: Promise<void>[] = [];
    if (propertyId !== undefined) {
      jobs.push(
        apiGet<{
          id: string;
          city?: string;
          street?: string;
          neighborhood?: string;
          rooms?: number;
          marketingTitle?: string;
        }>(`/properties/${propertyId}`)
          .then((row) => {
            if (!live) return;
            const where = [row.street, row.neighborhood, row.city]
              .filter(Boolean)
              .join(", ");
            setProperty({
              id: row.id,
              label: where || row.marketingTitle || "הנכס שנבחר",
            });
          })
          .catch(() => {
            if (live) setProperty({ id: propertyId, label: "הנכס שנבחר" });
          }),
      );
    }
    if (leadId !== undefined) {
      jobs.push(
        // התשובה עטופה: { lead, timeline } — לא LeadDto ישירות (ביקורת Codex)
        apiGet<{ lead: { contact: { name: string; phone: string } } }>(
          `/leads/${leadId}`,
        )
          .then((res) => {
            if (!live) return;
            setPerson({
              kind: "lead",
              id: leadId,
              label: res.lead.contact.name,
              phone: res.lead.contact.phone,
            });
          })
          .catch(() => {
            if (live) setPerson({ kind: "lead", id: leadId, label: "הליד שנבחר" });
          }),
      );
    } else if (buyerId !== undefined) {
      jobs.push(
        apiGet<{ contact: { name: string; phone: string } }>(`/buyers/${buyerId}`)
          .then((row) => {
            if (!live) return;
            setPerson({
              kind: "buyer",
              id: buyerId,
              label: row.contact.name,
              phone: row.contact.phone,
            });
          })
          .catch(() => {
            if (live) setPerson({ kind: "buyer", id: buyerId, label: "הקונה שנבחר" });
          }),
      );
    }
    void Promise.all(jobs).then(() => {
      if (live) setResolving(false);
    });
    return () => {
      live = false;
    };
  }, [resolving, propertyId, leadId, buyerId]);

  /*
   * ‎**הטיוטה חוזרת אחרי הרכבת המסך, ולא כערך התחלתי.**
   *
   * ‎`sessionStorage` אינו קיים בשרת, ולכן קריאה שלו בזמן הרינדור
   * הייתה מייצרת שרת שמרנדר טופס ריק ולקוח שמרנדר טופס מלא —
   * אזהרת אי-התאמה, ובגרסאות מסוימות גם ערך שנדרס בחזרה לריק.
   * הכתיבה הישירה לשדות אחרי ההרכבה עוקפת את זה לגמרי, ומכבדת
   * את `defaultValue` של המסלול הקולי כשאין טיוטה.
   */
  useEffect(() => {
    const draft = takeDraft();
    const form = formRef.current;
    if (draft === null || form === null) return;
    for (const [name, value] of Object.entries(draft)) {
      const field = form.elements.namedItem(name);
      if (
        field instanceof HTMLInputElement ||
        field instanceof HTMLSelectElement ||
        field instanceof HTMLTextAreaElement
      ) {
        field.value = value;
      }
    }
    // פעם אחת בכניסה למסך: `takeDraft` מוחק, ולכן הרצה שנייה
    // הייתה מנקה טיוטה שזה עתה הוחזרה
  }, []);

  /**
   * יוצאים לטופס קליטה, ומשאירים כאן את מה שכבר נכתב.
   *
   * בלי זה, מי שגילה באמצע שהנכס אינו במערכת היה חוזר לטופס ריק
   * ומקליד מחדש את המועד וההערות. השדות אינם מנוהלים ב-state (הם
   * נקראים ב-`FormData` בשליחה), ולכן הם נקראים כאן מהטופס עצמו
   * ברגע הלחיצה — מה שכתוב עכשיו, לא מה שהיה ברינדור האחרון.
   *
   * המזהים נוסעים בכתובת והטקסט ב-`sessionStorage`; ההפרדה מנומקת
   * ב-`draft.ts`.
   */
  function leaveTo(target: string): void {
    const f = formRef.current === null ? null : new FormData(formRef.current);
    const read = (key: string): string => String(f?.get(key) ?? "").trim();
    const fields: Record<string, string> = {};
    for (const key of ["kind", "title", "date", "time", "duration", "notes"]) {
      const value = read(key);
      if (value !== "") fields[key] = value;
    }
    saveDraft(fields);

    let back = SELF;
    const ids: [string, string][] = [
      ["propertyId", property?.id ?? ""],
      ["leadId", person?.kind === "lead" ? person.id : ""],
      ["buyerId", person?.kind === "buyer" ? person.id : ""],
    ];
    for (const [key, value] of ids) {
      if (value !== "") back = withQuery(back, key, value);
    }
    router.push(withQuery(target, "returnTo", back));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const f = new FormData(event.currentTarget);
    const date = String(f.get("date"));
    const time = String(f.get("time"));
    const kind = String(f.get("kind"));
    /*
     * הטופס הוא `noValidate`, ולכן `required` אינו נאכף ושדה ריק
     * מגיע לכאן כמחרוזת ריקה. הפונקציה טוטלית ומחזירה סיבה במקום
     * לזרוק, והמסך אומר איזו — „מלאו תאריך ושעה” אינו „השעה אינה
     * קיימת” (ביקורת Codex).
     */
    const resolved = resolveJerusalemWall(date, time, null);
    if (!resolved.ok) {
      setError(jerusalemWallErrorMessage(resolved.reason));
      setSubmitting(false);
      return;
    }
    const startsAt = resolved.at;
    try {
      await apiPost("/appointments", {
        kind,
        title: String(f.get("title") ?? "").trim() || undefined,
        startsAt: startsAt.toISOString(),
        durationMinutes: Number(f.get("duration")),
        notes: String(f.get("notes") ?? "").trim() || undefined,
        /*
         * שלושת הקישורים יחד. `buyerId` נשלח כאן לראשונה — השער כבר
         * קיבל אותו מאז שהיומן נבנה, אבל שום מסך לא שלח אותו, ולכן
         * סיור עם קונה נשמר בלי הקונה.
         */
        leadId: person?.kind === "lead" ? person.id : undefined,
        buyerId: person?.kind === "buyer" ? person.id : undefined,
        propertyId: property?.id,
      });
      /*
       * "תיאום ביומן עם הודעה ללקוח": כשהפגישה מקושרת ללקוח, ההודעה
       * נפתחת בוואטסאפ מנוסחת ומוכנה — המתווך רק לוחץ שליחה. השליחה
       * לעולם לא אוטומטית: הודעה ללקוח יוצאת רק ביד של בן אדם.
       */
      if (person !== null && person.phone !== undefined) {
        // ההודעה ללקוח נוקבת בשעה — ולכן בשעון ישראל, לא בזה של המכשיר
        const when = new Intl.DateTimeFormat("he-IL", {
          timeZone: JERUSALEM_TZ,
          dateStyle: "full",
          timeStyle: "short",
        }).format(startsAt);
        // הכתובת בהודעה היא מה שהלקוח באמת צריך כדי להגיע
        const where = property === null ? "" : ` ב${property.label}`;
        setNotify({
          waUrl: waMeUrl(
            person.phone,
            `שלום ${person.label}, קבענו ${KIND_LABELS[kind] ?? "פגישה"}${where} ל${when}. נתראה!`,
          ),
        });
        setSubmitting(false);
        return;
      }
      router.replace("/calendar");
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "קביעת הפגישה נכשלה");
      setSubmitting(false);
    }
  }

  if (notify) {
    return (
      <div className="mx-auto max-w-lg">
        <h1 className="mb-2 text-2xl font-bold">✓ הפגישה נקבעה</h1>
        <p className="mb-6" style={{ color: "var(--color-text-muted)" }}>
          רוצים לעדכן את הלקוח? ההודעה כבר מנוסחת — נשאר רק ללחוץ שליחה בוואטסאפ.
        </p>
        <div className="flex flex-wrap gap-3">
          <a href={notify.waUrl} target="_blank" rel="noopener noreferrer" className="mv-btn-action" style={{ textDecoration: "none" }}>
            <IconChat s={15} /> שלח עדכון ללקוח בוואטסאפ
          </a>
          <Button variant="ghost" onClick={() => router.replace("/calendar")}>
            סיום — ליומן
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-2 text-2xl font-bold">פגישה חדשה</h1>
      <p className="mb-4" style={{ color: "var(--color-text-muted)" }}>
        מי ואיפה — שניהם ניתנים לבחירה כאן. הפגישה תתועד בציר הזמן של
        הכרטיסים שיקושרו אליה.
      </p>

      <form onSubmit={onSubmit} noValidate ref={formRef}>
        {error ? (
          <Notice tone="danger">{error}</Notice>
        ) : null}

        {resolving ? (
          <p className="mb-4" aria-live="polite" style={{ color: "var(--color-text-muted)" }}>
            טוען את הכרטיס…
          </p>
        ) : (
          <>
            <PersonPicker
              value={person}
              onPick={setPerson}
              onClear={() => setPerson(null)}
              onNew={() => leaveTo("/leads/new")}
            />
            <PropertyPicker
              value={property}
              onPick={setProperty}
              onClear={() => setProperty(null)}
              onNew={() => leaveTo("/properties/new")}
            />
          </>
        )}

        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="kind" className="mb-1 block font-medium">סוג *</label>
            <select id="kind" name="kind" required defaultValue={initialKind} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle}>
              <option value="viewing">סיור בנכס</option>
              <option value="meeting">פגישה</option>
              <option value="call">שיחה</option>
            </select>
          </div>
          <div>
            <label htmlFor="title" className="mb-1 block font-medium">כותרת</label>
            <input id="title" name="title" maxLength={200} placeholder="סיור עם יעקב כהן" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
          </div>
          <div>
            <label htmlFor="date" className="mb-1 block font-medium">תאריך *</label>
            <input id="date" name="date" type="date" required defaultValue={initialDate} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
          </div>
          <div>
            <label htmlFor="time" className="mb-1 block font-medium">שעה *</label>
            <input id="time" name="time" type="time" required defaultValue={initialTime} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
          </div>
          <div>
            <label htmlFor="duration" className="mb-1 block font-medium">משך (דקות)</label>
            <select id="duration" name="duration" defaultValue="30" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle}>
              <option value="15">15</option>
              <option value="30">30</option>
              <option value="45">45</option>
              <option value="60">60</option>
              <option value="90">90</option>
              <option value="120">120</option>
            </select>
          </div>
        </div>

        <div className="mb-6">
          <label htmlFor="notes" className="mb-1 block font-medium">הערות</label>
          <textarea id="notes" name="notes" rows={2} maxLength={2000} defaultValue={initialNotes} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
          <DictateFor targetId="notes" />
        </div>

        <div className="flex gap-3">
          <Button type="submit" disabled={submitting}>{submitting ? "קובע…" : "קבע פגישה"}</Button>
          <Button type="button" variant="ghost" onClick={() => router.back()}>ביטול</Button>
        </div>
      </form>
    </div>
  );
}

export default function NewAppointmentPage() {
  return (
    <Suspense fallback={<p aria-live="polite">טוען…</p>}>
      <NewAppointmentForm />
    </Suspense>
  );
}
