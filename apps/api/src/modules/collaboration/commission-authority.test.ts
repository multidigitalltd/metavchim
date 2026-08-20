import { describe, expect, it } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import { AGENT_ACTIONS, type Capability } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { ListingsService } from "./listings.service";

/**
 * מי רשאי לשנות את תנאי השת"פ, ועל מה השינוי חל.
 *
 * ## הכלל
 *
 * חלוקת העמלה אינה העדפה פנימית אלא **התחייבות כלפי משרד אחר**:
 * הוא רואה אותה בלוח ומחליט לפיה אם להשקיע נכס או קונה. עד כה
 * השליפה סוננה לפי `tenantId` בלבד, ולכן כל סוכן במשרד יכול היה
 * להוריד את חלקו של עמית — או להוריד את הפרסום שלו כליל — בלי
 * ידיעתו ואחרי שמשרדים אחרים כבר ראו את התנאים.
 *
 * אצל הקונה הבעלות קיימת (`Buyer.ownerUserId`) ולכן היא הכלל שם.
 * לנכס אין בעלים ברמת הסוכן — נכסים גלויים לכל המשרד בכוונה — ולכן
 * הבעלות היא על **תנאי הפרסום**, כלומר מי שקבע אותם.
 */

function asAgent<T>(capabilities: Capability[], userId: string, fn: () => T): T {
  return TenantContext.run(
    { tenantId: "01TENANT", userId, capabilities: new Set(capabilities), billingOnly: false },
    fn,
  );
}

/**
 * השער בלבד — אין מסד, ואין צורך בו כדי לבדוק מי נחסם.
 *
 * שתי הצורות נבדקות יחד על אותו `this`: `canManage` ב-DTO נגזר
 * מהחיזוי, והשער זורק לפיו. אם הם ייפרדו, המסך יסתיר כפתור שהשרת
 * מאשר — או יציג כפתור שייכשל.
 */
const proto = ListingsService.prototype as unknown as {
  assertListingOwner: (listing: { createdBy: string | null }) => void;
  mayManageListing: (listing: { createdBy: string | null }) => boolean;
};
const self = { mayManageListing: proto.mayManageListing };

function gateCall(listing: { createdBy: string | null }): void {
  proto.assertListingOwner.call(self, listing);
}

function mayManage(listing: { createdBy: string | null }): boolean {
  return proto.mayManageListing.call(self, listing);
}

describe("מי משנה תנאי פרסום ברשת", () => {
  it("הסוכן שפרסם — כן", () => {
    expect(() =>
      asAgent(["collaboration.share"], "01ME", () => gateCall({ createdBy: "01ME" })),
    ).not.toThrow();
  });

  it("סוכן אחר במשרד — לא", () => {
    expect(() =>
      asAgent(["collaboration.share"], "01ME", () => gateCall({ createdBy: "01OTHER" })),
    ).toThrow(ForbiddenException);
  });

  it("מנהל עם collaboration.manage_all — כן", () => {
    expect(() =>
      asAgent(["collaboration.manage_all"], "01ME", () => gateCall({ createdBy: "01OTHER" })),
    ).not.toThrow();
  });

  /*
   * פרסום שקדם לעמודה נשאר בידי מנהל בלבד. ברירת המחדל ההפוכה —
   * „אין מפרסם ידוע, שכולם יוכלו” — הייתה משאירה בדיוק את הפרסומים
   * הוותיקים, שסביבם כבר יש שיתופי פעולה, ללא הגנה.
   */
  it("פרסום ישן בלי מפרסם ידוע אינו נפתח לכל המשרד", () => {
    expect(() =>
      asAgent(["collaboration.share"], "01ME", () => gateCall({ createdBy: null })),
    ).toThrow(ForbiddenException);
    expect(() =>
      asAgent(["collaboration.manage_all"], "01ME", () => gateCall({ createdBy: null })),
    ).not.toThrow();
  });

  /*
   * מה שהמסך מציג ומה שהשרת אוכף — אותו חישוב.
   *
   * `canManage` ב-DTO נגזר מ-`mayManageListing`, והשער זורק לפיו.
   * שני חישובים נפרדים היו נפרדים ביום שמישהו מוסיף תנאי לאחד מהם:
   * כפתור שמוצג ונכשל, או פעולה שמותרת ואין לה כפתור.
   */
  it("מה שהמסך מציג הוא מה שהשרת מאשר", () => {
    for (const capabilities of [
      ["collaboration.share"],
      ["collaboration.manage_all"],
    ] as Capability[][]) {
      for (const createdBy of ["01ME", "01OTHER", null]) {
        asAgent(capabilities, "01ME", () => {
          const shown = mayManage({ createdBy });
          let allowed = true;
          try {
            gateCall({ createdBy });
          } catch {
            allowed = false;
          }
          expect(shown, `${capabilities[0]} / ${String(createdBy)}`).toBe(allowed);
        });
      }
    }
  });

  /*
   * ההפרדה קיימת רק כל עוד היכולת הניהולית אינה יורדת לתפקידי
   * השורה. היא ניתנת גם פרטנית דרך חריגי ההרשאות, וזו הדרך הנכונה
   * לתת אותה לסוכן מסוים — לא הרחבה של ברירת המחדל.
   *
   * `branch_manager` הוא התפקיד שמחזיק את שתיהן בכוונה: מי שמנהל
   * את פעילות הרשת של המשרד צריך לתקן תנאים שסוכן בחופשה קבע.
   */
  it("היכולת הניהולית אינה יורדת לתפקידי השורה", async () => {
    const { ROLE_CAPABILITIES } = await import("@metavchim/shared");
    for (const role of ["agent", "assistant", "viewer"]) {
      expect(ROLE_CAPABILITIES[role]).not.toContain("collaboration.manage_all");
    }
    expect(ROLE_CAPABILITIES["branch_manager"]).toContain("collaboration.manage_all");
  });
});

/**
 * השינוי חל על הצעות **חדשות** בלבד.
 *
 * זו אינה הבטחה שנשמרת במאמץ אלא תוצאה של המודל: `CoopOffer`
 * ו-`CoopInterest` נושאים `commissionSplit` משלהם, שנכתב ברגע
 * שההצעה נשלחה. שינוי מאוחר בביקוש או בפרסום אינו נוגע בהם, ולכן
 * משרד שכבר השקיע נכס על סמך 50% אינו מגלה למחרת שהוא עומד על 34%.
 *
 * הבדיקה שומרת על התכונה הזו במבנה: היום שבו מישהו יגזור את
 * החלוקה מהביקוש בזמן התצוגה — במקום מההצעה — היא זו שתיפול.
 */
describe("הצעות שכבר יצאו", () => {
  it("נושאות חלוקת עמלה משלהן ואינן נגזרות מהביקוש", async () => {
    const { readFileSync } = await import("node:fs");
    const schema = readFileSync(
      new URL("../../../prisma/schema.prisma", import.meta.url),
      "utf8",
    );
    for (const model of ["model CoopOffer", "model CoopInterest"]) {
      const block = schema.slice(schema.indexOf(model));
      expect(block.slice(0, block.indexOf("\n}"))).toContain("commissionSplit");
    }
  });

  /* הקטלוג אינו מציע לסוכן פעולה שתעקוף את השער הזה בקול */
  it("אין פעולת סוכן קולי שמשנה חלוקת עמלה", () => {
    expect(AGENT_ACTIONS.map((action) => action.id)).not.toContain("update_commission");
  });
});
