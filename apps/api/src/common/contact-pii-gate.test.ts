import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ‎**מי נוגע בפרטי לקוח — רשימה שנאכפת, לא זיכרון.**
 *
 * ## ‏למה השער הזה קיים
 *
 * ‏ההפרדה בין סוכנים נסגרה עד כה **דלת אחרי דלת**: התיבה, כרטיס
 * ‏הנכס, פיד ההתראות, מונה הדואר, החיפוש, דוח הבעלים, העוזר,
 * ‏שליחת ה-Gmail, מסך הכפילויות. תשע עקיפות בשני סבבי ביקורת, כל
 * ‏אחת נמצאה בנפרד, וכל אחת הייתה **קיימת מהיום הראשון** — לא
 * ‏רגרסיה, אלא מקום שלא ידענו לחפש בו.
 *
 * ‏עלות המנייה הידנית היא שהדלת העשירית תימצא באותה דרך. השער הזה
 * ‏הופך את המנייה לאוטומטית: כל קובץ שנוגע בפרטי לקוח **חייב
 * ‏להופיע ברשימה** למטה, עם סיווג. קובץ חדש שנוגע בהם ואינו מסווג
 * ‏מפיל את ה-CI, וזה ההבדל בין „שכחנו” לבין „החלטנו”.
 *
 * ## ‏מה השער מבטיח — ומה לא
 *
 * ‎**מבטיח:** הרשימה מלאה ומעודכנת. אין קובץ שנוגע ב-PII ואינו
 * ‏מסווג, ואין ברשימה קובץ שכבר אינו נוגע. סיווג `person` או
 * ‎`entity` נבדק מול הקוד עצמו — הורדת השער מקובץ מפילה כאן, ולכן
 * ‏אי אפשר להצהיר על הגנה שאינה קיימת.
 *
 * ‎**אינו מבטיח:** שכל שאילתה בקובץ מסווג באמת מסוננת.
 * ‎`search.service.ts` היה `entity` **ונכון** — הוא סינן קונים
 * ‏ולידים — ובכל זאת ענף הנכסים שבו היה פרוץ. סריקת טקסט אינה
 * ‏יכולה לראות את זה, ואני מעדיף לכתוב את המגבלה מאשר להשאיר
 * ‏רושם של הוכחה.
 *
 * ‏לכן: **תיל מתיחה לדלת חדשה, לא תעודת כשרות לדלתות הקיימות.**
 * ‏הפתרון המלא הוא לרכז את פענוח ה-PII מאחורי שער אחד ב-
 * ‎`ContactsService` — 49 מקומות קריאה שצריך לסווג — וזו עבודה
 * ‏נפרדת שאינה נכנסת לשינוי הזה.
 */

const API_SRC = join(import.meta.dirname, "..");

/**
 * ‏איך „נגיעה בפרטי לקוח” נראית בקוד: פענוח ישיר של עמודה מוצפנת,
 * ‏או קריאה לאחת מארבע המתודות ב-`ContactsService` שמחזירות ערך
 * מפוענח.
 */
const PII_MARKERS = [
  /nameEncrypted/u,
  /phoneEncrypted/u,
  /emailEncrypted/u,
  /contacts\.(getById|getByIds|emailFor|phonesFor)\s*\(/u,
];

/**
 * ‏שער **ברמת האדם**: „מותר לי הלקוח הזה”. זה הכלל שכל תשע
 * ‏העקיפות פספסו.
 */
const PERSON_GATES = [
  /assertContactAccess/u,
  /canSeeContact/u,
  /visibleContactIds/u,
  /assertSeesAllContacts/u,
];

/**
 * ‏שער **ברמת הישות**: הלקוח מגיע דרך כרטיס קונה או ליד שכבר
 * ‏סוננו בבעלות, ולכן הזכאות לאדם נגזרת מהזכאות לכרטיס.
 */
const ENTITY_GATES = [/ownershipFilter/u, /leadOwnershipFilter/u];

type Classification = "person" | "entity" | "write" | "system" | "office" | "resolver";

/**
 * ‏כל קובץ שנוגע בפרטי לקוח, ולמה מותר לו.
 *
 * ‎`person`/`entity` נבדקים מול הקוד. `system`/`office`/`resolver`
 * ‏הם קביעה אנושית, ולכן הם מעטים ומנומקים אחד-אחד.
 */
interface Entry {
  as: Classification;
  why: string;
  /**
   * ‏הסמל שנושא את הסינון בקובץ הזה, כשאינו אחד מהמשותפים.
   *
   * ‏קיים כי „דרך ישות שכבר סוננה” מתממש לפעמים בפרדיקט מקומי ולא
   * ‏ב-`ownershipFilter` המשותף. ההצהרה נשארת **ניתנת לאימות**:
   * ‏השער בודק שהסמל שהוצהר עדיין בקוד, ולכן הסרתו מפילה כאן.
   */
  gate?: RegExp;
}

const CLASSIFIED: Record<string, Entry> = {
  // ‏שער ברמת האדם — נבדק מול הקוד
  "modules/agent/execute.service.ts": { as: "person", why: "פעולות העוזר" },
  "modules/calls/calls.service.ts": { as: "person", why: "יומן השיחות" },
  "modules/contacts/contacts.controller.ts": { as: "person", why: "כרטיס הלקוח" },
  "modules/contacts/duplicates.service.ts": { as: "person", why: "ראייה משרדית מלאה" },
  "modules/email-inbox/email-inbox.service.ts": { as: "person", why: "תיבת הדואר" },
  "modules/gmail/gmail-outbound.service.ts": { as: "person", why: "שליחה ללקוח" },
  "modules/properties/properties.service.ts": { as: "person", why: "כרטיס הנכס" },
  "modules/properties/property-activity.service.ts": { as: "person", why: "דוח לבעלים" },
  "modules/search/search.service.ts": { as: "person", why: "חיפוש" },
  "modules/telephony/telephony.service.ts": { as: "person", why: "שיחות" },

  // ‏שער ברמת הישות — הלקוח מגיע דרך כרטיס שכבר סונן בבעלות
  "modules/agreements/agreements.service.ts": { as: "entity", why: "הסכם של כרטיס" },
  "modules/buyers/buyers.service.ts": { as: "entity", why: "כרטיס הקונה" },
  "modules/coach/coach.service.ts": { as: "entity", why: "הכרטיסים שלי" },
  "modules/collaboration/collaboration.service.ts": { as: "entity", why: "דרישה משותפת" },
  "modules/collaboration/listings.service.ts": { as: "entity", why: "נכס ברשת" },
  "modules/export/export.controller.ts": { as: "entity", why: "ייצוא — `data.export`" },
  "modules/intake/intake.service.ts": { as: "entity", why: "בקשת קליטה" },
  "modules/leads/leads.service.ts": { as: "entity", why: "הליד" },
  "modules/matching/matching.service.ts": { as: "entity", why: "התאמה לכרטיס" },

  "modules/offers/offer-email.service.ts": { as: "entity", why: "הצעה לכרטיס" },
  "modules/offers/offers.service.ts": { as: "entity", why: "הצעה לכרטיס" },
  "modules/tasks/tasks.service.ts": {
    as: "entity",
    why: "שם הלקוח של הכרטיס שהמשימה מצביעה עליו",
    // ‏`scopeFilter` הוא ה-`ownershipFilter` המקומי של המשימות
    gate: /scopeFilter/u,
  },

  /*
   * ‏נוגע בעמודה מוצפנת רק כדי **לכתוב** אליה: יצירת לקוח חדש
   * ‏מהשיחה בוואטסאפ. אינו מפענח את פרטיו של אף אחד, ולכן אין כאן
   * ‏מה לשמור — וזה נבדק, לא מוצהר.
   */
  "modules/messaging/whatsapp-assistant.service.ts": {
    as: "write",
    why: "מצפין מספר של לקוח חדש; אינו מפענח איש",
  },

  /*
   * ‏אין משתמש בהקשר: סבב רקע, עובד, או webhook ציבורי. אין למי
   * ‏להשוות יכולות, ולכן אין שער — ואין גם מסך שמציג את התוצאה.
   */
  "modules/calendar/viewing-reminder.service.ts": {
    as: "system",
    why: "סבב תזכורות — רץ עם `capabilities` ריקות, מדיניות משרד",
  },
  "modules/gmail/gmail-sync.service.ts": {
    as: "system",
    why: "משיכת דואר נכנס — `withExplicitTenant`, בלי בקשת HTTP",
  },
  "modules/leads/web-lead.service.ts": {
    as: "system",
    why: "טופס ציבורי — הדייר נגזר מהטוקן, אין משתמש מחובר",
  },
  "modules/messaging/whatsapp-inbound.service.ts": {
    as: "system",
    why: "webhook מ-Meta — `withExplicitTenant`, אין משתמש",
  },

  // ‏יכולת של הנהלת המשרד, ולא עבודת סוכן
  "modules/contacts/contact-erasure.service.ts": {
    as: "office",
    why: "מחיקת לקוח — `contacts.delete`, שאינה אצל סוכן או מנהל סניף",
  },

  // ‏השער עצמו אינו יכול לשמור על עצמו
  "modules/contacts/contacts.service.ts": {
    as: "resolver",
    why: "כאן מפוענח ה-PII — הקוראים הם שנבדקים, לא הוא",
  },
};

/**
 * ‏מה שהקוד **עושה**, בלי הערות ובלי שורות ייבוא.
 *
 * ‏שתי ההשמטות נחוצות ומאותה סיבה: הערה שמזכירה
 * ‎`assertContactAccess` אינה שער, ו-`import { assertContactAccess }`
 * ‏שנשאר אחרי שהקריאה נמחקה אינו שער אף הוא. מוטציה שהסירה את
 * ‏הקריאה בלבד עברה כאן — הייבוא החזיק את ההצהרה בחיים.
 */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/\/\/.*$/gmu, "")
    .replace(/^\s*import\s[\s\S]*?from\s+["'][^"']+["'];?$/gmu, "")
    .replace(/^\s*import\s*\{[\s\S]*?\}\s*from\s+["'][^"']+["'];?/gmu, "");
}

function sourceFiles(dir: string, prefix = ""): { name: string; code: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(join(dir, entry.name), rel);
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) return [];
    return [{ name: rel, code: codeOnly(readFileSync(join(dir, entry.name), "utf8")) }];
  });
}

const touchesPii = (code: string): boolean => PII_MARKERS.some((re) => re.test(code));
const hasAny = (code: string, gates: RegExp[]): boolean => gates.some((re) => re.test(code));

/** ‏השערים המשותפים, ובנוסף הסמל שהקובץ הצהיר עליו בעצמו. */
function gatesFor(name: string, shared: RegExp[]): RegExp[] {
  const own = CLASSIFIED[name]?.gate;
  return own === undefined ? shared : [...shared, own];
}

describe("שער: מי נוגע בפרטי לקוח", () => {
  const files = sourceFiles(API_SRC);
  const touching = files.filter((file) => touchesPii(file.code));

  /*
   * ‏בלי זה השער ירוק על כלום: תיקיה שזזה או ביטוי שנשבר היו
   * ‏הופכים אותו לבדיקה שעוברת תמיד. אותה תבנית כמו בשער „שלב א׳
   * ‏אינו שולח”.
   */
  it("יש מה לבדוק", () => {
    expect(files.length).toBeGreaterThan(200);
    expect(touching.length).toBeGreaterThan(20);
    expect(touching.map((f) => f.name)).toContain("modules/contacts/contacts.service.ts");
  });

  it("כל קובץ שנוגע בפרטי לקוח מסווג", () => {
    const unlisted = touching.map((f) => f.name).filter((name) => !(name in CLASSIFIED));
    expect(
      unlisted,
      `קבצים אלה נוגעים בפרטי לקוח ואינם ברשימה. הוסיפו אותם ל-CLASSIFIED עם סיווג, או הסירו את הנגיעה: ${unlisted.join(", ")}`,
    ).toEqual([]);
  });

  /*
   * ‏רשימה שמחזיקה שורות מתות היא רשימה שמפסיקים לקרוא — וזה
   * ‏בדיוק הטיעון שכבר נכתב בשער כיסוי המחיקה של הדייר.
   */
  it("אין ברשימה קובץ שכבר אינו נוגע", () => {
    const names = new Set(touching.map((f) => f.name));
    const stale = Object.keys(CLASSIFIED).filter((name) => !names.has(name));
    expect(stale, `שורות מתות ברשימה: ${stale.join(", ")}`).toEqual([]);
  });

  /*
   * ‎**החלק שאי אפשר לשקר בו.** סיווג `person` נבדק מול הקוד, ולכן
   * ‏הסרת השער מקובץ מפילה כאן — גם אם הרשימה נשארה כמות שהיא.
   */
  it("מי שהוצהר `person` באמת נושא שער ברמת האדם", () => {
    const broken = touching
      .filter((f) => CLASSIFIED[f.name]?.as === "person")
      .filter((f) => !hasAny(f.code, gatesFor(f.name, PERSON_GATES)))
      .map((f) => f.name);
    expect(broken, `הוצהרו \`person\` ואין בהם שער: ${broken.join(", ")}`).toEqual([]);
  });

  it("מי שהוצהר `entity` באמת מסנן בעלות", () => {
    const broken = touching
      .filter((f) => CLASSIFIED[f.name]?.as === "entity")
      .filter((f) => !hasAny(f.code, gatesFor(f.name, [...ENTITY_GATES, ...PERSON_GATES])))
      .map((f) => f.name);
    expect(broken, `הוצהרו \`entity\` ואין בהם סינון: ${broken.join(", ")}`).toEqual([]);
  });

  /*
   * ‎**„רק כותב” נבדק ולא מוצהר.** קובץ שמצפין ערך חדש אינו חושף
   * ‏איש; קובץ שגם מפענח כן, ואז ההצהרה הזו הופכת לכיסוי לדלת
   * ‏פתוחה. לכן המבחן הוא היעדר כל דרך לקרוא.
   */
  it("מי שהוצהר `write` באמת אינו מפענח דבר", () => {
    const reads = [/contacts\.(getById|getByIds|emailFor|phonesFor)\s*\(/u, /\.decrypt\s*\(/u];
    const broken = touching
      .filter((f) => CLASSIFIED[f.name]?.as === "write")
      .filter((f) => hasAny(f.code, reads))
      .map((f) => f.name);
    expect(broken, `הוצהרו \`write\` ובכל זאת מפענחים: ${broken.join(", ")}`).toEqual([]);
  });

  /*
   * ‏הסיווגים האנושיים הם היחידים שהשער אינו יכול לאמת, ולכן הם
   * ‏גם היחידים שצריך לקרוא בעין. שמירתם מעטים היא מה שהופך את
   * ‏הקריאה הזו לאפשרית.
   */
  it("הסיווגים שאינם נבדקים מול הקוד נשארים מעטים", () => {
    const manual = Object.entries(CLASSIFIED).filter(
      ([, value]) => value.as === "system" || value.as === "office" || value.as === "resolver",
    );
    expect(manual.length).toBeLessThanOrEqual(8);
    for (const [name, value] of manual) {
      expect(value.why, `${name} מסווג ידנית בלי נימוק`).not.toBe("");
    }
  });
});
