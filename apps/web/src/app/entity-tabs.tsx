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
}

export function EntityTabs({
  tabs,
  active,
  onSelect,
  label,
}: {
  tabs: EntityTab[];
  active: string;
  onSelect: (key: string) => void;
  /** שם הרשימה לקוראי מסך — "לשוניות כרטיס הקונה". */
  label: string;
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
          id={`tab-${tab.key}`}
          aria-selected={active === tab.key}
          aria-controls={`panel-${tab.key}`}
          onClick={() => onSelect(tab.key)}
        >
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
