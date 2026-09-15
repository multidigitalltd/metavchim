import { readFileSync } from "node:fs";
import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { Capability } from "@metavchim/shared";
import { assertCanHandOverLead } from "./agent-names";
import { TenantContext } from "./tenant-context";

/**
 * ‎**„בין סוכנים ניתן להעביר לידים בלבד” — ומה מחזיק את הגבול.**
 *
 * ‏העברת כרטיס בין סוכנים היא פעולת מנהל בכל המערכת: משימה, קונה,
 * ‏נכס. ליד הוא היוצא מן הכלל היחיד (הכרעת בעלת המוצר), ומה שמונע
 * ‏מהחריג הזה להיות פרצה הוא **הכיוון**: סוכן יכול לוותר על מה
 * ‏שבידיו, ואינו יכול למשוך אליו את הליד של עמית.
 *
 * ‏אלמלא כן, כל סוכן במשרד היה יכול לקחת לעצמו כל ליד — כלומר גישה
 * ‏לנתונים של סוכן אחר, בדיוק מה שהבידוד קיים כדי למנוע.
 */

const CTX = (capabilities: Capability[], userId = "01ME") => ({
  tenantId: "01TENANT",
  userId,
  capabilities: new Set(capabilities),
  billingOnly: false,
});

describe("assertCanHandOverLead", () => {
  it("מנהל עם tasks.assign מוסר כל ליד שהוא רואה", () => {
    TenantContext.run(CTX(["leads.edit", "tasks.assign"]), () => {
      expect(() => assertCanHandOverLead("01OTHER")).not.toThrow();
      expect(() => assertCanHandOverLead(null)).not.toThrow();
    });
  });

  it("סוכן רגיל מוסר את הליד שמשויך אליו — בלי הרשאת מנהל", () => {
    TenantContext.run(CTX(["leads.edit"]), () => {
      expect(() => assertCanHandOverLead("01ME")).not.toThrow();
    });
  });

  /*
   * ‎**זו הבדיקה שהחריג עומד או נופל עליה.** בלעדיה „העברה בין
   * ‏סוכנים” פירושה שכל סוכן יכול לקחת לעצמו ליד של עמית.
   */
  it("סוכן רגיל אינו לוקח ליד של עמית", () => {
    TenantContext.run(CTX(["leads.edit"]), () => {
      expect(() => assertCanHandOverLead("01OTHER")).toThrow(ForbiddenException);
    });
  });

  /*
   * ‎**ליד ללא שיוך אינו „שלי”.** הוא של המשרד, וחלוקתו היא החלטה
   * ‏של מנהל — לא מי שהגיע ראשון.
   */
  it("ליד ללא שיוך נשאר פעולת מנהל", () => {
    TenantContext.run(CTX(["leads.edit"]), () => {
      expect(() => assertCanHandOverLead(null)).toThrow(ForbiddenException);
    });
  });
});

/**
 * ‏מה שאפשר להסיר בשורה אחת בלי שבדיקה תרגיש: אחת משלוש השאלות
 * ‏שהמסירה שואלת, או החלפתה בשער הרחב שהיא באה להחליף.
 */
const leads = readFileSync(
  new URL("../modules/leads/leads.service.ts", import.meta.url),
  "utf8",
);
const handOver = leads.slice(leads.indexOf("async handOver("), leads.indexOf("async updateStatus("));

describe("מסירת ליד — שלוש שאלות, ולא אחת", () => {
  /*
   * ‏„הליד נראה לי” נשאלת **ראשונה**. אילו הייתה נשאלת אחריה,
   * ‏ההודעה „אפשר למסור רק ליד שמשויך אליך” הייתה מגלה שקיים ליד
   * ‏כזה — כלומר מדליפה על ליד שאיני רואה.
   */
  it("קודם נשאל אם הליד בכלל נראה לי", () => {
    expect(handOver).toContain("await assertLeadAccess(tx, ctx.tenantId, id);");
    expect(handOver.indexOf("assertLeadAccess")).toBeLessThan(
      handOver.indexOf("assertCanHandOverLead"),
    );
  });

  it("ואז אם מותר לי למסור אותו", () => {
    expect(handOver).toContain("assertCanHandOverLead(lead.assignedToUserId);");
  });

  /*
   * ‎**בתוך הטרנזקציה הכותבת.** בדיקה מוקדמת בלבד היא חלון שבו
   * ‏הסוכן הוסר מהמשרד בין הבדיקה לכתיבה — וכתיבת מזהה זר בתוך
   * ‏הדייר שלנו היא בדיוק מה שהבידוד מונע.
   */
  it("והיעד הוא סוכן של אותו משרד", () => {
    expect(handOver).toContain("await assertAgentInOffice(tx, ctx.tenantId, agentUserId)");
  });

  /*
   * ‏החריג הוא **ללידים בלבד**. שער רחב כאן היה מבטל את הבקשה;
   * ‏החלפת השער הצר ברחב במקומות האחרים הייתה מרחיבה אותה לכל
   * ‏הכרטיסים.
   */
  it("ואינה נשענת על השער הרחב של „העברה היא פעולת מנהל”", () => {
    expect(handOver).not.toContain("assertCanAssignAgents");
  });

  it("ומסנן הבעלות חל גם על השליפה עצמה", () => {
    expect(handOver).toContain("...leadOwnershipFilter()");
  });

  /*
   * ‎**וההרשאה נאכפת שוב ברגע הכתיבה** (ביקורת Codex).
   *
   * ‏כאן, בשונה מכל העברה אחרת, **ההרשאה נגזרת מהבעלים**: „מותר לי
   * ‏כי הליד שלי”. לכן קריאה ישנה אינה מירוץ על ערך אלא הרשאה
   * ‏שניתנה על מצב שכבר אינו קיים — סוכן קרא „שלי”, מנהל העביר
   * ‏בינתיים, וכתיבה בלתי מותנית דורסת את הבעלים החדש בסמכות
   * ‏שפקעה. התנאי על העמודה נאכף במסד מול כל כותב, גם מי שאינו
   * ‏לוקח נעילה.
   */
  it("והכתיבה מותנית בבעלים שעליו ניתנה הרשות", () => {
    expect(handOver).toContain(
      "where: { id, tenantId: ctx.tenantId, assignedToUserId: lead.assignedToUserId }",
    );
  });

  /* ‏„זז בינתיים” אינו כישלון שקט ואינו הצלחה — המוסר צריך לדעת */
  it("וכשהליד זז בינתיים המסירה נאמרת ככזו שלא קרתה", () => {
    expect(handOver).toContain("if (updated.count === 0)");
    expect(handOver).toContain("ConflictException");
  });
});
