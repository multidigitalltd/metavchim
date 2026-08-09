/**
 * התאריך העברי.
 *
 * מתווך בישראל עובד עם שני לוחות שנה במקביל: פגישה נקבעת ל-"רביעי
 * ה-12", אבל "אחרי סוכות" ו-"לפני פסח" הם מה שקובע מתי השוק זז.
 * יומן שמציג רק תאריך לועזי מכריח אותו להחזיק את ההמרה בראש.
 *
 * ההמרה נשענת על `Intl` עם לוח `hebrew`, שקיים בכל דפדפן מודרני
 * וב-Node — בלי ספרייה חיצונית ובלי טבלת המרה שנצטרך לתחזק.
 *
 * **שגיאה בהמרה לעולם לא מפילה את היומן.** התאריך העברי הוא תוספת
 * ולא הנתון עצמו; סביבה שבה `Intl` חלקי תציג יומן לועזי תקין ולא
 * מסך שגיאה.
 */

/**
 * גרשיים בתאריך העברי.
 *
 * `Intl` מחזיר ספרות לטיניות ("12 Tishri") או אותיות בלי גרשיים,
 * תלוי בסביבה. הפורמט המקובל בעברית הוא י״ב תשרי, ולכן ההמרה
 * המספרית נעשית כאן ולא נשארת לגורל של הסביבה.
 */
const HEBREW_ONES = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
const HEBREW_TENS = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
const HEBREW_HUNDREDS = ["", "ק", "ר", "ש", "ת"];

/**
 * מספר לאותיות עבריות עם גרשיים.
 *
 * כולל את שני החריגים המקובלים: ט״ו ו-ט״ז ולא י״ה/י״ו, שנמנעים
 * מצירוף אותיות של שם ה'. זה לא קישוט — תאריך שכתוב י״ה נראה שגוי
 * לכל קורא עברית.
 */
export function hebrewNumeral(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return String(value);

  let rest = Math.floor(value);
  let out = "";
  while (rest >= 400) {
    out += "ת";
    rest -= 400;
  }
  out += HEBREW_HUNDREDS[Math.floor(rest / 100)] ?? "";
  rest %= 100;

  /*
   * החריג חל על **השארית אחרי המאות**, לא על המספר כולו.
   *
   * שנת 5715 היא תשט״ו ולא תשי״ה: הצירוף שנמנע הוא של שתי האותיות
   * האחרונות, ואין לו שום קשר לספרת המאות שלפניהן. בדיקה על הערך
   * המלא תפסה רק את 15 ו-16 עצמם (ביקורת Codex).
   */
  if (rest === 15 || rest === 16) {
    out += rest === 15 ? "טו" : "טז";
    rest = 0;
  } else {
    out += HEBREW_TENS[Math.floor(rest / 10)] ?? "";
    rest %= 10;
    out += HEBREW_ONES[rest] ?? "";
  }

  if (out.length === 1) return `${out}׳`;
  if (out.length > 1) return `${out.slice(0, -1)}״${out.slice(-1)}`;
  return out;
}

/** שמות החודשים כפי ש-Intl מחזיר אותם, ממופים לעברית. */
const MONTH_NAMES: Record<string, string> = {
  Tishri: "תשרי",
  Heshvan: "חשוון",
  Cheshvan: "חשוון",
  Marheshvan: "חשוון",
  Kislev: "כסלו",
  Tevet: "טבת",
  Shevat: "שבט",
  Adar: "אדר",
  "Adar I": "אדר א׳",
  "Adar II": "אדר ב׳",
  Nisan: "ניסן",
  Iyar: "אייר",
  Sivan: "סיוון",
  Tamuz: "תמוז",
  Av: "אב",
  Elul: "אלול",
};

export interface HebrewDateParts {
  /** יום בחודש כמספר. */
  day: number;
  /** שם החודש בעברית. */
  month: string;
  /** שנה כמספר (למשל 5786). */
  year: number;
}

/**
 * פירוק תאריך לועזי לחלקיו העבריים.
 *
 * מחזיר `null` כשההמרה אינה זמינה — הקורא מציג לועזי בלבד.
 */
export function hebrewDateParts(date: Date): HebrewDateParts | null {
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-u-ca-hebrew", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Jerusalem",
    }).formatToParts(date);

    const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
    const day = Number(get("day"));
    const rawMonth = get("month");
    const year = Number(get("year"));
    if (!Number.isFinite(day) || !Number.isFinite(year) || rawMonth === "") return null;

    return { day, month: MONTH_NAMES[rawMonth] ?? rawMonth, year };
  } catch {
    return null;
  }
}

/**
 * התאריך העברי הקצר — "י״ב תשרי". מתאים לתא ביומן שבועי.
 *
 * מחרוזת ריקה כשההמרה נכשלה, כדי שהקורא יוכל פשוט לשרשר אותה בלי
 * לבדוק null.
 */
export function hebrewDateShort(date: Date): string {
  const parts = hebrewDateParts(date);
  return parts === null ? "" : `${hebrewNumeral(parts.day)} ${parts.month}`;
}

/** התאריך המלא — "י״ב תשרי תשפ״ו". לכותרת ולתצוגת יום בודד. */
export function hebrewDateFull(date: Date): string {
  const parts = hebrewDateParts(date);
  if (parts === null) return "";
  // אלפי השנה לא נכתבים: תשפ״ו ולא ה׳תשפ״ו — כך זה מופיע בלוחות
  return `${hebrewNumeral(parts.day)} ${parts.month} ${hebrewNumeral(parts.year % 1000)}`;
}
