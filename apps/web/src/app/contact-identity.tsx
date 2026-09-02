"use client";

import { useState } from "react";
import { ApiError, apiPatch } from "@/lib/api";
import { IconEdit } from "./icons";

/**
 * ‎**תיקון פרטי הזיהוי של הלקוח — במקום שבו הם מוצגים.**
 *
 * ## מה לא היה אפשרי עד כה
 *
 * כרטיס נוצר משיחה נכנסת או מטופס, והפרטים שהגיעו איתו היו סופיים:
 * ‏שיחה שלא זוהה בה שם יוצרת כרטיס ששמו הוא מספר הטלפון, וספרה
 * שהוקלדה בטעות בטופס נשארת על הכרטיס לתמיד. השם קיבל תיקון בכרטיס
 * הקונה בלבד, האימייל היה קבור בפאנל „מי עומד מאחורי הכרטיס”,
 * ו**המספר הראשי לא היה ניתן לשינוי בשום מסך** — `ContactPeople`
 * מסמן אותו במפורש כ„אי אפשר להסירו לבד”.
 *
 * ## למה שלושת השדות יחד ולא כפתור לכל אחד
 *
 * המתווך שמגלה טעות מגלה אותה בשיחה אחת: „לא, קוראים לי אחרת, וזה
 * גם לא המספר שלי”. שלוש לחיצות בשלושה מקומות שונים באותו מסך הן
 * שלוש הזדמנויות לוותר באמצע ולכתוב את זה בהערות.
 *
 * ‎**המספר הישן מוחלף ואינו נשמר כמספר נוסף.** זה תיקון, ולא „עוד
 * מספר”: מספר שגוי שנשאר על הכרטיס ממשיך למשוך אליו שיחות נכנסות
 * — בדיוק התקלה שהתיקון בא לסגור. מי שרוצה לשמור את הישן מוסיף
 * אותו כמספר נוסף, וזה מסלול קיים ומפורש.
 *
 * ## למה שמירה שדה-אחר-שדה ולא בקשה אחת
 *
 * שלושת השדות הם שלושה נתיבים בשרת, כל אחד עם ההרשאה והביקורת
 * שלו. השמירה עוברת עליהם לפי הסדר ו**נעצרת בכישלון הראשון**:
 * התיבה נשארת פתוחה עם מה שנשמר כבר, וההודעה אומרת מה נכשל. סגירה
 * שקטה הייתה מציגה כרטיס שחציו התעדכן וקוראת כאילו הכול נשמר.
 */

const inputStyle = {
  background: "var(--color-field)",
  borderColor: "var(--color-input-border)",
} as const;

export interface ContactIdentity {
  name: string;
  phone: string;
  email?: string;
}

export function ContactIdentityEdit({
  contactId,
  identity,
  canEdit,
  onSaved,
}: {
  contactId: string;
  identity: ContactIdentity;
  /** ‎`buyers.edit` — אותה יכולת שהשרת דורש בשלושת הנתיבים. */
  canEdit: boolean;
  /**
   * הכרטיס מתעדכן רק אחרי שהשרת אישר. עדכון אופטימי היה מציג פרטים
   * שלא נשמרו, והמתווך היה ממשיך מהם.
   */
  onSaved: (next: ContactIdentity) => void;
}): React.JSX.Element | null {
  /** ‎`null` = לא עורכים כרגע. שני מצבים ולא דגל נפרד לצד ערך. */
  const [draft, setDraft] = useState<ContactIdentity | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canEdit) return null;

  function open(): void {
    setError(null);
    setDraft({
      name: identity.name,
      phone: identity.phone,
      email: identity.email ?? "",
    });
  }

  async function save(): Promise<void> {
    if (draft === null) return;
    const next: ContactIdentity = {
      name: draft.name.trim(),
      phone: draft.phone.trim(),
      email: (draft.email ?? "").trim(),
    };
    if (next.name.length < 2) {
      setError("שם קצר מדי — לפחות שני תווים");
      return;
    }
    if (next.phone === "") {
      setError("מספר טלפון הוא שדה חובה");
      return;
    }
    setBusy(true);
    setError(null);
    /*
     * ‎**מה שנשמר נשמר.** `saved` מלווה את המצב בפועל, כדי שכישלון
     * באמצע ישאיר על המסך את מה שהשרת כבר קיבל ולא את הטיוטה כולה.
     */
    const saved: ContactIdentity = { ...identity };
    try {
      if (next.name !== identity.name) {
        await apiPatch(`/contacts/${contactId}/name`, { name: next.name });
        saved.name = next.name;
      }
      if (next.phone !== identity.phone) {
        /*
         * ‎**המספר שנשמר הוא זה שחוזר מהשרת, ולא זה שהוקלד.** השרת
         * מנרמל „054-777-1122” ל-E.164, וזו הצורה שתיטען ברענון
         * הבא; הצגת המוקלד הייתה משנה צורה מעצמה מאוחר יותר.
         */
        const res = await apiPatch<{ phone: string }>(
          `/contacts/${contactId}/phone`,
          { phone: next.phone },
        );
        saved.phone = res.phone;
      }
      if (next.email !== (identity.email ?? "")) {
        await apiPatch(`/contacts/${contactId}/email`, { email: next.email });
        saved.email = next.email;
      }
      onSaved({
        name: saved.name,
        phone: saved.phone,
        ...(saved.email === undefined || saved.email === "" ? {} : { email: saved.email }),
      });
      setDraft(null);
    } catch (err: unknown) {
      /*
       * הודעת השרת ולא הודעה כללית: „המספר כבר רשום אצל איש קשר
       * אחר במשרד” אומרת למתווך מה לעשות; „השמירה נכשלה” לא.
       */
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה — אפשר לנסות שוב");
      onSaved({
        name: saved.name,
        phone: saved.phone,
        ...(saved.email === undefined || saved.email === "" ? {} : { email: saved.email }),
      });
    } finally {
      setBusy(false);
    }
  }

  if (draft === null) {
    return (
      <button
        type="button"
        className="mv-btn-plain"
        style={{ padding: "3px 9px", fontSize: "var(--type-caption)" }}
        onClick={open}
      >
        <IconEdit s={13} /> עריכת פרטים
      </button>
    );
  }

  return (
    <form
      /*
       * ‎**התיבה נפתחת מתחת לשם ולא במקומו**, ולכן `w-full` ושבירת
       * שורה: הפרטים הנוכחיים נשארים גלויים בזמן התיקון, ומי שמתקן
       * ספרה אחת צריך לראות מול מה הוא מתקן.
       */
      className="mt-2 flex w-full flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div>
        <label
          htmlFor="identity-name"
          className="mb-1 block text-[length:var(--type-caption)]"
          style={{ color: "var(--color-text-muted)" }}
        >
          שם
        </label>
        <input
          id="identity-name"
          autoFocus
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          maxLength={120}
          className="rounded-lg border px-3 py-2"
          style={{ ...inputStyle, minWidth: 190 }}
        />
      </div>
      <div>
        <label
          htmlFor="identity-phone"
          className="mb-1 block text-[length:var(--type-caption)]"
          style={{ color: "var(--color-text-muted)" }}
        >
          טלפון
        </label>
        <input
          id="identity-phone"
          value={draft.phone}
          onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
          type="tel"
          inputMode="tel"
          dir="ltr"
          maxLength={25}
          className="rounded-lg border px-3 py-2"
          style={{ ...inputStyle, minWidth: 150 }}
        />
      </div>
      <div>
        <label
          htmlFor="identity-email"
          className="mb-1 block text-[length:var(--type-caption)]"
          style={{ color: "var(--color-text-muted)" }}
        >
          אימייל
        </label>
        <input
          id="identity-email"
          value={draft.email ?? ""}
          onChange={(event) => setDraft({ ...draft, email: event.target.value })}
          type="email"
          dir="ltr"
          maxLength={254}
          className="rounded-lg border px-3 py-2"
          style={{ ...inputStyle, minWidth: 190 }}
        />
      </div>
      <button type="submit" className="mv-btn-action" disabled={busy}>
        שמירה
      </button>
      <button
        type="button"
        className="mv-btn-plain"
        onClick={() => {
          setDraft(null);
          setError(null);
        }}
      >
        ביטול
      </button>
      {/*
        ‎**כישלון נאמר, והתיבה נשארת פתוחה.** סגירה שקטה הייתה מציגה
        את הפרטים הישנים וקוראת כאילו נשמרו.
      */}
      {error !== null ? (
        <p
          className="m-0 w-full text-[length:var(--type-caption-lg)]"
          style={{ color: "var(--color-danger)" }}
        >
          {error}
        </p>
      ) : (
        <p
          className="m-0 w-full text-[length:var(--type-caption)]"
          style={{ color: "var(--color-text-muted)" }}
        >
          החלפת המספר הראשי מסירה את הקודם מהכרטיס. לשמירת שניהם — הוסיפו את
          הישן כמספר נוסף בפאנל אנשי הקשר.
        </p>
      )}
    </form>
  );
}
