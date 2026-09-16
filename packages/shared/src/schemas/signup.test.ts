import { describe, expect, it } from "vitest";
import { SIGNUP_PASSWORD_MIN, SignupInputSchema } from "./signup.js";

/**
 * ‏הבאג שנסגר: „לקוחות מתלוננים שלא ניתן לפתוח חשבון חינמי — זה
 * ‏כותב קלט לא תקין”. הטופס `noValidate`, ולכן כל שדה הגיע לשרת
 * ‏כמות שהוא; התבנית הפרטית של הטלפון פסלה צורות רגילות לגמרי,
 * ‏והמסך אמר רק „קלט לא תקין” בלי לומר איזה שדה.
 */
const base = {
  agencyName: "שישא ריאלטי",
  ownerName: "משה לוי",
  email: "moshe@example.co.il",
  password: "סיסמה-ארוכה-דיה",
  plan: "free",
  acceptTerms: true as const,
};

describe("סכימת ההרשמה — טלפון", () => {
  /** ‏כל אלה נדחו קודם ב„קלט לא תקין”, וכולם מספרים תקינים. */
  it.each([
    ["סוגריים סביב הקידומת", "(054) 1234567"],
    ["נקודות במקום מקפים", "054.123.4567"],
    ["רווח קשיח מהדבקה", "050 1234567"],
    ["סימן כיווניות מהדבקה בדף עברי", "‎0501234567"],
    ["מקף ארוך", "050–1234567"],
    ["בלי אפס מוביל, כפי שאקסל שומר", "541234567"],
  ])("מקבל %s", (_label, phone) => {
    const parsed = SignupInputSchema.safeParse({ ...base, phone });
    expect(parsed.success).toBe(true);
  });

  /** ‏הנרמול הוא גם מה שמייצר את הפורמט ש-`UserSchema.phone` דורש. */
  it("שומר E.164 ולא את מה שהוקלד", () => {
    const parsed = SignupInputSchema.parse({ ...base, phone: "(054) 123-4567" });
    expect(parsed.phone).toBe("+972541234567");
  });

  it("שדה ריק תקין — הטלפון אינו חובה", () => {
    expect(SignupInputSchema.parse({ ...base, phone: "" }).phone).toBe("");
    expect(SignupInputSchema.parse(base).phone).toBeUndefined();
  });

  it("מספר שאינו ישראלי עדיין נדחה, ובהודעה שאומרת מה לתקן", () => {
    const parsed = SignupInputSchema.safeParse({ ...base, phone: "12345" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.path).toEqual(["phone"]);
    expect(parsed.error.issues[0]?.message).toContain("טלפון");
  });
});

describe("סכימת ההרשמה — כל פסילה אומרת מה לתקן", () => {
  /*
   * ‏זה עיקר התיקון: לא „קלט לא תקין” אלא שדה ומשפט בעברית. בדיקה
   * ‏על ההודעה ולא רק על הפסילה, כי הפסילה עצמה עבדה כל הזמן — מה
   * ‏שנשבר הוא שהלקוח לא ידע מה לעשות איתה.
   */
  it.each([
    ["password", { password: "1".repeat(SIGNUP_PASSWORD_MIN - 1) }],
    ["email", { email: "moshe@gmail" }],
    ["agencyName", { agencyName: "ש" }],
    ["ownerName", { ownerName: "" }],
    ["plan", { plan: "" }],
    ["acceptTerms", { acceptTerms: false }],
  ])("שדה %s — נתיב והודעה בעברית", (field, patch) => {
    const parsed = SignupInputSchema.safeParse({ ...base, ...patch });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const issue = parsed.error.issues.find((row) => row.path[0] === field);
    expect(issue, `אין ממצא על ${field}`).toBeDefined();
    expect(issue!.message).toMatch(/[֐-׿]/u);
  });
});
