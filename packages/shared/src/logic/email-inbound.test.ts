import { describe, expect, it } from "vitest";
import {
  INBOUND_BODY_MAX,
  InboundEmailPayloadSchema,
  inboundBody,
  inboundSubject,
  inboundToken,
  replyAddressFor,
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
