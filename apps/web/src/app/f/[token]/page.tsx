"use client";

import { use, useCallback, useEffect, useState } from "react";
import {
  INTAKE_FEATURE_LABEL,
  INTAKE_FEATURES,
  INTAKE_NOTES_MAX,
  type IntakeAnswers,
  type IntakeFeature,
} from "@metavchim/shared";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { PROPERTY_TYPE_LABELS } from "@/lib/format";
import { Notice } from "../../notice";

/**
 * „מה אתם מחפשים?” — הטופס שהלקוח ממלא בעצמו.
 *
 * ## מי קורא את העמוד הזה
 *
 * לא מתווך. אדם שקיבל הודעת וואטסאפ, פותח אותה בטלפון, ורוצה
 * לסיים תוך דקה. לכן: שאלות בשפה של אדם ולא של מערכת, ברירות
 * מחדל שכבר מלאות, ושום שדה חובה מלבד מה שבאמת אי אפשר בלעדיו.
 *
 * ## למה הכול רשות
 *
 * לקוח שאינו יודע עדיין את התקציב הוא לקוח אמיתי. טופס שדורש
 * ממנו מספר יקבל מספר שהומצא — וזה גרוע משדה ריק, כי מנוע
 * ההתאמות מתייחס למספר שהומצא כאילו הוא נכון.
 *
 * ## למה השדות מגיעים מלאים
 *
 * מה שהמתווך כבר רשם מוצג, והלקוח **מתקן** במקום להתחיל מאפס.
 * זה גם מה שמאפשר לצרף את התשובות לכרטיס בלי לדרוס: הלקוח ראה
 * את מה שהיה, ומה ששלח הוא מה שהוא מתכוון שיהיה.
 *
 * ## מה אין כאן
 *
 * שום פרט של לקוח אחר, ושום מזהה פנימי. מי שמצא את הקישור ברחוב
 * רואה טופס, לא מאגר.
 */

interface PublicView {
  officeName: string;
  greetingName: string;
  status: string;
  inactive: "revoked" | "expired" | null;
  prefill: IntakeAnswers;
  submittedAt: string | null;
}

/** סוגי הנכס שמוצעים ללקוח. רשימה קצרה — זה טופס, לא קטלוג. */
/*
 * ערכי `PropertyTypeSchema` בדיוק — לא שמות שנראים נכון.
 *
 * הרשימה הקודמת שלחה `house` ו-`lot`, שאינם קיימים בסכימה: הלקוח
 * שסימן „בית פרטי” היה שולח ערך שאינו מוכר, הכרטיס היה מציג את
 * המחרוזת הגולמית, ומנוע ההתאמות לא היה מוצא לו אף נכס — בלי ששום
 * דבר נראה שבור. השמות הנכונים הם `private_house` ו-`plot`.
 */
const TYPES = [
  "apartment",
  "garden_apartment",
  "penthouse",
  "duplex",
  "private_house",
  "plot",
];

/** אגורות ⇄ שקלים. הלקוח חושב בשקלים; המערכת שומרת באגורות. */
function toShekels(agorot: number | undefined): string {
  return agorot === undefined ? "" : String(Math.round(agorot / 100));
}
function toAgorot(shekels: string): number | null | undefined {
  const trimmed = shekels.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : undefined;
}

function numOrNull(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

export default function IntakeFormPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [view, setView] = useState<PublicView | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  /* --- שדות הטופס --- */
  const [dealType, setDealType] = useState<"sale" | "rent">("sale");
  const [cities, setCities] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [roomsMin, setRoomsMin] = useState("");
  const [roomsMax, setRoomsMax] = useState("");
  const [budgetMax, setBudgetMax] = useState("");
  const [areaMin, setAreaMin] = useState("");
  const [features, setFeatures] = useState<Partial<Record<IntakeFeature, "must" | "nice">>>({});
  const [entryType, setEntryType] = useState<"immediate" | "by_date" | "flexible" | "">("");
  const [entryBy, setEntryBy] = useState("");
  const [notes, setNotes] = useState("");
  /** מלכודת דבש — נשארת ריקה אצל אדם. */
  const [website, setWebsite] = useState("");

  const load = useCallback(async () => {
    try {
      /*
       * `apiGet` ולא `fetch` גולמי — אותו עוזר שכל שאר המסכים
       * משתמשים בו, כולל דף הנחיתה הציבורי. הוא מה שמביא את הודעת
       * השגיאה של השרת בעברית ואת רישום הכישלון לאבחון; `fetch`
       * ישיר היה מחזיר „נכשל” גנרי במקום „הקישור פג תוקף”.
       */
      const data = await apiGet<PublicView>(`/f/${token}`);
      setView(data);
      setLoadFailed(false);
      const p = data.prefill;
      if (p.dealType !== undefined) setDealType(p.dealType);
      if (p.cities !== undefined) setCities(p.cities.join(", "));
      if (p.propertyTypes !== undefined) setTypes(p.propertyTypes);
      if (p.roomsMin !== undefined) setRoomsMin(String(p.roomsMin));
      if (p.roomsMax !== undefined) setRoomsMax(String(p.roomsMax));
      if (p.budgetMaxAgorot !== undefined) setBudgetMax(toShekels(p.budgetMaxAgorot));
      if (p.areaSqmMin !== undefined) setAreaMin(String(p.areaSqmMin));
      if (p.features !== undefined) setFeatures(p.features);
      if (p.entryType !== undefined) setEntryType(p.entryType);
      if (p.entryBy !== undefined) setEntryBy(p.entryBy);
      if (p.notes !== undefined) setNotes(p.notes);
    } catch {
      /*
       * נשאר `null` — „לא ידוע”. הצגת „הקישור פג” על סמך כשל רשת
       * הייתה שולחת לקוח לוותר על טופס שעובד מצוין.
       */
      setLoadFailed(true);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const cityList = cities
        .split(/[,\n]/u)
        .map((c) => c.trim())
        .filter((c) => c !== "");
      const body: Record<string, unknown> = {
        dealType,
        cities: cityList,
        propertyTypes: types,
        roomsMin: numOrNull(roomsMin),
        roomsMax: numOrNull(roomsMax),
        budgetMaxAgorot: toAgorot(budgetMax),
        areaSqmMin: numOrNull(areaMin),
        features,
        notes,
        ...(website !== "" ? { website } : {}),
        ...(entryType !== ""
          ? { entryType, ...(entryType === "by_date" && entryBy !== "" ? { entryBy } : {}) }
          : {}),
      };
      // ערך שאינו מספר תקין נשמט לגמרי — עדיף בלי מאשר שגוי
      for (const key of Object.keys(body)) {
        if (typeof body[key] === "number" && Number.isNaN(body[key])) delete body[key];
      }

      await apiPost<{ ok: true }>(`/f/${token}`, body);
      setDone(true);
    } catch (err: unknown) {
      /*
       * הסיבה שהשרת נתן, ולא „בדקו את החיבור”.
       *
       * קישור שפג בזמן שהלקוח מילא הוא המקרה השכיח כאן, ועצה לבדוק
       * את החיבור שולחת אותו לחפש תקלה שאינה קיימת במקום לבקש
       * קישור חדש.
       */
      setError(
        err instanceof ApiError
          ? err.message
          : "השליחה נכשלה. בדקו את החיבור ונסו שוב.",
      );
    } finally {
      setBusy(false);
    }
  }

  function toggleType(value: string): void {
    setTypes((prev) =>
      prev.includes(value) ? prev.filter((t) => t !== value) : [...prev, value],
    );
  }

  function cycleFeature(key: IntakeFeature): void {
    /*
     * שלושה מצבים במחזור אחד: לא נדרש → חובה → נחמד שיהיה. תיבת
     * סימון רגילה אינה יכולה לבטא „חובה” מול „נחמד”, ושתי תיבות
     * לכל מאפיין היו מכפילות את אורך הטופס.
     */
    setFeatures((prev) => {
      const next = { ...prev };
      if (next[key] === undefined) next[key] = "must";
      else if (next[key] === "must") next[key] = "nice";
      else delete next[key];
      return next;
    });
  }

  if (loadFailed) {
    return (
      <Shell>
        <Notice tone="danger">
          לא הצלחנו לטעון את הטופס. בדקו את החיבור ורעננו את העמוד.
        </Notice>
      </Shell>
    );
  }
  if (view === null) {
    return (
      <Shell>
        <p className="m-0 text-center">טוען…</p>
      </Shell>
    );
  }
  if (view.inactive !== null) {
    return (
      <Shell officeName={view.officeName}>
        <h1 className="m-0 text-center text-2xl font-extrabold">
          {view.inactive === "expired" ? "הקישור פג תוקף" : "הקישור בוטל"}
        </h1>
        <p className="m-0 mt-3 text-center text-[16px] leading-relaxed">
          {view.inactive === "expired"
            ? `בקשו מ${view.officeName} קישור חדש — ניצור אותו בשנייה.`
            : "פנו אלינו ונשלח לכם קישור חדש."}
        </p>
      </Shell>
    );
  }
  if (done) {
    return (
      <Shell officeName={view.officeName}>
        <h1 className="m-0 text-center text-2xl font-extrabold">✓ קיבלנו, תודה!</h1>
        <p className="m-0 mt-3 text-center text-[16px] leading-relaxed">
          הפרטים נשמרו אצל {view.officeName}. אם יימצא נכס שמתאים למה שסימנתם —
          ניצור אתכם קשר.
        </p>
      </Shell>
    );
  }

  return (
    <Shell officeName={view.officeName}>
      <header className="text-center">
        <h1 className="m-0 text-2xl font-extrabold">
          שלום {view.greetingName}, מה אתם מחפשים?
        </h1>
        <p className="m-0 mt-2 text-[16px] leading-relaxed">
          כמה שאלות קצרות, כדי שנציע לכם בדיוק את מה שמתאים. אין שדות
          חובה — מלאו את מה שידוע, ואת השאר נשלים בשיחה.
        </p>
        {view.submittedAt !== null ? (
          <p
            className="m-0 mt-2 text-[15px] font-semibold"
            style={{ color: "var(--color-primary)" }}
          >
            כבר מילאתם את הטופס. אפשר לעדכן ולשלוח שוב.
          </p>
        ) : null}
      </header>

      <Field label="לקנות או לשכור?">
        <div className="flex gap-2">
          {(
            [
              ["sale", "לקנות"],
              ["rent", "לשכור"],
            ] as const
          ).map(([value, label]) => (
            <Choice
              key={value}
              active={dealType === value}
              onClick={() => setDealType(value)}
            >
              {label}
            </Choice>
          ))}
        </div>
      </Field>

      <Field label="באילו ערים או אזורים?" hint="אפשר כמה, מופרדים בפסיק">
        <input
          className="mv-field w-full"
          value={cities}
          onChange={(e) => setCities(e.target.value)}
          placeholder="למשל: רמת גן, גבעתיים"
        />
      </Field>

      <Field label="איזה סוג נכס?" hint="אפשר לבחור כמה">
        <div className="flex flex-wrap gap-2">
          {TYPES.map((value) => (
            <Choice
              key={value}
              active={types.includes(value)}
              onClick={() => toggleType(value)}
            >
              {PROPERTY_TYPE_LABELS[value] ?? value}
            </Choice>
          ))}
        </div>
      </Field>

      <Field label="כמה חדרים?">
        <div className="flex items-center gap-2">
          <input
            className="mv-field w-full"
            inputMode="decimal"
            value={roomsMin}
            onChange={(e) => setRoomsMin(e.target.value)}
            placeholder="מ־"
            aria-label="מינימום חדרים"
          />
          <span aria-hidden="true">–</span>
          <input
            className="mv-field w-full"
            inputMode="decimal"
            value={roomsMax}
            onChange={(e) => setRoomsMax(e.target.value)}
            placeholder="עד"
            aria-label="מקסימום חדרים"
          />
        </div>
      </Field>

      <Field label="תקציב מקסימלי" hint="בשקלים. לא יודעים עדיין? השאירו ריק">
        <input
          className="mv-field w-full"
          inputMode="numeric"
          value={budgetMax}
          onChange={(e) => setBudgetMax(e.target.value)}
          placeholder="למשל: 2500000"
        />
      </Field>

      <Field label="שטח מינימלי במ״ר">
        <input
          className="mv-field w-full"
          inputMode="numeric"
          value={areaMin}
          onChange={(e) => setAreaMin(e.target.value)}
          placeholder="למשל: 90"
        />
      </Field>

      <Field label="מה חשוב לכם?" hint="לחיצה אחת = חובה · שתיים = נחמד שיהיה">
        <div className="flex flex-wrap gap-2">
          {INTAKE_FEATURES.map((key) => {
            const level = features[key];
            return (
              <button
                key={key}
                type="button"
                className="mv-chip"
                aria-pressed={level !== undefined}
                onClick={() => cycleFeature(key)}
                style={{
                  borderColor:
                    level === undefined ? "var(--color-border)" : "var(--color-primary)",
                  background:
                    level === "must"
                      ? "var(--color-primary)"
                      : level === "nice"
                        ? "var(--color-primary-soft)"
                        : "var(--color-surface)",
                  color: level === "must" ? "#fff" : "var(--color-text)",
                }}
              >
                {INTAKE_FEATURE_LABEL[key]}
                {level === "must" ? " · חובה" : level === "nice" ? " · נחמד" : ""}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="מתי אתם צריכים להיכנס?">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["immediate", "מיידי"],
              ["by_date", "עד תאריך"],
              ["flexible", "גמיש"],
            ] as const
          ).map(([value, label]) => (
            <Choice
              key={value}
              active={entryType === value}
              onClick={() => setEntryType(entryType === value ? "" : value)}
            >
              {label}
            </Choice>
          ))}
        </div>
        {entryType === "by_date" ? (
          <input
            type="date"
            className="mv-field mt-2 w-full"
            value={entryBy}
            onChange={(e) => setEntryBy(e.target.value)}
            aria-label="תאריך כניסה"
          />
        ) : null}
      </Field>

      <Field label="עוד משהו שחשוב שנדע?">
        <textarea
          className="mv-field w-full"
          rows={3}
          maxLength={INTAKE_NOTES_MAX}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="למשל: קומה גבוהה, קרוב לבית ספר, לא ליד כביש ראשי"
        />
      </Field>

      {/* מלכודת דבש — מוסתרת מאדם ומקוראי מסך, גלויה לבוט */}
      <input
        type="text"
        name="website"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }}
      />

      {error !== null ? <Notice tone="danger">{error}</Notice> : null}

      <button
        type="button"
        className="mv-btn-action mt-5 w-full"
        style={{ padding: "14px", fontSize: 17 }}
        disabled={busy}
        onClick={() => void submit()}
      >
        {busy ? "שולח…" : "שליחה"}
      </button>
      <p
        className="m-0 mt-3 text-center text-[14px]"
        style={{ color: "var(--color-text-muted)" }}
      >
        הפרטים נשמרים אצל {view.officeName} בלבד ואינם מועברים לאיש.
      </p>
    </Shell>
  );
}

/* ------------------------------------------------------------------ */

function Shell({
  officeName,
  children,
}: {
  officeName?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-8">
      {officeName !== undefined ? (
        <p
          className="m-0 mb-4 text-center text-[15px] font-bold"
          style={{ color: "var(--color-primary)" }}
        >
          {officeName}
        </p>
      ) : null}
      <div
        className="rounded-2xl border p-6"
        style={{
          borderColor: "var(--color-border)",
          background: "var(--color-surface)",
        }}
      >
        {children}
      </div>
    </main>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6">
      <h2 className="m-0 mb-1 text-[16.5px] font-bold">{label}</h2>
      {hint !== undefined ? (
        <p
          className="m-0 mb-2 text-[14px]"
          style={{ color: "var(--color-text-muted)" }}
        >
          {hint}
        </p>
      ) : null}
      {children}
    </section>
  );
}

function Choice({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="mv-chip"
      aria-pressed={active}
      onClick={onClick}
      style={{
        borderColor: active ? "var(--color-primary)" : "var(--color-border)",
        background: active ? "var(--color-primary)" : "var(--color-surface)",
        color: active ? "#fff" : "var(--color-text)",
      }}
    >
      {children}
    </button>
  );
}
