"use client";

import { useEffect, useState } from "react";

import { useScrollAffordance } from "@/lib/use-scroll-affordance";

/**
 * לשוניות של כרטיס ישות — **הסדר שהיה חסר.**
 *
 * כרטיס קונה החזיק אחת-עשרה קופסאות בגלילה אחת ארוכה: מי הלקוח, מה
 * הוא מחפש, אנשי הקשר, ההסכם, השת"פ, המשימות, ההתאמות, ההצעות,
 * ההערות וציר הזמן. כולן נחוצות, ואף אחת מהן אינה נחוצה **תמיד** —
 * וזה בדיוק ההבדל בין מסך עמוס למסך מסודר.
 *
 * ## למה הלשונית נשמרת בכתובת
 *
 * סוכן שפתח את ההתאמות, לחץ על נכס וחזר, ציפה לחזור להתאמות. בלי
 * ‎?tab=‎ הוא נוחת בסקירה בכל פעם ומחפש מחדש. זה גם מה שמאפשר
 * לקשר ישירות ללשונית מתוך מסך אחר.
 *
 * `replaceState` ולא ניווט: אין כאן טעינת עמוד, רק החלפת תצוגה —
 * ודחיפת רשומה להיסטוריה הייתה הופכת את כפתור "אחורה" למעבר בין
 * לשוניות במקום ליציאה מהכרטיס.
 */

export interface EntityTab {
  key: string;
  label: string;
  /** מונה קטן לצד התווית. `undefined` = אין מה לספור; 0 אינו מוצג. */
  count?: number | undefined;
  /**
   * אייקון לפני התווית — **אופציונלי, ובכוונה.**
   *
   * בכרטיסי הישויות הסרגל הוא רשימת פרקים של אותו כרטיס, ואייקון
   * לכל פרק הוא רעש. ברשת הלשוניות הן אזורים שונים לגמרי, ושם
   * הסמל הוא מה שמבדיל ביניהם בסריקה מהירה.
   */
  icon?: React.ReactNode;
}

export function EntityTabs({
  tabs,
  active,
  onSelect,
  label,
  isActive,
  idPrefix = "tab",
  panelPrefix = "panel",
}: {
  tabs: EntityTab[];
  active: string;
  onSelect: (key: string) => void;
  /** שם הרשימה לקוראי מסך — "לשוניות כרטיס הקונה". */
  label: string;
  /**
   * ‏מתי לשונית נחשבת פעילה, כשזה אינו „המפתח שווה למצב”.
   *
   * ברשת „הרשת” פעילה בשלוש תת-לשוניות שונות, ולכן המצב מחזיק
   * ‎`demands` בזמן שהלשונית שצריכה להיראות פעילה היא `network`.
   */
  isActive?: (key: string) => boolean;
  /** תחילית ל-`id` של הלשונית — למסך שכבר משתמש בשמות אחרים. */
  idPrefix?: string;
  /** תחילית ל-`aria-controls` — הפאנל שהלשונית פותחת. */
  panelPrefix?: string;
}) {
  /*
   * ‎**התווית והמונה בחתימה, לא רק המפתח.** המונה מגיע אחרי
   * הטעינה ומרחיב את הלשונית; בלי שהוא בחתימה, הגלישה שנולדת אינה
   * נמדדת והלשונית הפעילה נדחפת החוצה אחרי שהגלילה כבר רצה.
   */
  const strip = useScrollAffordance<HTMLDivElement>(
    `${active}|${tabs.map((tab) => `${tab.key}:${tab.label}:${tab.count ?? ""}`).join(",")}`,
  );

  return (
    <div className="mv-entity-tabs" role="tablist" aria-label={label} ref={strip}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          id={`${idPrefix}-${tab.key}`}
          aria-selected={isActive === undefined ? active === tab.key : isActive(tab.key)}
          aria-controls={`${panelPrefix}-${tab.key}`}
          onClick={() => onSelect(tab.key)}
        >
          {tab.icon}
          {tab.label}
          {tab.count !== undefined && tab.count > 0 ? (
            <span className="mv-tab-count">{tab.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/**
 * מצב הלשונית, מסונכרן עם הכתובת.
 *
 * מפתח שאינו ברשימה נבלע ונופל ללשונית הראשונה: כתובת ישנה אחרי
 * שינוי שמות הלשוניות אמורה לפתוח משהו, לא מסך ריק.
 */
export function useEntityTab(keys: string[], fallback: string): [string, (next: string) => void] {
  const [tab, setTab] = useState(fallback);

  /*
   * ריצה אחת בטעינה בלבד. `keys` נוצר מחדש בכל רינדור אצל הקורא,
   * ולכן הכללתו כתלות הייתה מאפסת את הלשונית בכל רינדור — בדיוק
   * ההתנהגות שהקוד הזה נועד למנוע. הקריאה מהכתובת רלוונטית רק
   * בכניסה לכרטיס.
   */
  const initial = keys.join(",");
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (requested !== null && initial.split(",").includes(requested)) setTab(requested);
  }, [initial]);

  function select(next: string): void {
    setTab(next);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", next);
    window.history.replaceState({}, "", `?${params.toString()}`);
  }

  return [tab, select];
}

/** מעטפת פאנל — קושרת אותו ללשונית שלו לקוראי מסך. */
export function TabPanel({
  tab,
  active,
  children,
}: {
  tab: string;
  active: string;
  children: React.ReactNode;
}) {
  if (tab !== active) return null;
  return (
    <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={-1}>
      {children}
    </div>
  );
}
