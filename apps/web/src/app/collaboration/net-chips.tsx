import type { NetworkChip, NetworkChipIcon } from "@metavchim/shared";
import {
  IconBank,
  IconBanknote,
  IconBolt,
  IconCalendar,
  IconCheck,
  IconClock,
  IconCoins,
  IconDoor,
  IconFlame,
  IconHome,
  IconKey,
  IconMap,
  IconPin,
  IconRuler,
  IconSparkle,
  IconStairs,
  IconStar,
  IconTag,
} from "../icons";

/**
 * שורת התגיות של כרטיס ברשת.
 *
 * **מה** מוצג נקבע ב-`packages/shared/logic/network-card.ts`; **איך**
 * זה נראה נקבע כאן. ההפרדה אינה סגנון: אותו ביקוש מוצג בשלושה
 * מסכים, ורשימת השדות המותרים צריכה להיות מקום אחד שאפשר לבדוק ולא
 * שלוש רשימות JSX שנפרדות ביום שמישהו מוסיף שדה.
 *
 * ## למה טבלה ולא אימוג'י
 *
 * גרסה קודמת של המסך הזה נשאה אימוג'ים. הם נראו זרים לצד ערכת
 * הקווים של שאר המערכת — שתי שפות חזותיות באותו מסך, ובנוסף כל
 * מערכת הפעלה מציירת אותם אחרת, כך שאין שליטה על משקל, על גודל ועל
 * צבע. האייקונים כאן הם `currentColor` באותו משקל קו כמו כל המערכת,
 * ולכן הם יורשים את צבע התגית ואת מצב הערכה הכהה בלי טיפול נפרד.
 */
const ICONS: Record<
  NetworkChipIcon,
  (p: { s?: number }) => React.ReactElement
> = {
  tag: IconTag,
  key: IconKey,
  home: IconHome,
  door: IconDoor,
  ruler: IconRuler,
  map: IconMap,
  pin: IconPin,
  coins: IconCoins,
  bolt: IconBolt,
  calendar: IconCalendar,
  bank: IconBank,
  banknote: IconBanknote,
  flame: IconFlame,
  clock: IconClock,
  check: IconCheck,
  star: IconStar,
  stairs: IconStairs,
  sparkle: IconSparkle,
};

export function NetChips({ chips }: { chips: NetworkChip[] }) {
  if (chips.length === 0) return null;
  return (
    <ul className="mv-net-chips">
      {chips.map((chip, index) => {
        const Icon = ICONS[chip.icon];
        return (
          <li
            // אין מפתח יציב: התגיות נגזרות ונבנות מחדש בכל רינדור,
            // ואותו טקסט עשוי להופיע פעמיים (שתי שכונות בעלות שם זהה)
            key={`${chip.icon}-${chip.text}-${String(index)}`}
            className={`mv-net-chip${chip.tone !== undefined && chip.tone !== "plain" ? ` mv-net-chip--${chip.tone}` : ""}`}
            {...(chip.title === undefined ? {} : { title: chip.title })}
          >
            <Icon s={14} />
            {chip.text}
          </li>
        );
      })}
    </ul>
  );
}
