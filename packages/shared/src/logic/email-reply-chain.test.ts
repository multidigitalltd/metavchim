import { describe, expect, it } from "vitest";
import {
  checkReplyChain,
  replyChainVerdict,
  REPLY_CHAIN_SAMPLE_TOKEN,
  REPLY_LOCAL_MAX,
  type ReplyChainStepId,
} from "./email-reply-chain.js";

/** ‏באיזה שלב נעצרה השרשרת — `null` כשהיא שלמה. */
function failedAt(address: string | null): ReplyChainStepId | null {
  const result = checkReplyChain(address);
  return result.steps.find((step) => !step.ok)?.id ?? null;
}

describe("שרשרת התשובה — המסלול השלם", () => {
  it("כתובת תקינה עוברת את כל השלבים ומחזירה כתובת תשובה", () => {
    const result = checkReplyChain("reply@inbound.metavchim.co.il");
    expect(result.ok).toBe(true);
    expect(result.sampleReplyTo).toBe(
      `reply+${REPLY_CHAIN_SAMPLE_TOKEN}@inbound.metavchim.co.il`,
    );
    expect(result.steps.every((step) => step.ok)).toBe(true);
  });

  it("כל שלב שנכשל נושא הסבר מה לעשות, ולא רק „לא תקין”", () => {
    for (const address of [null, "", "לא-כתובת", `${"a".repeat(50)}@x.co.il`]) {
      const result = checkReplyChain(address);
      const failed = result.steps.find((step) => !step.ok);
      expect(failed, `${String(address)} היה אמור להיכשל`).toBeDefined();
      expect(failed!.fix, `${String(address)} נכשל בלי הסבר`).toBeTruthy();
    }
  });
});

describe("שרשרת התשובה — שלוש נקודות הקטיעה השקטות", () => {
  it("בלי הגדרה — נעצר בשלב הראשון", () => {
    expect(failedAt(null)).toBe("address");
    expect(failedAt("")).toBe("address");
  });

  /*
   * ‏החלק המקומי נכנס ל-64 יחד עם „+” וטוקן בן 26, ולכן 37 הוא
   * ‏הגבול. מעבר לו `replyAddressFor` מחזיר `null` **בשקט**: המייל
   * ‏יוצא בלי כתובת תשובה, והתשובה חוזרת לכתובת השולח.
   */
  it("חלק מקומי ארוך מדי — נעצר בבניית הכתובת, והמספר נאמר", () => {
    expect(REPLY_LOCAL_MAX).toBe(37);
    expect(failedAt(`${"a".repeat(REPLY_LOCAL_MAX)}@x.co.il`)).toBe(null);
    const tooLong = checkReplyChain(`${"a".repeat(REPLY_LOCAL_MAX + 1)}@x.co.il`);
    expect(failedAt(`${"a".repeat(REPLY_LOCAL_MAX + 1)}@x.co.il`)).toBe("reply_to");
    expect(tooLong.steps.find((s) => !s.ok)!.detail).toContain(String(REPLY_LOCAL_MAX + 1));
  });

  /*
   * ‎**המקרה שבגללו הבדיקה אינה טאוטולוגיה.**
   *
   * ‏`reply+office@…` היא כתובת תקינה לחלוטין; `replyAddressFor`
   * ‏מקבל אותה ובונה `reply+office+<ULID>@…`. הספק מוסר את כל מה
   * ‏שאחרי ה-„+” הראשון, כלומר `office+<ULID>` — שאינו ULID, ולכן
   * ‏**כל תשובה של כל לקוח בכל המשרדים** נוחתת בתמיכה. שום שדה
   * ‏בהגדרות אינו נראה שגוי.
   */
  it("„+” בחלק המקומי — הכתובת נבנית, והטוקן חוזר מעוות", () => {
    const address = "reply+office@inbound.metavchim.co.il";
    const result = checkReplyChain(address);
    expect(result.sampleReplyTo).toBe(
      `reply+office+${REPLY_CHAIN_SAMPLE_TOKEN}@inbound.metavchim.co.il`,
    );
    expect(failedAt(address)).toBe("mailbox_hash");
    const failed = result.steps.find((step) => !step.ok)!;
    expect(failed.detail).toContain(`office+${REPLY_CHAIN_SAMPLE_TOKEN}`);
    expect(failed.fix).toContain("+");
  });
});

describe("מסקנת הבדיקה — מה מונה הטוקנים מוכיח, ומה לא", () => {
  /*
   * ‏`replyAddressFor` כותב את שורת הטוקן **לפני** שהוא בונה את
   * ‏הכתובת, ולכן חלק מקומי ארוך מדי מייצר טוקן ואז מחזיר `null`:
   * ‏שורה קיימת, ושום כותרת לא יצאה. גם שינוי הגדרות משאיר שורות
   * ‏היסטוריות. „יש טוקנים” אינו מוכיח שיצאו מיילים עם Reply-To,
   * ‏ומסקנה כזו הייתה שולחת את המנהל לחפש בחצי הלא נכון
   * ‏(ביקורת Codex).
   */
  it("שרשרת שבורה — המסקנה אינה טוענת דבר על מה שיצא", () => {
    for (const tokensIssued of [0, 1, 5000]) {
      const verdict = replyChainVerdict({ chainOk: false, tokensIssued });
      expect(verdict).toContain("השלב המסומן");
      expect(verdict).not.toContain("יוצאים עם כתובת תשובה");
    }
  });

  /** ‏ובכיוון ההפוך המונה כן חד-משמעי: אפס שורות = לא יצא כלום. */
  it("אפס טוקנים — זה כן ניתן לקבוע", () => {
    expect(replyChainVerdict({ chainOk: true, tokensIssued: 0 })).toContain("לא נשא Reply-To");
  });

  it("שרשרת תקינה עם טוקנים — הטענה על ההווה, לא על ההיסטוריה", () => {
    const verdict = replyChainVerdict({ chainOk: true, tokensIssued: 412 });
    expect(verdict).toContain("עכשיו");
  });
});
