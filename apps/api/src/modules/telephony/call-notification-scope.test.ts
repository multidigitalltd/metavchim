import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { missedCallTitle } from "@metavchim/shared";
import { publicNotification } from "./telephony.service";
import {
  contactOwnerCandidates,
  notifiableContactOwner,
  notifiableContactOwnerSource,
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
        buyers: [{ id: "01BUYER", ownerUserId: OWNER_OF_CARD }],
        leads: [],
        properties: [],
      }),
    ).toBe(OWNER_OF_CARD);
  });

  it("סוכן שמודול הקונים חסום אצלו — לא", async () => {
    expect(
      await notifiableContactOwner(txWith([deny("buyers.view_own")]) as never, TENANT, {
        buyers: [{ id: "01BUYER", ownerUserId: OWNER_OF_CARD }],
        leads: [],
        properties: [],
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
      buyers: [],
      leads: [{ id: "01LEAD", assignedToUserId: OWNER_OF_CARD }],
      properties: [],
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
      buyers: [],
      leads: [],
      properties: [{ agentUserId: OWNER_OF_CARD }],
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
        buyers: [{ id: "01BUYER", ownerUserId: OWNER_OF_CARD }],
        leads: [],
        properties: [],
      }),
    ).toBeNull();
  });

  it("סוכן מושבת אינו מקבל התראה אישית", async () => {
    const gone: FakeUser = { ...AGENT, isActive: false };
    expect(
      await notifiableContactOwner(txWith([gone]) as never, TENANT, {
        buyers: [{ id: "01BUYER", ownerUserId: OWNER_OF_CARD }],
        leads: [],
        properties: [],
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
          buyers: [{ id: "01BUYER", ownerUserId: OWNER_OF_CARD }],
          leads: [{ id: "01LEAD", assignedToUserId: OTHER.id }],
          properties: [],
        },
      ),
    ).toBe(OTHER.id);
  });

  it("גם סוכן שאינו פעיל מוריש את התור", async () => {
    const gone: FakeUser = { ...AGENT, isActive: false };
    expect(
      await notifiableContactOwner(txWith([gone, OTHER]) as never, TENANT, {
        buyers: [{ id: "01BUYER", ownerUserId: OWNER_OF_CARD }],
        leads: [],
        properties: [{ agentUserId: OTHER.id }],
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
          buyers: [{ id: "01BUYER", ownerUserId: OWNER_OF_CARD }],
          leads: [{ id: "01LEAD", assignedToUserId: OTHER.id }],
          properties: [],
        },
      ),
    ).toBeNull();
  });

  it("בלי בעלים — אין למי לשלוח אישית", async () => {
    expect(
      await notifiableContactOwner(txWith([AGENT]) as never, TENANT, {
        buyers: [],
        leads: [],
        properties: [],
      }),
    ).toBeNull();
  });

  /*
   * ‎**והפסילה נופלת הלאה גם בתוך המקור** (ביקורת Codex, P2).
   *
   * ‏קונה אינו ייחודי ללקוח — `createWithin` מוסיף כרטיס חדש בכל
   * ‏פעם. „הכרטיס האחרון” הוא מועמד אחד מתוך כמה, וכשבעליו חסום
   * ‏כרטיס ותיק של סוכן כשר מעולם לא נשאל: ההתראה נפלה למקור אחר
   * ‏או נשארה משרדית וחסרת תוכן.
   */
  it("הבעלים של הכרטיס החדש חסום — ההתראה עוברת לוותיק הכשר", async () => {
    expect(
      await notifiableContactOwnerSource(
        txWith([deny("buyers.view_own"), OTHER]) as never,
        TENANT,
        {
          buyers: [
            { id: "01NEW", ownerUserId: OWNER_OF_CARD },
            { id: "01OLD", ownerUserId: OTHER.id },
          ],
          leads: [],
          properties: [],
        },
      ),
    ).toEqual({ userId: OTHER.id, source: "buyers" });
  });

  /*
   * ‏והצד השני, שבלעדיו „תמיד לקחת את האחרון ברשימה” היה עובר:
   * ‏כששניהם כשרים, החדש הוא הנמען.
   */
  it("ושניהם כשרים — הכרטיס החדש הוא שקובע", async () => {
    expect(
      await notifiableContactOwnerSource(txWith([AGENT, OTHER]) as never, TENANT, {
        buyers: [
          { id: "01NEW", ownerUserId: OWNER_OF_CARD },
          { id: "01OLD", ownerUserId: OTHER.id },
        ],
        leads: [],
        properties: [],
      }),
    ).toEqual({ userId: OWNER_OF_CARD, source: "buyers" });
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
        buyers: [],
        leads: [],
        properties: [{ agentUserId: "01PROPAGENT" }],
      }),
    ).toEqual([{ userId: "01PROPAGENT", source: "properties" }]);
  });

  it("שלושת המקורות מוחזרים לפי הסדר, כל אחד עם המקור שלו", () => {
    expect(
      contactOwnerCandidates({
        buyers: [{ id: "01BUYER", ownerUserId: "01BUYEROWNER" }],
        leads: [{ id: "01LEAD", assignedToUserId: "01LEADOWNER" }],
        properties: [{ agentUserId: "01PROPAGENT" }],
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
        buyers: [{ id: "01BUYER", ownerUserId: null }],
        leads: [{ id: "01LEAD", assignedToUserId: "01LEADOWNER" }],
        properties: [],
      }),
    ).toEqual([{ userId: "01LEADOWNER", source: "leads" }]);
  });

  it("בלי בעלים — רשימה ריקה", () => {
    expect(contactOwnerCandidates({ buyers: [], leads: [], properties: [] })).toEqual([]);
  });

  /*
   * ‎**וגם בתוך המקור** (ביקורת Codex, P2).
   *
   * ‏קונה אינו ייחודי ללקוח — `createWithin` מוסיף כרטיס חדש בכל
   * ‏פעם — ולכן „הכרטיס האחרון” הוא מועמד אחד מתוך כמה. הסבב הקודם
   * ‏לימד **מקור** שנפסל להוריש את התור; זו אותה הורשה שכבה פנימה,
   * ‏ובלעדיה כרטיס ותיק של סוכן כשר מעולם לא נשאל.
   */
  it("כמה כרטיסי קונה — כולם מועמדים, החדש ראשון", () => {
    expect(
      contactOwnerCandidates({
        buyers: [
          { id: "01NEW", ownerUserId: "01BLOCKED" },
          { id: "01OLD", ownerUserId: "01ELIGIBLE" },
        ],
        leads: [],
        properties: [],
      }),
    ).toEqual([
      { userId: "01BLOCKED", source: "buyers" },
      { userId: "01ELIGIBLE", source: "buyers" },
    ]);
  });

  /*
   * ‏וסדר המקורות נשמר מעליו: כל הקונים לפני הלידים, ולא לסירוגין.
   * ‏בלי זה „שטח את הכול” היה עובר ומשנה את סדר ההעדפה.
   */
  it("סדר המקורות נשמר מעל הסדר שבתוך המקור", () => {
    expect(
      contactOwnerCandidates({
        buyers: [
          { id: "01B1", ownerUserId: "01B1OWNER" },
          { id: "01B2", ownerUserId: "01B2OWNER" },
        ],
        leads: [{ id: "01L", assignedToUserId: "01LOWNER" }],
        properties: [],
      }).map((row) => row.userId),
    ).toEqual(["01B1OWNER", "01B2OWNER", "01LOWNER"]);
  });

  /*
   * ‏ואותו אדם דרך שני מקורות אינו מועמד פעמיים: השאלה נשאלת עליו
   * ‏פעם אחת, לפי המקור הראשון שבו נמצא.
   */
  it("אותו בעלים בשני מקורות — מועמד אחד, המקור הראשון", () => {
    expect(
      contactOwnerCandidates({
        buyers: [{ id: "01B", ownerUserId: "01SAME" }],
        leads: [{ id: "01L", assignedToUserId: "01SAME" }],
        properties: [],
      }),
    ).toEqual([{ userId: "01SAME", source: "buyers" }]);
  });
});

/**
 * ‎**השם ירד מהכותרת — והמצביע נשאר** (ביקורת Codex, P1).
 *
 * ‏ההתראה המשרדית נכתבת ל-`userId: null`, והעובד מעשיר אותה
 * ‏פר-נמען: `entityType: "contact"` הופך לשם ולטלפון מפוענחים.
 * ‏ההרשאה לכך נבחנת ב-`canSeeNotifyDetail` מול הרשאות **הקונים
 * ‏והלידים**, ולא מול הרשאת הנכסים שההסתרה נשענת עליה — ולכן מנהל
 * ‏סניף שנחסם מבעלי נכסים קיבל את הזהות דרך הדלת השנייה.
 *
 * ‏ענף הצלצול כבר עשה את הדבר הנכון וענף „לא נענתה” לא. שני
 * ‏ניסוחים של אותו כלל הם שני כללים שביום מן הימים אינם מסכימים,
 * ‏וכאן הם כבר לא הסכימו.
 */
describe("publicNotification — השורה המשרדית", () => {
  /** ‏נוסח שנושא אסימון — בדיוק מה שחזר מ„הצע טופס”. */
  const WITH_TOKEN =
    "לא נשלח אוטומטית (אין תבנית מאושרת). שלחו ללקוח:\nhttps://app.example/f/AbCd_1234";

  /*
   * ‎**חומרי הגלם של הכותרת** (ביקורת Codex, P1).
   *
   * ‏הכותרת נבנית עכשיו בתוך ההכרעה, כי המספר הגולמי היה משובץ
   * ‏לתוכה גם כשהלקוח הוסתר — כלומר השם ירד והטלפון של אותו אדם
   * ‏בדיוק המשיך לצאת לכל המשרד.
   */
  const CALL = {
    kind: "missed" as const,
    contactName: "דנה כהן",
    peerPhone: "+972501234567",
  };
  const NAMED_MISSED = missedCallTitle(CALL.contactName, CALL.peerPhone);
  const PUBLIC_MISSED = missedCallTitle(null, null);

  it("לקוח שהוסתר — אין מצביע, גם כשיש ליד", () => {
    expect(
      publicNotification(true, { ...CALL, leadId: "01LEAD", contactId: "01CONTACT", body: null }),
    ).toEqual({ title: PUBLIC_MISSED, entityType: null, entityId: null, body: null });
  });

  /*
   * ‏גם מצביע הליד יורד: הליד מוביל לאותו אדם בדיוק, תחת הרשאה
   * ‏שלישית. „הורדנו את של הלקוח” אינה תשובה.
   */
  it("וגם כשיש רק ליד", () => {
    expect(
      publicNotification(true, { ...CALL, leadId: "01LEAD", contactId: null, body: null }),
    ).toEqual({ title: PUBLIC_MISSED, entityType: null, entityId: null, body: null });
  });

  /*
   * ‎**והשדה השלישי — הגוף.**
   *
   * ‏זו הדליפה שהמצביע לבדו לא סגר: נוסח ההזמנה נושא כתובת
   * ‏`‎/f/:token` חיה, ו-`NotificationsService.visible()` מחזירה
   * ‏`body` לכל מי שהשורה נראית לו בלי שער פר-נמען. האסימון פותח
   * ‏את הטופס, חושף את שם הפנייה, ומאפשר לכתוב לכרטיס הקונה של
   * ‏אותו לקוח מוסתר (ביקורת Codex, P1).
   */
  it("לקוח שהוסתר — גם הגוף יורד, ואיתו קישור הטופס", () => {
    const row = publicNotification(true, {
      ...CALL,
      leadId: null,
      contactId: "01CONTACT",
      body: WITH_TOKEN,
    });
    expect(row.body).toBeNull();
    expect(JSON.stringify(row)).not.toContain("/f/");
  });

  it("לקוח גלוי — הליד קודם ללקוח, והגוף נשאר", () => {
    expect(
      publicNotification(false, {
        ...CALL,
        leadId: "01LEAD",
        contactId: "01CONTACT",
        body: WITH_TOKEN,
      }),
    ).toEqual({ title: NAMED_MISSED, entityType: "lead", entityId: "01LEAD", body: WITH_TOKEN });
  });

  it("בלי ליד — הלקוח", () => {
    expect(
      publicNotification(false, { ...CALL, leadId: null, contactId: "01CONTACT", body: null }),
    ).toEqual({ title: NAMED_MISSED, entityType: "contact", entityId: "01CONTACT", body: null });
  });

  /*
   * ‎**מספר שאינו מוכר אינו „מוסתר”.** זו ההבחנה שדורשת דגל נפרד
   * ‏ולא `name === null`: ליד שנפתח משיחה ממספר לא מוכר חייב
   * ‏להישאר מקושר, גם במשרד שמפריד — וגם הגוף שלו נשאר.
   */
  it("בלי לקוח ובלי ליד — אין מצביע, והגוף נשאר", () => {
    expect(
      publicNotification(false, {
        ...CALL,
        leadId: null,
        contactId: null,
        body: "מספר שאינו מוכר במערכת",
      }),
    ).toEqual({
      title: NAMED_MISSED,
      entityType: null,
      entityId: null,
      body: "מספר שאינו מוכר במערכת",
    });
  });
});

describe("‏שני הענפים עוברים דרך אותה פונקציה", () => {
  const source = readFileSync(join(__dirname, "telephony.service.ts"), "utf8");

  it("‏אין מצביע שנבנה ביד בהתראה המשרדית", () => {
    /*
     * ‏שתי הקריאות ל-`publicNotification` הן שתי ההתראות המשרדיות
     * ‏(צלצול, לא-נענתה). כתיבה ידנית רביעית של `entityType` באחת
     * ‏מהן היא בדיוק החזרה של הבאג.
     */
    expect(source.split("...publicNotification(").length - 1).toBe(2);
  });

  /*
   * ‎**וגם אין `body` שנכתב ביד לצד הפריסה** — זה היה הבאג עצמו.
   *
   * ‏המצביע עבר דרך הפונקציה, והגוף נשאר שורה מעליה: `body: pending
   * ‏?? …` עם קישור הטופס בתוכו. שער שסופר רק את הקריאות היה ירוק
   * ‏על הדליפה הזו. לכן הוא נשאל כאן על **הבלוק**: בשתי ההתראות
   * ‏המשרדיות אין מפתח `body` מחוץ לאובייקט שנמסר לפונקציה.
   */
  it("‏ואין גוף שנכתב ביד בהתראה המשרדית", () => {
    for (const key of ["incoming_call:", "call_missed:"]) {
      const at = source.indexOf(`dedupeKey: \`${key}`);
      expect(at, `לא נמצאה ההתראה המשרדית ${key}`).toBeGreaterThan(0);
      const block = source.slice(at, source.indexOf("});", at));
      const spread = block.indexOf("...publicNotification(");
      expect(spread, `${key} אינה עוברת דרך הפונקציה`).toBeGreaterThan(0);
      /* ‏מה שלפני הפריסה הוא מה שנכתב ביד — שם `body` אסור */
      expect(block.slice(0, spread), `${key} כותבת גוף ביד`).not.toMatch(/\bbody:/u);
    }
  });

  /*
   * ‎**והתיקון לא הידק יותר מדי — הצד השני של אותו שער.**
   *
   * ‏מוטציה שהעבירה `body: null` לפונקציה במקום את `pending` שרדה:
   * ‏בדיקות היחידה מוכיחות שהפונקציה **שומרת** גוף כשאין הסתרה,
   * ‏אבל לא שאתר הקריאה עדיין מוסר לה אותו. במשרד שאינו מפריד זו
   * ‏כל תוחלת האוטומציה — „לא נשלח, שלחו ללקוח את זה” בלי הנוסח
   * ‏עצמו מחזיר בדיוק את החיפוש שהיא נועדה לחסוך.
   */
  it("‏והנוסח שמיועד ללקוח עדיין נמסר לשורה המשרדית", () => {
    const at = source.indexOf("dedupeKey: `call_missed:");
    const block = source.slice(at, source.indexOf("});", at));
    const spread = block.indexOf("...publicNotification(");
    expect(block.slice(spread), "הנוסח אינו נמסר לשורה המשרדית").toContain("pending");
  });

  /*
   * ‎**והתיקון לא הידק יותר מדי.** ההתראה האישית נשלחת ל-
   * ‏`contactOwnerUserId` בלבד — האדם שהלקוח שלו — ולכן היא חייבת
   * ‏להמשיך לשאת את המצביע. תיקון שהיה מוריד גם אותה היה הופך את
   * ‏ההפרדה ל„אף אחד לא מקבל כלום”.
   */
  /*
   * ‎**ומאיפה `redacted` מגיע.**
   *
   * ‏מוטציה ששמה `redacted: false` קבוע שרדה את בדיקות היחידה
   * ‏למעלה — הן מקבלות את הדגל כפרמטר ואינן יודעות מי מחשב אותו.
   * ‏החישוב עצמו יושב בסגור בתוך המטפל באירוע ואי אפשר לקרוא לו,
   * ‏ולכן הוא נבדק על המקור. זו הגבלה אמיתית, והיא נאמרת כאן:
   * ‏מה שנבדק הוא ש**שני התנאים** נמצאים בביטוי, לא שהוא רץ.
   *
   * ‏שניהם נדרשים, וכל אחד לבדו שגוי: בלי `restricted` כל משרד
   * ‏מסתיר, ובלי `contact !== null` מספר לא-מוכר נחשב „מוסתר”
   * ‏והליד שנפתח ממנו מאבד את הקישור.
   */
  it("‏„מוסתר” נגזר מההפרדה **וגם** מקיום הלקוח", () => {
    /*
     * ‏מהשם ולא מהשדה: `redacted:` מופיע קודם בהצהרת הטיפוס, ו-
     * ‏`indexOf` היה נופל עליה. העוגן הוא השורה שמעליו בפועל.
     */
    const audience = source.indexOf("name: restricted ? null : decryptedName,");
    expect(audience, "קהל ההתראה נעלם").toBeGreaterThan(0);
    const at = source.indexOf("redacted:", audience);
    expect(at, "השדה `redacted` נעלם מקהל ההתראה").toBeGreaterThan(0);
    const line = source.slice(at, source.indexOf("\n", at));
    expect(line).toContain("restricted");
    expect(line).toContain("contact !== null");
    /* ‏והשם נגזר מאותו `restricted` — שתי שכבות של אותה החלטה */
    expect(line).not.toContain("true");
  });

  it("‏ההתראה האישית ממשיכה לשאת מצביע", () => {
    for (const key of ["incoming_call_owner:", "call_missed_owner:"]) {
      const at = source.indexOf(key);
      expect(at, `לא נמצאה ההתראה האישית ${key}`).toBeGreaterThan(0);
      const block = source.slice(at, at + 400);
      expect(block).toMatch(/entityType:/u);
      expect(block).not.toContain("publicNotification(");
    }
  });
});

/**
 * ‎**והקישור הוא של המקור שדרכו נבחר הנמען** (ביקורת Codex).
 *
 * ‏`notifiableContactOwner` כבר מדלגת על בעלים שאינו רשאי ועוברת
 * ‏למקור הבא — אבל מי שכותב את **הקישור** לא ידע דרך איזה מקור
 * ‏נבחר הנמען, וגזר אותו מ„יש כרטיס קונה”. התוצאה: סוכן הליד קיבל
 * ‏התראה אישית שמקשרת לכרטיס הקונה של עמיתו, כרטיס שאינו יכול
 * ‏לפתוח, בזמן שהליד שלו — שאותו כן — לא היה היעד.
 *
 * ‏`notifiableContactOwnerSource` מחזירה את המועמד השלם, ו-
 * ‏`notifiableContactOwner` היא היטל שלה. שתי צורות, החלטה אחת.
 */
describe("המקור שדרכו נבחר הנמען חוזר איתו", () => {
  const OWNER_OF_CARD = "01USERAGENTAAAAAAAAAAAAAAA";
  const OTHER: FakeUser = { id: "01USERAGENTBBBBBBBBBBBBBBB", role: "agent" };

  function deny(capability: string): FakeUser {
    return { ...AGENT, overrides: [{ capability, effect: "deny", expiresAt: null }] };
  }

  it("סוכן הקונה נבחר — והמקור הוא הקונים", async () => {
    expect(
      await notifiableContactOwnerSource(txWith([AGENT]) as never, TENANT, {
        buyers: [{ id: "01BUYER", ownerUserId: OWNER_OF_CARD }],
        leads: [{ id: "01LEAD", assignedToUserId: OTHER.id }],
        properties: [],
      }),
    ).toEqual({ userId: OWNER_OF_CARD, source: "buyers" });
  });

  /*
   * ‎**זה המקרה שהממצא תיאר.** יש כרטיס קונה, ולכן הקישור נגזר
   * ‏ממנו — אבל הנמען בפועל הוא סוכן הליד, שאינו רשאי לפתוח אותו.
   */
  it("סוכן קונה חסום — הנמען הוא סוכן הליד, והמקור הוא הלידים", async () => {
    expect(
      await notifiableContactOwnerSource(
        txWith([deny("buyers.view_own"), OTHER]) as never,
        TENANT,
        {
          buyers: [{ id: "01BUYER", ownerUserId: OWNER_OF_CARD }],
          leads: [{ id: "01LEAD", assignedToUserId: OTHER.id }],
          properties: [],
        },
      ),
    ).toEqual({ userId: OTHER.id, source: "leads" });
  });

  it("ובלי נמען — אין מקור", async () => {
    expect(
      await notifiableContactOwnerSource(txWith([AGENT]) as never, TENANT, {
        buyers: [],
        leads: [],
        properties: [],
      }),
    ).toBeNull();
  });

  /* ‏וההיטל מסכים עם הצורה המלאה, אחרת אלה שני כללים */
  it("‏`notifiableContactOwner` הוא היטל ולא ניסוח שני", async () => {
    const sources = {
      buyers: [{ id: "01BUYER", ownerUserId: OWNER_OF_CARD }],
      leads: [{ id: "01LEAD", assignedToUserId: OTHER.id }],
      properties: [],
    };
    for (const users of [[AGENT, OTHER], [deny("buyers.view_own"), OTHER], [deny("buyers.view_own"), deny("leads.view_own")]]) {
      const full = await notifiableContactOwnerSource(txWith(users) as never, TENANT, sources);
      const projected = await notifiableContactOwner(txWith(users) as never, TENANT, sources);
      expect(projected).toBe(full?.userId ?? null);
    }
  });
});

/**
 * ‏ובתיבת הדואר: הקישור נגזר מהמקור, והשורה המשרדית — שאין לה
 * ‏בעלים ולכן גם אין לה תוכן — אינה נושאת מצביע כלל. זו אותה
 * ‏דליפה שתוקנה בהתראות המרכזייה, בקובץ אחר.
 */
describe("‏מצביע ההתראה בתיבת הדואר", () => {
  const INBOX = readFileSync(
    join(__dirname, "..", "email-inbox", "email-inbox.service.ts"),
    "utf8",
  );

  it("‏המצביע נגזר מהמקור שנבחר, ולא מ„יש כרטיס”", () => {
    const at = INBOX.indexOf('type: "email_reply"');
    expect(at, "התראת התשובה במייל נעלמה").toBeGreaterThan(0);
    const block = INBOX.slice(at, at + 1600);
    expect(block).toContain('owner?.source === "buyers"');
    expect(block).toContain('owner?.source === "leads"');
  });

  it("‏ובלי בעלים — אין מצביע, כמו שאין תוכן", () => {
    /* ‏`owner?.source` על `null` הוא `undefined`, ולכן שני הענפים נופלים */
    expect(INBOX).toContain("const ownerUserId = owner?.userId ?? null;");
    expect(INBOX).not.toContain('? { entityType: "buyer", entityId: buyer.id }\n            : lead !== null');
  });
});
