import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import {
  WHATSAPP_AGENT_DENIAL_TEXT,
  whatsappAgentDenial,
  whatsappAgentSeats,
  whatsappSeatOffer,
  whatsappSeatOfferText,
} from "./whatsapp-agent";

/**
 * ‎**מי רשאי לסוכן בוואטסאפ — ומה קורה למי שאינו.**
 *
 * שתי תקלות נפרדות מכוסות כאן, ושתיהן היו „עובד” עד שמישהו הסתכל:
 *
 * 1. ‎**הזכאות נבדקה רק על הודעה נכנסת.** הפקת קוד הצימוד הייתה
 *    פתוחה לכל משתמש מאומת בכל מסלול — אונבורדינג מלא לתכונה שאינה
 *    נמכרת למשרד הזה, וקישור חי במסד שאיש לא ישתמש בו.
 * 2. ‎**ההסבר נבלע.** אחרי שנוסף השער, המסך קיבל 403 עם הסיבה
 *    המדויקת והציג „הפקת הקוד נכשלה — נסו שוב”: הוראה לנסות שוב על
 *    בקשה שלעולם לא תצליח (ביקורת Codex).
 */
describe("זכאות לסוכן בוואטסאפ", () => {
  it("מסלול שאינו כולל את הסוכן חוסם גם את מי שהוקצה לו", () => {
    expect(whatsappAgentDenial({ planHasAgent: false, whatsappAccess: true })).toBe("plan");
  });

  /*
   * ‎**המקום מוקצה, ואינו נגזר מתפקיד.**
   *
   * קודם בעל המשרד היה מורשה אוטומטית לפי `role`, ולכן לא הייתה
   * שום דרך להעביר את המקום לסוכן אחר — הדגל שלו לא נשמר בשום
   * מקום, ולא היה מה לכבות. ההעברה היא הדרישה עצמה.
   */
  it("ההכרעה נגזרת מההקצאה בלבד, לכל תפקיד", () => {
    expect(whatsappAgentDenial({ planHasAgent: true, whatsappAccess: true })).toBeNull();
    expect(whatsappAgentDenial({ planHasAgent: true, whatsappAccess: false })).toBe("seat");
  });

  /*
   * הסדר אינו שרירותי: „אינו כלול במסלול” הוא מצב של המשרד, ו„לא
   * הופעל עבורך” הוא מצב אישי שיש לו פתרון בלחיצה. הצגת השני
   * כשהראשון הוא הסיבה שולחת את המתווך לבקש משהו שאין לו מה לעשות
   * איתו.
   */
  it("המסלול קודם להקצאה כשהשניים חסרים", () => {
    expect(whatsappAgentDenial({ planHasAgent: false, whatsappAccess: false })).toBe("plan");
  });

  it("לכל סיבה יש נוסח, והוא אומר מה לעשות", () => {
    expect(WHATSAPP_AGENT_DENIAL_TEXT.plan).toContain("מסלול");
    expect(WHATSAPP_AGENT_DENIAL_TEXT.seat).toContain("בעל המשרד");
  });
});

/**
 * ‎**המקום הראשון מגיע מהמסלול, לא מהמשרד.**
 *
 * כל מסלול שכולל את הסוכן מזכה בסוכן אחד; כל נוסף נרכש. מסלול
 * שאינו כולל אותו מזכה ב**אפס** ולא ב„אחד שחסום” — שני המצבים
 * נראים דומה מבחוץ והם שונים לגמרי כשמשרד משדרג מסלול.
 */
describe("מקומות לסוכן הוואטסאפ", () => {
  it("מסלול שכולל את הסוכן מזכה באחד", () => {
    expect(whatsappAgentSeats(true, 0)).toBe(1);
  });

  it("מסלול שאינו כולל מזכה באפס, גם אם נרכשו תוספות", () => {
    expect(whatsappAgentSeats(false, 0)).toBe(0);
    expect(whatsappAgentSeats(false, 5)).toBe(0);
  });

  it("כל תוספת שנרכשה מצטרפת לאחד הכלול", () => {
    expect(whatsappAgentSeats(true, 1)).toBe(2);
    expect(whatsappAgentSeats(true, 4)).toBe(5);
  });

  /* ערך פגום בעמודה לא יגדיל מכסה ולא ירד מתחת לכלול */
  it("ערך שלילי או שבור אינו גורע מהמקום הכלול", () => {
    expect(whatsappAgentSeats(true, -3)).toBe(1);
    expect(whatsappAgentSeats(true, 1.7)).toBe(2);
  });
});

describe("שני הצדדים משתמשים באותה הכרעה", () => {
  const read = (relative: string): string =>
    readFileSync(new URL(relative, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .replace(/^[ \t]*\/\/.*$/gmu, "");

  const SETTINGS = read("../../../../apps/api/src/modules/settings/settings.controller.ts");
  const PROFILE = read("../../../../apps/web/src/app/profile/whatsapp-link-section.tsx");

  /*
   * שתי נקודות הכניסה — הצגת המצב והפקת הקוד — חייבות לענות אותה
   * תשובה. שתי בדיקות מקבילות היו נפרדות ביום שאחת מהן משתנה,
   * וההפרש ביניהן הוא בדיוק החור.
   */
  it("הצגת המצב והפקת הקוד קוראות לאותה פונקציה פרטית", () => {
    expect(SETTINGS).toContain("private async whatsappAgentDenial()");
    expect((SETTINGS.match(/await this\.whatsappAgentDenial\(\)/gu) ?? []).length).toBe(2);
  });

  /*
   * הסיבה **ומה לעשות איתה** נמסרות עם המצב, ולא כשגיאה אחרי לחיצה.
   *
   * הביטוי בודק את שני השדות ולא את החתימה המלאה: חתימה שנבדקת
   * כמחרוזת אחת נשברת בכל תוספת שדה — וזה בדיוק מה שקרה כאן
   * כשנוסף `offer`, על שער שהיה ירוק רגע קודם.
   */
  it("הזכאות וההצעה נמסרות למסך יחד עם מצב החיבור", () => {
    const signature = SETTINGS.slice(
      SETTINGS.indexOf("async whatsappLink()"),
      SETTINGS.indexOf("const status = await this.whatsappLinks.status"),
    );
    expect(signature).toContain("denial?: WhatsappAgentDenial");
    expect(signature).toContain("offer?: WhatsappSeatOffer");
  });

  /*
   * ‎**ההודעה של השרת אינה נבלעת.** זו התקלה עצמה: 403 שנשא את
   * הסיבה הוחלף ב„נסו שוב”.
   */
  it("המסך שומר את הודעת השרת ואינו מחליף אותה", () => {
    expect(PROFILE).toContain("err instanceof ApiError ? err.message");
  });

  /* וכשאי אפשר — לא מציעים כפתור שיכשל */
  it("כפתור ההפקה אינו מוצג כשהזכאות נשללה", () => {
    expect(PROFILE).toContain("status?.denial === undefined ? (");
    expect(PROFILE).toContain("WHATSAPP_AGENT_DENIAL_TEXT[status.denial]");
  });
});

/**
 * ‎**המקום נספר, מועבר, ונראה.**
 *
 * שלוש דרישות של בעל המוצר, וכל אחת נשברת בשקט בלי שער:
 *
 * 1. ‎**נספר** — בלי מכסה, בעל משרד מדליק את הסוכן לכל הצוות בלי
 *    לרכוש דבר, וההכנסה על „כל סוכן נוסף” אינה נגבית.
 * 2. ‎**מועבר** — בלי היכולת לכבות אצל מי שמחזיק, „בעל המשרד יכול
 *    לתת את הוואטסאפ לסוכן אחר” אינו אפשרי בכלל.
 * 3. ‎**נראה** — „שיראה למי הוא משויך” היה חלק מהבקשה, לא קישוט.
 */
describe("הקצאת המקום — נספרת, ניתנת להעברה, ומוצגת", () => {
  const read = (relative: string): string =>
    readFileSync(new URL(relative, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .replace(/^[ \t]*\/\/.*$/gmu, "");

  const SETTINGS = read("../../../../apps/api/src/modules/settings/settings.controller.ts");
  const TEAM = read("../../../../apps/web/src/app/settings/page.tsx");
  const MIGRATION = read(
    "../../../../apps/api/prisma/migrations/20260830070000_whatsapp_agent_seats/migration.sql",
  );

  it("המכסה נאכפת בהדלקה, ותחת הנעילה", () => {
    expect(SETTINGS).toContain("private async assertWhatsappSeatAvailable(");
    expect(SETTINGS).toMatch(/body\.whatsappAccess === true && !target\.whatsappAccess/u);
    expect(SETTINGS).toContain("pg_advisory_xact_lock");
  });

  /*
   * ההקצאה מותרת על שורת בעל המשרד ועל השורה של עצמך — ורק היא.
   * תפקיד, פעילות וטלפון נשארים חסומים: הם זהות, ועריכה עצמית שלהם
   * היא הדרך להעלות את עצמך בדרגה.
   */
  it("ההעברה מותרת, ושאר שדות הזהות נשארים חסומים", () => {
    expect(SETTINGS).toContain("const onlyWhatsappSeat =");
    expect(SETTINGS).toMatch(/id === ctx\.userId && !onlyWhatsappSeat/u);
    expect(SETTINGS).toMatch(/target\.role === "owner" && !onlyWhatsappSeat/u);
  });

  /*
   * ‎**„רק המקום” נגזר מהמפתחות, ולא מרשימה ידנית.**
   *
   * מנייה של שלושת השדות האחרים עובדת היום ונשברת בשקט מחר: שדה
   * רביעי שיתווסף לסכימה ייחשב „רק המקום” — כלומר עריכה עצמית שלו
   * תעקוף את החסימה שנועדה למנוע בדיוק אותה.
   */
  it("הפטור מוגבל למפתח אחד בלבד, בלי מנייה ידנית", () => {
    expect(SETTINGS).toMatch(
      /Object\.keys\(body\)\.every\(\(key\) => key === "whatsappAccess"\)/u,
    );
  });

  /*
   * ‎**הפעלה מחדש של מי שמחזיק במקום נספרת גם היא.**
   *
   * חשבון מושבת אינו נספר, ולכן המקום שלו התפנה ובעל המשרד יכול
   * היה להקצות אותו לסוכן אחר. הפעלה מחדש שבודקת רק את מכסת
   * המשתמשים מחזירה אותו עם המקום ביד — מעל המכסה, ובלי חיוב.
   */
  it("הפעלה מחדש נספרת מול מכסת המקומות", () => {
    expect(SETTINGS).toContain("const takesWhatsappSeat =");
    expect(SETTINGS).toMatch(
      /body\.isActive === true && !target\.isActive && holdsSeatAfter/u,
    );
  });

  it("המסך מראה למי הסוכן מוקצה וכמה מקומות בשימוש", () => {
    expect(TEAM).toContain("const whatsappHolders =");
    expect(TEAM).toContain("whatsappAgentSeatsUsed");
    expect(TEAM).toContain("הסוכן בוואטסאפ:");
  });

  /*
   * ‎**המקום ניתן למכירה דרך המוצר.**
   *
   * השדה נוסף ל-API ולא למסך, ולכן אי אפשר היה למכור מקום בכלל —
   * כל משרד נעול על אחד אלא אם מישהו קורא ל-API ידנית (ביקורת
   * Codex). „כל אחד נוסף בתוספת תשלום” אינו קיים אם אין איפה
   * להוסיף אותו.
   */
  it("מסך הפלטפורמה מציג ושולח את המקומות הנוספים", () => {
    const PLATFORM_API = read("../../../../apps/api/src/modules/platform/platform.controller.ts");
    const PLATFORM_UI = read("../../../../apps/web/src/app/platform/page.tsx");
    expect(PLATFORM_API).toMatch(/whatsappAgentSeatsExtra: t\.whatsappAgentSeatsExtra/u);
    expect(PLATFORM_UI).toContain("agency.whatsappAgentSeatsExtra");
    expect(PLATFORM_UI).toContain("whatsappAgentSeatsExtra: Number(waSeats)");
  });

  /*
   * ‎**הורדת מכסה מתחת למוקצים נדחית.**
   *
   * הזכאות בזמן ריצה קוראת את דגל המשתמש ואת המסלול — לא את המכסה.
   * הורדת המספר לבדה אינה מנתקת איש, ולכן המחזיקים ממשיכים לעבוד
   * מעל מה ששולם ללא הגבלת זמן.
   */
  it("הורדת מקומות מתחת למספר המחזיקים נדחית", () => {
    const PLATFORM_API = read("../../../../apps/api/src/modules/platform/platform.controller.ts");
    expect(PLATFORM_API).toMatch(/if \(holders > seats\)/u);
    const guard = PLATFORM_API.slice(
      PLATFORM_API.indexOf('if ("whatsappAgentSeatsExtra" in body'),
      PLATFORM_API.indexOf("data.whatsappAgentSeatsExtra = next;"),
    );
    expect(guard).toContain("pg_advisory_xact_lock");
  });

  /*
   * ‎**ההגירה אינה מנתקת את בעלי המשרדים.**
   *
   * הגישה שלהם נגזרה מהתפקיד ולא נשמרה בדגל. בלי הצעד הזה, הרגע
   * שההכרעה מפסיקה לקרוא `role` הוא הרגע שכל בעלי המשרדים מנותקים
   * — בפריסה אחת, בלי אזהרה.
   */
  it("ההגירה מעניקה לבעלי המשרדים את מה שכבר היה להם", () => {
    expect(MIGRATION).toMatch(/SET "whatsapp_access" = TRUE[\s\S]*?"role" = 'owner'/u);
  });

  /*
   * ‎**המחיר המוצג הוא המחיר שיחויב.**
   *
   * המסך עיגל לשקלים שלמים, ולכן 199.50 ₪ הופיע „200 ₪” — פרסום
   * של מחיר שאינו נגבה, על סכום שהעורך מאפשר במפורש.
   */
  it("מחיר עם אגורות אינו מעוגל כלפי מעלה", () => {
    const text = whatsappSeatOfferText(whatsappSeatOffer(19_950));
    expect(text).toContain("199.5");
    expect(text).not.toContain("200");
  });

  it("מחיר עגול מוצג בלי אגורות מיותרות", () => {
    const text = whatsappSeatOfferText(whatsappSeatOffer(20_000));
    expect(text).toContain("200 ₪");
    expect(text).not.toContain("200.00");
  });

  /*
   * ‎`null` = המסלול אינו מוכר מקומות נוספים, ולא „טרם הוגדר”.
   * הצגת מחיר כלשהי שם הייתה מבטיחה רכישה שאין לה מחיר.
   */
  it("מסלול שאינו מוכר מקומות מפנה לפנייה אנושית, בלי מספר", () => {
    const text = whatsappSeatOfferText(whatsappSeatOffer(null));
    expect(text).toContain("פנו אלינו");
    expect(text).not.toMatch(/\d/u);
  });
});
