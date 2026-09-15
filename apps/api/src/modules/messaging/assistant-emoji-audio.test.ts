import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeButtonId, encodeButtonId } from "@metavchim/shared";
import { buttonAsText } from "./assistant-buttons";
import { WhatsAppAssistantService } from "./whatsapp-assistant.service";

/*
 * ‎**שלוש התקלות שדווחו מהשטח על הסוכן בוואטסאפ.**
 *
 * ‏כולן אותה משפחה: מסלול שלא נצפה נופל למשפט הסיום הכללי, והמשפט
 * ‏הזה הוא הסבר על מגבלות המערכת במקום תשובה. הבדיקות כאן מקבעות
 * ‏את שלוש ההכרעות — שתיקה על תגובה, משפט קצר על אימוג'י, וניסיון
 * ‏חוזר על תמלול — במקור עצמו, כי חלקן הן **סדר** ולא ערך מוחזר.
 */

const SERVICE = readFileSync(
  join(__dirname, "whatsapp-assistant.service.ts"),
  "utf8",
);
const INBOUND = readFileSync(
  join(__dirname, "whatsapp-inbound.service.ts"),
  "utf8",
);

describe("תגובת אימוג'י — שתיקה, ולא הסבר על מגבלות", () => {
  /*
   * ‏זה הבאג עצמו: 👍 על סיכום הבוקר קיבל „אני יודע לטפל כרגע
   * ‏בטקסט, בהודעות קוליות, בתמונות ובקבצי אקסל”.
   */
  it("‏`reaction` יוצא מ-handleInner לפני שמגיעים למשפט הסיום", () => {
    const branch = SERVICE.indexOf('if (msg.type === "reaction")');
    /* ‏המשפט עצמו ולא ציטוטו: ההערה שמעל הענף נוקבת בו בכוונה */
    const catchAll = SERVICE.indexOf(
      'return { reply: "אני יודע לטפל כרגע בטקסט',
    );
    expect(branch).toBeGreaterThan(0);
    expect(catchAll).toBeGreaterThan(branch);
  });

  /*
   * ‎**לפני הזיהוי** ולא אחריו: תגובה ממספר שאינו מקושר הייתה
   * ‏מפעילה את מסלול המתעניין ומחזירה מענה שיווקי על אגודל.
   */
  it("היציאה קודמת ל-identifyUser", () => {
    const inner = SERVICE.indexOf("private async handleInner(");
    const branch = SERVICE.indexOf('if (msg.type === "reaction")', inner);
    const identify = SERVICE.indexOf("this.identifyUser(", inner);
    expect(branch).toBeGreaterThan(inner);
    expect(identify).toBeGreaterThan(branch);
  });

  /*
   * ‏zod משמיט מפתחות שאינם מוצהרים, ובלי `reaction` בסכימה ההודעה
   * ‏הגיעה בלי שום סימן למה היא — בדיוק כמו `image` ו-`document`
   * ‏לפניה.
   */
  it("הסכימה של ה-webhook מצהירה על השדה, והוא נמסר הלאה", () => {
    expect(INBOUND).toContain("reaction: z");
    expect(INBOUND).toContain("reactionEmoji");
  });
});

describe("אימוג'י שהוקלד — משפט קצר, לא „לא הבנתי”", () => {
  /*
   * ‏הבדיקה היא על **הסדר**: הזיהוי חייב לקרות לפני `return { text }`,
   * ‏אחרת ההודעה ממשיכה למנוע ההבנה בדיוק כמו קודם.
   */
  it("הזיהוי יושב בענף הטקסט, לפני ההחזרה למנוע", () => {
    const textBranch = SERVICE.indexOf('if (msg.type === "text") {', SERVICE.indexOf("private async extractText("));
    const check = SERVICE.indexOf("isEmojiOnlyMessage(text)", textBranch);
    const toEngine = SERVICE.indexOf("return { text };", textBranch);
    expect(check).toBeGreaterThan(textBranch);
    expect(toEngine).toBeGreaterThan(check);
  });
});

describe("תמלול שנכשל — ניסיון חוזר, לא מבוי סתום", () => {
  it("שני ניסיונות לפני שמכריזים על כישלון", () => {
    const fn = SERVICE.slice(
      SERVICE.indexOf("private async transcribeWithRetry("),
      SERVICE.indexOf("private transcribeFailed("),
    );
    expect(fn).toContain("attempt < 2");
    /* ‏`null` = המנוע נפל; `""` = ההקלטה שקטה. שתי תשובות שונות. */
    expect(fn).toContain("return null;");
  });

  /*
   * ‏„נסו שוב או כתבו את הבקשה” ביקש מהמתווך להקליט מחדש דבר שהוא
   * ‏כבר אמר. ההקלטה עדיין שמורה אצל Meta, ולכן הכפתור נושא את
   * ‏מזהה המדיה ומריץ בדיוק את המסלול שנכשל.
   */
  const failed = (): {
    reply: string;
    buttonBody: string;
    buttons: { action: string; arg?: string; title: string }[];
  } =>
    (
      WhatsAppAssistantService.prototype as unknown as {
        transcribeFailed: (id: string) => {
          reply: string;
          buttonBody: string;
          buttons: { action: string; arg?: string; title: string }[];
        };
      }
    ).transcribeFailed("MEDIA-123");

  it("הכפתור נושא את מזהה המדיה", () => {
    expect(failed().buttons).toHaveLength(1);
    expect(failed().buttons[0]?.action).toBe("retry");
    expect(failed().buttons[0]?.arg).toBe("MEDIA-123");
  });

  /*
   * ‎**שני נוסחים, לא אחד** (ביקורת Codex). ‏`deliver` שולח את `text`
   * ‏כשההודעה האינטראקטיבית נדחית — ואז אין כפתור, ואין שום דרך
   * ‏לבקש תמלול חוזר. נוסח שמבטיח „אפשר לנסות שוב” בלי הכפתור
   * ‏שמממש אותו הוא בדיוק המבוי הסתום שהשינוי בא להסיר, רק בניסוח
   * ‏נעים יותר.
   */
  it("הנוסח בלי כפתורים מציע רק מה שתמיד אפשר", () => {
    const { reply, buttonBody } = failed();
    expect(reply).not.toContain("לתמלל אותה שוב");
    expect(reply).not.toContain("לחצו");
    expect(reply).toContain("שלחו לי את ההקלטה שוב");
    /* ‏הנוסח שליד הכפתור — שם ההבטחה מכוסה */
    expect(buttonBody).toContain("שמורה");
    expect(buttonBody).not.toBe(reply);
  });

  it("‏„retry” עובר הלוך-חזור במזהה הכפתור ואינו משפט למנוע", () => {
    const decoded = decodeButtonId(encodeButtonId("retry", "MEDIA-123"));
    expect(decoded?.action).toBe("retry");
    expect(decoded?.arg).toBe("MEDIA-123");
    /* ‏`buttonAsText` מחזירה null — הלחיצה מטופלת לפני מנוע ההבנה */
    expect(buttonAsText("retry", "MEDIA-123")).toBeNull();
  });

  /*
   * ‏לחיצה מריצה מחדש את **אותו מסלול**: אותו אישור קבלה, אותה
   * ‏הודעת ביניים, אותו ניסיון חוזר. מסלול תמלול שני היה נשכח
   * ‏ביום שהראשון ישתנה.
   */
  it("הלחיצה נכתבת מחדש כהודעה קולית ולא כמסלול שני", () => {
    expect(SERVICE).toContain('button.action === "retry"');
    expect(SERVICE).toContain('type: "audio", mediaId: button.arg ?? ""');
  });
});
