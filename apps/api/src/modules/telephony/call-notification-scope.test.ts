import { describe, expect, it } from "vitest";
import {
  inboundNotificationOwner,
  officeRestrictsContactVisibility,
} from "../../common/ownership";

/**
 * ‎**„מי מתקשר” — התראה משרדית שנושאת זהות.**
 *
 * ‏התראת השיחה נכתבת ל-`userId: null` **בכוונה**: המרכזייה מדווחת
 * ‏על שלוחה, אין מיפוי אמין ממנה למשתמש, ועדיף שכולם יראו מי
 * ‏מתקשר מאשר שההתראה תגיע לאדם הלא נכון. ההחלטה הזו כתובה בקוד
 * ‏עוד לפני ה-PR הזה.
 *
 * ‏אלא ש-`NotificationsService.visible()` מציגה שורה כזו לכל
 * ‏המשרד ואין לה שער לפי לקוח — כלומר זו זהות שיושבת בטקסט חופשי,
 * ‏אותו סוג בדיוק כמו בהערות המשימה. סוכן שנחסם מבעלי הנכסים של
 * ‏המשרד קיבל דרכה את שמו של בעל נכס של עמית (ביקורת Codex, P1).
 *
 * ## ‏למה השאלה היא „האם המשרד הפעיל הפרדה”
 *
 * ‏חישוב „מי זכאי” לכל שיחה היה מחליף את החלטת המוצר שלמעלה
 * ‏באחרת. השאלה הצרה כאן משאירה אותה במקומה: משרד שלא ביקש הפרדה
 * ‏מתנהג **בדיוק** כמו קודם, ומשרד שכן מקבל התראה משרדית בלי שם
 * ‏(המספר עצמו מוצג ממילא — אחרת אי אפשר לענות) והבעלים מקבל
 * ‏התראה אישית מלאה.
 */

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";

/**
 * ‎**המסד המדומה מכבד את ה-`where` — כולל את מה שאין בו.**
 *
 * ‏גרסה ראשונה של הפיקסצ׳ר אכפה את התפוגה בעצמה, ולכן מוטציה
 * ‏שהסירה את תנאי התפוגה מהשאילתה **עברה**: הבדיקה מדדה את
 * ‏הפיקסצ׳ר ולא את הקוד. כל תנאי נבדק כאן רק אם הוא באמת נבנה.
 */
function txWith(rows: { capability: string; effect: string; expiresAt: Date | null }[]) {
  return {
    userCapability: {
      findFirst: async (args: {
        where: {
          effect?: string;
          capability?: { in: string[] } | string;
          OR?: ({ expiresAt: null } | { expiresAt: { gt: Date } })[];
        };
      }) => {
        const { effect, capability, OR } = args.where;
        const wanted =
          capability === undefined
            ? null
            : typeof capability === "string"
              ? [capability]
              : capability.in;
        const now = Date.now();
        const match = rows.find(
          (row) =>
            (effect === undefined || row.effect === effect) &&
            (wanted === null || wanted.includes(row.capability)) &&
            (OR === undefined ||
              row.expiresAt === null ||
              row.expiresAt.getTime() > now),
        );
        return match === undefined ? null : { id: "01OVERRIDEAAAAAAAAAAAAAAAA" };
      },
    },
  };
}

const HOUR = 60 * 60 * 1000;

describe("האם המשרד הפעיל הפרדה", () => {
  it("משרד שלא נגע בכלום — לא", async () => {
    expect(await officeRestrictsContactVisibility(txWith([]) as never, TENANT)).toBe(false);
  });

  it("חסימה של בעלי הנכסים — כן", async () => {
    const rows = [{ capability: "properties.view_all", effect: "deny", expiresAt: null }];
    expect(await officeRestrictsContactVisibility(txWith(rows) as never, TENANT)).toBe(true);
  });

  /*
   * ‏שלוש היכולות ולא אחת: חסימת קונים או לידים מסתירה לקוחות
   * ‏בדיוק באותה מידה, וההתראה אינה יודעת דרך איזה מקור הלקוח
   * ‏מגיע.
   */
  it("גם חסימת קונים או לידים נחשבת", async () => {
    for (const capability of ["buyers.view_all", "leads.view_all"]) {
      const rows = [{ capability, effect: "deny", expiresAt: null }];
      expect(await officeRestrictsContactVisibility(txWith(rows) as never, TENANT)).toBe(true);
    }
  });

  /*
   * ‎**הענקה אינה חסימה.** `grant` מרחיב ולכן אינו יוצר הפרדה —
   * ‏שער שסופר כל שורת חריגה היה מוריד את השם מכל משרד שהעניק
   * ‏יכולת אחת למישהו.
   */
  it("שורת `grant` אינה נחשבת הפרדה", async () => {
    const rows = [{ capability: "properties.view_all", effect: "grant", expiresAt: null }];
    expect(await officeRestrictsContactVisibility(txWith(rows) as never, TENANT)).toBe(false);
  });

  /** ‏חסימה שפגה חזרה למצב הרגיל — התפוגה נאכפת בקריאה. */
  it("חסימה שפגה אינה נחשבת", async () => {
    const rows = [
      {
        capability: "properties.view_all",
        effect: "deny",
        expiresAt: new Date(Date.now() - HOUR),
      },
    ];
    expect(await officeRestrictsContactVisibility(txWith(rows) as never, TENANT)).toBe(false);
  });

  it("וחסימה שעוד בתוקף — כן", async () => {
    const rows = [
      {
        capability: "properties.view_all",
        effect: "deny",
        expiresAt: new Date(Date.now() + HOUR),
      },
    ];
    expect(await officeRestrictsContactVisibility(txWith(rows) as never, TENANT)).toBe(true);
  });
});

/**
 * ‏הבעלים שההתראה האישית נשלחת אליו הוא **אותו כלל** של התיבה,
 * ‏ולכן הוא חי ב-`ownership.ts` ולא בשני עותקים.
 */
describe("הבעלים שמקבל את ההתראה האישית", () => {
  it("בעל הנכס, כשהלקוח אינו קונה ואינו ליד", () => {
    expect(
      inboundNotificationOwner({
        buyer: null,
        lead: null,
        property: { agentUserId: "01PROPAGENT" },
      }),
    ).toBe("01PROPAGENT");
  });

  it("בלי בעלים — אין למי לשלוח אישית", () => {
    expect(
      inboundNotificationOwner({ buyer: null, lead: null, property: null }),
    ).toBeNull();
  });
});
