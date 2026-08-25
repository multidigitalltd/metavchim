"use client";

import { useCallback, useEffect, useState } from "react";
import type { DuplicateGroup } from "@metavchim/shared";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { IconX } from "./icons";
import { Notice } from "./notice";

/**
 * הסתרת הפאנל כולו — **לדפדפן הזה, ורק לרשימה הזו.**
 *
 * ייבוא של מאגר שלם מייצר עשרות הצעות מיזוג בבת אחת, והדשבורד
 * הופך לרשימה ארוכה שחוסמת את מה שבאמת צריך לראות בבוקר. „לא
 * עכשיו” הוא צורך אמיתי.
 *
 * מה שנשמר הוא **חתימת הרשימה** ולא דגל „הוסתר”: הצעה חדשה שתיווצר
 * מחר משנה את החתימה והפאנל חוזר. דגל פשוט היה מסתיר לנצח גם
 * כפילויות אמיתיות שייווצרו אחר כך — כלומר פותר הצקה ויוצר נזק.
 *
 * ההעדפה מקומית ולא בשרת: זו בחירת תצוגה של אדם, לא החלטה של
 * המשרד. סוכן אחר שרואה את אותם כרטיסים צריך לראות את ההצעות.
 */
const HIDDEN_KEY = "mv.duplicates.hidden";

/**
 * החתימה כוללת את **חברי** הקבוצה ולא רק את מפתחה.
 *
 * המפתח הוא חתימת השם, והוא אינו משתנה כשלקוח נוסף מצטרף לאותו
 * שם. השרת דווקא מחזיר קבוצה שנדחתה ברגע שנוסף לה חבר — וחתימה
 * שמסתמכת על המפתח בלבד הייתה מבטלת בדיוק את ההתנהגות הזו,
 * ומשאירה מוסתרת כפילות חדשה לגמרי (ביקורת Codex).
 */
function signatureOf(groups: DuplicateGroup[]): string {
  return groups
    .map((group) =>
      [group.key, group.survivor.contactId, ...group.duplicates.map((d) => d.contactId)]
        .sort()
        .join(","),
    )
    .sort()
    .join("|");
}

function readHidden(): string | null {
  try {
    return window.localStorage.getItem(HIDDEN_KEY);
  } catch {
    // דפדפן שחוסם אחסון מקומי — הפאנל פשוט לא ייזכר, וזה בסדר
    return null;
  }
}

/**
 * "כפילויות אפשריות" בדשבורד.
 *
 * למה בדשבורד ולא במסך הגדרות: כפילות אינה תקלה טכנית אלא מצב שפוגע
 * בעבודה — חצי מההיסטוריה של הלקוח בכרטיס אחד וחצי בשני. מי שרואה
 * את זה כל בוקר מטפל בזה; מי שצריך לחפש את המסך, לא.
 *
 * הרכיב לא מציג דבר כשאין כפילויות — דשבורד עמוס בקופסאות ריקות
 * מאמן את המשתמש להתעלם מהן.
 */
export function DuplicateContacts() {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  /*
   * `null` = טרם נקרא מהאחסון. חשוב להבדיל מ"לא הוסתר": קריאה
   * מ-localStorage אסורה ברינדור השרת, ואתחול ל-"" היה מציג
   * הבזק של הפאנל לפני ההסתרה.
   */
  const [hiddenSignature, setHiddenSignature] = useState<string | null>(null);

  useEffect(() => {
    setHiddenSignature(readHidden() ?? "");
  }, []);

  const load = useCallback(() => {
    // 403 לסוכן ללא ראות רוחבית — לא שגיאה, פשוט לא בשבילו
    apiGet<DuplicateGroup[]>("/contacts/duplicates")
      .then(setGroups)
      .catch(() => setGroups([]));
  }, []);

  useEffect(load, [load]);

  async function dismiss(key: string): Promise<void> {
    setBusyId(key);
    setError(null);
    setDone(null);
    try {
      await apiPost("/contacts/duplicates/dismiss", { key });
      setDone("ההצעה הוסרה — היא תחזור רק אם ייווסף כרטיס נוסף עם השם הזה");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הדחייה נכשלה");
    } finally {
      setBusyId(null);
    }
  }

  async function merge(survivorId: string, duplicateId: string): Promise<void> {
    setBusyId(duplicateId);
    setError(null);
    setDone(null);
    try {
      const result = await apiPost<{ moved: number }>("/contacts/duplicates/merge", {
        survivorId,
        duplicateId,
      });
      setDone(
        result.moved === 0
          ? "הכרטיסים אוחדו"
          : `הכרטיסים אוחדו — ${result.moved} רשומות הועברו`,
      );
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "המיזוג נכשל");
    } finally {
      setBusyId(null);
    }
  }

  if (groups.length === 0 && done === null) return null;
  // עדיין לא ידוע אם הוסתר — לא מציגים כדי לא להבהב
  if (hiddenSignature === null) return null;
  if (done === null && hiddenSignature === signatureOf(groups)) return null;

  function hide(): void {
    const signature = signatureOf(groups);
    try {
      window.localStorage.setItem(HIDDEN_KEY, signature);
    } catch {
      // בלי אחסון ההסתרה תקפה עד לרענון — עדיין עדיף מכלום
    }
    setHiddenSignature(signature);
    setDone(null);
  }

  return (
    <section className="mv-list-card mb-[18px] px-5 py-[17px]" aria-labelledby="dupes-heading">
      <div className="mb-1 flex items-baseline gap-2">
        <h2 id="dupes-heading" className="m-0" style={{ fontSize: 16.5, fontWeight: 800 }}>
          כפילויות אפשריות
          {groups.length > 0 ? <span className="mv-chip ms-2">{groups.length}</span> : null}
        </h2>
        <button
          type="button"
          className="ms-auto"
          onClick={hide}
          aria-label="הסתר את רשימת הכפילויות"
          title="הסתר — תחזור אם תתגלה כפילות חדשה"
          style={{ color: "var(--color-text-muted)" }}
        >
          <IconX s={15} />
        </button>
      </div>
      <p className="m-0 mb-3 text-[14px]" style={{ color: "var(--color-text-muted)" }}>
        אותו שם מופיע ביותר מכרטיס אחד — בדרך כלל אותו אדם שנקלט פעמיים עם שני
        מספרים. מיזוג מעביר את כל ההיסטוריה לכרטיס אחד ושומר את שני המספרים.
      </p>

      {done ? (
        <Notice tone="success">✓ {done}</Notice>
      ) : null}

      <ul className="m-0 list-none p-0">
        {groups.map((group) => (
          <li
            key={group.key}
            className="border-t py-2.5 first:border-t-0 first:pt-0"
            style={{ borderColor: "var(--color-input-border)" }}
          >
            <div className="mb-1 flex flex-wrap items-baseline gap-2">
              <strong className="text-sm">{group.survivor.name}</strong>
              <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                נשמר: <span dir="ltr">{group.survivor.phone}</span>
                {group.survivor.activity > 0 ? ` · ${group.survivor.activity} רשומות` : " · ללא פעילות"}
              </span>
              {/* שני אנשים שונים עם אותו שם — ההצעה מוסרת ולא חוזרת */}
              <button
                type="button"
                className="mv-btn-plain ms-auto"
                style={{ padding: "4px 10px", fontSize: "var(--type-caption)" }}
                disabled={busyId !== null}
                onClick={() => void dismiss(group.key)}
              >
                {busyId === group.key ? "מסיר…" : "לא כפילות"}
              </button>
            </div>

            {group.duplicates.map((dupe) => (
              <div key={dupe.contactId} className="flex flex-wrap items-center gap-2 py-1">
                <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                  ימוזג: <span dir="ltr">{dupe.phone}</span>
                  {dupe.activity > 0 ? ` · ${dupe.activity} רשומות` : " · ללא פעילות"}
                </span>
                <button
                  type="button"
                  className="mv-btn-action ms-auto"
                  style={{ padding: "5px 12px", fontSize: "var(--type-caption)" }}
                  disabled={busyId !== null}
                  onClick={() => void merge(group.survivor.contactId, dupe.contactId)}
                >
                  {busyId === dupe.contactId ? "ממזג…" : "מזג לכרטיס אחד"}
                </button>
              </div>
            ))}
          </li>
        ))}
      </ul>

      {error ? (
        <Notice tone="danger">{error}</Notice>
      ) : null}
    </section>
  );
}
