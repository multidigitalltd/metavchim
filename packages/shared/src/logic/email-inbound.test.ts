import { describe, expect, it } from "vitest";
import {
  INBOUND_BODY_MAX,
  InboundEmailPayloadSchema,
  emailAttachmentKind,
  inboundBody,
  inboundProviderMessageId,
  inboundSubject,
  inboundToken,
  replyAddressFor,
  safeAttachmentName,
} from "./email-inbound.js";

const payload = (overrides: Record<string, unknown> = {}) =>
  InboundEmailPayloadSchema.parse({
    MailboxHash: "01HZXK7M9QW3ERTYUPASDFGHJK",
    From: "dana@example.com",
    FromName: "דנה",
    Subject: "Re: נכס חדש שמתאים לחיפוש שלכם",
    StrippedTextReply: "מעניין אותי! אפשר לתאם ביקור מחר?",
    TextBody: "מעניין אותי! אפשר לתאם ביקור מחר?\n\n> ההודעה המקורית...",
    MessageID: "abc-123",
    ...overrides,
  });

describe("replyAddressFor", () => {
  it("מרכיב כתובת Plus תקינה מכתובת הבסיס והטוקן", () => {
    expect(replyAddressFor("reply@in.metavchim.co.il", "01HZXK7M9QW3ERTYUPASDFGHJK")).toBe(
      "reply+01HZXK7M9QW3ERTYUPASDFGHJK@in.metavchim.co.il",
    );
  });

  it("כתובת בסיס שבורה או טוקן עוין — null, לא כתובת שבורה", () => {
    expect(replyAddressFor("not-an-address", "01HZXK7M9QW3ERTYUPASDFGHJK")).toBeNull();
    expect(replyAddressFor("reply@", "01HZXK7M9QW3ERTYUPASDFGHJK")).toBeNull();
    expect(replyAddressFor("reply@in.example", "a@b")).toBeNull();
    expect(replyAddressFor("reply@in.example", "")).toBeNull();
  });

  it("חלק מקומי מעל 64 תווים נדחה — גבול התקן, לא שלנו", () => {
    const longLocal = "x".repeat(40);
    expect(replyAddressFor(`${longLocal}@in.example`, "01HZXK7M9QW3ERTYUPASDFGHJK")).toBeNull();
  });
});

describe("inboundToken", () => {
  it("מקבל ULID תקין בלבד — הכותרת ניתנת לזיוף וזה רק מפתח חיפוש", () => {
    expect(inboundToken(payload())).toBe("01HZXK7M9QW3ERTYUPASDFGHJK");
    expect(inboundToken(payload({ MailboxHash: "" }))).toBeNull();
    expect(inboundToken(payload({ MailboxHash: "abc" }))).toBeNull();
    expect(inboundToken(payload({ MailboxHash: "' OR 1=1 --" }))).toBeNull();
  });
});

describe("inboundBody", () => {
  it("מעדיף את התשובה החשופה על הטקסט המלא עם הציטוט", () => {
    expect(inboundBody(payload())).toBe("מעניין אותי! אפשר לתאם ביקור מחר?");
  });

  it("בלי הפרדה של הספק — הטקסט המלא; ריק נשאר ריק", () => {
    expect(inboundBody(payload({ StrippedTextReply: "" }))).toContain("ההודעה המקורית");
    expect(inboundBody(payload({ StrippedTextReply: "", TextBody: "  " }))).toBe("");
  });

  it("הודעת ענק נחתכת — הקליטה לא נופלת על עותק של 2MB", () => {
    const body = inboundBody(payload({ StrippedTextReply: "א".repeat(INBOUND_BODY_MAX * 2) }));
    expect(body.length).toBeLessThanOrEqual(INBOUND_BODY_MAX + 1);
    expect(body.endsWith("…")).toBe(true);
  });
});

describe("inboundSubject", () => {
  it("נושא ריק מקבל תווית, לא מחרוזת ריקה במסך", () => {
    expect(inboundSubject(payload({ Subject: "  " }))).toBe("(ללא נושא)");
    expect(inboundSubject(payload())).toContain("Re:");
  });
});

describe("emailAttachmentKind", () => {
  it("רשימה סגורה: מוכר ⟵ סוג, לא מוכר ⟵ null", () => {
    expect(emailAttachmentKind("image/jpeg")).toBe("image");
    expect(emailAttachmentKind("video/mp4")).toBe("video");
    expect(emailAttachmentKind("application/pdf")).toBe("file");
    expect(emailAttachmentKind("text/html")).toBeNull();
    expect(emailAttachmentKind("image/svg+xml")).toBeNull();
    expect(emailAttachmentKind("application/x-msdownload")).toBeNull();
  });

  it("פרמטרים ואותיות גדולות אינם עוקפים את הרשימה", () => {
    expect(emailAttachmentKind("Image/JPEG; charset=utf-8")).toBe("image");
    expect(emailAttachmentKind(" text/plain ; boundary=x")).toBe("file");
  });
});

describe("safeAttachmentName", () => {
  it("מנקה נתיבים, ציטוטים ותווי שליטה — השם הוא תוכן, לא נתיב", () => {
    expect(safeAttachmentName("../../etc/passwd")).not.toContain("/");
    expect(safeAttachmentName("a\\b\\c.doc")).not.toContain("\\");
    expect(safeAttachmentName('חוזה "סופי".pdf')).toBe("חוזה סופי.pdf");
    expect(safeAttachmentName("a\u0000b\u001fc.txt")).toBe("abc.txt");
  });

  it("ריק מקבל שם, ושם ענק נחתך מהסוף — הסיומת נשמרת", () => {
    expect(safeAttachmentName("   ")).toBe("קובץ");
    const long = `${"א".repeat(300)}.pdf`;
    const safe = safeAttachmentName(long);
    expect(safe.length).toBeLessThanOrEqual(120);
    expect(safe.endsWith(".pdf")).toBe(true);
  });
});

describe("InboundEmailPayloadSchema", () => {
  it("סובלני לשדות נוספים של הספק וקשוח על מה שנקרא", () => {
    const parsed = InboundEmailPayloadSchema.parse({
      MailboxHash: "x",
      SomeNewProviderField: { nested: true },
    });
    expect(parsed.Subject).toBe("");
    expect(parsed.TextBody).toBe("");
  });
});

/**
 * ‎**„אין מזהה” אינו מזהה, ותקרה אחת אינה חלה על שתי תיבות.**
 *
 * שני כללים שתיבת התמיכה החמיצה בהעתקה מתיבת הלקוחות, ולכן הם כאן
 * ולא בכל תיבה בנפרד.
 */
describe("מזהה ההודעה מהספק", () => {
  const base = InboundEmailPayloadSchema.parse({});

  it("מחרוזת ריקה אינה מזהה", () => {
    expect(inboundProviderMessageId({ ...base, MessageID: "" })).toBeNull();
  });

  /*
   * העמודה ייחודית: מחרוזת ריקה שנשמרת כערך אמיתי נתפסת על ידי
   * ההודעה הראשונה בלי מזהה, וכל הבאות נדחות כ„כפילות”.
   */
  it("גם רווחים בלבד אינם מזהה", () => {
    expect(inboundProviderMessageId({ ...base, MessageID: "   " })).toBeNull();
  });

  it("מזהה אמיתי חוזר כמות שהוא", () => {
    expect(inboundProviderMessageId({ ...base, MessageID: "abc-123" })).toBe("abc-123");
  });
});

describe("תקרת הגוף", () => {
  const long = "א".repeat(30_000);
  const payload = (text: string) =>
    InboundEmailPayloadSchema.parse({ TextBody: text, StrippedTextReply: "" });

  it("ברירת המחדל היא תקרת תיבת הלקוחות", () => {
    expect(inboundBody(payload(long)).length).toBe(INBOUND_BODY_MAX + 1);
  });

  /*
   * תיבת התמיכה הכריזה על תקרה משלה וחתכה אחרי הקריאה — כלומר על
   * טקסט שכבר קוצץ. התקרה נמסרת עכשיו פנימה, ולכן היא מתקיימת.
   */
  it("תקרה שנמסרת גוברת, ולא נחתכת פעמיים", () => {
    expect(inboundBody(payload(long), 20_000).length).toBe(20_001);
  });

  it("טקסט קצר מהתקרה אינו מסומן כחתוך", () => {
    expect(inboundBody(payload("שלום"), 20_000)).toBe("שלום");
  });
});
