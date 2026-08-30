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
    const payload = viewingReminderReplyPayload("01ABC", "reschedule");
    expect(parseViewingReminderReply(payload)).toEqual({
      appointmentId: "01ABC",
      reply: "reschedule",
    });
  });

  /* מטען שאינו שלנו אינו „ברירת מחדל” — הוא לא-תשובה */
  it("מטען זר אינו מפוענח", () => {
    expect(parseViewingReminderReply("mv:confirm:01ABC")).toBeNull();
    expect(parseViewingReminderReply("vr:01ABC")).toBeNull();
    expect(parseViewingReminderReply("vr::confirmed")).toBeNull();
    expect(parseViewingReminderReply("vr:01ABC:maybe")).toBeNull();
  });

  /*
   * ‎**הסדר הוא חוזה מול Meta.** המטען נשלח לפי אינדקס, ולכן היפוך
   * הסדר כאן הופך „אישרתי” ל„צריך לשנות” בלי ששום דבר ייכשל.
   */
  it("אישור ראשון, שינוי מועד שני", () => {
    expect(VIEWING_REMINDER_REPLY_ORDER).toEqual(["confirmed", "reschedule"]);
    const [first, second] = viewingReminderQuickReplies("01ABC");
    expect(first?.index).toBe("0");
    expect(first?.parameters[0].payload).toBe("vr:01ABC:confirmed");
    expect(second?.index).toBe("1");
    expect(second?.parameters[0].payload).toBe("vr:01ABC:reschedule");
  });

  /* ‎`quick_reply` ולא `url` — רכיב אחר לגמרי אצל Meta */
  it("הרכיב הוא תשובה מהירה", () => {
    const [first] = viewingReminderQuickReplies("01ABC");
    expect(first?.sub_type).toBe("quick_reply");
    expect(first?.parameters[0].type).toBe("payload");
  });
});

describe("קליטת הלחיצה", () => {
  /*
   * ‎**לפני מסנן הטקסט, אחרת היא נזרקת.**
   *
   * ‏`if (message.type !== "text") continue` היה הראשון בלולאה,
   * ולחיצה על כפתור תבנית מגיעה כ-`type: "button"` — כלומר התשובה
   * נעלמה בלי זכר. הסדר בין שתי השורות הוא כל התכונה.
   */
  it("הכפתור נבדק לפני שהלולאה זורקת מה שאינו טקסט", () => {
    const buttonAt = INBOUND.indexOf('message.type === "button"');
    const textFilter = INBOUND.indexOf('if (message.type !== "text"');
    expect(buttonAt).toBeGreaterThan(-1);
    expect(textFilter).toBeGreaterThan(-1);
    expect(buttonAt, "מסנן הטקסט זורק את הלחיצה לפני שמישהו קרא אותה").toBeLessThan(
      textFilter,
    );
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

  /* וובהוק חוזר ולחיצה כפולה אינם שתי תשובות */
  it("תשובה זהה אינה אירוע נוסף", () => {
    expect(REPLY).toContain("appointment.reminderReply === parsed.reply");
  });

  /*
   * ‎**„צריך לשנות” פותח משימה; „אישרתי” לא.** התראה נקראת ונעלמת,
   * והמועד נשאר ביומן — אבל משימה על „אישרתי” היא רעש שמלמד
   * להתעלם מהרשימה.
   */
  it("רק בקשה לשנות מועד פותחת משימה", () => {
    expect(REPLY).toContain('parsed.reply === "reschedule" && assignee !== null');
    expect(REPLY).toContain("viewing-reschedule:");
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
    expect(REMINDER).toContain("withButtons ? viewingReminderQuickReplies(appointmentId)");
  });
});
