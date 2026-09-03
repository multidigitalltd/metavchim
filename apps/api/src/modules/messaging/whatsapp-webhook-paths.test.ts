import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * ‎**נתיב לכל אפליקציה — ולא סוד שמתקבל על שניהם.**
 *
 * ## מה היה
 *
 * קו הסוכן וחיבור המשרדים יושבים באפליקציות Meta נפרדות, ושתיהן
 * הצביעו על אותה כתובת. הבקר אסף את שני הסודות ל-`secrets` וקיבל
 * בקשה שתואמת ל**אחד מהם** — כלומר בקשה חתומה בסוד של אפליקציית
 * החיבור התקבלה גם בשם קו הסוכן.
 *
 * הניתוב לתוכן ממילא לא התערבב (הוא לפי `phone_number_id`), אבל
 * גבול האמון היה משותף: אי אפשר היה לכבות אפליקציה אחת, להגביל
 * אותה, או לקרוא את היומן שלה בנפרד. ובנוסף — טוקן אימות משותף
 * מחייב לדעת את הישן כדי לרשום אפליקציה חדשה, והסודות אינם ניתנים
 * לשליפה מהמסך בכוונה (הכרעת בעל המוצר).
 *
 * ## למה בדיקת קוד
 *
 * הנפילה חזרה היא שורה אחת — להחזיר מערך שני סודות — והיא שקטה
 * לגמרי: הכול ממשיך לעבוד, רק הגבול נעלם.
 */

const CONTROLLER = readFileSync(
  new URL("./whatsapp-webhook.controller.ts", import.meta.url),
  "utf8",
);

describe("שני נתיבי Webhook", () => {
  it("לאפליקציית החיבור נתיב משלה — GET ו-POST", () => {
    expect(CONTROLLER).toContain('@Get("connect")');
    expect(CONTROLLER).toContain('@Post("connect")');
  });

  it("כל נתיב מקבל סוד אחד, ולא רשימה של שניהם", () => {
    /*
     * ‏הצורה הישנה: מערך משני הסודות שנבנה פעם אחת ומשמש את שניהם.
     * ‏`accept` מקבל **סוד יחיד**, והמערך שבתוכו הוא רק כדי לשמור על
     * צורת ההשוואה הקיימת.
     */
    expect(CONTROLLER).toContain(
      "private async accept(req: Request, secret: string | undefined)",
    );
    expect(CONTROLLER, "שני הסודות שוב על אותו נתיב").not.toContain(
      'this.platformSettings.get("whatsappAppSecret")) ?? env.WHATSAPP_APP_SECRET,\n          (await this.platformSettings.get("whatsappConnectAppSecret"))',
    );
  });

  it("נתיב הסוכן אינו מקבל את הסוד של אפליקציית החיבור", () => {
    const agent = CONTROLLER.slice(
      CONTROLLER.indexOf("async receive(@Req() req: Request)"),
      CONTROLLER.indexOf("async receiveConnect("),
    );
    expect(agent.length).toBeGreaterThan(20);
    expect(agent, "הסוד של אפליקציית החיבור על נתיב הסוכן").not.toContain(
      "whatsappConnectAppSecret",
    );
  });

  it("לכל נתיב טוקן אימות משלו", () => {
    expect(CONTROLLER).toContain('this.platformSettings.get("whatsappConnectVerifyToken")');
    const agent = CONTROLLER.slice(
      CONTROLLER.indexOf("async verify("),
      CONTROLLER.indexOf("async verifyConnect("),
    );
    expect(agent.length).toBeGreaterThan(20);
    expect(agent, "טוקן החיבור על נתיב הסוכן").not.toContain("whatsappConnectVerifyToken");
  });

  /*
   * ‎**התקנה עם אפליקציה אחת אינה נשברת.** כשהערכים הייעודיים ריקים
   * נתיב החיבור נופל לאלה של קו הסוכן — אחרת השינוי הזה היה מפיל כל
   * התקנה שלא הגדירה אותם, וזו בדיוק אינה ההכרעה.
   */
  it("ריק בערכים הייעודיים נופל לקו הסוכן", () => {
    const connect = CONTROLLER.slice(
      CONTROLLER.indexOf("async receiveConnect("),
      CONTROLLER.indexOf("private async agentSecret("),
    );
    expect(connect).toContain("await this.agentSecret()");
    const verify = CONTROLLER.slice(
      CONTROLLER.indexOf("async verifyConnect("),
      CONTROLLER.indexOf("private async agentToken("),
    );
    expect(verify).toContain("await this.agentToken()");
  });

  /*
   * המפתח נשמר בהצפנה כמו כל סוד, ולכן הוא חייב להיות ברשימת
   * המפתחות המוכרים — אחרת השמירה נופלת בזמן ריצה ולא בקומפילציה.
   */
  it("הטוקן החדש מוכר גם בשירות ההגדרות וגם בסכמת השמירה", () => {
    const service = readFileSync(
      new URL("../../core/platform-settings.service.ts", import.meta.url),
      "utf8",
    );
    const controller = readFileSync(
      new URL("../platform/platform.controller.ts", import.meta.url),
      "utf8",
    );
    expect(service).toContain('| "whatsappConnectVerifyToken"');
    expect(controller).toContain("whatsappConnectVerifyToken: z");
  });
});
