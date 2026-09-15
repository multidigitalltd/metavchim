"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";

/**
 * ‎**„המר” מתוך רשימת הלידים, בלי להיכנס לכרטיס תחילה.**
 *
 * ## הבקשה, והמדרגה שהייתה
 *
 * ‏ההמרה קיימת מזמן — בכרטיס הליד, ומאז גם במסך השיחות — אבל
 * ברשימה עצמה לא הייתה. מי שסורק עשרים לידים ומחליט מי מהם בשל
 * היה צריך להיכנס לכרטיס, לגלול אל תחתיתו, ולבחור שם; ואז לחזור
 * ולעשות זאת שוב. בעל המוצר ביקש „בכל שורה כפתור המר עם
 * דרופ-דאון שמאפשר להמיר לקונה, למוכר או לשוכר/משכיר”.
 *
 * ## למה תפריט שמנווט, ולא המרה בלחיצה אחת
 *
 * ‏המרה **אינה** שינוי סטטוס: היא יוצרת כרטיס חדש שיש לו שדות
 * חובה. קונה בלי בשלות ובלי ערי חיפוש אינו נכנס למנוע ההתאמות,
 * ונכס בלי עיר וסוג אינו ניתן לשיווק. „המר” שהיה מסיים בלחיצה
 * אחת היה מייצר כרטיסים חצי-ריקים שמישהו יגלה מאוחר יותר — וזה
 * גרוע מהמדרגה שהוא בא לחסוך.
 *
 * ‏לכן התפריט עושה בדיוק את מה שהיה חסר: הוא **בוחר את הצד ואת
 * סוג העסקה**, ונוחת בכרטיס על הטופס הנכון כשהוא כבר פתוח וסוג
 * העסקה מולא. ארבע האפשרויות הן שני צירים — מי הלקוח (מחפש או
 * בעל נכס) ואיזו עסקה (מכירה או שכירות) — וארבעת הצירופים הם
 * „קונה / שוכר / מוכר / משכיר”.
 *
 * ## נגישות
 *
 * אותה תבנית כמו `SelectMenu`, שכבר מוכחת כאן: הפוקוס נשאר על
 * הכפתור, החצים מזיזים את הפריט הפעיל, `aria-activedescendant`
 * הוא מה שקורא המסך מקריא, `Enter` מאשר ו-`Esc` סוגר. ההבדל
 * היחיד הוא שאין כאן ערך נבחר — יש פעולה, ולכן `menu` ולא
 * ‎`listbox`.
 */

/** ארבעת היעדים — שני צירים, ולא ארבע פעולות שאין ביניהן קשר. */
const TARGETS = [
  { key: "buyer-sale", side: "buyer", deal: "sale", label: "קונה" },
  { key: "buyer-rent", side: "buyer", deal: "rent", label: "שוכר" },
  { key: "seller-sale", side: "property", deal: "sale", label: "מוכר" },
  { key: "seller-rent", side: "property", deal: "rent", label: "משכיר" },
] as const;

export function ConvertMenu({
  leadId,
  leadName,
  canBuyer,
  canProperty,
  className,
}: {
  leadId: string;
  /** לשם הנגיש: „המרת הליד של משה כהן”, ולא עשרים כפתורי „המר”. */
  leadName: string;
  /** ‎`buyers.edit` — בלעדיה צד המחפש אינו מוצע. */
  canBuyer: boolean;
  /** ‎`properties.create` — בלעדיה צד בעל-הנכס אינו מוצע. */
  canProperty: boolean;
  className?: string;
}): React.JSX.Element | null {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const targets = TARGETS.filter((t) =>
    t.side === "buyer" ? canBuyer : canProperty,
  );

  useEffect(() => {
    if (!open) return;
    function onDocument(event: MouseEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocument);
    return () => document.removeEventListener("mousedown", onDocument);
  }, [open]);

  /*
   * ‎**אין הרשאה לאף צד — אין כפתור.** תפריט שנפתח ריק, או שכל
   * פריט בו מוביל למסך שיסרב, גרוע מהיעדרו.
   */
  if (targets.length === 0) return null;

  function commit(index: number): void {
    const target = targets[index];
    if (target === undefined) return;
    setOpen(false);
    /*
     * ‎`tab=next` הוא חלק מהכתובת ולא פרט טכני: טפסי ההמרה יושבים
     * בלשונית „הצעד הבא” של הכרטיס, והלשוניות אינן מרונדרות יחד.
     * בלעדיו הניווט נוחת ב„סקירה”, הטופס אינו קיים ב-DOM כלל,
     * והכפתור נראה כאילו לא עשה דבר.
     */
    router.push(
      `/leads/${leadId}?tab=next&convert=${target.side}&deal=${target.deal}`,
    );
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setActive(0);
        setOpen(true);
      } else {
        setActive((i) => Math.min(targets.length - 1, i + 1));
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setActive(targets.length - 1);
        setOpen(true);
      } else {
        setActive((i) => Math.max(0, i - 1));
      }
    } else if (open && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      commit(active);
    }
  }

  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`}>
      <button
        ref={buttonRef}
        type="button"
        className="mv-btn-plain"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-activedescendant={open ? `${menuId}-${active}` : undefined}
        aria-label={`המרת הליד של ${leadName}`}
        onClick={() => {
          setActive(0);
          setOpen(!open);
        }}
        onKeyDown={onKeyDown}
      >
        המר
        <svg
          aria-hidden="true"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s ease" }}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? (
        /* אותה רשימה נפתחת של `SelectMenu` — שפה אחת לכל מה שנפתח */
        <ul id={menuId} role="menu" aria-label="המרת הליד" className="mv-select-list">
          {targets.map((target, index) => (
            <li
              key={target.key}
              id={`${menuId}-${index}`}
              role="menuitem"
              data-active={index === active}
              className="mv-select-option"
              onMouseEnter={() => setActive(index)}
              onClick={() => commit(index)}
            >
              <span className="truncate">{target.label}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
