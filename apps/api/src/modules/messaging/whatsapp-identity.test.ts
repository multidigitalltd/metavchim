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
    // מנורמל: „050-1234567” ו„0501234567” הם אותו מספר, לא החלפה
    expect(auth).toContain('normalizePhone(phoneIncoming ?? "") !== normalizePhone(current?.phone ?? "")');
  });

  /*
   * שתי כתיבות נפרדות היו משאירות את הקישור פתוח כשהעדכון עבר
   * והניתוק נכשל — והניסיון החוזר כבר קורא את המספר החדש ולא מנתק.
   */
  it("והשתיים באותה עסקה", () => {
    const block = auth.slice(auth.indexOf("const phoneIncoming"));
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

  /*
   * מתווך שקישר מכשיר בקוד בזמן שבפרופיל רשום מספר אחר לא הותיר
   * מצבה על המספר ההוא — והודעה ראשונה ממנו הייתה מנתקת את המכשיר
   * שאושר בקוד ותופסת את מקומו.
   */
  it("וגם היסטוריה של החשבון עוצרת את הצירוף, לא רק של המספר", () => {
    const fn = link.slice(link.indexOf("private async bind("), link.indexOf("private async lock("));
    expect(fn).toContain("where: { OR: [{ waIdHash }, { userId }] }");
  });

  /*
   * המצבה לבדה אינה מספיקה: חשבון שלא היה מקושר מעולם אינו מותיר
   * שורה כשמנתקים אותו, ולכן החלפת מספר עליו עוברת בלי עקבות —
   * והודעה ראשונה מהמספר הישן, שעברה את הזיהוי רגע לפני ההחלפה,
   * הייתה נקשרת אחריה.
   */
  it("והמספר נבדק מול הפרופיל העדכני, מתוך הנעילה", () => {
    const fn = link.slice(link.indexOf("private async bind("), link.indexOf("private async lock("));
    expect(fn).toContain("phoneDigitsCondition(digits)");
    expect(fn).toContain("SELECT id FROM users");
    expect(fn.indexOf("phoneDigitsCondition")).toBeGreaterThan(
      fn.indexOf("await this.lock(tx, userId)"),
    );
  });

  /*
   * אותה השוואה בדיוק משמשת את הזיהוי ואת הכתיבה. שני עותקים שלה
   * היו נפרדים ביום שבו אחד מהם יתוקן — וזו ההשוואה שקובעת למי
   * נפתח המאגר.
   */
  it("וההשוואה עצמה משותפת לזיהוי ולכתיבה", () => {
    expect(source).toContain('from "./phone-match"');
    expect(link).toContain('from "./phone-match"');
    expect(source).not.toContain("regexp_replace(phone");
    expect(link).not.toContain("regexp_replace(phone");
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
    expect(bind).toContain("(await this.generation(userId)) !== generation");
    const revoke = link.slice(link.indexOf("private async revokeWithin("));
    expect(revoke).toContain("await this.lock(tx, userId)");
    // החותמת נכתבת לפני הכתיבה במסד, בתוך הנעילה
    expect(revoke.indexOf("bumpGeneration")).toBeLessThan(revoke.indexOf("updateMany"));
  });

  /*
   * שעון אינו סדר: שתי פעולות באותה מילישנייה נראות „בו-זמניות”,
   * והפרשי שעונים בין תהליכים יכולים אפילו להפוך את היחס. הדור
   * מקודד בדיוק את הסדר שהנעילה כבר קבעה.
   */
  it("והקוד נושא את הדור שבו הופק — לא שעה", () => {
    const issue = link.slice(link.indexOf("async issueCode("), link.indexOf("async redeemCode("));
    expect(issue).toContain("this.bumpGeneration(userId)");
    expect(issue).toContain("JSON.stringify({ tenantId, userId, generation })");
    expect(issue).not.toContain("Date.now()");
    const revoke = link.slice(link.indexOf("private async revokeWithin("));
    expect(revoke).toContain("this.bumpGeneration(userId)");
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
/*
 * שלוש נקודות שבהן „הקישור אמור לחדול” נבדקות יחד, כי כל אחת מהן
 * נשברת בשקט: הנפקה שאינה מבטלת קוד קודם, השבתת חשבון שמשאירה
 * מכשיר מחובר, ושינוי עיצוב של מספר שנקרא כהחלפה.
 */
/*
 * שתי הכרעות שנקראו מחוץ לנעילה, ולכן יכלו להתיישן בדיוק כשזה
 * קובע: „האם הקישור עדיין קיים” בזיהוי, ו„האם המספר השתנה” בעדכון.
 */
describe("ההכרעה נקראת מתוך הנעילה", () => {
  const link = readFileSync(
    new URL("./whatsapp-link.service.ts", import.meta.url),
    "utf8",
  );
  const auth = readFileSync(
    new URL("../auth/auth.service.ts", import.meta.url),
    "utf8",
  );

  it("זיהוי מאמת שהקישור לא נותק בין הקריאה לתשובה", () => {
    const fn = link.slice(link.indexOf("async resolve("), link.indexOf("async bindByPhone("));
    // העדכון עצמו הוא האימות: אפס שורות = הקישור כבר אינו
    expect(fn).toContain("where: { id: link.id, revokedAt: null }");
    expect(fn).toContain("if (touched.count === 0) return null");
  });

  it("ועדכון הפרופיל קורא את המספר הנוכחי מתוך הנעילה", () => {
    const block = auth.slice(auth.indexOf("const phoneIncoming"));
    const lock = block.indexOf("lockAccount(tx, userId)");
    const read = block.indexOf("tx.user.findUnique");
    expect(lock).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(lock);
  });
});

describe("החלפה היא ביטול", () => {
  const link = readFileSync(
    new URL("./whatsapp-link.service.ts", import.meta.url),
    "utf8",
  );

  it("הנפקת קוד חדש מבטלת ניצול של קוד קודם שעוד באוויר", () => {
    const issue = link.slice(link.indexOf("async issueCode("), link.indexOf("async redeemCode("));
    // ההנפקה מקדמת את הדור, ולכן קוד שהופק לפניה כבר אינו תואם
    expect(issue).toContain("this.bumpGeneration(userId)");
  });
});

describe("גם החלפת מספר בידי בעל המשרד מנתקת", () => {
  const settings = readFileSync(
    new URL("../settings/settings.controller.ts", import.meta.url),
    "utf8",
  );

  /*
   * מחיקת ה-Session נעשתה תמיד; הקישור בוואטסאפ שרד. ההודעות נחסמו
   * רק משום ש-`loadUser` דורש חשבון פעיל — וברגע שהחשבון הופעל
   * מחדש, המכשיר הישן חזר לגישה מלאה בלי לאמת דבר.
   */
  it("והשבתת חשבון מנתקת את המכשיר, כמו את הדפדפן", () => {
    const route = settings.slice(settings.indexOf("pg_advisory_xact_lock"));
    expect(route).toContain("phoneChanging || body.isActive === false");
  });

  it("ושינוי עיצוב בלבד אינו נחשב להחלפת מספר", () => {
    const route = settings.slice(settings.indexOf("pg_advisory_xact_lock"));
    expect(route).toContain("normalizePhone(nextPhone");
    const auth = readFileSync(new URL("../auth/auth.service.ts", import.meta.url), "utf8");
    expect(auth).toContain("normalizePhone(phoneIncoming");
  });

  it("עדכון סוכן מניהול הצוות מנתק את הקישור, באותה טרנזקציה", () => {
    const route = settings.slice(settings.indexOf("pg_advisory_xact_lock"));
    const update = route.indexOf("tx.user.update");
    const revoke = route.indexOf("this.whatsappLinks.revoke(id,");
    expect(revoke).toBeGreaterThan(update);
    expect(route).toContain("normalizePhone(target.phone");
  });
});

/*
 * הזיהוי מסרב להכריע כששני חשבונות מחזיקים באותו מספר — אבל הוא
 * בדק זאת מחוץ לתור. הקצאת המספר לחשבון שני קורית על **חשבון אחר**,
 * ולכן הנעילה לפי חשבון אינה פוגשת אותה: היא יכולה להיכנס בדיוק בין
 * הבדיקה לכתיבה, והתוצאה היא קישור שקט לאחד משניים — בזמן שהמסלול
 * הרגיל היה עוצר.
 */
describe("„בדיוק אחד” נבדק שוב, ובתוך התור של המספר", () => {
  const link = readFileSync(new URL("./whatsapp-link.service.ts", import.meta.url), "utf8");
  const bind = link.slice(link.indexOf("private async bind("), link.indexOf("private async lock("));

  it("הצירוף סופר את כל בעלי המספר, לא את ההתאמה שלו", () => {
    // בלי סינון לפי המשתמש — אחרת „עדיין שלו” עונה כן גם בריבוי
    expect(bind).not.toContain("WHERE id = ${userId}");
    expect(bind).toContain("LIMIT 2");
    expect(bind).toContain("matches.length !== 1");
    expect(bind).toContain("matches[0]?.id !== userId");
  });

  it("והספירה נעשית אחרי נעילת המספר", () => {
    const lockPhone = bind.indexOf("await this.lockPhone(tx, digits)");
    const count = bind.indexOf("SELECT id FROM users");
    expect(lockPhone).toBeGreaterThan(-1);
    expect(count).toBeGreaterThan(lockPhone);
  });

  it("ונעילת המספר היא לפי צורה אחת לשתי הצורות", () => {
    const phoneMatch = readFileSync(new URL("./phone-match.ts", import.meta.url), "utf8");
    expect(phoneMatch).toContain("export function phoneLockKey");
    expect(link).toContain("hashtext(${`wa-phone:${key}`})");
  });

  it("וגם מי שכותב מספר נכנס לאותו תור — בפרופיל ובניהול הצוות", () => {
    const auth = readFileSync(new URL("../auth/auth.service.ts", import.meta.url), "utf8");
    const profile = auth.slice(auth.indexOf("lockAccount(tx, userId)"));
    expect(profile.indexOf("lockPhone(tx, phoneIncoming)")).toBeLessThan(
      profile.indexOf("tx.user.update"),
    );
    const settings = readFileSync(
      new URL("../settings/settings.controller.ts", import.meta.url),
      "utf8",
    );
    const route = settings.slice(settings.indexOf("this.whatsappLinks.lockAccount(tx, id)"));
    expect(route.indexOf("lockPhone(tx, nextPhone)")).toBeLessThan(route.indexOf("tx.user.update"));
  });
});

/*
 * ‎`INCR` ואחריו `EXPIRE` הם שתי פקודות. נפילה ביניהן מותירה מונה
 * בלי תפוגה — ואחרי חמישה ניסיונות המספר הזה חסום לתמיד.
 */
describe("מונה הניסיונות אינו יכול להישאר בלי תפוגה", () => {
  const link = readFileSync(new URL("./whatsapp-link.service.ts", import.meta.url), "utf8");
  const redeem = link.slice(link.indexOf("async redeemCode("), link.indexOf("async claimInbound("));

  it("הספירה והתפוגה נקבעות בפעולה אחת", () => {
    expect(redeem).not.toContain("this.redis.incr(attemptsKey)");
    const script = redeem.slice(redeem.indexOf("attemptsKey"), redeem.indexOf("attemptNo >"));
    expect(script).toContain("this.redis.eval");
    expect(script).toContain("INCR");
    expect(script).toContain("EXPIRE");
  });

  it("ומונה שנשאר בלי תפוגה מתוקן בניסיון הבא", () => {
    expect(redeem).toContain("TTL");
    expect(redeem).toContain("< 0");
  });
});

/*
 * הכפתור היה מותנה בחיבור קיים, ולכן מי שהפיק קוד ולא שלח אותו נשאר
 * בלי דרך לבטל אותו עד שיפוג — רבע שעה שבה קוד שנחשף עדיין תקף.
 */
describe("קוד ממתין אפשר לבטל גם בלי מכשיר מחובר", () => {
  const section = readFileSync(
    new URL("../../../../web/src/app/profile/whatsapp-link-section.tsx", import.meta.url),
    "utf8",
  );

  it("הפעולה מוצעת גם כשאין קישור פעיל", () => {
    expect(section).toContain('status?.linked === true || code !== null ? (');
    expect(section).toContain("לבטל את הקוד");
  });

  it("והיא אותה בקשה שמנתקת — הניתוק שורף גם קוד פתוח", () => {
    const revoke = section.slice(section.indexOf("function revokeLink("));
    expect(revoke).toContain('apiDelete("/settings/whatsapp-link")');
    expect(revoke).toContain("✓ הקוד בוטל");
  });
});
