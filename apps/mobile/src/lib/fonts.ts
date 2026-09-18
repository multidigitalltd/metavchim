/**
 * ‏Almoni — הגופן העברי של המותג, כמו ב-web (`globals.css` → `@font-face`).
 *
 * ‏ה-web טוען woff2; React Native דורש ttf, ולכן הקבצים ב-`assets/fonts`
 * ‏הם המרה ישירה של אותם ארבעה משקלים (fontTools, בלי שינוי בקווים).
 * ‏באנדרואיד `fontWeight` אינו בוחר קובץ מתוך משפחה בעצמו — כל משקל
 * ‏הוא שם משפחה משלו, ולכן הבחירה נעשית כאן, פעם אחת, ולא בכל מסך.
 */
import AlmoniRegular from "../../assets/fonts/Almoni-Regular.ttf";
import AlmoniMedium from "../../assets/fonts/Almoni-Medium.ttf";
import AlmoniBold from "../../assets/fonts/Almoni-Bold.ttf";
import AlmoniUltrabold from "../../assets/fonts/Almoni-Ultrabold.ttf";

export const FONT_ASSETS = {
  "Almoni-Regular": AlmoniRegular,
  "Almoni-Medium": AlmoniMedium,
  "Almoni-Bold": AlmoniBold,
  "Almoni-Ultrabold": AlmoniUltrabold,
} as const;

export type Weight = 400 | 500 | 600 | 700 | 800 | 900;

/** ‏אותו מיפוי כמו ב-`@font-face` של ה-web: 500–600 → Medium, 800–900 → UltraBold. */
export function family(weight: Weight = 400): keyof typeof FONT_ASSETS {
  if (weight >= 800) return "Almoni-Ultrabold";
  if (weight === 700) return "Almoni-Bold";
  if (weight >= 500) return "Almoni-Medium";
  return "Almoni-Regular";
}
