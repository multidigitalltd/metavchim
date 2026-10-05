import { describe, expect, it } from "vitest";
import { agentReplySegments, externalLinkLabel } from "./reply-plan.js";

describe("תוכנית התשובה — הרכב וסדר אחד לשני הערוצים", () => {
  it("הסדר: מסקנה, תובנה, נתונים, קישורים, צעדים", () => {
    const kinds = agentReplySegments({
      message: "3 קונים",
      insight: "אחד מהם חם",
      data: { buyers: [] },
      href: "/buyers",
      link: "https://wa.me/x",
      nextSteps: [{ text: "לשלוח הצעה?", label: "📤 שלח" }],
      suggestion: "לא אמור להופיע",
    }).map((segment) => segment.kind);
    expect(kinds).toEqual([
      "headline",
      "insight",
      "data",
      "screen-link",
      "external-link",
      "steps",
    ]);
  });

  it("suggestion רק כשאין אף צעד נגזר — לא שתי עצות באותה תשובה", () => {
    const kinds = agentReplySegments({
      message: "בוצע",
      suggestion: "לקבוע סיור?",
    }).map((segment) => segment.kind);
    expect(kinds).toEqual(["headline", "suggestion"]);
  });

  it("מקטע ריק אינו נפלט — אין שורות רפאים", () => {
    expect(agentReplySegments({ message: "", insight: "" })).toEqual([]);
  });
});

/*
 * ‎**התווית של הקישור — נגזרת, לא קבועה.**
 *
 * ‏במסך הייתה כתובה „פתיחה בוואטסאפ” ללא תנאי, ולכן קישור לטופס
 * ‏קליטה פתוח — פעולה שאין לה נמען בוואטסאפ כלל — הבטיח וואטסאפ
 * ‏ופתח טופס. עכשיו הכלל אחד לשני הערוצים, וכאן הוא נבדק.
 */
describe("externalLinkLabel — מה כתוב על הקישור", () => {
  it("קישורי וואטסאפ מקבלים את התווית של וואטסאפ", () => {
    for (const url of [
      "https://wa.me/972500000000",
      "https://wa.me/972500000000?text=%D7%A9%D7%9C%D7%95%D7%9D",
      "https://api.whatsapp.com/send?phone=1",
      "https://web.whatsapp.com/send",
      "HTTPS://WA.ME/1",
    ]) {
      expect(externalLinkLabel(url)).toBe("פתיחה בוואטסאפ");
    }
  });

  it("כל השאר — תווית כללית, שאינה מבטיחה ערוץ", () => {
    for (const url of [
      "https://app.example.com/f/abc123",
      "https://example.com/p/token",
      "http://localhost:3000/f/abc",
    ]) {
      expect(externalLinkLabel(url)).toBe("פתיחת הקישור");
    }
  });

  /*
   * ‏המארח הוא מה שאחרי ה-`@` האחרון: `wa.me` לפניו הוא שם משתמש,
   * ‏והדפדפן ילך ל-`evil.example`. „מכיל wa.me” היה נופל כאן.
   */
  it("כתובת שמתחזה לוואטסאפ אינה מקבלת את התווית שלו", () => {
    expect(externalLinkLabel("https://wa.me@evil.example/x")).toBe("פתיחת הקישור");
    expect(externalLinkLabel("https://evil.example/wa.me/x")).toBe("פתיחת הקישור");
    expect(externalLinkLabel("https://not-wa.me/x")).toBe("פתיחת הקישור");
  });

  it("מארח עם פורט עדיין מזוהה נכון", () => {
    expect(externalLinkLabel("https://wa.me:443/1")).toBe("פתיחה בוואטסאפ");
  });

  it("כתובת שאינה נפרסת אינה מסווגת, ואינה זורקת", () => {
    for (const url of ["", "לא כתובת", "javascript:alert(1)", "https://"]) {
      expect(externalLinkLabel(url)).toBe("פתיחת הקישור");
    }
  });

  it("המקטע נושא את התווית, כדי ששני הערוצים יאמרו אותו דבר", () => {
    const [segment] = agentReplySegments({ message: "מוכן", link: "https://app.example.com/f/x" });
    expect(agentReplySegments({ message: "", link: "https://wa.me/1" })[0]).toMatchObject({
      kind: "external-link",
      label: "פתיחה בוואטסאפ",
    });
    expect(segment).toMatchObject({ kind: "headline" });
  });
});
