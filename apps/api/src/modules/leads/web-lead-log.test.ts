import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { LEAD_WEBHOOK_KEYS } from "@metavchim/shared";
import { WebLeadController } from "./web-lead.controller";

/**
 * ‎**„שלחתי ולא קרה כלום” — הצד שלא הותיר עקבה.**
 *
 * ‏יומן הוובהוקים נבנה למרכזייה בדיוק בשביל השאלה הזו: פנייה
 * ‏שנדחתה נראתה בדיוק כמו פנייה שלא הגיעה מעולם. בנתיב הלידים היא
 * ‏נשארה בלי תשובה — מפתח לא מוכר החזיר 404 בשקט, וגוף שנפסל
 * ‏נדחה ב-Pipe **לפני** שהמתודה רצה, כלומר לפני שהיה מה לרשום.
 *
 * ‏זה הכישלון השכיח של מי שמחבר טופס דרך Make או n8n, וזו הסיבה
 * ‏שהבדיקה עברה אל תוך המתודה.
 */

const KEY = "abcdefghijklmnopqrstuvwxyz";
const BODY = { name: "ישראל", phone: "0501234567" };

function controllerWith(ingest: () => Promise<{ tenantId: string }>): {
  controller: WebLeadController;
  rows: Record<string, unknown>[];
} {
  const rows: Record<string, unknown>[] = [];
  const log = { record: async (input: Record<string, unknown>) => void rows.push(input) };
  const controller = new WebLeadController({ ingest } as never, log as never);
  return { controller, rows };
}

const ok = async () => ({ tenantId: "01TENANTAAAAAAAAAAAAAAAAAA" });

describe("‏וובהוק לידים — כל תוצאה נרשמת", () => {
  it("‏פנייה שנקלטה נרשמת עם המשרד שנפתר", async () => {
    const { controller, rows } = controllerWith(ok);
    await controller.ingest(KEY, BODY);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: "lead",
      outcome: "accepted",
      tenantId: "01TENANTAAAAAAAAAAAAAAAAAA",
    });
  });

  /*
   * ‏המשרד ידוע רק **אחרי** שהמפתח נפתר. שורה שנכתבה מוקדם מדי
   * ‏הייתה נופלת מהסינון „הפניות של המשרד הזה” — הראשון שנשאל.
   */
  it("‏ושורה שנקלטה אינה נשארת בלי משרד", async () => {
    const { controller, rows } = controllerWith(ok);
    await controller.ingest(KEY, BODY);
    expect(rows[0]?.["tenantId"]).not.toBeNull();
  });

  /*
   * ‎**המספר נמסר ליומן בצורתו המנורמלת** — וזו הנקודה: החתימה
   * ‏נעשית על אותה צורה שנשמרת ב-`contacts.phone_hash`, ולכן
   * ‏חיפוש ביומן לפי מספר נותן בדיוק את אותה תשובה כמו חיפוש איש
   * ‏קשר, בלי קשר לכתיב שהוקלד בטופס.
   *
   * ‏הוא נמסר כדי **שייחתם**, לא כדי להיכתב — היומן שומר חתימה
   * ‏וארבע ספרות בלבד.
   */
  it("‏המספר נמסר מנורמל, כמו החתימה השמורה", async () => {
    const { controller, rows } = controllerWith(ok);
    await controller.ingest(KEY, BODY);
    expect(rows[0]?.["peerPhone"]).toBe("+972501234567");
  });

  /* ‎**זו התקלה שעד עכשיו נעלמה לגמרי** */
  it("‏מפתח שאינו שייך לאף משרד נרשם, ולא רק נדחה", async () => {
    const { controller, rows } = controllerWith(async () => {
      throw new NotFoundException("לא נמצא");
    });
    await expect(controller.ingest(KEY, BODY)).rejects.toBeInstanceOf(NotFoundException);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "lead", outcome: "unknown_key" });
  });

  it("‏ומפתח משובש בצורתו — אותה שורה, והקידומת מראה מה הגיע", async () => {
    const { controller, rows } = controllerWith(ok);
    await expect(controller.ingest("קצר", BODY)).rejects.toBeInstanceOf(BadRequestException);
    expect(rows[0]).toMatchObject({ outcome: "unknown_key", key: "קצר" });
  });

  /*
   * ‎**גוף שנפסל — הכישלון השכיח של Make ושל n8n.** עד עכשיו
   * ‏ה-Pipe דחה אותו לפני שהמתודה רצה, ולכן הוא לא הותיר דבר.
   */
  it("‏שדה שאיננו מכירים נרשם כ„נדחתה בבדיקה”", async () => {
    const { controller, rows } = controllerWith(ok);
    await expect(
      controller.ingest(KEY, { ...BODY, surprise: "x" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(rows[0]).toMatchObject({ outcome: "unparsed", issue: "bad_body" });
  });

  it("‏טלפון פסול מקבל את אותו שם תקלה של המרכזייה", async () => {
    const { controller, rows } = controllerWith(ok);
    await expect(controller.ingest(KEY, { ...BODY, phone: "12" })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(rows[0]).toMatchObject({ issue: "invalid_phone" });
  });

  it("‏גוף ריק נבדל משדה פסול", async () => {
    const { controller, rows } = controllerWith(ok);
    await expect(controller.ingest(KEY, {})).rejects.toBeInstanceOf(BadRequestException);
    expect(rows[0]).toMatchObject({ issue: "no_fields" });
  });

  /*
   * ‏בוט אינו השאלה שהיומן עונה עליה — אבל טופס אמיתי שיש בו שדה
   * ‏בשם `website` נבלע כאן בשקט מוחלט, לנצח, ואין לו שום דרך
   * ‏אחרת להתגלות.
   */
  it("‏מלכודת הבוטים נרשמת, והבקשה עדיין „מצליחה”", async () => {
    const { controller, rows } = controllerWith(ok);
    await expect(controller.ingest(KEY, { ...BODY, website: "spam" })).resolves.toEqual({
      ok: true,
    });
    expect(rows[0]).toMatchObject({ outcome: "unparsed", issue: "honeypot" });
  });

  /* ‏כשל אצלנו אינו „מפתח לא מוכר”: התקלה בצד שלנו, והשולח ינסה שוב */
  it("‏כשל בעיבוד נרשם כ„נפלה אצלנו”", async () => {
    const { controller, rows } = controllerWith(async () => {
      throw new Error("boom");
    });
    await expect(controller.ingest(KEY, BODY)).rejects.toThrow("boom");
    expect(rows[0]).toMatchObject({ outcome: "failed" });
  });
});

/**
 * ‎**והסיבה אינה נושאת את הערך שנדחה.**
 *
 * ‏הודעת Zod המלאה מכילה את מה שהוקלד — כלומר עלולה לשאת שם או
 * ‏טלפון של לקוח אל טבלת פלטפורמה שנקראת בעיניים. שם התקלה בלבד,
 * ‏כמו בצד המרכזייה.
 */
describe("‏הסיבה היא שם תקלה, לא ציטוט", () => {
  const SOURCE = readFileSync(join(__dirname, "web-lead.controller.ts"), "utf8");

  it("‏אין ציטוט של הודעת השגיאה אל היומן", () => {
    const fn = SOURCE.slice(SOURCE.indexOf("function bodyIssue("));
    expect(fn.slice(0, 900)).not.toContain("issue.message");
  });

  it("‏והשמות הם רשימה סגורה", () => {
    for (const name of ["no_fields", "invalid_phone", "no_name", "bad_body"]) {
      expect(SOURCE).toContain(`"${name}"`);
    }
  });
});

/**
 * ‎**רשימת השדות המוכרים חיה בשני מקומות — והם חייבים להסכים.**
 *
 * ‏`LEAD_WEBHOOK_KEYS` ב-shared קובעת מה **אינו** „לא ממופה”
 * ‏ביומן; סכימת הקליטה קובעת מה מתקבל. שדה שיתווסף לסכימה ולא
 * ‏לרשימה יופיע באדום כאילו הוא מידע שאנחנו מפספסים — בזמן שהוא
 * ‏נקלט בפועל. שער אחד, ולא זיכרון של מי שיוסיף את הבא.
 */
describe("‏רשימת השדות ביומן זהה לסכימת הקליטה", () => {
  const SOURCE = readFileSync(join(__dirname, "web-lead.controller.ts"), "utf8");

  it("‏כל שדה בסכימה מופיע ברשימה המשותפת", () => {
    const schema = SOURCE.slice(
      SOURCE.indexOf("const WebLeadSchema"),
      SOURCE.indexOf(".strict();"),
    );
    /* ‏שמות המפתחות ברמת האובייקט — ארבעה רווחי הזחה בדיוק */
    const keys = [...schema.matchAll(/^ {4}([A-Za-z][A-Za-z0-9]*):/gmu)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(5);
    expect([...keys].sort()).toEqual([...LEAD_WEBHOOK_KEYS].sort());
  });
});
