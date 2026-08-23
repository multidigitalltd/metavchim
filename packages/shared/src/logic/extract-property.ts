import type { PropertyFields } from "../schemas/property.js";
import { parseSpokenAmountShekels } from "./spoken-amount.js";

/**
 * חילוץ שדות נכס מתמלול עברי (אפיון §6) — מנוע חוקים דטרמיניסטי.
 *
 * זו שכבת הבסיס: מהירה, חינמית, צפויה וניתנת לבדיקה. בפרודקשן ספק LLM
 * ירוץ מעליה (ExtractionProvider ב-API) וישלים מקרים מורכבים; החוקים
 * נשארים כ-Fallback וכרשת ביקורת על תוצרי ה-LLM.
 */

export const CITIES = [
  "בני ברק",
  "ירושלים",
  "תל אביב",
  "בית שמש",
  "פתח תקווה",
  "חיפה",
  "אלעד",
  "מודיעין עילית",
  "ביתר עילית",
  "אשדוד",
  "רמת גן",
  "גבעת שמואל",
  "רחובות",
  "נתניה",
  "צפת",
  "טבריה",
  "באר שבע",
  "רכסים",
  "קרית ספר",
] as const;

export const HEB_NUM: Record<string, number> = {
  אחד: 1,
  שניים: 2,
  שני: 2,
  שלושה: 3,
  שלוש: 3,
  ארבעה: 4,
  ארבע: 4,
  חמישה: 5,
  חמש: 5,
  שישה: 6,
  שש: 6,
  שבעה: 7,
  שבע: 7,
  שמונה: 8,
};

export function parseNumberWord(raw: string): number | undefined {
  const asNumber = Number(raw.replace(",", "."));
  if (!Number.isNaN(asNumber)) return asNumber;
  return HEB_NUM[raw.trim()];
}

export interface ExtractionResult {
  fields: PropertyFields;
  /**
   * מה שנאמר, כתוכן שיווקי.
   *
   * מחוץ ל-`fields` בכוונה: `PropertyFields` הוא מה שמנוע החילוץ
   * *מזהה*, והתיאור אינו שדה שזוהה אלא הטקסט עצמו. הוא גם יושב על
   * הנכס ולא על השדות שממנו נגזרות ההתאמות.
   */
  marketingDescription?: string;
  /** ביטויים שזוהו — לשקיפות מול המתווך ("ממה הבנו כל שדה") */
  evidence: Partial<Record<keyof PropertyFields, string>>;
}

export function extractPropertyFromTranscript(
  transcript: string,
): ExtractionResult {
  const text = transcript.replace(/\s+/gu, " ").trim();
  const fields: PropertyFields = {};
  const evidence: ExtractionResult["evidence"] = {};

  // --- עיר ---
  for (const city of CITIES) {
    if (text.includes(city)) {
      fields.city = city;
      evidence.city = city;
      break;
    }
  }

  // --- חדרים: "3 חדרים", "3.5 חדרים", "שלושה חדרים", "3 וחצי חדרים", "דירת 4" ---
  const roomsMatch =
    /(?<num>\d+(?:[.,]5)?|[א-ת]+)(?:\s+וחצי)?\s+חדרים/u.exec(text) ??
    /דירת\s+(?<num>\d+(?:[.,]5)?)/u.exec(text);
  if (roomsMatch?.groups?.["num"] !== undefined) {
    let rooms = parseNumberWord(roomsMatch.groups["num"]);
    if (rooms !== undefined && roomsMatch[0].includes("וחצי")) rooms += 0.5;
    if (rooms !== undefined && rooms >= 1 && rooms <= 20) {
      fields.rooms = rooms;
      evidence.rooms = roomsMatch[0];
    }
  }

  /*
   * --- רחוב: "רחוב הרב שך", "ברחוב רבי עקיבא 10" ---
   *
   * **הגבול הוא מה שחשוב כאן, לא הזיהוי.** הגרסה הקודמת עצרה רק
   * בשש מילות מפתח, ולכן במשפט טבעי כמו "ברחוב הרצל דירה מהממת
   * משופצת" היא לקחה גם את "דירה מהממת משופצת" אל תוך הכתובת —
   * כלומר התיאור השיווקי הגיע לשדה הכתובת, ושם הוא גם חסר משמעות
   * וגם מעוות את פענוח הכתובת למפה.
   *
   * שתי הגנות: רשימת עצירה רחבה בהרבה (כל מילה שפותחת תיאור), וגג
   * של ארבע מילים — שם רחוב ארוך מזה כמעט אינו קיים, ומשפט שנשפך
   * פנימה תמיד ארוך יותר.
   */
  const streetMatch =
    /ב?רחוב\s+(?<street>[א-ת"״׳'\d ]+?)(?=,|\.|$| קומה| בקומה| עם| בלי| ללא| יש | מחיר| במחיר| ב?עיר| דירה| דירת| בית| פנטהאוז| דופלקס| משופצ| חדש| ישן| מדהים| מהמם| יפה| גדול| קטן| מרווח| כניסה| בלעדיות| מיידי| גמיש| שכירות| להשכרה| למכירה| מ["״]ר| מטר| חדרים)/u.exec(
      text,
    );
  if (streetMatch?.groups?.["street"]) {
    const street = streetMatch.groups["street"]
      .trim()
      .split(/\s+/u)
      .slice(0, 4)
      .join(" ");
    if (street !== "") {
      fields.street = street;
      evidence.street = streetMatch[0];
    }
  }

  // --- קומה: "קומה 2 מתוך 4" ---
  const floorMatch =
    /קומה\s+(?<floor>\d+|קרקע)(?:\s+מתוך\s+(?<total>\d+))?/u.exec(text);
  if (floorMatch?.groups?.["floor"] !== undefined) {
    fields.floor =
      floorMatch.groups["floor"] === "קרקע"
        ? 0
        : Number(floorMatch.groups["floor"]);
    evidence.floor = floorMatch[0];
    if (floorMatch.groups["total"] !== undefined) {
      fields.totalFloors = Number(floorMatch.groups["total"]);
    }
  }

  // --- שטח: "68 מטר", '95 מ"ר' ---
  const areaMatch = /(?<area>\d{2,4})\s*(?:מטר|מ["״]ר)/u.exec(text);
  if (areaMatch?.groups?.["area"] !== undefined) {
    fields.areaSqm = Number(areaMatch.groups["area"]);
    evidence.areaSqm = areaMatch[0];
  }

  // --- מחיר: "2.15 מיליון", "מיליון וחצי", "850 אלף", "6,500 שקל" ---
  const priceMillion = /(?<n>\d+(?:[.,]\d+)?)\s*מיליון/u.exec(text);
  const millionHalf = /מיליון וחצי/u.exec(text);
  const priceThousand = /(?<n>\d{2,4})\s*אלף/u.exec(text);
  const priceShekel = /(?<n>\d[\d,]{2,})\s*(?:שקל|ש["״]ח|₪)/u.exec(text);
  const spokenAmount = parseSpokenAmountShekels(text);
  const bareAmount = bareAmountAgorot(text);
  if (priceMillion?.groups?.["n"] !== undefined) {
    fields.priceAgorot = Math.round(
      Number(priceMillion.groups["n"].replace(",", ".")) * 100_000_000,
    );
    evidence.priceAgorot = priceMillion[0];
  } else if (millionHalf) {
    fields.priceAgorot = 150_000_000;
    evidence.priceAgorot = millionHalf[0];
  } else if (priceThousand?.groups?.["n"] !== undefined) {
    fields.priceAgorot = Number(priceThousand.groups["n"]) * 100_000;
    evidence.priceAgorot = priceThousand[0];
  } else if (priceShekel?.groups?.["n"] !== undefined) {
    fields.priceAgorot =
      Number(priceShekel.groups["n"].replace(/,/gu, "")) * 100;
    evidence.priceAgorot = priceShekel[0];
  } else if (spokenAmount !== undefined) {
    // תמלול דיבור: "שני מיליון וחצי", "שבע מאות אלף" — מילים, לא ספרות
    fields.priceAgorot = spokenAmount.shekels * 100;
    evidence.priceAgorot = spokenAmount.evidence;
  } else if (bareAmount !== undefined) {
    fields.priceAgorot = bareAmount.agorot;
    evidence.priceAgorot = bareAmount.evidence;
  }

  // --- סוג עסקה ---
  if (/להשכרה|שכירות|לשכירות/u.test(text)) {
    fields.dealType = "rent";
    evidence.dealType = "להשכרה";
  } else if (
    fields.priceAgorot !== undefined &&
    fields.priceAgorot >= 30_000_000
  ) {
    fields.dealType = "sale"; // מחיר בסדר גודל של מכירה
    evidence.dealType = "מחיר בסדר גודל של מכירה";
  } else if (/למכירה|מכירה/u.test(text)) {
    fields.dealType = "sale";
    evidence.dealType = "למכירה";
  }

  // --- סוג נכס ---
  /*
   * הסדר הוא ההיגיון: הכלל הכללי `/דירה|דירת/` תופס כמעט כל תיאור,
   * ולכן כל סוג ספציפי חייב להופיע **לפניו**. „דירה מתאימה לחלוקה”
   * ו„דירה בטאבו משותף” שניהם מכילים „דירה”, והוספת הערכים לסכימה
   * בלי שורות כאן הייתה שומרת אותם בשקט כ-`apartment` — כלומר
   * ההתאמות והייצוא היו מתארים נכס אחר (ביקורת Codex).
   *
   * הנתיב הזה הוא הגיבוי לכשהסוכן החכם אינו מוגדר או מחזיר תשובה
   * שאי אפשר לקרוא, ולכן הוא צריך לכסות את אותם ערכים בדיוק.
   */
  /*
   * `unless` — ביטוי ששולל את השורה.
   *
   * „דירה **לא** מתאימה לחלוקה” הוא ההפך הגמור מ„דירה מתאימה
   * לחלוקה”, וחיפוש מחרוזת חיובית מוצא את שתיהן. בלי השלילה
   * המפורשת המערכת הייתה שומרת בדיוק את ההפך ממה שנאמר — טעות
   * גרועה יותר מלא לזהות כלל, כי היא נראית כמו זיהוי מוצלח
   * (ביקורת Codex).
   *
   * `(?:^|\s)` ולא `\b`: הגבול של `\b` מוגדר על תווי ASCII ואינו
   * עובד בעברית.
   */
  const NOT_DIVISIBLE = /(?:^|\s)(?:לא|אינה|אינו|אינם)\s+(?:מתאימה|מתאים|ניתנת|ניתן)?\s*(?:לחלוקה|מחולקת|מחולק)/u;

  /*
   * אותה שלילה, לצד השני: „דירה **לא** בטאבו משותף”.
   *
   * הניסוח הרווח מוסיף מילת מצב בין השלילה לטאבו — „אינה **רשומה**
   * בטאבו משותף” — ושלילה שאינה מזהה אותה גרועה מכלום: החלק החיובי
   * עדיין תופס, ונשמר בדיוק ההפך (ביקורת Codex). קבוצת מילות המצב
   * מפורשת ולא `\S+` כללי, כדי ש„לא גדולה אבל בטאבו משותף” לא
   * ייפסל בטעות.
   */
  const NOT_SHARED_TABU =
    /(?:^|\s)(?:לא|אינה|אינו|אינם)\s+(?:(?:רשומה|רשום|רשומים|נמצאת|נמצא|מוגדרת|מוגדר)\s+)?(?:ב)?טאבו\s+(?:משותף|שיתופי)/u;

  /*
   * „לחלוקה” לבדו אינו סוג נכס. „מגרש לחלוקה” ו„מחסן לחלוקה” אינם
   * דירה, והקיצור היה הופך אותם ל-`divisible_apartment` — שינוי
   * שקט של ההתאמה והייצוא (ביקורת Codex). הקיצור מחייב עכשיו
   * הקשר של דירה; „מתאימה/ניתנת לחלוקה” נשארות עצמאיות, כי הן
   * בנקבה ומתייחסות ממילא לדירה.
   */
  const DIVISIBLE = /מתאימה לחלוקה|ניתנת לחלוקה|דיר(?:ה|ת)[^.,]{0,30}?(?:לחלוקה|מחולקת)/u;

  const typeMap: [RegExp, PropertyFields["propertyType"], RegExp?][] = [
    [/פנטהאוז/u, "penthouse"],
    [/דירת גן/u, "garden_apartment"],
    [/דופלקס/u, "duplex"],
    [/בית פרטי|קוטג/u, "private_house"],
    [/יחידת דיור/u, "unit"],
    [DIVISIBLE, "divisible_apartment", NOT_DIVISIBLE],
    [/טאבו משותף|טאבו שיתופי/u, "shared_tabu", NOT_SHARED_TABU],
    [/דירה|דירת/u, "apartment"],
  ];
  for (const [re, type, unless] of typeMap) {
    if (unless?.test(text)) continue;
    if (re.test(text)) {
      fields.propertyType = type;
      evidence.propertyType = re.source;
      break;
    }
  }

  // --- מאפיינים: "עם/יש X" ⇒ true, "בלי/אין X" ⇒ false, לא הוזכר ⇒ לא ידוע ---
  const featureMap: [
    string,
    "hasElevator" | "hasParking" | "hasBalcony" | "hasSafeRoom" | "hasStorage",
  ][] = [
    ["מעלית", "hasElevator"],
    ["חניה", "hasParking"],
    ["מרפסת", "hasBalcony"],
    ['ממ"ד', "hasSafeRoom"],
    ["ממ״ד", "hasSafeRoom"],
    ["מחסן", "hasStorage"],
  ];
  for (const [word, field] of featureMap) {
    if (new RegExp(`(?:בלי|אין|ללא)\\s+${word}`, "u").test(text)) {
      fields[field] = false;
      evidence[field] = `בלי ${word}`;
    } else if (
      new RegExp(`(?:עם|יש|כולל)\\s+${word}`, "u").test(text) ||
      text.includes(`ו${word}`)
    ) {
      fields[field] = true;
      evidence[field] = word;
    }
  }

  // --- מצב הנכס ---
  if (/משופצת|משופץ|אחרי שיפוץ/u.test(text)) {
    fields.condition = "renovated";
    evidence.condition = "משופצת";
  } else if (/חדשה מקבלן|דירה חדשה/u.test(text)) {
    fields.condition = "new";
  } else if (/דורשת שיפוץ|צריך שיפוץ/u.test(text)) {
    fields.condition = "needs_renovation";
  }

  // --- בלעדיות ---
  if (/בלעדיות/u.test(text)) {
    fields.exclusive = true;
    evidence.exclusive = "בלעדיות";
  }

  /*
   * --- מועד כניסה/מסירה ---
   *
   * מה שנאמר בפה הוא כמעט תמיד מצב ולא תאריך: "כניסה מיידית",
   * "גמיש", "בתיאום". קודם הוקלט תאריך של היום על "כניסה מיידית"
   * וכל השאר ירד לאיבוד — כלומר הנכס נראה כאילו נמסר היום, וההתאמה
   * עבדה על נתון שאיש לא אמר.
   */
  if (/כניסה מיידית|פינוי מיידי|מיידי/u.test(text)) {
    fields.entryType = "immediate";
    evidence.entryType = "כניסה מיידית";
  } else if (/כניסה גמישה|מועד גמיש|גמיש בכניסה|בתיאום/u.test(text)) {
    fields.entryType = "flexible";
    evidence.entryType = "מועד גמיש";
  }

  /*
   * --- התיאור החופשי → תוכן שיווקי ---
   *
   * מה שנאמר בפה הוא גם נתונים וגם *תיאור*: "דירה מהממת עם נוף
   * לים, שכנים נהדרים". הנתונים נחלצים לשדות, והתיאור עצמו לא היה
   * נשמר בשום מקום — או גרוע מכך, נבלע לתוך הכתובת.
   *
   * התמלול המלא נשמר כתוכן שיווקי, כי הוא **בדיוק** מה שהמתווך
   * רוצה לכתוב במודעה, ומחיקה שלו הייתה מאבדת את החלק היחיד שאי
   * אפשר לשחזר משדות. הוא ניתן לעריכה בכרטיס, ולכן טקסט עודף כאן
   * עדיף על טקסט חסר.
   */
  const description = text.trim();

  return {
    fields,
    evidence,
    ...(description === ""
      ? {}
      : { marketingDescription: description.slice(0, 4000) }),
  };
}

/**
 * סכום שנאמר בלי מילת יחידה — "המחיר 2,300,000", "ב-1750000".
 *
 * המנוע זיהה עד כה רק "מיליון", "אלף" ו"שקל", ולכן מתווך שאמר את
 * המספר המלא — הדרך הטבעית ביותר לומר מחיר — קיבל נכס בלי מחיר,
 * בלי שום סימן לכך שמשהו אבד.
 *
 * הסף התחתון אינו קישוט: בלעדיו כל "68 מטר" ו"קומה 3" היו הופכים
 * למחיר. מספר שאינו סביר כמחיר נדחה, וכך גם מספר שכבר שימש שדה
 * אחר (שטח, קומה, חדרים) — הבדיקה היא על המילים שסביבו.
 */
const MIN_BARE_PRICE = 50_000;

function bareAmountAgorot(
  text: string,
): { agorot: number; evidence: string } | undefined {
  /*
   * שתי הגנות שנלמדו מביקורת: **אין `ב-` גנרי**, ואין קבלה של תחילית
   * מספר ארוך יותר.
   *
   * "לפרטים בטלפון ב-0501234567" התפרש כמחיר של 50,123,456 ₪ — ומכיוון
   * שמחיר בסדר גודל כזה גם קובע "למכירה", מספר טלפון היה מזהם את סוג
   * העסקה, את ציון המוכנות ואת ההתאמות. אותו דבר לתאריך דחוס.
   *
   * לכן: רק מילה שמצהירה על מחיר, ספרה ראשונה שאינה 0 (טלפון ישראלי
   * מתחיל ב-0), וגבול ימני שמונע לקיחת תשע ספרות מתוך מספר ארוך יותר.
   */
  const re =
    /(?:מחיר|במחיר|מבקשים|מבקש|עולה)\s*(?:של\s*)?(?<n>\d{1,3}(?:,\d{3})+|[1-9]\d{4,8})(?![\d,./-])/gu;
  for (const match of text.matchAll(re)) {
    const raw = match.groups?.["n"];
    if (raw === undefined) continue;
    const value = Number(raw.replace(/,/gu, ""));
    if (!Number.isFinite(value) || value < MIN_BARE_PRICE) continue;
    return { agorot: value * 100, evidence: match[0] };
  }
  /*
   * מספר עם מפרידי אלפים עומד בפני עצמו גם בלי מילה שמקדימה אותו:
   * "דירת 4 חדרים בבני ברק, 2,300,000". אין שדה אחר בנכס שנכתב כך,
   * ולכן אין כאן התנגשות.
   */
  const grouped = /(?<![\d,])(?<n>\d{1,3}(?:,\d{3}){1,3})(?![\d,])/u.exec(text);
  if (grouped?.groups?.["n"] !== undefined) {
    const value = Number(grouped.groups["n"].replace(/,/gu, ""));
    if (Number.isFinite(value) && value >= MIN_BARE_PRICE) {
      return { agorot: value * 100, evidence: grouped[0] };
    }
  }
  return undefined;
}
