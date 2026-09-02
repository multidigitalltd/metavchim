import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * ‎**דו-קיום: הקו של המשרד, והמתווך שממשיך לענות מהטלפון** (docs/12).
 *
 * ## למה הבדיקות כאן מבניות
 *
 * מה שנשבר בפיצ'ר הזה אינו חישוב — אין כאן פונקציה טהורה להאכיל.
 * מה שנשבר הוא **סדר** ו**נוכחות** בזרימת הוובהוק: ענף שהוזז אחרי
 * הענף שבולע הכול, קריאה שנשמטה, שדה שלא נקרא. כל אחד מהם משאיר
 * מערכת שעולה, עוברת קומפילציה, ונכשלת **בשקט** — בדיוק סוג הכשל
 * שהמשתמש חווה כ„זה פשוט לא עובד” ואנחנו כ„אין שגיאה בלוג”.
 *
 * הצד השני (Meta) אינו בריפו ואי אפשר להריץ אותו, ולכן מה שאפשר
 * לקבע הוא שהקוד שלנו מרכיב את הזרימה כפי שהיא הוגדרה.
 */

const read = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

const INBOUND = read("./whatsapp-inbound.service.ts");
const CONNECTION = read("./whatsapp-connection.service.ts");
const WEBHOOK = read("./whatsapp-webhook.controller.ts");

/**
 * ‎**אפליקציית חיבור נפרדת מזו של קו הסוכן.**
 *
 * הפרדה לגיטימית ואף רצויה ב-Meta: חסימה של אפליקציה אחת אינה מפילה
 * את השנייה. אבל אז שתי אפליקציות מצביעות על אותו Webhook וכל אחת
 * חותמת בסוד משלה, ו-Meta מחליפה `code` לטוקן רק מול הצמד
 * ‎`app_id`+`app_secret` של אותה אפליקציה. שתי הנקודות האלה נכשלות
 * **בשקט**: הראשונה כ-401 על כל הודעה מהאפליקציה השנייה, השנייה
 * כשגיאת אימות של Meta שאינה מרמזת על הסיבה.
 */
describe("אפליקציית חיבור נפרדת", () => {
  it("אימות החתימה מנסה את שני הסודות ולא אחד", () => {
    expect(WEBHOOK).toContain('this.platformSettings.get("whatsappConnectAppSecret")');
    // ‏`some` על רשימת סודות — לא השוואה יחידה שנועלת אפליקציה אחת
    expect(WEBHOOK).toMatch(/secrets\.some\(/u);
  });

  it("הסוד לנפילה חוזרת הוא של אפליקציה אחת, כך שהתקנה קיימת אינה נשברת", () => {
    const connect = WEBHOOK.indexOf('"whatsappConnectAppSecret"');
    const shared = WEBHOOK.indexOf('"whatsappAppSecret"');
    expect(connect).toBeGreaterThan(0);
    expect(shared).toBeGreaterThan(0);
  });

  /*
   * ‎`appId` בא מ-`whatsappAppId` — של אפליקציית החיבור. צירופו עם
   * הסוד של האפליקציה השנייה נדחה ב-Meta, ולכן הסוד הייעודי חייב
   * להיקרא **לפני** המשותף.
   */
  it("המרת הקוד מעדיפה את הסוד של אפליקציית החיבור", () => {
    const connect = CONNECTION.indexOf('"whatsappConnectAppSecret"');
    const shared = CONNECTION.indexOf('"whatsappAppSecret"');
    expect(connect).toBeGreaterThan(0);
    expect(shared).toBeGreaterThan(connect);
  });
});

describe("ניתוב הודעה נכנסת לקו של משרד", () => {
  /*
   * ‎`phone_number_id` הוא מפתח יציב על אינדקס ייחודי; המספר המוצג
   * חוזר מ-Meta בפורמטים שונים. היפוך הסדר היה מחזיר את הניתוב
   * להשוואת מחרוזות — כלומר לכשל השקט שהחיבור נועד לסלק.
   */
  it("החיבור לפי מזהה הקו קודם להשוואת המספר המוצג", () => {
    const byLine = INBOUND.indexOf("this.connections.byPhoneNumberId(");
    const byNumber = INBOUND.indexOf("await this.resolveTenant(businessNumber)");
    expect(byLine).toBeGreaterThan(0);
    expect(byNumber).toBeGreaterThan(0);
    expect(byLine).toBeLessThan(byNumber);
  });

  /*
   * ‎**המסלול הישן חייב לשרוד.** משרדים שהוגדרו לפני החיבור העצמאי
   * מזוהים לפי מספר שהוקלד בהגדרות, ומחיקת ה-Fallback הייתה מנתקת
   * אותם ביום הפריסה בלי ששום בדיקה אחרת תרגיש.
   */
  it("ומשרד שהוגדר ידנית ממשיך להיות מזוהה", () => {
    expect(INBOUND).toContain("private async resolveTenant(businessNumber: string)");
    expect(INBOUND).toMatch(/connection\?\.tenantId \?\?/u);
  });

  /*
   * הקו נבחר לפי החיבור, ולכן השיחה שנפתחת חייבת להיות של אותו קו:
   * חלון 24 השעות הוא פר-קו-ופר-לקוח, ולא פר-משרד.
   */
  it("וחלון 24 השעות נפתח על השיחה של אותו קו", () => {
    const ingest = INBOUND.slice(INBOUND.indexOf("private async ingestMessage("));
    expect(ingest).toContain("whatsAppConversation.upsert");
    expect(ingest).toContain("lastInboundAt");
  });
});

describe("הד — המתווך ענה מהאפליקציה בטלפון", () => {
  /*
   * ‎**הענף חייב לקדום ללולאת ההודעות.** מתחתיו יושב ענף הסוכן
   * האישי שמסתיים ב-`continue` על כל מה שמגיע לקו שלו, ולולאת
   * ההודעות שמתחתיו מדלגת על כל מה שאינו `messages`. הד שהיה מגיע
   * לשם היה נבלע — בדיוק התקלה שכבר קרתה פעם עם לחיצות כפתור.
   */
  it("ההדים מטופלים לפני ניתוב הקווים ולולאת ההודעות", () => {
    const echoes = INBOUND.indexOf("value.message_echoes?.length");
    const assistant = INBOUND.indexOf("assistantCreds !== null &&");
    const loop = INBOUND.indexOf("for (const message of value.messages)");
    expect(echoes).toBeGreaterThan(0);
    expect(echoes).toBeLessThan(assistant);
    expect(echoes).toBeLessThan(loop);
  });

  /*
   * ‎**שתי הפעולות, ושתיהן.** רישום בלי השתקה = הבוט עונה על גבי
   * המתווך; השתקה בלי רישום = ההיסטוריה במערכת חסרה בדיוק את מה
   * שהמתווך כתב. אחת בלי השנייה היא חצי פיצ'ר שנראה שלם.
   */
  it("ההד נרשם בציר הזמן ומשתיק את הבוט", () => {
    const handler = INBOUND.slice(
      INBOUND.indexOf("private async handleEchoes("),
      INBOUND.indexOf("private async resolveTenant("),
    );
    expect(handler).toContain('provider: "coexistence_echo"');
    expect(handler).toContain("botPausedUntil");
    expect(handler, "הד חוזר פעמיים מ-Meta כמו כל מטען אחר").toContain("providerMessageId: echoId");
  });

  /*
   * הד הוא הודעה **יוצאת** של המשרד. סימונה כנכנסת היה הופך כל
   * תשובה של המתווך לפנייה חדשה של הלקוח בציר הזמן.
   */
  it("ונרשם ככיוון יוצא", () => {
    const handler = INBOUND.slice(
      INBOUND.indexOf("private async handleEchoes("),
      INBOUND.indexOf("private async resolveTenant("),
    );
    expect(handler).toContain('direction: "out"');
  });
});

describe("עדכון חשבון מ-Meta", () => {
  /*
   * מתווך יכול לנתק את החיבור מהטלפון בכל רגע. בלי הענף הזה החיבור
   * היה נשאר „מחובר” אצלנו לנצח, והמסך היה משקר.
   */
  it("ניתוק שהמתווך עשה מהטלפון מעדכן את החיבור", () => {
    expect(INBOUND).toContain('change.field === "account_update"');
    expect(INBOUND).toContain("this.connections.applyAccountUpdate(");
  });

  it("והטוקן נמחק כשהקו כבר אינו שלנו", () => {
    const apply = CONNECTION.slice(
      CONNECTION.indexOf("async applyAccountUpdate("),
      CONNECTION.indexOf("async markHistory("),
    );
    expect(apply).toContain("accessTokenEncrypted: null");
    expect(apply).toContain("DISABLED_UPDATE");
  });
});

describe("חיבור המספר", () => {
  /*
   * ‎**ההרשמה ל-Webhooks היא מה שמפנה את ההודעות אלינו.** המרה
   * מוצלחת לבדה נותנת טוקן ולא ניתוב, ולכן חיבור שנשמר בלי הקריאה
   * הזו מציג „מחובר” ואף הודעה לא מגיעה — הכשל השקט המרכזי של
   * הזרימה הזו.
   */
  it("ההרשמה ל-Webhooks נקראת, וכישלונה אינו נבלע", () => {
    const complete = CONNECTION.slice(
      CONNECTION.indexOf("async complete("),
      CONNECTION.indexOf("async disconnect("),
    );
    expect(complete).toContain("this.subscribeApp(");
    expect(complete).toContain('status: subscribed ? "pending_history" : "error"');
    expect(complete, "חיבור בלי ניתוב אינו מדווח כהצלחה").toMatch(/if \(!subscribed\)/u);
  });

  /*
   * מתווך שלחץ פעמיים, או רענן באמצע, אינו אמור לייצר שני קווים
   * זהים — וקו של משרד אחר אינו אמור להיחטף בלחיצה.
   */
  it("חיבור חוזר מעדכן, וקו של משרד אחר נדחה", () => {
    const complete = CONNECTION.slice(
      CONNECTION.indexOf("async complete("),
      CONNECTION.indexOf("async disconnect("),
    );
    expect(complete).toContain("existing.tenantId !== tenantId");
    expect(complete).toMatch(/existing\s*\n?\s*\?\s*await this\.prisma\.whatsAppBusinessConnection\.update/u);
  });

  /*
   * ‎**ניתוק מוחק את הסוד ומשאיר את השורה.** מחיקת השורה הייתה
   * מציגה „מעולם לא חובר”; החזקת טוקן חי של עסק שכבר אינו איתנו
   * היא בדיוק מה שהעמודה נעשתה Nullable כדי למנוע.
   */
  it("ניתוק מוחק את הטוקן ומשאיר את הסטטוס", () => {
    const disconnect = CONNECTION.slice(
      CONNECTION.indexOf("async disconnect("),
      CONNECTION.indexOf("async byPhoneNumberId("),
    );
    expect(disconnect).toContain("accessTokenEncrypted: null");
    expect(disconnect).toContain('status: "disconnected"');
    expect(disconnect).toContain("disconnectReason");
    expect(disconnect, "השורה נשמרת — „היה ונותק” הוא מידע").not.toContain("delete({");
  });

  /*
   * ה-App Secret נדרש להמרה, ולכן ההמרה בשרת. `code` בפרונט הוא
   * ערך חד-פעמי שאין בו נזק; Secret בפרונט הוא Secret שדלף.
   */
  it("והמרת הקוד נעשית בשרת עם ה-App Secret", () => {
    expect(CONNECTION).toContain("client_secret");
    expect(CONNECTION).toContain("oauth/access_token");
  });
});

describe("מה בתשלום ומה לא", () => {
  /*
   * ‎**הגבול הכלכלי, ולא רק המסחרי.** הודעות נכנסות אינן עולות לנו
   * דבר, ולכן החיבור והלידים פתוחים; תשובת בוט היא קריאת LLM
   * שאנחנו משלמים עליה, ולכן היא נגבית. שער שיזלוג על החיבור היה
   * גובה על מה שחינם, ושער חסר על הבוט היה מחלק חינם מה שעולה.
   */
  it("הבוט מאחורי שער פיצ'ר, והחיבור אינו", () => {
    expect(CONNECTION).toContain("async botAllowed(");
    expect(CONNECTION).toContain('tenantHasFeature(tenantId, "whatsapp_bot")');

    const complete = CONNECTION.slice(
      CONNECTION.indexOf("async complete("),
      CONNECTION.indexOf("async disconnect("),
    );
    expect(complete, "חיבור המספר אינו נגבה").not.toContain("tenantHasFeature");
  });

  /*
   * קליטת הליד היא הערך שמגיע לכל מסלול. שער שייכנס לנתיב הזה
   * יהפוך „פנייה שנכנסת כליד” לפיצ'ר בתשלום בלי שאיש יתכוון לכך.
   */
  it("וקליטת הפניות בוובהוק אינה נבדקת מול מסלול", () => {
    const ingest = INBOUND.slice(INBOUND.indexOf("private async ingestMessage("));
    expect(ingest).not.toContain("tenantHasFeature");
    expect(ingest).not.toContain("botAllowed");
  });
});

describe("הסוד אינו זולג ליומן", () => {
  /*
   * כל השירות הזה מטפל בטוקנים של לקוחות. שורת לוג אחת שמדפיסה
   * טוקן הופכת את היומן למאגר מפתחות — וזה בדיוק סוג השורה שנוספת
   * „רק כדי לבדוק משהו” ונשארת.
   */
  it("אין הדפסה של טוקן או של סוד", () => {
    const logLines = CONNECTION.split("\n").filter((line) => line.includes("this.logger."));
    for (const line of logLines) {
      expect(line, `שורת לוג חושפת סוד: ${line.trim()}`).not.toMatch(
        /\$\{\s*(token|app\.appSecret|creds\.token|secret)\b/u,
      );
    }
  });
});
