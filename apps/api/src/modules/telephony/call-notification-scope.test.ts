import { describe, expect, it } from "vitest";
import {
  contactOwnerCandidates,
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
function txWith(users: FakeUser[], blockedModules: string[] = []) {
  return {
    tenant: {
      findUnique: async (args: { where: { id: string } }) =>
        args.where.id === TENANT ? { blockedModules } : null,
    },
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
  /*
   * ‎**חסימת מודול של הפלטפורמה — השכבה שדילגתי עליה.**
   *
   * ‏„היכולות בפועל” הן שלוש שכבות: תפקיד, חריגי המנהל, וחסימת
   * ‏המודולים. חישבתי שתיים. משרד של בעלים בלבד שמודול הנכסים חסום
   * ‏לו נקרא „כולם רואים הכול”, והשם המפוענח של בעל נכס יצא בהתראה
   * ‏משרדית (ביקורת Codex, P1).
   */
  it("מודול שהפלטפורמה חסמה יוצר הפרדה — גם במשרד של בעלים בלבד", async () => {
    expect(
      await officeRestrictsContactVisibility(
        txWith([OWNER], ["properties"]) as never,
        TENANT,
      ),
    ).toBe(true);
  });

  it("וכל אחד משלושת המודולים לבדו מספיק", async () => {
    for (const key of ["properties", "buyers", "leads"]) {
      expect(
        await officeRestrictsContactVisibility(txWith([OWNER], [key]) as never, TENANT),
        `מודול ${key}`,
      ).toBe(true);
    }
  });

  /*
   * ‏והצד השני: מודול שאינו נוגע בלקוחות אינו יוצר הפרדה, אחרת כל
   * ‏חסימה שהיא הייתה מורידה את השם.
   */
  it("חסימת מודול שאינו של לקוחות אינה יוצרת הפרדה", async () => {
    expect(
      await officeRestrictsContactVisibility(
        txWith([OWNER], ["collaboration"]) as never,
        TENANT,
      ),
    ).toBe(false);
  });

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
  /** ‏סוכן שני, כשר — הוא מי שאמור לרשת את התור כשהראשון נפסל. */
  const OTHER: FakeUser = { id: "01USERAGENTBBBBBBBBBBBBBBB", role: "agent" };

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
  /*
   * ‏ואותה שכבה חלה גם על הנמען: סוכן במשרד שמודול הקונים חסום בו
   * ‏אינו מגיע לכרטיס, ולכן אינו נמען — גם בלי שום חריג אישי.
   */
  it("מודול שהפלטפורמה חסמה פוסל גם את הנמען", async () => {
    expect(
      await notifiableContactOwner(txWith([AGENT], ["buyers"]) as never, TENANT, {
        buyer: { ownerUserId: OWNER_OF_CARD },
        lead: null,
        property: null,
      }),
    ).toBeNull();
  });

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

  /*
   * ‎**מועמד שנפסל מוריש את התור לבא אחריו.**
   *
   * ‏„הראשון” היה נכון כשהשאלה הייתה „מי משויך”. מרגע שהיא „מי
   * ‏משויך ורשאי”, סוכן קונה חסום היה בולע גם את הליד של סוכן כשר:
   * ‏האחד נפסל, השני מעולם לא נשקל (ביקורת Codex).
   */
  it("סוכן קונה חסום — הליד של סוכן כשר מקבל את ההתראה", async () => {
    expect(
      await notifiableContactOwner(
        txWith([deny("buyers.view_own"), OTHER]) as never,
        TENANT,
        {
          buyer: { ownerUserId: OWNER_OF_CARD },
          lead: { assignedToUserId: OTHER.id },
          property: null,
        },
      ),
    ).toBe(OTHER.id);
  });

  it("גם סוכן שאינו פעיל מוריש את התור", async () => {
    const gone: FakeUser = { ...AGENT, isActive: false };
    expect(
      await notifiableContactOwner(txWith([gone, OTHER]) as never, TENANT, {
        buyer: { ownerUserId: OWNER_OF_CARD },
        lead: null,
        property: { agentUserId: OTHER.id },
      }),
    ).toBe(OTHER.id);
  });

  /*
   * ‏והגבול: כשכל המועמדים נפסלים אין נמען, ולא „הראשון בכל זאת”.
   */
  it("כל המועמדים נפסלו — אין נמען", async () => {
    const blockedOther: FakeUser = {
      ...OTHER,
      overrides: [{ capability: "leads.view_own", effect: "deny", expiresAt: null }],
    };
    expect(
      await notifiableContactOwner(
        txWith([deny("buyers.view_own"), blockedOther]) as never,
        TENANT,
        {
          buyer: { ownerUserId: OWNER_OF_CARD },
          lead: { assignedToUserId: OTHER.id },
          property: null,
        },
      ),
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
 * ‏הכלל הטהור שמאחורי הזיהוי — **כל** המועמדים לפי הסדר, ו„דרך
 * ‏איזה מקור”. המקור אינו תיעוד: הוא קובע איזו יכולת נבדקת. והרשימה
 * ‏אינה נוחות: היא מה שמאפשר למועמד שנפסל להוריש את התור.
 */
describe("סדר הבעלות והמקור שממנו הוא נגזר", () => {
  it("בעל הנכס, כשהלקוח אינו קונה ואינו ליד", () => {
    expect(
      contactOwnerCandidates({
        buyer: null,
        lead: null,
        property: { agentUserId: "01PROPAGENT" },
      }),
    ).toEqual([{ userId: "01PROPAGENT", source: "properties" }]);
  });

  it("שלושת המקורות מוחזרים לפי הסדר, כל אחד עם המקור שלו", () => {
    expect(
      contactOwnerCandidates({
        buyer: { ownerUserId: "01BUYEROWNER" },
        lead: { assignedToUserId: "01LEADOWNER" },
        property: { agentUserId: "01PROPAGENT" },
      }),
    ).toEqual([
      { userId: "01BUYEROWNER", source: "buyers" },
      { userId: "01LEADOWNER", source: "leads" },
      { userId: "01PROPAGENT", source: "properties" },
    ]);
  });

  it("כרטיס בלי בעלים נשמט מהרשימה ואינו עוצר אותה", () => {
    expect(
      contactOwnerCandidates({
        buyer: { ownerUserId: null },
        lead: { assignedToUserId: "01LEADOWNER" },
        property: null,
      }),
    ).toEqual([{ userId: "01LEADOWNER", source: "leads" }]);
  });

  it("בלי בעלים — רשימה ריקה", () => {
    expect(contactOwnerCandidates({ buyer: null, lead: null, property: null })).toEqual([]);
  });
});
