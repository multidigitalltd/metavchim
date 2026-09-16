import { describe, expect, it } from "vitest";
import { TenantContext } from "../../common/tenant-context";
import { EmailInboxService } from "./email-inbox.service";

/**
 * ‎**וובהוק מגיע בלי הקשר דייר — וחייב לקבוע אותו בעצמו.**
 *
 * ‏`withExplicitTenant` קובעת את הדייר ל-RLS בלבד. שכבת הנתונים
 * ‏שואלת גם את `TenantContext`, ולכן `ContactsService.getById` זרקה
 * „‏TenantContext missing” בתוך קליטת התשובה: **כל תשובת לקוח
 * ‏במייל החזירה 500 ואבדה**, והספק חזר ונכשל שוב על אותה הודעה.
 * ‏נמצא בבדיקת QA מול המערכת החיה; טיפוסים ובדיקות יחידה עברו,
 * ‏כי במכשיר `ContactsService` היה מזויף.
 *
 * ‏הבדיקה קוראת ל-`processInbound` **מחוץ** לכל הקשר, כמו הוובהוק
 * ‏עצמו, ובודקת מה ראתה שכבת הנתונים כשנגעו בה.
 */

const TENANT = "01TENANT0000000000000000AA";
const CONTACT = "01CONTACT000000000000000BB";

function serviceThatRecordsContext(seen: { tenantId?: string; threw?: unknown }): EmailInboxService {
  const prisma = {
    emailReplyToken: {
      findUnique: async () => ({
        tenantId: TENANT,
        contactId: CONTACT,
        sentByUserId: null,
        cardKind: null,
        cardId: null,
      }),
    },
    /* ‏כמו במציאות: קובעת דייר ל-RLS, ואינה נוגעת ב-`TenantContext` */
    withExplicitTenant: async <T>(_tenantId: string, fn: (tx: unknown) => Promise<T>): Promise<T> =>
      fn({}),
  };
  const contacts = {
    /* ‏הנקודה שבה נפל: קורא את ההקשר, ולא מקבל אותו כפרמטר */
    getById: async () => {
      try {
        seen.tenantId = TenantContext.current().tenantId;
      } catch (error: unknown) {
        seen.threw = error;
      }
      /* ‏`null` = לקוח שנמחק; הקליטה נעצרת כאן, וזה כל מה שנדרש לבדיקה */
      return null;
    },
  };
  return new EmailInboxService(
    prisma as never,
    {} as never,
    contacts as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

const PAYLOAD = {
  MailboxHash: "01TOKEN00000000000000000CC",
  From: "dana@example.com",
  FromName: "דנה",
  Subject: "Re: הודעה מהמשרד",
  StrippedTextReply: "מעולה, נתראה ביום שלישי",
  TextBody: "מעולה, נתראה ביום שלישי",
  MessageID: "msg-1",
  Headers: [],
  Attachments: [],
};

describe("קליטת תשובת לקוח מהוובהוק", () => {
  it("קובעת את הקשר הדייר לפני שהיא נוגעת בשכבת הנתונים", async () => {
    const seen: { tenantId?: string; threw?: unknown } = {};
    expect(TenantContext.maybeCurrent(), "הבדיקה חייבת לרוץ בלי הקשר").toBeUndefined();

    await serviceThatRecordsContext(seen).processInbound(PAYLOAD as never);

    expect(seen.threw, `שכבת הנתונים זרקה: ${String(seen.threw)}`).toBeUndefined();
    expect(seen.tenantId).toBe(TENANT);
  });

  it("והוא נגזר מהטוקן, לא מגוף הבקשה", async () => {
    const seen: { tenantId?: string; threw?: unknown } = {};
    await serviceThatRecordsContext(seen).processInbound({
      ...PAYLOAD,
      /* ‏ניסיון להשתיל דייר אחר מהקלט — אינו נקרא כלל */
      TenantId: "01OTHER00000000000000000ZZ",
    } as never);
    expect(seen.tenantId).toBe(TENANT);
  });

  it("ואינו נשאר דלוף אחרי שהקליטה הסתיימה", async () => {
    await serviceThatRecordsContext({}).processInbound(PAYLOAD as never);
    expect(TenantContext.maybeCurrent()).toBeUndefined();
  });
});
