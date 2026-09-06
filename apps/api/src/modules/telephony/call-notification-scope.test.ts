import { describe, expect, it } from "vitest";
import {
  inboundNotificationOwner,
  notifiableContactOwner,
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
 * ## ‏ולמה השאלה אינה „האם קיימת שורת חסימה”
 *
 * ‏כך היא נשאלה, וזו שאלה על **הכוונון** ולא על המצב. ההפרדה
 * ‏קיימת במשרד ברירת-מחדל בלי שאיש נגע בדבר: `agent` מקבל
 * ‏`buyers.view_own` ו-`leads.view_own` בלבד. כלומר דווקא המשרד
 * ‏הנפוץ ביותר — סוכנים בתפקיד המובנה — נענה „אין הפרדה” וקיבל את
 * ‏השם המפוענח לכולם (ביקורת Codex, P1, סבב שני).
 *
 * ‏השאלה כאן היא לכן על היכולות בפועל: האם **כל** מי שיראה את
 * ‏ההתראה המשרדית רשאי לראות כל לקוח.
 */

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const HOUR = 60 * 60 * 1000;

type Override = { capability: string; effect: string; expiresAt: Date | null };
type FakeUser = { id: string; role: string; isActive?: boolean; overrides?: Override[] };

/**
 * ‎**המסד המדומה מכבד את ה-`where` שהקוד בונה.**
 *
 * ‏זו כל התוחלת של הבדיקות האלה: פיקסצ׳ר שמתעלם מ-`isActive` או
 * ‏מ-`id: { in }` היה מחזיר אותה תשובה לכל שאילתה, כלומר לא בודק
 * ‏דבר. גרסה קודמת של הקובץ הזה אכפה את **התפוגה** בעצמה, ומוטציה
 * ‏שהסירה את תנאי התפוגה עברה — הבדיקה מדדה את הפיקסצ׳ר.
 *
 * ‏התפוגה עברה מאז מה-SQL אל `resolveCapabilities`, ולכן הפיקסצ׳ר
 * ‏מחזיר **את כל** החריגים: מי שמסנן אותם הוא הקוד, וזה בדיוק מה
 * ‏שנבדק.
 */
function txWith(users: FakeUser[]) {
  return {
    user: {
      findMany: async (args: {
        where: { tenantId?: string; isActive?: boolean; id?: { in: string[] } };
      }) => {
        const { tenantId, isActive, id } = args.where;
        return users
          .filter(
            (user) =>
              (tenantId === undefined || tenantId === TENANT) &&
              (isActive === undefined || (user.isActive ?? true) === isActive) &&
              (id === undefined || id.in.includes(user.id)),
          )
          .map((user) => ({
            id: user.id,
            role: user.role,
            capabilityOverrides: user.overrides ?? [],
          }));
      },
    },
  };
}

const OWNER: FakeUser = { id: "01USEROWNERAAAAAAAAAAAAAAA", role: "owner" };
const AGENT: FakeUser = { id: "01USERAGENTAAAAAAAAAAAAAAA", role: "agent" };

const ALL_THREE: Override[] = [
  { capability: "properties.view_all", effect: "grant", expiresAt: null },
  { capability: "buyers.view_all", effect: "grant", expiresAt: null },
  { capability: "leads.view_all", effect: "grant", expiresAt: null },
];

describe("האם המשרד הפעיל הפרדה", () => {
  it("משרד של בעלים בלבד — אין מה להסתיר", async () => {
    expect(await officeRestrictsContactVisibility(txWith([OWNER]) as never, TENANT)).toBe(
      false,
    );
  });

  /*
   * ‎**הבדיקה שנולדה מהממצא.** אף אחד לא כיוון דבר, ובכל זאת סוכן
   * ‏אחד אינו יכול להגיע לקונה של עמיתו. השאלה הישנה החזירה כאן
   * ‏`false` והשם המפוענח יצא לכל המשרד.
   */
  it("סוכן בתפקיד המובנה — יש הפרדה, גם בלי שאיש כיוון דבר", async () => {
    expect(
      await officeRestrictsContactVisibility(txWith([OWNER, AGENT]) as never, TENANT),
    ).toBe(true);
  });

  /*
   * ‏והצד השני, שבלעדיו „תמיד יש הפרדה” היה עובר: אותו סוכן בדיוק,
   * ‏אחרי שמנהל המשרד העניק לו את שלוש היכולות, אינו יוצר הפרדה.
   */
  it("סוכן שקיבל את שלוש היכולות — אין הפרדה", async () => {
    const opened: FakeUser = { ...AGENT, overrides: ALL_THREE };
    expect(
      await officeRestrictsContactVisibility(txWith([OWNER, opened]) as never, TENANT),
    ).toBe(false);
  });

  /*
   * ‏שלוש היכולות ולא אחת: חסרה אחת מהן — הפרדה. שלוש בדיקות
   * ‏שמפילות כל אחת מהן בנפרד, אחרת „דיינו באחת” היה עובר.
   */
  it("חסרה אחת מהשלוש — הפרדה", async () => {
    for (const missing of ["properties.view_all", "buyers.view_all", "leads.view_all"]) {
      /*
       * ‏חסימה ולא השמטה: התפקיד עצמו כבר נושא את `properties.view_all`,
       * ‏ולכן „לא להעניק” אינו „אין לו”. בלי החסימה הבדיקה הייתה
       * ‏עוברת מסיבה אחרת לגמרי.
       */
      const partial: FakeUser = {
        ...AGENT,
        overrides: [
          ...ALL_THREE,
          { capability: missing, effect: "deny", expiresAt: null },
        ],
      };
      expect(
        await officeRestrictsContactVisibility(txWith([OWNER, partial]) as never, TENANT),
        `חסרה ${missing}`,
      ).toBe(true);
    }
  });

  /** ‏חסימה של המנהל עצמו — ההפרדה שהמשרד מפעיל במפורש. */
  it("חסימה של בעל המשרד — הפרדה", async () => {
    const blocked: FakeUser = {
      ...OWNER,
      overrides: [{ capability: "properties.view_all", effect: "deny", expiresAt: null }],
    };
    expect(await officeRestrictsContactVisibility(txWith([blocked]) as never, TENANT)).toBe(
      true,
    );
  });

  /** ‏חסימה שפגה חזרה למצב הרגיל — התפוגה נאכפת בקריאה. */
  it("חסימה שפגה אינה נחשבת", async () => {
    const expired: FakeUser = {
      ...OWNER,
      overrides: [
        {
          capability: "properties.view_all",
          effect: "deny",
          expiresAt: new Date(Date.now() - HOUR),
        },
      ],
    };
    expect(await officeRestrictsContactVisibility(txWith([expired]) as never, TENANT)).toBe(
      false,
    );
  });

  it("וחסימה שעוד בתוקף — כן", async () => {
    const live: FakeUser = {
      ...OWNER,
      overrides: [
        {
          capability: "buyers.view_all",
          effect: "deny",
          expiresAt: new Date(Date.now() + HOUR),
        },
      ],
    };
    expect(await officeRestrictsContactVisibility(txWith([live]) as never, TENANT)).toBe(
      true,
    );
  });

  /*
   * ‎**מי שאינו פעיל אינו רואה דבר, ולכן אינו יוצר הפרדה.** בלי
   * ‏התנאי הזה כל משרד שאי פעם השבית סוכן היה מאבד את השם לתמיד.
   */
  it("סוכן מושבת אינו נספר", async () => {
    const gone: FakeUser = { ...AGENT, isActive: false };
    expect(
      await officeRestrictsContactVisibility(txWith([OWNER, gone]) as never, TENANT),
    ).toBe(false);
  });

  /*
   * ‏„לא מצאנו למי זה מגיע” אינו „מותר לכולם”. אין כאן למי לשלוח
   * ‏ממילא, ולכן הכיוון השמרני אינו עולה דבר.
   */
  it("משרד בלי משתמשים פעילים נחשב מוגבל", async () => {
    expect(await officeRestrictsContactVisibility(txWith([]) as never, TENANT)).toBe(true);
  });
});

/**
 * ‎**השיוך אינו הרשאה.**
 *
 * ‏הבעלים נמצא לפי השורה — הקונה משויך אליו — אבל מנהל המשרד יכול
 * ‏לחסום ממנו את המודול כולו. אז הוא אינו מגיע ללקוח בשום מסך,
 * ‏וההתראה האישית עם השם, הטלפון והקישור הייתה נכתבת אליו בכל זאת
 * ‏(ביקורת Codex, P1).
 */
describe("הבעלים שמקבל את ההתראה האישית", () => {
  const OWNER_OF_CARD = "01USERAGENTAAAAAAAAAAAAAAA";

  function deny(capability: string): FakeUser {
    return {
      ...AGENT,
      overrides: [{ capability, effect: "deny", expiresAt: null }],
    };
  }

  it("סוכן הקונה מקבל את ההתראה", async () => {
    expect(
      await notifiableContactOwner(txWith([AGENT]) as never, TENANT, {
        buyer: { ownerUserId: OWNER_OF_CARD },
        lead: null,
        property: null,
      }),
    ).toBe(OWNER_OF_CARD);
  });

  it("סוכן שמודול הקונים חסום אצלו — לא", async () => {
    expect(
      await notifiableContactOwner(txWith([deny("buyers.view_own")]) as never, TENANT, {
        buyer: { ownerUserId: OWNER_OF_CARD },
        lead: null,
        property: null,
      }),
    ).toBeNull();
  });

  /*
   * ‎**וכל מקור נבדק לפי היכולת שלו.** חסימת הקונים אינה שוללת
   * ‏התראה על ליד, ולהפך — אחרת בדיקה אחת „דיינו” הייתה עוברת גם
   * ‏עם שער שבודק תמיד את אותה יכולת.
   */
  it("ליד — נבדק מול יכולת הלידים ולא מול הקונים", async () => {
    const sources = {
      buyer: null,
      lead: { assignedToUserId: OWNER_OF_CARD },
      property: null,
    };
    expect(
      await notifiableContactOwner(txWith([deny("buyers.view_own")]) as never, TENANT, sources),
    ).toBe(OWNER_OF_CARD);
    expect(
      await notifiableContactOwner(txWith([deny("leads.view_own")]) as never, TENANT, sources),
    ).toBeNull();
  });

  it("סוכן הנכס — נבדק מול מודול הנכסים", async () => {
    const sources = {
      buyer: null,
      lead: null,
      property: { agentUserId: OWNER_OF_CARD },
    };
    expect(
      await notifiableContactOwner(txWith([deny("leads.view_own")]) as never, TENANT, sources),
    ).toBe(OWNER_OF_CARD);
    expect(
      await notifiableContactOwner(txWith([deny("properties.view")]) as never, TENANT, sources),
    ).toBeNull();
  });

  /** ‏מי שאינו פעיל אינו נמען, גם כשהשיוך על השורה נשאר. */
  it("סוכן מושבת אינו מקבל התראה אישית", async () => {
    const gone: FakeUser = { ...AGENT, isActive: false };
    expect(
      await notifiableContactOwner(txWith([gone]) as never, TENANT, {
        buyer: { ownerUserId: OWNER_OF_CARD },
        lead: null,
        property: null,
      }),
    ).toBeNull();
  });

  it("בלי בעלים — אין למי לשלוח אישית", async () => {
    expect(
      await notifiableContactOwner(txWith([AGENT]) as never, TENANT, {
        buyer: null,
        lead: null,
        property: null,
      }),
    ).toBeNull();
  });
});

/**
 * ‏הכלל הטהור שמאחורי הזיהוי — הסדר, ו**דרך איזה מקור** נמצא
 * ‏הבעלים. המקור אינו תיעוד: הוא קובע איזו יכולת נבדקת אחריו.
 */
describe("סדר הבעלות והמקור שממנו הוא נגזר", () => {
  it("בעל הנכס, כשהלקוח אינו קונה ואינו ליד", () => {
    expect(
      inboundNotificationOwner({
        buyer: null,
        lead: null,
        property: { agentUserId: "01PROPAGENT" },
      }),
    ).toEqual({ userId: "01PROPAGENT", source: "properties" });
  });

  it("כרטיס קונה קודם לליד, וכל אחד נושא את המקור שלו", () => {
    expect(
      inboundNotificationOwner({
        buyer: { ownerUserId: "01BUYEROWNER" },
        lead: { assignedToUserId: "01LEADOWNER" },
        property: null,
      }),
    ).toEqual({ userId: "01BUYEROWNER", source: "buyers" });
    expect(
      inboundNotificationOwner({
        buyer: { ownerUserId: null },
        lead: { assignedToUserId: "01LEADOWNER" },
        property: null,
      }),
    ).toEqual({ userId: "01LEADOWNER", source: "leads" });
  });

  it("בלי בעלים — null", () => {
    expect(inboundNotificationOwner({ buyer: null, lead: null, property: null })).toBeNull();
  });
});
