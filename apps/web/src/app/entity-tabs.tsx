"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  const strip = useRef<HTMLDivElement>(null);

  /**
   * ‎**האם יש עוד לגלול, ולאיזה צד** — ומכאן המסכה שמְמַסָּה את הקצה.
   *
   * CSS אינו יודע לשאול את זה, ולכן זה נמדד כאן ונמסר כ-`data-fade`.
   * ‎`Math.abs` על `scrollLeft` כי ב-RTL הוא יורד לשלילי בכרום, ומדידה
   * שמניחה חיובי הייתה מכריזה „אין מה לגלול” בדיוק במסך שבו יש.
   */
  const measure = useCallback((): void => {
    const el = strip.current;
    if (el === null) return;
    const from = Math.abs(el.scrollLeft);
    const room = el.scrollWidth - el.clientWidth;
    if (room <= 1) {
      el.dataset["fade"] = "none";
      return;
    }
    const atStart = from <= 1;
    const atEnd = from >= room - 1;
    el.dataset["fade"] = atStart ? "end" : atEnd ? "start" : "both";
  }, []);

  /*
   * ‎**גם הלשוניות עצמן נמדדות, לא רק הסרגל** (ביקורת Codex).
   *
   * המונים מגיעים אחרי הטעינה — „נכסים תואמים 1” נולד רחב יותר
   * מ„נכסים תואמים”. כשזה קורה תיבת הגבול של הסרגל אינה משתנה
   * כלל, ולכן משקיף שמאזין לו בלבד אינו נורה: הגלישה **נולדת**
   * בלי שאיש ימדוד אותה, והקצה שנוסף נשאר חד עד שהמשתמש יגלול
   * במקרה. החתימה מרכיבה תווית ומונה יחד, כך שהמשקיפים נבנים
   * מחדש על הילדים החדשים בכל שינוי כזה.
   */
  const signature = tabs.map((tab) => `${tab.key}:${tab.label}:${tab.count ?? ""}`).join("|");

  useEffect(() => {
    const el = strip.current;
    if (el === null) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    /*
     * ‎`ResizeObserver` ולא אירוע `resize` של החלון: הסרגל צר
     * מהחלון, והוא משתנה גם כשהחלון אינו משתנה — סרגל צד שנפתח,
     * מכשיר שהסתובב, או לשונית שהתרחבה.
     */
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => {
      el.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [measure, signature]);

  /**
   * ‎**הלשונית הפעילה נגללת לתצוגה.**
   *
   * כניסה עם `?tab=tasks` בחרה לשונית שיושבת מחוץ למסך, והמתווך ראה
   * פאנל בלי לדעת מה נבחר — במסך צר הלשונית האחרונה הייתה 500 פיקסל
   * משמאל לקצה. הגלילה נעשית על הסרגל בלבד (`scrollLeft`) ולא דרך
   * `scrollIntoView`, שגורר גם את העמוד אנכית וקופץ מתחת לאצבע.
   */
  useEffect(() => {
    const el = strip.current;
    if (el === null) return;
    const button = el.querySelector<HTMLElement>('[aria-selected="true"]');
    if (button === null) return;
    const box = el.getBoundingClientRect();
    const mark = button.getBoundingClientRect();
    /*
     * ‎**רוחב המסכה, לא ריווח נוח.** הקצה נמוג על פני 34 פיקסלים
     * (‎`.mv-entity-tabs[data-fade]` ב-globals.css), וגלילה שעוצרת
     * לפני כן הייתה מציבה את הלשונית ה**פעילה** מתחת למיסוך —
     * כלומר בוחרת לשונית ומעמעמת אותה באותה נשימה.
     */
    const PAD = 38;
    /*
     * ‎**הגבול הוא קצה הסרגל פחות המסכה, לא קצה הסרגל** (ביקורת
     * Codex). לשונית שנמצאת בתוך הסרגל גיאומטרית אך יושבת בתוך
     * אזור הדהייה לא הפעילה אף אחד משני התנאים — כלומר לחיצה על
     * לשונית נראית בקצה בחרה אותה והשאירה אותה מעומעמת.
     * הגלילה נחסמת ממילא בקצוות, ולכן ריפוד גם בצד שאינו ממוסך
     * אינו מזיז דבר.
     */
    if (mark.left < box.left + PAD) el.scrollLeft -= box.left + PAD - mark.left;
    else if (mark.right > box.right - PAD) el.scrollLeft += mark.right - (box.right - PAD);
    measure();
    /*
     * ‎`signature` בתלויות ולא רק `active`: המונה מגיע אחרי הטעינה
     * ומרחיב לשוניות, והרוחב שנוסף דוחף את הפעילה אל מחוץ לתצוגה
     * **אחרי** שהגלילה כבר רצה. נצפה בפועל — כניסה ל„משימות” ב-360
     * וב-414 פיקסלים השאירה את הלשונית שנבחרה בלתי נראית, וזה
     * התגלה רק אחרי שהלשונית הפסיקה לקרוס וניתן היה למדוד אותה.
     */
  }, [active, measure, signature]);

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
