"use client";

import { useEffect, useState } from "react";
import {
  OWNER_ACTIVITY_KIND_LABELS,
  OWNER_ACTIVITY_RESULT_LABELS,
  type OwnerActivityKind,
  type OwnerActivityResult,
} from "@metavchim/shared";
import { apiGet } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { IconClock } from "../../icons";

/**
 * ‎**„מה קורה עם הנכס” — SPEC-3c §6a.**
 *
 * ## מאיפה מגיעה הפעילות
 *
 * מ-`GET /properties/:id/activity`, אותו מקור שממנו מופק הדוח לבעל
 * הנכס: פגישות וביקורים שנקבעו **על הנכס**, ושיחות טלפון שנשמר
 * עליהן צילום של הנכס. זו הפעילות היחידה שהמערכת באמת יודעת
 * לשייך לנכס.
 *
 * ‎**ולא `interactions`**, שנראה כמו המקור המתבקש: לטבלה הזו אין
 * ‎`property_id` כלל — היא תלויה בליד או בקונה. ציר שנבנה ממנה היה
 * מציג פעילות של לקוח, לא של נכס, ולפעמים פעילות של נכס אחר.
 *
 * ## חמש שורות, והחדשה למעלה
 *
 * המסמך מבקש „up to 5”. הדוח מחזיר בסדר עולה — הוא מסמך שנמסר
 * לבעל נכס וקוראים אותו מההתחלה — ואילו הטור הצדדי עונה על „מה
 * קרה לאחרונה”. לכן ההיפוך כאן, ולא בשרת: לשני הצרכנים אותה
 * אמת ושני סדרים, וזה הבדל של תצוגה.
 */

const MAX_ROWS = 5;

interface ActivityEntry {
  at: string;
  kind: OwnerActivityKind;
  result: OwnerActivityResult;
}

interface ActivityReport {
  entries: ActivityEntry[];
}

export function PropertyTimeline({ propertyId }: { propertyId: string }) {
  /*
   * שלושה מצבים ולא שניים: „טוען”, „ריק” ו„נכשל”. כרטיס ריק
   * שנראה זהה לכרטיס שלא נטען הוא בדיוק מה שהמסמך אוסר — ומצב
   * שאי אפשר להבחין בו כבר עלה ביוקר בקובץ ההקלטות.
   */
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    apiGet<ActivityReport>(`/properties/${propertyId}/activity`)
      .then((res) => {
        if (live) setEntries(res.entries);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [propertyId]);

  const recent = entries === null ? [] : [...entries].reverse().slice(0, MAX_ROWS);

  return (
    <section className="mv-card" aria-labelledby="timeline-heading">
      <div className="mv-card-head">
        <span className="mv-tile mv-tile--44 mv-domain-neutral" aria-hidden="true">
          <IconClock s={20} />
        </span>
        <h2 id="timeline-heading" className="mv-card-head__title">
          מה קורה עם הנכס
        </h2>
      </div>

      {failed ? (
        <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
          לא הצלחנו לטעון את הפעילות. רעננו את העמוד.
        </p>
      ) : entries === null ? (
        <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
          טוען…
        </p>
      ) : recent.length === 0 ? (
        <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
          עוד לא נרשמה פעילות על הנכס.
        </p>
      ) : (
        <ol className="mv-timeline m-0 list-none p-0">
          {recent.map((entry) => (
            <li className="mv-timeline__row" key={`${entry.at}-${entry.kind}`}>
              <span className="mv-timeline__dot" aria-hidden="true" />
              <div className="mv-timeline__body">
                <p className="mv-timeline__event">
                  {OWNER_ACTIVITY_KIND_LABELS[entry.kind]} ·{" "}
                  {OWNER_ACTIVITY_RESULT_LABELS[entry.result]}
                </p>
                {/* מועד ב-LTR מבודד — DESIGN-SYSTEM-4, כמו כל מספר במערכת */}
                <p className="mv-timeline__when" dir="ltr" style={{ unicodeBidi: "isolate" }}>
                  {formatDateTime(entry.at)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
