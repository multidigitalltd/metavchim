import { describe, expect, it } from "vitest";
import {
  bankDetailsRejectionReason,
  isValidIsraeliBusinessId,
  maskAccountNumber,
  payoutRequestRejectionReason,
  payoutTransitionRejectionReason,
  type BankDetails,
} from "./payout.js";

const details = (over: Partial<BankDetails> = {}): BankDetails => ({
  holderName: "משרד הדגמה א׳ בע״מ",
  bankCode: "12",
  branch: "345",
  accountNumber: "12345678",
  businessId: "514667484",
  ...over,
});

describe("isValidIsraeliBusinessId", () => {
  it("ח.פ. תקין", () => {
    expect(isValidIsraeliBusinessId("514667484")).toBe(true);
  });

  it("ספרה שהוקלדה לא נכון נתפסת", () => {
    expect(isValidIsraeliBusinessId("514667485")).toBe(false);
  });

  it("אורך שגוי", () => {
    expect(isValidIsraeliBusinessId("51466748")).toBe(false);
    expect(isValidIsraeliBusinessId("5146674840")).toBe(false);
  });

  it("מקפים ורווחים אינם פוסלים מספר תקין", () => {
    expect(isValidIsraeliBusinessId("51-466 7484")).toBe(true);
  });
});

describe("bankDetailsRejectionReason", () => {
  it("פרטים מלאים ותקינים", () => {
    expect(bankDetailsRejectionReason(details())).toBeNull();
  });

  it("שם בעל חשבון חסר", () => {
    expect(bankDetailsRejectionReason(details({ holderName: " " }))).toContain("שם בעל החשבון");
  });

  it("קוד בנק עם אותיות", () => {
    expect(bankDetailsRejectionReason(details({ bankCode: "לאומי" }))).toContain("קוד הבנק");
  });

  it("מספר חשבון קצר מדי", () => {
    expect(bankDetailsRejectionReason(details({ accountNumber: "12" }))).toContain("מספר החשבון");
  });

  it("ח.פ. פסול נבדק גם כשכל השאר תקין", () => {
    expect(bankDetailsRejectionReason(details({ businessId: "123456789" }))).toContain("ח.פ.");
  });
});

describe("payoutRequestRejectionReason", () => {
  const MIN = 50_000; // 500 ₪

  it("סכום תקין מעל הסף ובתוך היתרה", () => {
    expect(payoutRequestRejectionReason(60_000, 100_000, MIN)).toBeNull();
  });

  it("מעבר ליתרה — נדחה, וההודעה אומרת כמה יש", () => {
    expect(payoutRequestRejectionReason(120_000, 100_000, MIN)).toContain("1,000");
  });

  it("מתחת לסף המינימלי", () => {
    expect(payoutRequestRejectionReason(10_000, 100_000, MIN)).toContain("500");
  });

  it("היתרה נבדקת לפני הסף — ההודעה השימושית היא זו שמדויקת", () => {
    // 100 ₪ מבוקש, 20 ₪ בקופה, סף 500: שתי הבעיות קיימות
    expect(payoutRequestRejectionReason(10_000, 2_000, MIN)).toContain("20");
  });

  it("אפס ושלילי", () => {
    expect(payoutRequestRejectionReason(0, 100_000, MIN)).not.toBeNull();
    expect(payoutRequestRejectionReason(-5, 100_000, MIN)).not.toBeNull();
  });

  it("שבר אגורה אינו סכום", () => {
    expect(payoutRequestRejectionReason(60_000.5, 100_000, MIN)).not.toBeNull();
  });

  it("סף אפס — כל סכום חיובי בתוך היתרה עובר", () => {
    expect(payoutRequestRejectionReason(100, 100_000, 0)).toBeNull();
  });
});

describe("payoutTransitionRejectionReason", () => {
  it("המסלול התקין", () => {
    expect(payoutTransitionRejectionReason("pending", "approved")).toBeNull();
    expect(payoutTransitionRejectionReason("approved", "paid")).toBeNull();
  });

  it("דחייה אפשרית בשני השלבים", () => {
    expect(payoutTransitionRejectionReason("pending", "rejected")).toBeNull();
    expect(payoutTransitionRejectionReason("approved", "rejected")).toBeNull();
  });

  it("בקשה ששולמה סגורה — זה השער מפני העברה כפולה", () => {
    expect(payoutTransitionRejectionReason("paid", "paid")).not.toBeNull();
    expect(payoutTransitionRejectionReason("paid", "approved")).not.toBeNull();
  });

  it("בקשה שנדחתה אינה קמה לתחייה", () => {
    expect(payoutTransitionRejectionReason("rejected", "approved")).not.toBeNull();
  });

  it("דילוג על האישור — תשלום ישירות מ\"ממתינה\" אינו מותר", () => {
    expect(payoutTransitionRejectionReason("pending", "paid")).not.toBeNull();
  });
});

describe("maskAccountNumber", () => {
  it("ארבע ספרות אחרונות בלבד", () => {
    expect(maskAccountNumber("12345678")).toBe("••••5678");
  });

  it("מספר קצר אינו נחשף בכלל", () => {
    expect(maskAccountNumber("123")).toBe("••••");
  });
});
