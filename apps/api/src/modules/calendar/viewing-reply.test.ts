import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseViewingReminderReply,
  viewingReminderQuickReplies,
  viewingReminderReplyPayload,
  VIEWING_REMINDER_REPLY_ORDER,
} from "@metavchim/shared";

/**
 * ‎**התשובה של הלקוח לתזכורת — משליחת הכפתור ועד רישום התשובה.**
 *
 * ‏רוב מה שנשבר כאן נשבר **בשקט**: מטען שאינו מפוענח, לחיצה
 * שנזרקת בנתיב הקליטה, או בדיקה שמישהו יסיר „כי היא מיותרת”.
 */

const read = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

const INBOUND = read("../messaging/whatsapp-inbound.service.ts");
const REPLY = read("./viewing-reply.service.ts");
const REMINDER = read("./viewing-reminder.service.ts");

describe("מטען הכפתור", () => {
  it("הלוך ושוב", () => {
    const payload = viewingReminderReplyPayload("01TEN", "01ABC", 1770000000000, "reschedule");
    expect(parseViewingReminderReply(payload)).toEqual({
      tenantId: "01TEN",
      appointmentId: "01ABC",
      startsAtMs: 1770000000000,
      reply: "reschedule",
    });
  });

  /* מטען שאינו שלנו אינו „ברירת מחדל” — הוא לא-תשובה */
  it("מטען זר אינו מפוענח", () => {
    expect(parseViewingReminderReply("mv:confirm:01ABC")).toBeNull();
    expect(parseViewingReminderReply("vr:01TEN:01ABC:confirmed")).toBeNull();
    expect(parseViewingReminderReply("vr::01ABC:1770000000000:confirmed")).toBeNull();
    expect(parseViewingReminderReply("vr:01TEN:01ABC:1770000000000:maybe")).toBeNull();
    // מועד שאינו מספר — לחיצה על מטען פגום אינה „מועד 0”
    expect(parseViewingReminderReply("vr:01TEN:01ABC:soon:confirmed")).toBeNull();
  });

  /*
   * ‎**הסדר הוא חוזה מול Meta.** המטען נשלח לפי אינדקס, ולכן היפוך
   * הסדר כאן הופך „אישרתי” ל„צריך לשנות” בלי ששום דבר ייכשל.
   */
  it("אישור ראשון, שינוי מועד שני", () => {
    expect(VIEWING_REMINDER_REPLY_ORDER).toEqual(["confirmed", "reschedule"]);
    const [first, second] = viewingReminderQuickReplies("01TEN", "01ABC", 1770000000000);
    expect(first?.index).toBe("0");
    expect(first?.parameters[0].payload).toBe("vr:01TEN:01ABC:1770000000000:confirmed");
    expect(second?.index).toBe("1");
    expect(second?.parameters[0].payload).toBe("vr:01TEN:01ABC:1770000000000:reschedule");
  });

  /* ‎`quick_reply` ולא `url` — רכיב אחר לגמרי אצל Meta */
  it("הרכיב הוא תשובה מהירה", () => {
    const [first] = viewingReminderQuickReplies("01TEN", "01ABC", 1770000000000);
    expect(first?.sub_type).toBe("quick_reply");
    expect(first?.parameters[0].type).toBe("payload");
  });
});

describe("קליטת הלחיצה", () => {
  /*
   * ‎**לפני ניתוב הקווים — וזה כל ההבדל בין עובד ללא עובד**
   * (ביקורת Codex, P1).
   *
   * ‏התזכורת יוצאת דרך `WhatsAppSendService`, שמחזיק זוג אישורים
   * **אחד**: הקו של הפלטפורמה. כלומר הלחיצה חוזרת בדיוק לקו שבו
   * יושב הסוכן האישי, וענף הסוכן בולע כל הודעה שמגיעה לשם ומסיים
   * ב-`continue`. טיפול שיושב אחריו לא נקרא לעולם — הלחיצה מגיעה
   * לסוכן כאילו מתווך כתב לו, והתשובה נעלמת.
   */
  it("הלחיצה נקראת לפני שענף הסוכן בולע את ההודעה", () => {
    const recordAt = INBOUND.indexOf("this.viewingReplies.record(");
    const assistantAt = INBOUND.indexOf("this.assistant.handle(");
    expect(recordAt).toBeGreaterThan(-1);
    expect(assistantAt).toBeGreaterThan(-1);
    expect(
      recordAt,
      "ענף הסוכן מסיים ב-continue, ולכן טיפול שאחריו אינו רץ",
    ).toBeLessThan(assistantAt);
  });

  /* השדה `button` הוא מה שנושא את המטען; בלעדיו zod משמיט אותו */
  it("הסכימה מקבלת את שדה הכפתור", () => {
    expect(INBOUND).toContain("button: z");
    expect(INBOUND).toContain("payload: z.string()");
  });
});

describe("רישום התשובה", () => {
  /*
   * ‎**רק נמען אמיתי של הסיור.** המטען מגיע מבחוץ, ומי שמחזיק מטען
   * של סיור אחד יכול היה לסמן „אישרתי” על סיור של אדם אחר.
   */
  it("השולח נבדק מול נמעני הסיור", () => {
    expect(REPLY).toContain("this.contacts.findByAnyPhone(tx, fromPhone)");
    expect(REPLY).toContain("allowed.has(sender.id)");
  });

  /*
   * ‎**כל שלושת השדות שהמאתר קורא.**
   *
   * ‎`viewingReminderOccupantContactId` מחזיר את הדייר רק בנכס
   * מושכר ונופל לבעלים בכל השאר, ושלושת שדותיו אופציונליים —
   * ‎`select` חלקי עובר הידור ומחזיר `null`. בעל נכס שלוחץ על
   * הכפתור היה נדחה כ„אינו נמען” והתשובה נזרקת בשקט (ביקורת עצמית).
   */
  it("מאתר הנמען מקבל גם את הבעלים", () => {
    expect(REPLY).toContain(
      "select: { occupantContactId: true, occupancy: true, ownerContactId: true },",
    );
  });

  /*
   * ‎**הלחיצה שייכת למועד שעליו נשאלה** (ביקורת Codex, P1).
   *
   * ההודעה נשארת בצ'אט לנצח והכפתורים חיים. לחיצה על תזכורת ישנה
   * אחרי דחייה הייתה מסמנת אישור על מועד שהלקוח לא ראה.
   */
  it("מועד שזז פוסל את הלחיצה", () => {
    expect(REPLY).toContain(
      "appointment.startsAt.getTime() !== parsed.startsAtMs",
    );
  });

  /*
   * ‎**העדכון עצמו הוא המנעול** (ביקורת Codex, P2).
   *
   * קריאה ואז כתיבה אינן אטומיות: וובהוק חוזר במקביל, או לחיצה
   * כפולה מהירה, היו נקראים שניהם לפני שאחד כתב — ושתי התראות
   * היו יוצאות.
   */
  it("הכפילות נמנעת בעדכון עצמו ולא בקריאה שלפניו", () => {
    expect(REPLY).toContain("const claimed = await tx.appointment.updateMany({");
    expect(REPLY).toContain("reminderReply: { not: parsed.reply }");
    expect(REPLY, "בלי הבדיקה הזו שתי בקשות מקבילות שתיהן ממשיכות").toContain(
      "if (claimed.count !== 1) return;",
    );
  });

  /*
   * ‎**„צריך לשנות” פותח משימה; „אישרתי” לא.** התראה נקראת ונעלמת,
   * והמועד נשאר ביומן — אבל משימה על „אישרתי” היא רעש שמלמד
   * להתעלם מהרשימה.
   */
  it("רק בקשה לשנות מועד פותחת משימה", () => {
    expect(REPLY).toContain('parsed.reply === "reschedule" && assignee !== null');
    /*
     * ‎**המפתח נושא גם את המועד** (ביקורת Codex, P2). מפתח לכל
     * הסיור היה חד-פעמי לתמיד: אחרי שהבקשה הראשונה טופלה והמשימה
     * הושלמה, בקשה שנייה מהתזכורת החדשה הייתה מוצאת את המשימה
     * המושלמת ולא פותחת דבר.
     */
    expect(REPLY).toContain(
      "`viewing-reschedule:${appointment.id}:${parsed.startsAtMs}`",
    );
  });

  /*
   * ‎**אינו זורק.** הקורא הוא הוובהוק של Meta; שגיאה שעולה משם
   * מחזירה שאינו-200, ו-Meta שולחת שוב — בלולאה.
   */
  it("כשל אינו עולה אל הוובהוק", () => {
    expect(REPLY).toContain("} catch (error) {");
  });
});

describe("שליחת הכפתורים", () => {
  /*
   * ‎**רק לתבנית שנרשמה איתם.** תבנית בלי כפתורים שמקבלת רכיבי
   * כפתור נדחית — ואז אין תזכורת בכלל, לא רק „בלי כפתורים”.
   */
  it("הכפתורים מותנים בהגדרה", () => {
    expect(REMINDER).toContain(
      'this.settings.get("whatsappViewingReminderTemplateButtons")) === "true"',
    );
    expect(REMINDER).toContain("viewingReminderQuickReplies(tenantId, appointmentId, startsAtMs)");
  });
});
