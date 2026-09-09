"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@metavchim/ui";
import {
  RECRUITMENT_FIELDS,
  RECRUITMENT_SECTIONS,
  RECRUITMENT_SECTION_LABELS,
  RECRUITMENT_SOURCES,
  RECRUITMENT_STATUSES,
  type RecruitmentFieldSpec,
  isValidSourceUrl,
  recruitmentFieldSplit,
  recruitmentSourceLabel,
  recruitmentStatusLabel,
} from "@metavchim/shared";
import { apiPatch, apiPost } from "@/lib/api";
import { PropertyTypeOptions } from "../../property-type-options";
import type { TargetValues } from "./target-values";

export type { TargetValues } from "./target-values";

const inputStyle = {
  borderColor: "var(--color-input-border)",
  background: "var(--color-field)",
} as const;

const FIELD_CLASS = "w-full rounded-lg border px-3 py-2.5";

/**
 * ‏שדות שתופסים יותר מעמודה אחת — קישור, תיבת ההסבר והערת השיחה.
 * ‏כתובת מודעה ביד2 בעמודה של שליש מסך נחתכת אחרי „yad2.co.il/it”.
 */
const WIDE = new Set(["sourceUrl", "sharedTabu", "notes"]);

/**
 * ‎**שדה ריק נשלח כ-`null`, ולא מושמט.**
 *
 * ‏השמטה פירושה „אל תיגע”, והשרת השאיר את הערך הישן — כלומר מי
 * שמחק עיר גילה שהיא חזרה (ביקורת Codex). הטופס מציג את המצב
 * המלא, ולכן מה שריק בו הוא מה שאמור להיות ריק במסד.
 */
function num(form: FormData, name: string): number | null {
  const raw = String(form.get(name) ?? "").trim();
  if (raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function str(form: FormData, name: string): string | null {
  const raw = String(form.get(name) ?? "").trim();
  return raw === "" ? null : raw;
}

/**
 * ‏טופס נכס לגיוס — יצירה, עריכה והשלמה באותו רכיב.
 *
 * ‏אותם שדות של „נכס חדש”, פחות מה שאי אפשר לדעת ממודעה (מאפיינים,
 * מיקום מדויק, בלעדיות) — ופלוס שני שדות שקיימים רק כאן: **מאיפה
 * הנכס הגיע והקישור למודעה**.
 *
 * ## ‏שני מצבים, טופס אחד
 *
 * ‎**יצירה** מציגה את כל השדות במקטעים, כי אין עדיין מה לחלק.
 *
 * ‎**השלמה** (שורה קיימת) מציגה קודם את מה שחסר — זו הפעולה שהמסך
 * ‏נפתח בשבילה — ואת מה שכבר ידוע במקטע מקופל מתחתיו. המקופל אינו
 * ‏קישוט: מחיר שגוי שנקלט ממודעה חייב להיות ניתן לתיקון באותו
 * ‏חלון, אחרת המתווך יוצא ממנו כדי לתקן שדה אחד.
 *
 * ‏החלוקה עצמה חיה ב-`recruitmentFieldSplit` המשותף, לא כאן: אותה
 * ‏חלוקה בדיוק מזינה את התצוגה שמעל הטופס, ושתי הכרעות נפרדות על
 * ‏„מה חסר” היו מציגות שדה בשני המקומות או בשום מקום.
 */
export function TargetForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: TargetValues;
  /**
   * ‎**מה לעשות אחרי שמירה מוצלחת.**
   *
   * ‏ברירת המחדל היא ניווט חזרה לרשימה — הנכון לעמוד מלא. החלונית
   * ‏מוסרת כאן סגירה וריענון במקום: ניווט מתוך חלונית היה מרענן
   * ‏את כל העמוד רק כדי לחזור לאותו מקום.
   */
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const editing = initial?.id !== undefined;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const sourceUrl = str(form, "sourceUrl");

    /*
     * ‏אותה בדיקה שהשרת מריץ — כאן היא רק כדי לומר את זה מיד, ליד
     * השדה, במקום לשלוח בקשה שתחזור בשגיאה. השרת הוא האוכף.
     */
    if (sourceUrl !== null && !isValidSourceUrl(sourceUrl)) {
      setUrlError("הקישור חייב להתחיל ב-http:// או https://");
      return;
    }
    setUrlError(null);
    setError(null);
    setSaving(true);

    const price = num(form, "price");
    const body = {
      status: str(form, "status") ?? "new",
      source: str(form, "source") ?? "other",
      sourceUrl,
      city: str(form, "city"),
      neighborhood: str(form, "neighborhood"),
      street: str(form, "street"),
      houseNumber: str(form, "houseNumber"),
      propertyType: str(form, "propertyType"),
      dealType: str(form, "dealType"),
      /*
       * ‎**עובדה משפטית ולא מאפיין** — אותו שם ואותה צורה בדיוק
       * ‏שלושת הטפסים האחרים שולחים.
       */
      sharedTabu: form.get("sharedTabu") === "on",
      rooms: num(form, "rooms"),
      areaSqm: num(form, "areaSqm"),
      floor: num(form, "floor"),
      totalFloors: num(form, "totalFloors"),
      /* ‏המחיר מוזן בשקלים ונשמר באגורות — כמו בכל שאר המערכת */
      priceAgorot: price === null ? null : Math.round(price * 100),
      ownerName: str(form, "ownerName"),
      ownerPhone: str(form, "ownerPhone"),
      notes: str(form, "notes"),
    };

    try {
      if (editing) {
        await apiPatch(`/recruitment/${initial?.id}`, body);
      } else {
        await apiPost("/recruitment", body);
      }
      if (onSaved === undefined) {
        router.push("/properties/recruitment");
        router.refresh();
      } else {
        onSaved();
      }
    } catch {
      setError("השמירה נכשלה. בדקו את השדות ונסו שוב.");
      setSaving(false);
    }
  }

  /**
   * ‎**הפקד של שדה בודד, לפי מפתח מהקטלוג.**
   *
   * ‏המבנה הזה החליף שמונה־עשר בלוקים מוטבעים. הרווח אינו בשורות
   * ‏אלא בכך ששדה נעשה **בר-מיעון**: אפשר לרנדר תת-קבוצה שלהם —
   * ‏„מה שחסר”, „מה שידוע” — בלי עותק שני של הטופס.
   */
  function control(spec: RecruitmentFieldSpec): ReactNode {
    const id = spec.key;
    switch (spec.key) {
      case "status":
        return (
          <select
            id={id}
            name="status"
            defaultValue={initial?.status ?? "new"}
            className={FIELD_CLASS}
            style={inputStyle}
          >
            {RECRUITMENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {recruitmentStatusLabel(status)}
              </option>
            ))}
          </select>
        );
      case "source":
        return (
          <select
            id={id}
            name="source"
            defaultValue={initial?.source ?? "yad2"}
            className={FIELD_CLASS}
            style={inputStyle}
          >
            {RECRUITMENT_SOURCES.map((source) => (
              <option key={source} value={source}>
                {recruitmentSourceLabel(source)}
              </option>
            ))}
          </select>
        );
      case "sourceUrl":
        return (
          <>
            <input
              id={id}
              name="sourceUrl"
              type="url"
              inputMode="url"
              dir="ltr"
              placeholder="https://www.yad2.co.il/item/..."
              defaultValue={initial?.sourceUrl ?? ""}
              aria-describedby={urlError ? "sourceUrl-error" : "sourceUrl-hint"}
              aria-invalid={urlError ? true : undefined}
              className={FIELD_CLASS}
              style={inputStyle}
            />
            {urlError ? (
              <p
                id="sourceUrl-error"
                role="alert"
                className="mt-1 text-sm text-[var(--color-danger)]"
              >
                {urlError}
              </p>
            ) : (
              <p id="sourceUrl-hint" className="mt-1 text-sm text-[var(--color-text-muted)]">
                כדי לחזור למודעה בלחיצה, גם אחרי שבועיים.
              </p>
            )}
          </>
        );
      case "propertyType":
        return (
          <select
            id={id}
            name="propertyType"
            defaultValue={initial?.propertyType ?? ""}
            className={FIELD_CLASS}
            style={inputStyle}
          >
            <option value="">לא ידוע</option>
            {/*
              ‏`keep` — שורה ותיקה שנרשמה בסוג `shared_tabu` חייבת
              ‏להמשיך למצוא אותו בבורר, אחרת `defaultValue` אינו
              ‏מתאים לשום אפשרות, הבורר נופל לראשונה, ושמירה סתמית
              ‏משנה את הסיווג. את ההסבה עושה התיבה שמתחת.
            */}
            <PropertyTypeOptions keep={initial?.propertyType} />
          </select>
        );
      case "dealType":
        return (
          <select
            id={id}
            name="dealType"
            defaultValue={initial?.dealType ?? "sale"}
            className={FIELD_CLASS}
            style={inputStyle}
          >
            <option value="sale">מכירה</option>
            <option value="rent">השכרה</option>
          </select>
        );
      case "notes":
        return (
          <textarea
            id={id}
            name="notes"
            rows={3}
            defaultValue={initial?.notes ?? ""}
            placeholder="ענה שיחשוב · מבקש 2.1 · יש לו מתווך אחר עד סוף החודש"
            className={FIELD_CLASS}
            style={inputStyle}
          />
        );
      case "ownerPhone":
        return (
          <input
            id={id}
            name="ownerPhone"
            type="tel"
            inputMode="tel"
            dir="ltr"
            defaultValue={initial?.ownerPhone ?? ""}
            className={FIELD_CLASS}
            style={inputStyle}
          />
        );
      case "rooms":
        return (
          <input
            id={id}
            name="rooms"
            type="number"
            step="0.5"
            min="1"
            max="20"
            defaultValue={initial?.rooms ?? ""}
            className={FIELD_CLASS}
            style={inputStyle}
          />
        );
      case "areaSqm":
        return (
          <input
            id={id}
            name="areaSqm"
            type="number"
            min="10"
            max="2000"
            defaultValue={initial?.areaSqm ?? ""}
            className={FIELD_CLASS}
            style={inputStyle}
          />
        );
      case "floor":
        return (
          <input
            id={id}
            name="floor"
            type="number"
            min="-2"
            max="60"
            /*
             * ‎**`?? ""` ולא `|| ""`.** קומה 0 היא קומת קרקע, והיא
             * ‏השכיחה ביותר — בדיקת אמיתות הייתה מרוקנת את השדה
             * ‏בכל פתיחה, ושמירה סתמית מוחקת אותה מהמסד.
             */
            defaultValue={initial?.floor ?? ""}
            className={FIELD_CLASS}
            style={inputStyle}
          />
        );
      case "totalFloors":
        return (
          <input
            id={id}
            name="totalFloors"
            type="number"
            min="1"
            max="60"
            defaultValue={initial?.totalFloors ?? ""}
            className={FIELD_CLASS}
            style={inputStyle}
          />
        );
      case "priceAgorot":
        return (
          <input
            id={id}
            /* ‏השם הוא `price` — השדה מוזן בשקלים, והמרה לאגורות בשליחה */
            name="price"
            type="number"
            min="0"
            defaultValue={
              initial?.priceAgorot === undefined ? "" : Math.round(initial.priceAgorot / 100)
            }
            className={FIELD_CLASS}
            style={inputStyle}
          />
        );
      /*
       * ‏תיבת הסימון נבנית ב-`field` עם התווית שעוטפת אותה ועם
       * ‏ההסבר שמתחתיה — ולכן אין לה פקד נפרד כאן.
       */
      case "sharedTabu":
        return null;
      default:
        return (
          <input
            id={id}
            name={spec.key}
            defaultValue={initial?.[spec.key] ?? ""}
            className={FIELD_CLASS}
            style={inputStyle}
          />
        );
    }
  }

  /** ‏שדה עם התווית שלו — או תיבת הסימון, שהתווית שלה עוטפת אותה. */
  function field(spec: RecruitmentFieldSpec): ReactNode {
    if (spec.key === "sharedTabu") {
      /*
        ‎**הטופס הרביעי** (ביקורת Codex, P1).

        ‏התיבה נוספה לנכס חדש, לעריכת נכס ולהמרת ליד — ולא לכאן.
        ‏מרגע שהסוג הוותיק ירד מהבורר, שורת גיוס חדשה לא יכלה
        ‏לרשום את העובדה בכלל, ועריכה של שורה ותיקה מחקה אותה
        ‏בשקט. ההמרה יצרה נכס רגיל, והוא הוצע לקונים שסירבו
        ‏במפורש למושאע.
      */
      return (
        <div
          key={spec.key}
          className="rounded-xl border p-3 sm:col-span-2"
          style={{ borderColor: "var(--color-border)", background: "var(--color-field)" }}
        >
          <label className="flex items-center gap-2 font-medium">
            <input type="checkbox" name="sharedTabu" defaultChecked={initial?.sharedTabu ?? false} />
            {spec.label}
          </label>
          <p
            className="m-0 mt-1 text-[length:var(--type-caption-lg)]"
            style={{ color: "var(--color-text-muted)" }}
          >
            אין חלקה נפרדת — העסקה דורשת הסכמת שותפים, והמימון מורכב יותר. הסימון נוסע איתו
            להמרה, ומשפיע על ההתאמות.
          </p>
        </div>
      );
    }
    return (
      <div key={spec.key} className={WIDE.has(spec.key) ? "sm:col-span-2" : undefined}>
        <label htmlFor={spec.key} className="mb-1 block font-medium">
          {spec.label}
        </label>
        {control(spec)}
      </div>
    );
  }

  /**
   * ‏קבוצת שדות מסודרת למקטעים — אותם שלושה, ורק אלה שיש בהם משהו.
   *
   * ‎`hint` מכבה את ההסבר על בעל הנכס במקטע המקופל: כשחלק מפרטי
   * ‏הבעלים מלאים וחלק חסרים, שני הבלוקים מרנדרים את מקטע „בעל
   * ‏הנכס”, ואותה פסקה הייתה מופיעה פעמיים באותו מסך.
   */
  function sections(specs: readonly RecruitmentFieldSpec[], hint = true): ReactNode {
    return RECRUITMENT_SECTIONS.map((section) => {
      const inSection = specs.filter((spec) => spec.section === section);
      if (inSection.length === 0) return null;
      return (
        <section key={section} className="space-y-3">
          <h3 className="font-bold">{RECRUITMENT_SECTION_LABELS[section]}</h3>
          {section === "owner" && hint ? (
            <p className="text-sm text-[var(--color-text-muted)]">
              נשמר כאן בלבד. הוא נכנס לאנשי הקשר של המשרד רק ברגע שתמירו את הנכס — כל עוד לא
              חתם, הוא אינו לקוח שלכם.
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{inSection.map(field)}</div>
        </section>
      );
    });
  }

  const pinned = RECRUITMENT_FIELDS.filter((spec) => spec.pinned === true);
  const { missing, filled } = recruitmentFieldSplit(initial ?? {});

  return (
    <form onSubmit={(event) => void submit(event)} className="mv-card space-y-5 p-5">
      {editing ? (
        <>
          {/* ‏השלב הוא הפעולה של המסך — הוא למעלה, מחוץ לחלוקה */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{pinned.map(field)}</div>

          {missing.length > 0 ? (
            <section className="space-y-4">
              <div>
                <h2 className="text-lg font-bold">להשלמה</h2>
                <p className="m-0 mt-1 text-sm text-[var(--color-text-muted)]">
                  {missing.length} פרטים שעדיין לא ידועים על הנכס. מה שתמלאו יעבור איתו להמרה.
                </p>
              </div>
              {sections(missing)}
            </section>
          ) : (
            <p className="rounded-md bg-[var(--color-success-soft)] p-3 text-sm">
              כל הפרטים מולאו — הנכס מוכן להמרה ברגע שיגויס.
            </p>
          )}

          {/*
            ‎**מה שידוע נשאר בהישג יד, מקופל.**

            ‏מחיר שנקלט שגוי ממודעה, או טלפון עם ספרה חסרה, מתגלים
            ‏בדיוק בחלון הזה. בלי המקטע הזה המתווך היה יוצא ממנו
            ‏כדי לתקן שדה אחד. `details` נייטיב: מקלדת, קורא מסך
            ‏וזיכרון מצב — בחינם מהדפדפן.

            ‎**וזו הסיבה שזה `details` ולא רינדור מותנה.** שדה בתוך
            ‏`details` סגור נמצא ב-DOM ונשלח (נבדק). שדה שאינו
            ‏מרונדר פשוט אינו שם — ומכיוון שהטופס שולח את מצבו
            ‏המלא, ושדה ריק נשלח כ-`null` ולא מושמט, מעבר
            ‏ל-`{open ? … : null}` היה **מוחק בשמירה אחת את כל מה
            ‏שכבר ידוע על הנכס**, בשקט.
          */}
          {filled.length > 0 ? (
            <details className="rounded-xl border" style={{ borderColor: "var(--color-border)" }}>
              <summary className="cursor-pointer px-4 py-3 font-semibold">
                מה שכבר ידוע ({filled.length}) — לתיקון
              </summary>
              <div className="space-y-5 border-t px-4 py-4" style={{ borderColor: "var(--color-border)" }}>
                {sections(filled, false)}
              </div>
            </details>
          ) : null}
        </>
      ) : (
        /* ‏יצירה — אין מה לחלק, הכול חסר */
        sections(RECRUITMENT_FIELDS)
      )}

      {error ? (
        <p role="alert" className="rounded-md bg-[var(--color-danger-soft)] p-3 text-sm">
          {error}
        </p>
      ) : null}

      <div className="flex gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? "שומר…" : editing ? "שמירת שינויים" : "הוספה לרשימת הגיוס"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => (onCancel === undefined ? router.back() : onCancel())}
        >
          ביטול
        </Button>
      </div>
    </form>
  );
}
