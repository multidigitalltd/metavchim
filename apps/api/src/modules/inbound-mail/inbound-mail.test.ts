import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PrismaService } from "../../core/prisma.service";
import type { EmailInboxService } from "../email-inbox/email-inbox.service";
import type { SupportInboxService } from "../support/support-inbox.service";
import { InboundMailService } from "./inbound-mail.service";

/**
 * ‎**אף נתיב קליטה אינו רשאי לזרוק דואר.**
 *
 * ## התקלה שהבדיקה הזאת נולדה ממנה
 *
 * היו שני נתיבים ציבוריים שהתנהגו **הפוך** על אותו קלט: הנתיב של
 * תיבות המשרדים זרק בשקט כל הודעה בלי טוקן מוכר, והנתיב של התמיכה
 * פתח ממנה פנייה. כל עוד לכל אחד הייתה כתובת נפרדת אצל הספק זה
 * עבד. ברגע שכל הדואר של הדומיין נכנס לשרת אחד, ההתנהגות נקבעת
 * לפי **איזו כתובת URL מוגדרת שם** — פרט הגדרה, לא החלטה — ומי
 * שהגדיר את הנתיב של תיבת הלקוחות מאבד כל מייל שאינו תשובה: בלי
 * שורה, בלי יומן, בלי שאיש יידע שהיה.
 *
 * שני הנתיבים עוברים עכשיו דרך `InboundMailService`, ולכן אין
 * ביניהם הבדל. הבדיקה אוכפת את שני חצאי ההבטחה: שהניתוב עצמו נכון,
 * ושלא נולד נתיב שלישי שעוקף אותו.
 */

const MODULES = join(import.meta.dirname, "..");

function payload(over: Record<string, unknown> = {}): never {
  return {
    MailboxHash: "",
    From: "dana@office.co.il",
    FromName: "דנה",
    Subject: "שאלה",
    StrippedTextReply: "",
    TextBody: "שלום",
    MessageID: "m-1",
    Attachments: [],
    Headers: [],
    ...over,
  } as never;
}

function service(found: { support?: boolean; tenant?: boolean } = {}): {
  svc: InboundMailService;
  went: string[];
} {
  const went: string[] = [];
  const prisma = {
    supportThread: { findUnique: async () => (found.support === true ? { id: "01T" } : null) },
    emailReplyToken: { findUnique: async () => (found.tenant === true ? { id: "01K" } : null) },
  } as unknown as PrismaService;
  const support = {
    processInbound: async () => {
      went.push("support");
    },
  } as unknown as SupportInboxService;
  const tenantInbox = {
    processInbound: async () => {
      went.push("tenant");
    },
  } as unknown as EmailInboxService;
  return { svc: new InboundMailService(prisma, support, tenantInbox), went };
}

const TOKEN = "01HZXK4RTMABCDEFGHJKMNPQRS";

describe("ניתוב הדואר הנכנס", () => {
  it("בלי טוקן — פנייה חדשה לתמיכה, ולא זריקה", async () => {
    /*
     * זו השורה שכל המהלך עומד עליה: מי שכתב לכתובת כלשהי בדומיין
     * ולא ענה לשום דבר הוא מי שפונה אלינו לראשונה.
     */
    const { svc, went } = service();
    await svc.route(payload());
    expect(went).toEqual(["support"]);
  });

  it("טוקן לא מוכר — גם הוא פנייה חדשה", async () => {
    const { svc, went } = service();
    await svc.route(payload({ MailboxHash: TOKEN }));
    expect(went).toEqual(["support"]);
  });

  it("טוקן של תשובת לקוח — לתיבת המשרד, לא לתמיכה", async () => {
    // ההפך היה מניח הודעה פרטית של לקוח על שולחן מנהלי הפלטפורמה
    const { svc, went } = service({ tenant: true });
    await svc.route(payload({ MailboxHash: TOKEN }));
    expect(went).toEqual(["tenant"]);
  });

  it("טוקן של שרשור תמיכה — המשך אותו שרשור", async () => {
    const { svc, went } = service({ support: true });
    await svc.route(payload({ MailboxHash: TOKEN }));
    expect(went).toEqual(["support"]);
  });

  it("טוקן שמוכר בשני המקומות — לשום מקום", async () => {
    const { svc, went } = service({ support: true, tenant: true });
    await svc.route(payload({ MailboxHash: TOKEN }));
    expect(went).toEqual([]);
  });

  it("מענה אוטומטי אינו נכנס לאף אחד מהשניים", async () => {
    /*
     * הסינון ברמת הניתוב ולא בתוך אחד השירותים, כי הוא נכון לשני
     * הכיוונים: הודעת אי-מסירה אינה פנייה **וגם** אינה תשובת לקוח.
     */
    const { svc, went } = service({ tenant: true });
    await svc.route(
      payload({
        MailboxHash: TOKEN,
        Headers: [{ Name: "Auto-Submitted", Value: "auto-replied" }],
      }),
    );
    expect(went).toEqual([]);
  });

  it("‏„מחוץ למשרד” אינו פותח פנייה", async () => {
    const { svc, went } = service();
    await svc.route(payload({ Subject: "Out of Office" }));
    expect(went).toEqual([]);
  });
});

describe("אין נתיב קליטה שעוקף את הניתוב", () => {
  /*
   * ‎**שער מבני.** הבדיקה למעלה מוכיחה שהניתוב נכון; זו מוודאת
   * שכל נתיב ציבורי באמת עובר דרכו. נתיב שלישי שנוסף במודול אחר
   * ויקרא ישירות ל-`processInbound` יחזיר בדיוק את ההתנהגות
   * ההפוכה שממנה יצאנו — ובשקט.
   */
  function sources(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        sources(path, out);
        continue;
      }
      if (entry.endsWith(".ts") && !entry.includes(".test.")) out.push(path);
    }
    return out;
  }

  it("כל `public/**/inbound` יושב בבקר הניתוב", () => {
    const offenders: string[] = [];
    for (const file of sources(MODULES)) {
      const text = readFileSync(file, "utf8");
      if (!/@Post\(\s*"public\/[^"]*inbound/u.test(text)) continue;
      if (!file.endsWith(join("inbound-mail", "inbound-mail.controller.ts"))) {
        offenders.push(file.replace(MODULES, "modules"));
      }
    }
    expect(
      offenders,
      "נתיב קליטה ציבורי מחוץ לבקר הניתוב — הוא יתנהג אחרת ממנו, " +
        "ואיזו התנהגות תתקבל ייקבע לפי הכתובת שהוגדרה אצל הספק:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("הבדיקה אכן מוצאת את הבקר עצמו", () => {
    // רשת ביטחון: שינוי שם או מבנה שיאפס את הסריקה
    const controller = readFileSync(
      join(MODULES, "inbound-mail", "inbound-mail.controller.ts"),
      "utf8",
    );
    expect(controller).toMatch(/@Post\(\s*"public\/support\/inbound\/:secret"\)/u);
    expect(controller).toMatch(/@Post\(\s*"public\/email\/inbound\/:secret"\)/u);
  });
});
