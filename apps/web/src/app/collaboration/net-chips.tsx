import type { NetworkChip } from "@metavchim/shared";

/**
 * שורת התגיות של כרטיס ברשת.
 *
 * מה מוצג נקבע ב-`packages/shared/logic/network-card.ts` ולא כאן —
 * הרכיב הזה רק מצייר. ההפרדה אינה סגנון: אותו ביקוש מוצג בשלושה
 * מסכים, ורשימת השדות המותרים צריכה להיות מקום אחד שאפשר לבדוק,
 * ולא שלוש רשימות JSX שנפרדות ביום שמישהו מוסיף שדה.
 */
export function NetChips({ chips }: { chips: NetworkChip[] }) {
  if (chips.length === 0) return null;
  return (
    <ul className="mv-net-chips">
      {chips.map((chip, index) => (
        <li
          // אין מפתח יציב: התגיות נגזרות ונבנות מחדש בכל רינדור,
          // ואותו טקסט עשוי להופיע פעמיים (שתי שכונות בעלות שם זהה)
          key={`${chip.icon}-${chip.text}-${String(index)}`}
          className={`mv-net-chip${chip.tone !== undefined && chip.tone !== "plain" ? ` mv-net-chip--${chip.tone}` : ""}`}
          {...(chip.title === undefined ? {} : { title: chip.title })}
        >
          <span aria-hidden="true">{chip.icon}</span>
          {chip.text}
        </li>
      ))}
    </ul>
  );
}
