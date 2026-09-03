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
const INBOUND = readFileSync(
  new URL("./whatsapp-inbound.service.ts", import.meta.url),
  "utf8",
);

describe("שני נתיבי Webhook, וגבול שנאכף בעיבוד", () => {
  it("לאפליקציית החיבור נתיב וטוקן משלה", () => {
    expect(CONTROLLER).toContain('@Get("connect")');
    expect(CONTROLLER).toContain('@Post("connect")');
    expect(CONTROLLER).toContain('this.platformSettings.get("whatsappConnectVerifyToken")');
    const agent = CONTROLLER.slice(
      CONTROLLER.indexOf("async verify("),
      CONTROLLER.indexOf("async verifyConnect("),
    );
    expect(agent.length).toBeGreaterThan(20);
    expect(agent, "טוקן החיבור על נתיב הסוכן").not.toContain("whatsappConnectVerifyToken");
  });

  /*
   * ‎**הנתיב הישן ממשיך לקבל את שתי החתימות.** המדריך הפנה לשם את
   * שתי האפליקציות, והתקנה כזו קיימת בשטח: דחייה פתאומית של הסוד
   * השני הייתה מפילה כל אירוע ב-401 עד שמישהו יעדכן ידנית אצל Meta
   * — שקט מוחלט, בלי שדבר בקוד יצעק (ביקורת Codex).
   */
  it("הנתיב הישן אינו שובר התקנה שהפנתה אליו את שתי האפליקציות", () => {
    const receive = CONTROLLER.slice(
      CONTROLLER.indexOf("async receive(@Req() req: Request)"),
      CONTROLLER.indexOf("async receiveConnect("),
    );
    expect(receive).toContain("await this.candidates()");
  });

  /*
   * ‎**וזה מה שמחליף את ההפרדה שהנתיב לבדו לא נתן.**
   *
   * אימות אומר „חתום כדין”. בלי המקור, סוד של אפליקציית החיבור
   * שדלף היה מספיק כדי לשלוח גוף עם ה-`phone_number_id` של קו
   * הסוכן ולהריץ את הסוכן האישי בשמו של המתווך.
   */
  it("המקור נגזר מהסוד שהתאים, ולא מהנתיב", () => {
    expect(CONTROLLER, "some מאבד את מי שהתאים").toContain("const matched = candidates.find(");
    expect(CONTROLLER).toContain("matched.source");
    expect(CONTROLLER).toContain("this.inbound.handle(body as Record<string, unknown>, matched.source)");
    /* הסוד של החיבור מייצג את החיבור בלבד — לעולם לא `any` */
    expect(CONTROLLER).toContain('list.push({ secret: connect, source: "connect" })');
    /* וכשאין סוד נפרד, אפליקציה אחת ממלאת את שני התפקידים */
    expect(CONTROLLER).toContain('source: has(connect) ? "agent" : "any"');
  });

  /*
   * ‎**הגבול נשען על המקור בלבד — לא על מה שכתוב במטען.**
   *
   * שתי גרסאות קודמות נפלו כאן. הראשונה שמה את השומר רק לפני ענף
   * הסוכן, וטיפול הלחיצות שמעליו נשאר חשוף. השנייה העלתה אותו, אבל
   * השוותה `incomingLine === assistantCreds.phoneNumberId` —
   * ו-`metadata.phone_number_id` מגיע **מהגוף**, כלומר מי שמחזיק
   * בסוד שולט בו: השמטת השדה או נקיבת קו של משרד עקפה את ההשוואה
   * והגיעה הישר לטיפול הלחיצות, שאינו תלוי-קו כלל (ביקורת Codex).
   *
   * לכן הבדיקה על **הצורה**: תשובות לתזכורות נחסמות לפי `source`
   * לבדו, וענף הסוכן בודק `source` לפני השוואת הקו.
   */
  it("תשובות לתזכורות נחסמות לפי המקור לבדו", () => {
    expect(INBOUND).toContain('source: InboundSource = "any"');
    expect(INBOUND).toContain('source === "connect"\n            ? []');
    /* השוואת קו כתנאי לחסימה = הכרעה שנשענת על מטען מזויף */
    expect(INBOUND, "החסימה תלויה בקו שבמטען").not.toContain(
      'source === "connect" && incomingLine ===',
    );
  });

  it("ענף הסוכן בודק את המקור לפני שהוא משווה קו", () => {
    const branch = INBOUND.slice(
      INBOUND.indexOf("        if (\n          source !== \"connect\" &&"),
      INBOUND.indexOf("this.assistant.handle("),
    );
    expect(branch.length).toBeGreaterThan(50);
    expect(branch).toContain("assistantCreds !== null");
  });

  /*
   * ‏קליטת הלידים אינה מוגבלת למקור, ובכוונה: משרד שהזין את המספר
   * שלו ידנית (מסלול הגיבוי) מגיע דרך אפליקציית הסוכן, וחסימה שם
   * הייתה שוברת אותו בלי שאיש יבחין.
   */
  it("קליטת הלידים נשארת פתוחה לשני המקורות", () => {
    const after = INBOUND.slice(INBOUND.indexOf("this.assistant.handle("));
    expect(after, "מסלול הגיבוי הידני נחסם").not.toContain('source === "agent"');
  });

  /*
   * שדה סוד ריק פירושו „בלי שינוי", ולכן עקיפה שאין לה כפתור ניקוי
   * היא עקיפה חד-כיוונית — והמסך מבטיח את ההפך („ריק = אותה
   * אפליקציה"). התיבה שולחת `""` לשני הערכים יחד.
   */
  it("אפשר לחזור מאפליקציה נפרדת לאחת", () => {
    const platform = readFileSync(
      new URL("../../../../web/src/app/platform/platform-settings-section.tsx", import.meta.url),
      "utf8",
    );
    expect(platform).toContain('f.get("whatsappConnectClear") !== null');
    expect(platform).toContain(
      '{ whatsappConnectAppSecret: "", whatsappConnectVerifyToken: "" }',
    );
  });

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
