"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import { apiGet } from "@/lib/api";
import { IconPhone } from "../icons";
import { formatDateTime } from "@/lib/format";

/**
 * יומן הפניות שהגיעו מהמרכזיות — **כולל אלה שנדחו**.
 *
 * ## למה המסך הזה קיים
 *
 * פנייה עם מפתח שאינו מוכר, חיבור מנוטרל או מסלול בלי מרכזייה
 * נדחתה ב-404 ולא הותירה שום עקבה בשום מקום. מסך האבחון של המשרד
 * הראה "לא התקבל אף אירוע" — אותו טקסט בדיוק שרואה משרד שהמרכזייה
 * שלו מעולם לא פנתה.
 *
 * שני המצבים דורשים פעולה הפוכה לגמרי: לתקן כתובת אצל הספק, מול
 * לרענן מפתח או לפתוח את הפיצ'ר במסלול. בלי ההבחנה השאלה "למה
 * השיחות לא מגיעות" נשארת בלי שום קצה חוט.
 *
 * ## למה כאן ולא בהגדרות המשרד
 *
 * הפנייה המעניינת ביותר היא זו שלא הצלחנו לשייך לאף משרד. מסך
 * שמסונן לפי משרד לא יכול להראות אותה מעצם הגדרתו — כלומר היה
 * מחמיץ בדיוק את התקלה השכיחה.
 */

/** מה קרה לפנייה, בשפה של מי שצריך לפעול. */
const OUTCOMES: Record<string, { label: string; hint: string; ok: boolean }> = {
  accepted: {
    label: "נקלטה כשיחה",
    hint: "המפתח זוהה, האירוע נותח, והשיחה נרשמה",
    ok: true,
  },
  /*
   * צלצול נקרא בהצלחה ובכל זאת אינו יוצר שורת שיחה — כך נקבע
   * בכוונה, כי השיחה עוד לא קרתה. סימונו כ„נקלטה” היה מציג
   * מרכזייה ששולחת `Calling` ומאבדת את ה-`Hangup` כתקינה, בזמן
   * שאף שיחה אינה נרשמת אצלה.
   */
  preliminary: {
    label: "אירוע ביניים",
    hint: "צלצול או מענה — נקרא בהצלחה, אך שורת השיחה נכתבת רק באירוע המסיים (ניתוק). אם הוא אינו מגיע, לא תיווצר שיחה",
    ok: true,
  },
  /*
   * „התקבלה” הישנה נרשמה על ההגעה בלבד, ולכן פנייה שנזרקה מיד אחריה
   * נראתה כמו פנייה שהפכה לשיחה. זו הייתה בדיוק העמודה שמסתכלים בה
   * כשלקוח התקשר ואין רישום — והיא לא יכלה לענות.
   */
  unparsed: {
    label: "הגיעה ולא זוהתה",
    hint: "המפתח והמסלול תקינים, אבל לא היה באירוע די כדי לזהות שיחה — ראו את הסיבה",
    ok: false,
  },
  /*
   * לא „נדחתה” ולא „נקלטה”: הפנייה הגיעה, הובנה, והעיבוד אצלנו נפל.
   * המרכזייה תשלח שוב, ולכן שורה כזו לרוב מלווה בשורה נוספת שהצליחה
   * — ומי שרואה רק אותה צריך לדעת שהתקלה בצד שלנו.
   */
  failed: {
    label: "נפלה אצלנו",
    hint: "האירוע הובן אך העיבוד נכשל בשרת שלנו. הבקשה הוחזרה בשגיאה, והמרכזייה אמורה לשלוח שוב",
    ok: false,
  },
  unknown_key: {
    label: "מפתח לא מוכר",
    hint: "הכתובת אצל הספק מכילה מפתח ישן או שגוי — יש להעתיק מחדש ממסך ההגדרות של המשרד",
    ok: false,
  },
  disabled: {
    label: "חיבור מנוטרל",
    hint: "המפתח שייך למשרד, אבל החיבור אינו פעיל",
    ok: false,
  },
  no_feature: {
    label: "אין מרכזייה במסלול",
    hint: "המפתח תקין והחיבור פעיל — המסלול של המשרד אינו כולל מרכזייה",
    ok: false,
  },
};

/**
 * מה חסר היה באירוע שלא זוהה.
 *
 * `invalid_phone` אינו תקלה: כך נראית שיחה ממספר חסוי, והיא נפוצה.
 * הוא מנוסח כאן כעובדה ולא כאזהרה — אותה הבחנה שמסך ההגדרות של
 * המשרד כבר עושה.
 */
const ISSUES: Record<string, string> = {
  no_fields: "הבקשה הגיעה ריקה — כנראה Content-Type שאינו תואם לתבנית",
  no_call_id: "אין מזהה שיחה (callid)",
  no_phone: "לא הגיע מספר מתקשר — השדה חסר או שהספק שלח אותו ריק",
  invalid_phone: "המספר שהגיע אינו מספר תקין — כך נראית שיחה ממספר חסוי",
};

interface Hit {
  id: string;
  receivedAt: string;
  outcome: string;
  /** למה הפנייה לא הפכה לשיחה — `null` כשהיא כן */
  issue: string | null;
  tenantId: string | null;
  tenantName: string | null;
  keyPrefix: string;
  method: string;
  fieldKeys: string | null;
  /** מה שהספק שלח ואיננו צורכים — ראו התא בטבלה. */
  unmapped: string | null;
}

export function TelephonyWebhooksSection() {
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    apiGet<{ hits: Hit[] }>("/platform/telephony-webhooks")
      .then((res) => setHits(res.hits))
      .catch(() => setFailed(true));
  }, []);

  useEffect(load, [load]);

  return (
    <section
      aria-labelledby="telephony-webhooks"
      className="mb-8 rounded-xl border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="telephony-webhooks" className="text-lg font-semibold">
          <IconPhone s={16} /> פניות ממרכזיות
        </h2>
        <Button variant="secondary" onClick={load}>
          רענן
        </Button>
      </div>

      <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        כל פנייה שהגיעה לכתובת הוובהוק, כולל פניות שנדחו. רשימה ריקה אחרי שהספק הוגדר
        פירושה שהמרכזייה אינה פונה כלל — כלומר הכתובת אצלה שגויה או שהאירוע לא הופעל.
        <br />
        עמודת <b>לא ממופה</b> מראה שדות שהספק שולח ואיננו קוראים. שדה שמופיע שם באדום
        ונראה חשוב — שלחו לנו אותו, והוא ייקלט בגרסה הבאה.
      </p>

      {failed ? (
        <p className="text-sm" style={{ color: "var(--color-danger)" }}>
          טעינת היומן נכשלה.
        </p>
      ) : hits === null ? (
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          טוען…
        </p>
      ) : hits.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          לא הגיעה אף פנייה. אם מרכזייה אמורה לשלוח — הכתובת אצל הספק אינה מגיעה אלינו.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="mv-table w-full text-sm">
            <thead>
              <tr>
                <th className="text-start">מתי</th>
                <th className="text-start">תוצאה</th>
                <th className="text-start">משרד</th>
                <th className="text-start">מפתח</th>
                <th className="text-start">שיטה</th>
                <th className="text-start">שדות שהגיעו</th>
                <th className="text-start">לא ממופה</th>
              </tr>
            </thead>
            <tbody>
              {hits.map((hit) => {
                const outcome = OUTCOMES[hit.outcome];
                return (
                  <tr key={hit.id}>
                    <td dir="ltr" className="whitespace-nowrap">
                      {formatDateTime(hit.receivedAt)}
                    </td>
                    <td>
                      <span
                        className="mv-pill"
                        title={outcome?.hint ?? ""}
                        style={{
                          color: outcome?.ok === true ? "var(--color-success)" : "var(--color-danger)",
                        }}
                      >
                        {outcome?.label ?? hit.outcome}
                      </span>
                      {/*
                        הסיבה צמודה לתוצאה ולא בעמודה משלה: „הגיעה
                        ולא זוהתה” בלי „חסר מספר מתקשר” אינה עוזרת,
                        ושתיהן נקראות כמשפט אחד.
                      */}
                      {hit.issue === null ? null : (
                        <span
                          className="mt-1 block text-sm"
                          style={{ color: "var(--color-text-muted)" }}
                        >
                          {ISSUES[hit.issue] ?? hit.issue}
                        </span>
                      )}
                    </td>
                    {/* מפתח שלא זוהה אינו שייך לאף משרד — וזו התשובה עצמה */}
                    <td>{hit.tenantName ?? "—"}</td>
                    <td dir="ltr" className="whitespace-nowrap">
                      {hit.keyPrefix}…
                    </td>
                    <td dir="ltr">{hit.method}</td>
                    {/*
                      שמות השדות, וערכים לשדות הטכניים בלבד. מספרי
                      טלפון ושמות לקוחות נשמרים כשם השדה בלבד ולא
                      נכנסים לטבלה שנקראת בעיניים.
                    */}
                    <td dir="ltr" className="text-sm">
                      {hit.fieldKeys ?? "—"}
                    </td>
                    {/*
                      **השאלה המעניינת**: מה הספק שולח ואנחנו מתעלמים
                      ממנו. "אילו שדות הגיעו" עונה על חצי — החצי שחסר
                      הוא איפה יושב מידע שאנחנו מפספסים. שמות בלבד:
                      ערך של שדה שלא זיהינו יכול להיות כל דבר.
                    */}
                    <td dir="ltr" className="text-sm">
                      {hit.unmapped === null || hit.unmapped === "" ? (
                        <span style={{ color: "var(--color-text-muted)" }}>—</span>
                      ) : (
                        <span style={{ color: "var(--color-danger)" }}>{hit.unmapped}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
