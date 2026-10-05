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

  it("Magic Bytes: תוכן שתואם את ההצהרה נשאר בסוגו", () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
    const webp = Uint8Array.from([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")]);
    const gif = Uint8Array.from(Buffer.from("GIF89a"));
    const mp4 = Uint8Array.from([0, 0, 0, 0x18, ...Buffer.from("ftypisom")]);
    const webm = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]);
    expect(emailAttachmentKind("image/png", png)).toBe("image");
    expect(emailAttachmentKind("image/jpeg", jpeg)).toBe("image");
    expect(emailAttachmentKind("image/webp", webp)).toBe("image");
    expect(emailAttachmentKind("image/gif", gif)).toBe("image");
    expect(emailAttachmentKind("video/mp4", mp4)).toBe("video");
    expect(emailAttachmentKind("video/quicktime", mp4)).toBe("video");
    expect(emailAttachmentKind("video/webm", webm)).toBe("video");
  });

  it("Magic Bytes: ‏MOV ישן בלי ftyp — האטום הראשון יכול להיות moov/mdat/wide", () => {
    for (const atom of ["moov", "mdat", "wide", "free"]) {
      const mov = Uint8Array.from([0, 0, 0, 0x08, ...Buffer.from(atom)]);
      expect(emailAttachmentKind("video/quicktime", mov)).toBe("video");
      // ‏MP4 עדיין דורש ftyp — ההרחבה היא ל-QuickTime בלבד
      expect(emailAttachmentKind("video/mp4", mov)).toBe("file");
    }
  });

  it("Magic Bytes: הצהרת תמונה/וידאו על תוכן אחר יורדת ל-file (הורדה בלבד)", () => {
    const html = Uint8Array.from(Buffer.from("<html><script>alert(1)</script>"));
    expect(emailAttachmentKind("image/png", html)).toBe("file");
    expect(emailAttachmentKind("video/mp4", html)).toBe("file");
    // תוכן קצר מהחתימה — גם הוא אינו תמונה
    expect(emailAttachmentKind("image/png", Uint8Array.from([0x89]))).toBe("file");
  });

  it("Magic Bytes: מסמכים אינם נבדקים — מוגשים כהורדה ממילא", () => {
    const html = Uint8Array.from(Buffer.from("<html>"));
    expect(emailAttachmentKind("application/pdf", html)).toBe("file");
    // סוג מחוץ לרשימה נדחה גם עם תוכן תקין
    expect(emailAttachmentKind("text/html", html)).toBeNull();
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

  /*
   * ‎**התקרה כוללת את שלוש הנקודות.** הניסוח הראשון כאן אימת
   * ‎`max + 1` — כלומר קיבע בשער בדיוק את הבאג: העמודה של התמיכה
   * היא `VarChar(20000)`, ותו אחד מעבר מפיל את הכתיבה ומשאיר את
   * הוובהוק בלולאת ניסיונות.
   */
  it("ברירת המחדל היא תקרת תיבת הלקוחות", () => {
    expect(inboundBody(payload(long)).length).toBe(INBOUND_BODY_MAX);
  });

  /*
   * תיבת התמיכה הכריזה על תקרה משלה וחתכה אחרי הקריאה — כלומר על
   * טקסט שכבר קוצץ. התקרה נמסרת עכשיו פנימה, ולכן היא מתקיימת.
   */
  it("תקרה שנמסרת גוברת, ולא נחתכת פעמיים", () => {
    expect(inboundBody(payload(long), 20_000).length).toBe(20_000);
  });

  /*
   * העמודה של התמיכה היא בדיוק `VarChar(20000)`: תו אחד מעבר מפיל
   * את הכתיבה, הוובהוק מחזיר שגיאה, והספק מנסה שוב בלי סוף.
   */
  it("החתוך מסתיים בסימון, ובתוך התקרה", () => {
    const cut = inboundBody(payload(long), 100);
    expect(cut.length).toBe(100);
    expect(cut.endsWith("…")).toBe(true);
  });

  it("טקסט קצר מהתקרה אינו מסומן כחתוך", () => {
    expect(inboundBody(payload("שלום"), 20_000)).toBe("שלום");
  });
});
