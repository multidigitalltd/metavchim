import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  WHATSAPP_LINK_MAX_AGE_DAYS,
  linkNeedsReverification,
  normalizeWhatsappLinkCode,
} from "@metavchim/shared";

/**
 * הזהות בערוץ הוואטסאפ — **מי מדבר איתנו, ומי אמר את זה.**
 *
 * ## למה חלק מהבדיקות כאן מבניות
 *
 * ההכרעה עצמה נבדקת בהתנהגות (הלוגיקה המשותפת), אבל **מיקומה**
 * בזרימה הוא מה שנשבר בקלות: בדיקת הקוד חייבת לקרות לפני הזיהוי,
 * וההשוואה למספר חייבת לחדול מלהכריע בריבוי. שניהם שורות בודדות
 * שאפשר להזיז בלי שאף בדיקה תרגיש — ולכן הן נבדקות במפורש.
 */

const source = readFileSync(
  new URL("./whatsapp-assistant.service.ts", import.meta.url),
  "utf8",
);

describe("סדר ההכרעה בהודעה נכנסת", () => {
  it("קוד הקישור נבדק לפני זיהוי המשתמש", () => {
    const code = source.indexOf("looksLikeWhatsappLinkCode");
    const identify = source.indexOf("await this.identifyUser(");
    expect(code).toBeGreaterThan(0);
    expect(identify).toBeGreaterThan(0);
    /*
     * אחרת ניסיון קישור ממספר לא מוכר היה מתגלגל למסלול המתעניין,
     * ומקבל מענה שיווקי במקום להיקשר.
     */
    expect(code).toBeLessThan(identify);
  });

  /*
   * המסלול הזה עוקף את התפיסה שבמסד (היא דורשת משתמש מזוהה), ולכן
   * שליחה חוזרת של Meta הייתה עונה „הקוד אינו תקף” על קוד שהמשלוח
   * הראשון בדיוק ניצל.
   */
  it("ושליחה חוזרת של אותה הודעה אינה מטופלת פעמיים", () => {
    const branch = source.slice(
      source.indexOf("looksLikeWhatsappLinkCode"),
      source.indexOf("const identified = await this.identifyUser("),
    );
    expect(branch).toContain("this.links.claimInbound(msg.externalId)");
    expect(branch.indexOf("claimInbound")).toBeLessThan(branch.indexOf("completeLink"));
  });

  it("והקישור נבדק לפני השוואת המספר", () => {
    const resolve = source.indexOf("this.links.resolve(");
    const byPhone = source.indexOf("this.identifyByPhone(");
    expect(resolve).toBeGreaterThan(0);
    expect(resolve).toBeLessThan(byPhone);
  });
});

/*
 * „הפעיל לאחרונה מנצח” היה ניחוש שקט ברשומות של מישהו אחר, והאזהרה
 * שנרשמה לצדו לא עצרה דבר. רק שני המשתמשים יודעים מי מהם מחזיק
 * במכשיר, ולכן ההכרעה חוזרת אליהם בדמות קוד.
 */
describe("ריבוי אינו מוכרע", () => {
  it("שני משתמשים עם אותו מספר אינם מזוהים לפי הטלפון", () => {
    const fn = source.slice(
      source.indexOf("private async identifyByPhone("),
      source.indexOf("private async loadUser("),
    );
    expect(fn).toContain("matched.length > 1");
    /*
     * ‎`NEEDS_LINK` ולא `null`: „לא מוכר” היה מגלגל את מי שהמערכת
     * דווקא מכירה למסלול המתעניין — עמוד מכירות, ורישום כליד.
     */
    expect(fn).toContain("return NEEDS_LINK");
    // והבחירה השקטה שהייתה כאן נמחקה
    expect(fn).not.toContain("נבחר ");
  });

  it("וחשבון שהושבת אינו מזוהה גם כשהקישור שלו קיים", () => {
    const fn = source.slice(source.indexOf("private async loadUser("));
    expect(fn).toContain("isActive: true");
  });
});

describe("הקוד עצמו", () => {
  it("הודעה רגילה אינה נחשבת לניסיון קישור", () => {
    expect(normalizeWhatsappLinkCode("מה יש לי ביומן")).toBeNull();
  });

  it("וקישור ישן נדרש לאימות מחדש", () => {
    const now = new Date("2026-08-25T00:00:00Z");
    const old = new Date(now.getTime() - (WHATSAPP_LINK_MAX_AGE_DAYS + 1) * 86_400_000);
    expect(linkNeedsReverification(old, now)).toBe(true);
  });
});

/*
 * הקישור הוא מפתח למאגר שלם, ולכן שינוי מספר הטלפון מנתק אותו:
 * מי שמעדכן מספר עשה זאת בדרך כלל כי החליף קו או מכשיר, ומי
 * שמחזיק עכשיו במספר הישן אינו אמור להישאר עם גישה.
 */
describe("החלפת מספר מנתקת", () => {
  const auth = readFileSync(
    new URL("../auth/auth.service.ts", import.meta.url),
    "utf8",
  );

  it("עדכון הפרופיל מנתק את הקישור כשהמספר השתנה", () => {
    expect(auth).toContain("phoneChanging");
    expect(auth).toContain('this.whatsappLinks.revoke(userId, "phone_changed", tx)');
  });

  it("והשוואה היא מול המספר הקודם, לא מול הקלט בלבד", () => {
    expect(auth).toContain("data.phone !== user.phone");
  });

  /*
   * שתי כתיבות נפרדות היו משאירות את הקישור פתוח כשהעדכון עבר
   * והניתוק נכשל — והניסיון החוזר כבר קורא את המספר החדש ולא מנתק.
   */
  it("והשתיים באותה עסקה", () => {
    const block = auth.slice(auth.indexOf("const phoneChanging"));
    const tx = block.indexOf("this.prisma.$transaction");
    const update = block.indexOf("tx.user.update");
    const revoke = block.indexOf("whatsappLinks.revoke");
    expect(tx).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(tx);
    expect(revoke).toBeGreaterThan(update);
  });
});

/*
 * הניתוק חייב לשרוד את ההודעה הבאה. שדה `phone` אינו משתנה בניתוק,
 * ולכן השוואת המספר הייתה בונה את הקישור מחדש — ומבטלת בשקט גם את
 * הניתוק היזום וגם את חובת האימות מחדש.
 */
describe("מצבה עוצרת את ההשוואה", () => {
  const link = readFileSync(
    new URL("./whatsapp-link.service.ts", import.meta.url),
    "utf8",
  );

  /*
   * הבדיקה יושבת בתוך `bind`, תחת הנעילה: מחוצה לה היא יכולה
   * להתיישן בדיוק כשזה קובע — ההודעה הראשונה מהמספר הישן קוראת
   * „אין קישור קודם”, הניתוק מסתיים, והצירוף כותב קישור פעיל
   * למכשיר שזה עתה נותק.
   */
  it("צירוף לפי מספר נבדק מול קישור קודם על אותו מספר, בתוך הנעילה", () => {
    const fn = link.slice(link.indexOf("private async bind("), link.indexOf("private async lock("));
    const lock = fn.indexOf("await this.lock(tx, userId)");
    const tombstone = fn.indexOf("source === SOURCE_PHONE");
    expect(lock).toBeGreaterThan(-1);
    expect(tombstone).toBeGreaterThan(lock);
    // בלי `revokedAt: null` — כל שורה שנמצאת שם היא מצבה
    expect(fn.slice(tombstone, fn.indexOf("updateMany"))).not.toContain("revokedAt: null");
  });

  it("והדחייה אינה מגלגלת למענה השיווקי", () => {
    expect(source).toContain("bound ? identified : NEEDS_LINK");
    const hint = source.indexOf("identified === NEEDS_LINK");
    const prospect = source.indexOf("await this.greetProspect(");
    expect(hint).toBeGreaterThan(0);
    expect(hint).toBeLessThan(prospect);
  });

  it("וקישור חדש מנתק גם מכשיר קודם של אותו משתמש", () => {
    const fn = link.slice(link.indexOf("private async bind("), link.indexOf("async resolve("));
    // המסך מבטיח „המכשיר שמחובר”, ביחיד — משני הכיוונים
    expect(fn).toContain("OR: [{ waIdHash }, { userId }]");
  });
});

/*
 * הניתוק שבקוד מספיק לרצף פעולות, לא לשתי בקשות מקבילות: שתיהן
 * מנתקות אפס שורות ושתיהן מוסיפות. האכיפה היא במסד, וההתאוששות
 * היא ניסיון שני שכבר רואה את השורה שנכתבה.
 */
describe("מכשיר אחד גם במקביל", () => {
  const link = readFileSync(
    new URL("./whatsapp-link.service.ts", import.meta.url),
    "utf8",
  );
  const migration = readFileSync(
    new URL("../../../prisma/migrations/20260825050000_whatsapp_links/migration.sql", import.meta.url),
    "utf8",
  );

  it("אינדקס ייחודי חלקי אוכף קישור פעיל אחד לכל חשבון", () => {
    expect(migration).toContain('CREATE UNIQUE INDEX "whatsapp_links_active_user_key"');
    expect(migration).toMatch(/whatsapp_links_active_user_key"\s*\n?\s*ON "whatsapp_links"\("user_id"\) WHERE "revoked_at" IS NULL/u);
  });

  it("ומרוץ נפתר בניסיון שני ולא בשגיאה למשתמש", () => {
    const fn = link.slice(link.indexOf("private async bind("), link.indexOf("async resolve("));
    expect(fn).toContain('error.code !== "P2002"');
    expect(fn).toContain("await write()");
  });

  it("והנפקת קוד מחליפה מצביע באטומיות — לא שני קודים תקפים", () => {
    const fn = link.slice(link.indexOf("async issueCode("), link.indexOf("async redeemCode("));
    // הקוד נכתב לפני החלפת המצביע, וההחלפה עצמה היא GETSET
    expect(fn.indexOf("wa-link:code:${codeHmac}")).toBeLessThan(fn.indexOf("getset("));
    expect(fn).not.toContain("getdel(");
  });

  /*
   * שני משתמשים יכולים להגריל את אותן שש אותיות. כתיבה גורפת הייתה
   * מעבירה את הבעלות על הקוד לשני, והראשון היה מקשר את המכשיר שלו
   * לחשבון שאינו שלו.
   */
  it("וקוד שכבר תפוס אינו נגזל — מגרילים מחדש", () => {
    const fn = link.slice(link.indexOf("async issueCode("), link.indexOf("async redeemCode("));
    expect(fn).toContain('"NX"');
    expect(fn).toContain('claimed === "OK"');
    expect(fn).toContain("ServiceUnavailableException");
  });

  /*
   * מחיקה גורפת של המצביע פתחה מחדש את אותו חלון: קוד שהונפק בין
   * מחיקת הקוד למחיקת המצביע היה מאבד את המצביע שלו, וההנפקה
   * הבאה כבר לא הייתה יודעת לבטל אותו.
   */
  /*
   * ניצול קוד וניתוק יכלו לחצות זה את זה: הניתוק כותב את הביטול
   * ואינו רואה קוד ממתין, והניצול — שכבר לקח את הקוד — מוסיף שורה
   * חדשה רגע אחריו. הנעילה מכניסה את שניהם לתור, והחותמת היא מה
   * שאומר לניצול שהקוד שלו קדם לניתוק.
   */
  it("וקישור וניתוק נכנסים לתור על אותו חשבון", () => {
    const bind = link.slice(link.indexOf("private async bind("), link.indexOf("private async lock("));
    expect(bind).toContain("await this.lock(tx, userId)");
    expect(bind).toContain("this.revokedSince(userId, issuedAt)");
    const revoke = link.slice(link.indexOf("private async revokeWithin("));
    expect(revoke).toContain("await this.lock(tx, userId)");
    // החותמת נכתבת לפני הכתיבה במסד, בתוך הנעילה
    expect(revoke.indexOf("wa-link:revoked:")).toBeLessThan(revoke.indexOf("updateMany"));
  });

  it("והקוד נושא את מועד ההפקה שלו", () => {
    const issue = link.slice(link.indexOf("async issueCode("), link.indexOf("async redeemCode("));
    expect(issue).toContain("issuedAt: Date.now()");
  });

  /*
   * בלי הנעילה, הנפקה שרצה במקביל לניתוק יכלה לכתוב קוד אחרי
   * החותמת ולהתקין מצביע אחרי שהניתוק חיפש אותו — קוד ששרד ניתוק
   * שהצליח, ותקף בעיני הבדיקה כי הוא חדש מהחותמת.
   */
  it("וגם ההנפקה נכנסת לתור", () => {
    const issue = link.slice(link.indexOf("async issueCode("), link.indexOf("private async writeCode("));
    expect(issue).toContain("await this.lock(tx, userId)");
    expect(issue).toContain("this.writeCode(tenantId, userId)");
  });

  it("וניצול קוד מוחק את המצביע רק כשהוא עדיין שלו", () => {
    const fn = link.slice(link.indexOf("async redeemCode("), link.indexOf("private async bind("));
    expect(fn).toContain("redis.eval(");
    expect(fn).toContain("redis.call('GET', KEYS[1]) == ARGV[1]");
    // והמחיקה הגורפת של המצביע איננה עוד
    expect(fn).not.toContain("del(`wa-link:user:${claim.userId}`");
  });
});

/*
 * אותו שינוי, מסך אחר: בעל המשרד מעדכן את מספר הסוכן מניהול הצוות.
 * בלי הניתוק המכשיר שמחזיק במספר הישן ממשיך להיפתר לחשבון הסוכן.
 */
describe("גם החלפת מספר בידי בעל המשרד מנתקת", () => {
  const settings = readFileSync(
    new URL("../settings/settings.controller.ts", import.meta.url),
    "utf8",
  );

  it("עדכון סוכן מניהול הצוות מנתק את הקישור, באותה טרנזקציה", () => {
    const route = settings.slice(settings.indexOf("pg_advisory_xact_lock"));
    const update = route.indexOf("tx.user.update");
    const revoke = route.indexOf('this.whatsappLinks.revoke(id, "phone_changed", tx)');
    expect(revoke).toBeGreaterThan(update);
    expect(route).toContain("nextPhone !== target.phone");
  });
});
