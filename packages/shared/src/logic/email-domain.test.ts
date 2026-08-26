import { describe, expect, it } from "vitest";
import {
  emailDomainDnsRecords,
  emailDomainRejectionReason,
  emailDomainStatus,
  formatSender,
  normalizeEmailDomain,
  senderAddressRejectionReason,
  senderNameRejectionReason,
} from "./email-domain.js";

describe("normalizeEmailDomain", () => {
  it("סולח למה שמנהלים באמת מדביקים", () => {
    expect(normalizeEmailDomain("  Office.Co.IL  ")).toBe("office.co.il");
    expect(normalizeEmailDomain("https://www.office.co.il/about")).toBe("office.co.il");
    expect(normalizeEmailDomain("info@office.co.il")).toBe("office.co.il");
    // נקודה בסוף — כך DNS מציג דומיינים
    expect(normalizeEmailDomain("office.co.il.")).toBe("office.co.il");
  });
});

describe("emailDomainRejectionReason", () => {
  it("דומיין תקין של משרד עובר", () => {
    expect(emailDomainRejectionReason("office.co.il")).toBeNull();
    expect(emailDomainRejectionReason("cohen-realty.com")).toBeNull();
    // דומיין עברי אחרי המרת Punycode
    expect(emailDomainRejectionReason("xn--4dbrk0ce.co.il")).toBeNull();
  });

  it("צורה פסולה נדחית לפני כל בדיקה אחרת", () => {
    expect(emailDomainRejectionReason("")).not.toBeNull();
    expect(emailDomainRejectionReason("office")).not.toBeNull();
    expect(emailDomainRejectionReason("-bad.co.il")).not.toBeNull();
    expect(emailDomainRejectionReason("a b.co.il")).not.toBeNull();
    // כתובת IP אינה דומיין לשליחת מייל
    expect(emailDomainRejectionReason("10.0.0.1")).not.toBeNull();
  });

  it("ספק דואר ציבורי נחסם — DKIM עליו לא יאומת לעולם", () => {
    expect(emailDomainRejectionReason("gmail.com")).toMatch(/ציבורי/u);
    expect(emailDomainRejectionReason("walla.co.il")).toMatch(/ציבורי/u);
    // גם תת-דומיין של ספק ציבורי
    expect(emailDomainRejectionReason("mail.gmail.com")).toMatch(/ציבורי/u);
  });

  it("הדומיין של הפלטפורמה עצמה חסום — משרד אינו שולח בשמה", () => {
    expect(emailDomainRejectionReason("metavchim.co.il")).not.toBeNull();
  });
});

describe("senderAddressRejectionReason", () => {
  it("כתובת על הדומיין שחובר עוברת", () => {
    expect(senderAddressRejectionReason("info@office.co.il", "office.co.il")).toBeNull();
  });

  it("דומיין אחר או תת-דומיין נדחים — היו יוצאים לא חתומים", () => {
    expect(senderAddressRejectionReason("info@other.co.il", "office.co.il")).not.toBeNull();
    expect(senderAddressRejectionReason("info@mail.office.co.il", "office.co.il")).not.toBeNull();
  });

  it("כתובת שאינה כתובת נדחית", () => {
    expect(senderAddressRejectionReason("לא כתובת", "office.co.il")).not.toBeNull();
    expect(senderAddressRejectionReason("@office.co.il", "office.co.il")).not.toBeNull();
  });
});

describe("senderNameRejectionReason", () => {
  it("שם משרד רגיל עובר, כולל גרש בעברית", () => {
    expect(senderNameRejectionReason("משרד כהן נדל״ן")).toBeNull();
  });

  it("תווי הזרקת כותרות נפסלים ולא מנוקים בשקט", () => {
    expect(senderNameRejectionReason('כהן "נדל')).not.toBeNull();
    expect(senderNameRejectionReason("כהן\nBcc: x@y.com")).not.toBeNull();
    expect(senderNameRejectionReason("כהן <x@y.com>")).not.toBeNull();
  });

  it("קצר מדי או ארוך מדי", () => {
    expect(senderNameRejectionReason(" א ")).not.toBeNull();
    expect(senderNameRejectionReason("א".repeat(81))).not.toBeNull();
  });
});

describe("formatSender", () => {
  it("הצורה שהנמען רואה", () => {
    expect(formatSender(" משרד כהן ", "info@office.co.il")).toBe(
      '"משרד כהן" <info@office.co.il>',
    );
  });
});

describe("emailDomainStatus", () => {
  it("מאומת רק כששתי הרשומות אומתו — חצי חיבור פוגע במסירה", () => {
    expect(emailDomainStatus({ dkimVerified: true, returnPathVerified: true })).toBe("verified");
    expect(emailDomainStatus({ dkimVerified: true, returnPathVerified: false })).toBe("pending");
    expect(emailDomainStatus({ dkimVerified: false, returnPathVerified: true })).toBe("pending");
  });
});

describe("emailDomainDnsRecords", () => {
  it("שתי רשומות בסדר קבוע, כל אחת עם הסטטוס שלה", () => {
    const records = emailDomainDnsRecords(
      {
        dkimHost: "pm._domainkey.office.co.il",
        dkimValue: "k=rsa;p=ABC",
        returnPathHost: "pm-bounces.office.co.il",
        returnPathValue: "pm.mtasv.net",
      },
      { dkimVerified: true, returnPathVerified: false },
    );
    expect(records.map((r) => r.purpose)).toEqual(["dkim", "return_path"]);
    expect(records[0]).toMatchObject({ type: "TXT", verified: true });
    expect(records[1]).toMatchObject({ type: "CNAME", value: "pm.mtasv.net", verified: false });
  });
});
