import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NotFoundException } from "@nestjs/common";
import type { Capability } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import {
  contactOwnerCandidates,
  type ContactOwner,
  type ContactOwnerSource,
} from "../../common/ownership";
import {
  EmailInboxService,
  inboundInteractionParent,
  inboundNotificationAnchor,
  inboundNotificationContent,
} from "./email-inbox.service";
import {
  redactNotification,
  type AnchorSubject,
  type RedactableNotification,
} from "@metavchim/shared";

/**
 * ‎**סוכן אינו רואה — ובעיקר אינו כותב — בהתכתבות של עמיתו.**
 *
 * ## ‏למה הבדיקה הזו קיימת
 *
 * ‎`FORCE ROW LEVEL SECURITY` מבודד משרד ממשרד, ולא סוכן מסוכן.
 * ‏יומן השיחות, ההסכמים והחיפוש כבר סיננו לפי בעלות
 * ‏(`visibleContactIds`), ותיבת הדואר — היחידה מבין הארבעה שנכתבה
 * ‏אחרי — פשוט לא קראה לו. היכולת שנדרשת בנתיב היא
 * ‎`buyers.view_own`, שיש לכל סוכן, ולכן לא הייתה שם שום הפרדה:
 * ‏רשימת השיחות, גוף ההודעות, הקבצים — ו**כפתור „השב”**.
 *
 * ‏השליחה היא החמורה מביניהן: היא אינה חושפת מידע אלא **יוצרת**
 * ‏אותו — מייל שיוצא בשם המשרד ללקוח של סוכן אחר, ונראה לו כהמשך
 * ‏השיחה שלו.
 */

interface Fixtures {
  /** ‏הלקוחות שהמשתמש הזה בעליהם. ריק = שום דבר אינו שלו. */
  ownedContactIds: readonly string[];
  /**
   * ‏לקוחות שנגישים לי דרך **ליד שלי** — ולא דרך כרטיס קונה.
   *
   * ‏זה המצב שהממצא תיאר: שער הלקוח הוא איחוד, ולכן שיחה יכולה
   * ‏להיפתח דרך הליד שלי בזמן שלאותו לקוח יש כרטיס קונה של עמית.
   */
  leadContactIds?: readonly string[];
}

function serviceFor(fx: Fixtures): EmailInboxService {
  const ALL_CONTACTS = ["01MINE", "01THEIRS"];
  const owns = (contactId: unknown): boolean =>
    typeof contactId === "string" && fx.ownedContactIds.includes(contactId);

  /*
   * ‎**הכרטיסים מכבדים את ה-`where` שהקוד בונה, ולא את הפיקסצ׳ר.**
   *
   * ‏זו הנקודה שהופכת את הבדיקה למשמעותית: `ownershipFilter` מוסיף
   * ‏`ownerUserId` ל-`where` רק כשלמשתמש **אין** `view_all`. מסד
   * ‏מדומה שמתעלם מה-`where` היה מחזיר את אותה תשובה לסוכן ולמנהל,
   * ‏כלומר לא היה בודק את הכלל בכלל.
   */
  const scoped = (where: { contactId?: string; ownerUserId?: string }): boolean => {
    const known = where.contactId === undefined || ALL_CONTACTS.includes(where.contactId);
    if (!known) return false;
    // ‏אין `ownerUserId` ב-`where` = `view_all`, ואז הכול נראה
    if (where.ownerUserId === undefined) return true;
    return owns(where.contactId);
  };

  const tx = {
    /*
     * ‏הבעלות נגזרת דרך כרטיס הקונה, כמו במציאות. הליד והנכס
     * ‏מחזירים ריק, ולכן „שלי” כאן פירושו „קונה שאני מטפל בו”.
     */
    buyer: {
      findFirst: async (args: { where: { contactId?: string; ownerUserId?: string } }) =>
        scoped(args.where) ? { id: "01BUYER" } : null,
      findMany: async (args: { where: { ownerUserId?: string } }) =>
        (args.where.ownerUserId === undefined ? ALL_CONTACTS : fx.ownedContactIds).map(
          (contactId) => ({ id: `buyer-${contactId}`, contactId }),
        ),
    },
    lead: {
      findFirst: async () => null,
      findMany: async () =>
        (fx.leadContactIds ?? []).map((contactId) => ({ id: `lead-${contactId}`, contactId })),
    },
    // ‏שום נכס אינו קושר את הלקוח הזה — „שלי” כאן הוא קונה בלבד
    property: { findFirst: async () => null, findMany: async () => [] },
    contactLink: { findFirst: async () => null },
    emailMessage: {
      findMany: async (args: { where?: { contactId?: { in?: string[] } } }) => {
        const scope = args.where?.contactId?.in;
        const rows = [
          { contactId: "01MINE", subject: "s", body: "b", direction: "in", createdAt: new Date() },
          { contactId: "01THEIRS", subject: "s", body: "b", direction: "in", createdAt: new Date() },
        ];
        return scope === undefined ? rows : rows.filter((r) => scope.includes(r.contactId));
      },
      groupBy: async () => [],
      findFirst: async () => ({ contactId: "01THEIRS" }),
      updateMany: async () => ({ count: 0 }),
    },
    emailAttachment: {
      findMany: async () => [],
      findFirst: async () => ({
        s3Key: "k",
        contentType: "application/pdf",
        sizeBytes: 1,
        name: "חוזה.pdf",
        kind: "document",
        messageId: "01MSG",
      }),
    },
    contact: { findFirst: async () => ({ id: "01THEIRS", fullName: "לקוח" }) },
  };
  const prisma = {
    withTenant: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => fn(tx),
  };
  const contacts = {
    getByIds: async (_tx: unknown, ids: readonly string[]) =>
      new Map(ids.map((id) => [id, "לקוח"])),
    getById: async () => ({ id: "01THEIRS", fullName: "לקוח" }),
  };
  return new EmailInboxService(
    prisma as never,
    {} as never,
    contacts as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

function asAgent<T>(capabilities: Capability[], fn: () => T): T {
  return TenantContext.run(
    {
      tenantId: "01TENANT",
      userId: "01ME",
      capabilities: new Set(capabilities),
      billingOnly: false,
    },
    fn,
  );
}

/** ‏סוכן רגיל: רואה את הקונים שלו בלבד. */
const AGENT: Capability[] = ["buyers.view_own", "leads.view_own", "properties.view"];
/** ‏מנהל: רואה הכול, ולכן אמור להמשיך לראות הכול. */
const MANAGER: Capability[] = [
  "buyers.view_all",
  "leads.view_all",
  "properties.view",
  "properties.view_all",
];

describe("תיבת הדואר — הפרדה בין סוכנים", () => {
  it("הרשימה מציגה רק את השיחות של הסוכן", async () => {
    const threads = await asAgent(AGENT, () =>
      serviceFor({ ownedContactIds: ["01MINE"] }).listThreads(),
    );
    expect(threads.map((t) => t.contactId)).toEqual(["01MINE"]);
  });

  /*
   * ‏הסתרה מהרשימה בלי שער על הפתיחה אינה הפרדה אלא ניחוש מזהה:
   * ‏המזהה מופיע בכתובת, בהתראות ובכרטיס הלקוח.
   */
  it("פתיחת שיחה של לקוח שאינו שלו נדחית", async () => {
    await expect(
      asAgent(AGENT, () => serviceFor({ ownedContactIds: ["01MINE"] }).thread("01THEIRS")),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("סימון כנקרא על שיחה שאינה שלו נדחה", async () => {
    await expect(
      asAgent(AGENT, () => serviceFor({ ownedContactIds: ["01MINE"] }).markRead("01THEIRS")),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  /** ‏החמורה: שליחה בשם המשרד ללקוח של סוכן אחר. */
  it("תשובה ללקוח שאינו שלו נדחית לפני כל שליחה", async () => {
    await expect(
      asAgent(AGENT, () => serviceFor({ ownedContactIds: ["01MINE"] }).reply("01THEIRS", "שלום")),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  /*
   * ‏הנתיב היחיד שאינו מקבל מזהה לקוח אלא מזהה קובץ — ולכן זה
   * ‏שנשאר פתוח אחרי שכל השאר נסגרו.
   */
  it("הורדת קובץ מתוך שיחה שאינה שלו נדחית", async () => {
    await expect(
      asAgent(AGENT, () => serviceFor({ ownedContactIds: ["01MINE"] }).attachmentRaw("01ATT")),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  /*
   * ‏הצד השני של הכלל. שער שחוסם גם את המנהל הוא תקלה, לא הידוק:
   * ‏„וגם המנהל שלו” הוא חלק מהדרישה עצמה.
   */
  it("מנהל ממשיך לראות את כל התיבה", async () => {
    const threads = await asAgent(MANAGER, () =>
      serviceFor({ ownedContactIds: [] }).listThreads(),
    );
    expect(threads.map((t) => t.contactId).sort()).toEqual(["01MINE", "01THEIRS"]);
  });

  it("מנהל פותח שיחה של כל סוכן", async () => {
    await expect(
      asAgent(MANAGER, () => serviceFor({ ownedContactIds: [] }).thread("01THEIRS")),
    ).resolves.toBeDefined();
  });
});


/**
 * ‎**ההתראה על מייל נכנס — הדרך השנייה החוצה.**
 *
 * ‏הסתרת השיחה מהתיבה אינה שווה דבר אם ההתראה עליה מוצגת לכולם.
 * ‏`NotificationsService.visible()` מציג התראה **חסרת בעלים** לכל
 * ‏המשרד, כולל תמצית מגוף המייל — ולקוח שהוא רק בעל נכס לא היה
 * ‏קונה ולא ליד, ולכן נפל בדיוק לשם (ביקורת Codex, P1).
 */
describe("בעלות ההתראה על מייל נכנס", () => {
  it("שלושת המקורות לפי הסדר, כל אחד עם המקור שלו", () => {
    expect(
      contactOwnerCandidates({
        buyers: [{ id: "01BUYER", ownerUserId: "01BUYERAGENT" }],
        leads: [{ id: "01LEAD", assignedToUserId: "01LEADAGENT" }],
        properties: [{ agentUserId: "01PROPAGENT" }],
      }),
    ).toEqual([
      { userId: "01BUYERAGENT", source: "buyers", cardId: "01BUYER" },
      { userId: "01LEADAGENT", source: "leads", cardId: "01LEAD" },
      /* ‏בעל הנכס אינו כרטיס שאפשר לתלות עליו אינטראקציה */
      { userId: "01PROPAGENT", source: "properties", cardId: null },
    ]);
  });

  /*
   * ‎**כרטיס בלי בעלים נשמט ואינו עוצר.**
   *
   * ‏הפונקציה תמיד ידעה ליפול הלאה, אבל השאילתות שמזינות אותה
   * ‏נעצרו על **קיום** הכרטיס הקודם ולא על בעלותו. התיקון ההוא
   * ‏שרד סבב אחד ונשבר שוב מסיבה עמוקה יותר — מועמד שנפסל בהרשאה
   * ‏חייב גם הוא להוריש את התור — ולכן אין יותר קיצור בכלל.
   */
  it("כרטיס בלי בעלים אינו עוצר את החיפוש", () => {
    expect(
      contactOwnerCandidates({
        buyers: [{ id: "01BUYER", ownerUserId: null }],
        leads: [{ id: "01LEAD", assignedToUserId: "01LEADAGENT" }],
        properties: [],
      }),
    ).toEqual([{ userId: "01LEADAGENT", source: "leads", cardId: "01LEAD" }]);
  });

  /** ‏זה המקרה שנפל: לקוח שהוא **רק** בעל נכס. */
  it("בעל נכס בלבד מקבל את סוכן הנכס — ולא רשימה ריקה", () => {
    expect(
      contactOwnerCandidates({
        buyers: [],
        leads: [],
        properties: [{ agentUserId: "01PROPAGENT" }],
      }),
    ).toEqual([{ userId: "01PROPAGENT", source: "properties", cardId: null }]);
  });

  /*
   * ‏הגבול: כשבאמת אין בעלים, רשימה ריקה היא התשובה הנכונה. התראה
   * ‏שאיש אינו רואה גרועה מהתראה משרדית — ומה שנשלל ממנה הוא
   * ‏התוכן, לא הקיום. את זה בודק ה-`describe` הבא.
   */
  it("בלי אף מקור — רשימה ריקה, ובכוונה", () => {
    expect(contactOwnerCandidates({ buyers: [], leads: [], properties: [] })).toEqual([]);
  });
});

/**
 * ‎**והמקורות נטענים כולם — בדיקה מבנית, ואומר זאת.**
 *
 * ‏הקיצור („אל תשאל על הליד אם לכרטיס הקונה יש בעלים”) היה נכון
 * ‏כשהשאלה הייתה „מי משויך”. מרגע שהיא „מי משויך **ורשאי**”, אין
 * ‏תנאי שמבטא אותו נכון: הפסילה נודעת רק אחרי שכל המועמדים ידועים,
 * ‏והקיצור מנע מהמועמד הבא להיטען בכלל (ביקורת Codex).
 *
 * ‏`processInbound` נוגע באחסון, בשליחה וביצירת אנשי קשר, ומכשיר
 * ‏מלא עבורו היה בודק הכול חוץ מהשורה הזו. לכן סריקת מקור, על
 * ‏מגבלותיה: היא מוודאת שהתנאי לא יחזור.
 *
 * ‎**והטענה נוסחה מחדש כתכונה.** הניסוח הקודם נעץ את שתי שורות
 * ‏השליפה עצמן, ולכן הוא נשבר כשהן ירדו ל-`loadContactOwnerSources`
 * ‏המשותפת — שער שחוסם את התיקון של עצמו. מה שהוא באמת בודק הוא
 * ‏שהתיבה אינה שולפת מקור בעצמה ואינה מתנה מקור במקור: היא מוסרת
 * ‏את השאלה למי שטוען את שלושתם.
 *
 * ‎**ומאז — היא מוסרת גם את ההרכבה.** התיבה שאלה פעמיים על אותה
 * ‏תשובה (בטרנזקציה ושוב לפני הוואטסאפ), והרכיבה את השאלה בעצמה
 * ‏בשני המקומות. ברגע שהשולח נכנס לתמונה ההרכבות נפרדו: הראשונה
 * ‏העדיפה אותו והשנייה לא, שתי התשובות לא הסכימו — וההתראה
 * ‏בוואטסאפ, דווקא במקרה שבגללו נוסף השדה, נבלעה בשקט. השאלה
 * ‏המורכבת ירדה ל-`replyRecipient`, וכאן נבדק שאיש אינו מרכיב
 * ‏אותה שוב.
 */
describe("שאילתות הבעלים אינן מותנות זו בזו", () => {
  const source = readFileSync(
    join(import.meta.dirname, "email-inbox.service.ts"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//gu, "");

  it("‏שתי הפעמים שואלות את אותה שאלה, ולא מרכיבות אותה", () => {
    expect(source.match(/replyRecipient\(/gu)).toHaveLength(2);
    expect(source).not.toContain("loadContactOwnerSources(");
    expect(source).not.toContain("notifiableContactOwnerSource(");
  });

  /*
   * ‏ולא מכריעה בעלות בעצמה. הטענה היא על **העמודות**: שליפה
   * ‏שבוחרת עמודת בעלות היא שליפה שמכריעה מי הנמען, וזו בדיוק
   * ‏העותק שנפרד מהשיחה הנכנסת — ומשם צמח „שורה אחת לכל מקור”
   * ‏בשני המקומות. שליפות אחרות (על איזה כרטיס לתלות אינטראקציה,
   * ‏למשל) בוחרות `id` בלבד ואינן נוגעות בשאלה.
   */
  it("‏והתיבה אינה שולפת עמודת בעלות בעצמה", () => {
    for (const column of ["ownerUserId: true", "assignedToUserId: true", "agentUserId: true"]) {
      expect(source, `בחירת עמודת בעלות: ${column}`).not.toContain(column);
    }
  });

  it("ואין קיצור שמדלג על מקור לפי מקור שלפניו", () => {
    expect(source).not.toContain("stillLookingForOwner");
  });
});

describe("תוכן ההתראה על מייל נכנס", () => {
  const SNIPPET = "שלום, אני מעוניין להתקדם עם הדירה ברחוב הרצל";

  it("יש בעלים — ההתראה אישית ונושאת את התמצית", () => {
    expect(inboundNotificationContent("01PROPAGENT", SNIPPET)).toEqual({
      title: "📧 לקוח ענה במייל",
      body: SNIPPET,
    });
  });

  /** ‏זה המקרה שדלף: נכס בלי סוכן משויך. */
  it("אין בעלים — ההתראה נשארת, התמצית לא", () => {
    expect(inboundNotificationContent(null, SNIPPET).body).toBeNull();
  });

  /*
   * ‏החצי השני, ובלעדיו „מחקנו את ההתראה” היה עובר את הבדיקה: מייל
   * ‏של נכס לא-משויך היה נעלם גם מהמנהל שכן רשאי לראותו.
   */
  it("אין בעלים — הכותרת עדיין אומרת שהגיע דבר מה, ולאן", () => {
    const content = inboundNotificationContent(null, SNIPPET);
    expect(content.title).not.toBe("");
    expect(content.title).toContain("מייל");
    expect(content.title).toContain("ללא סוכן משויך");
  });

  /*
   * ‏הכלל נגזר מהבעלים ולא ממקור מסוים: קונה בלי `ownerUserId`
   * ‏מגיע לאותו `null` ומקבל את אותו יחס. אחרת התיקון היה נכון
   * ‏לנכסים בלבד, ונשבר על הדרך הבאה פנימה.
   */
  it("הכלל תלוי בבעלים בלבד — לא במקור שממנו הוא נגזר", () => {
    const owner = contactOwnerCandidates({
      buyers: [{ id: "01BUYER", ownerUserId: null }],
      leads: [],
      properties: [],
    })[0];
    expect(inboundNotificationContent(owner?.userId ?? null, SNIPPET).body).toBeNull();
  });

  /*
   * ‏והצד השני של אותו כלל: כרטיס חסר-בעלים **עם** מקור אחר שיש לו
   * ‏בעלים אינו „חסר בעלים” — יש למי לשלוח, ולכן יש גם תמצית.
   */
  it("כשנמצא בעלים דרך מקור אחר — התמצית חוזרת", () => {
    const owner = contactOwnerCandidates({
      buyers: [{ id: "01BUYER", ownerUserId: null }],
      leads: [{ id: "01LEAD", assignedToUserId: "01LEADAGENT" }],
      properties: [],
    })[0];
    expect(inboundNotificationContent(owner?.userId ?? null, SNIPPET).body).toBe(SNIPPET);
  });
});

/**
 * ‎**והקישור לכרטיס הקונה — גם הוא** (ביקורת Codex, P2).
 *
 * ‏שיחה שנפתחה דרך הליד שלי יכולה להיות עם לקוח שיש לו **גם**
 * ‏כרטיס קונה של עמית. שליפת הכרטיסים הייתה משרדית, ולכן המסך צייר
 * ‏קישור אל `/buyers/:id` שאינו נפתח: גילוי קיומו של הכרטיס, ו-404
 * ‏למי שלוחץ.
 */
describe("‏הקישור לכרטיס הקונה הוא כרטיס שאפשר לפתוח", () => {
  it("שיחה שנפתחה דרך הליד שלי — בלי קישור לכרטיס של עמית", async () => {
    const threads = await asAgent(AGENT, () =>
      serviceFor({ ownedContactIds: [], leadContactIds: ["01THEIRS"] }).listThreads(),
    );
    expect(threads.map((t) => t.contactId), "השיחה עצמה אמורה להיראות").toEqual([
      "01THEIRS",
    ]);
    expect(threads[0]?.buyerId, "קישור לכרטיס שאינו נפתח").toBeUndefined();
  });

  /*
   * ‏והצד השני, שבלעדיו „אף פעם אין קישור” היה עובר: כרטיס שלי
   * ‏מקושר כרגיל.
   */
  it("וכרטיס שלי כן מקושר", async () => {
    const threads = await asAgent(AGENT, () =>
      serviceFor({ ownedContactIds: ["01MINE"] }).listThreads(),
    );
    expect(threads[0]?.buyerId).toBe("buyer-01MINE");
  });

  it("ומנהל משרד מקבל את הקישור בכל מקרה", async () => {
    const threads = await asAgent(MANAGER, () =>
      serviceFor({ ownedContactIds: [] }).listThreads(),
    );
    expect(threads.every((t) => t.buyerId !== undefined)).toBe(true);
  });
});

/**
 * ‎**ציר הזמן והקישור מצביעים לאותו מקום** (ביקורת Codex, P2).
 *
 * ‏שני הצדדים נגזרים מ-`notifiableContactOwnerSource`, ולכן שאלה
 * ‏אחת: לאן ההתראה מפנה, ולאן התמצית נרשמת. כשהם נפרדים, הסוכן
 * ‏פותח את הליד שלו ולא מוצא דבר — והתמצית יושבת על כרטיס קונה
 * ‏שהוא אינו יכול לפתוח.
 */
describe("‏ההתראה וציר הזמן — אותו מקור", () => {
  /*
   * ‎**הכרטיס מגיע מהמועמד עצמו, ולא נשלף בנפרד** (ביקורת Codex, P2).
   *
   * ‏הניסוח הקודם קיבל „מקור” וזוג מזהים שנקראו מהשורה החדשה בכל
   * ‏מקור. שני מפתחות זהות שונים לאותה שאלה — ובדיוק במקום שבו הם
   * ‏נפגשים נפער החור: כשהבעלים של הכרטיס החדש נפסל והבחירה נפלה
   * ‏על כרטיס ותיק, האינטראקציה נתלתה על החדש. עכשיו המועמד נושא
   * ‏את `cardId` שלו, ואין שני מפתחות.
   */
  const owner = (source: ContactOwnerSource, cardId: string | null): ContactOwner => ({
    userId: "01OWNER",
    source,
    cardId,
  });

  it("נבחר הקונה — נתלה על הקונה", () => {
    expect(inboundInteractionParent(owner("buyers", "01BUYER"))).toEqual({ buyerId: "01BUYER" });
  });

  /*
   * ‏זה המקרה שהממצא תיאר: יש כרטיס קונה, אבל הבחירה נפלה על הליד
   * ‏(הקונה חסום). הניסוח הקודם היה תולה על הקונה בכל מקרה.
   */
  it("נבחר הליד — נתלה על הליד, גם כשקיים כרטיס קונה", () => {
    expect(inboundInteractionParent(owner("leads", "01LEAD"))).toEqual({ leadId: "01LEAD" });
  });

  it("נבחר סוכן הנכס — אין למי לתלות", () => {
    expect(inboundInteractionParent(owner("properties", null))).toBeNull();
  });

  it("אין בעלים — אין למי לתלות", () => {
    expect(inboundInteractionParent(null)).toBeNull();
  });

  /* ‏והשורה חייבת להתקיים: מקור בלי כרטיס אינו הורה */
  it("מקור בלי כרטיס — אין למי לתלות", () => {
    expect(inboundInteractionParent(owner("buyers", null))).toBeNull();
  });
});

/**
 * ‎**„אין לאן לקפוץ” אינו „אין את מי לשאול”** (ביקורת Codex, P1).
 *
 * ‏השאלה של הניווט והשאלה של ההרשאה נענו כאן בערך אחד, ולכן לקוח
 * ‏שנראה דרך נכס — שאין לו כרטיס לפתוח — ייצר שורה בלי עוגן.
 * ‏שורה בלי עוגן פטורה מהצנזורה בקריאה בכל שלושת הערוצים, ולכן
 * ‏תמצית המייל של הלקוח המשיכה לזרום לסוכן שהנכס כבר אינו שלו.
 */
describe("‏עוגן ההרשאה של התראת המייל", () => {
  const owner = (source: ContactOwnerSource, cardId: string | null): ContactOwner => ({
    userId: "01OWNER",
    source,
    cardId,
  });

  it("נבחר הקונה — העוגן הוא הכרטיס", () => {
    expect(inboundNotificationAnchor(owner("buyers", "01BUYER"), "01CONTACT")).toEqual({
      entityType: "buyer",
      entityId: "01BUYER",
    });
  });

  it("נבחר הליד — העוגן הוא הליד", () => {
    expect(inboundNotificationAnchor(owner("leads", "01LEAD"), "01CONTACT")).toEqual({
      entityType: "lead",
      entityId: "01LEAD",
    });
  });

  /* ‏זה הממצא: אין כרטיס, ולכן אין ניווט — אבל יש את מי לשאול */
  it("נבחר סוכן הנכס — העוגן נופל ללקוח", () => {
    expect(inboundNotificationAnchor(owner("properties", null), "01CONTACT")).toEqual({
      entityType: "contact",
      entityId: "01CONTACT",
    });
  });

  /* ‏וכך גם מקור עם כרטיס חסר: „אין כרטיס” אינו „אין הרשאה לבדוק” */
  it("מקור בלי כרטיס — העוגן נופל ללקוח", () => {
    expect(inboundNotificationAnchor(owner("buyers", null), "01CONTACT")).toEqual({
      entityType: "contact",
      entityId: "01CONTACT",
    });
  });

  /*
   * ‎**ובלי בעלים — עדיין בלי עוגן.** השורה המשרדית כבר יורדת מהתוכן
   * ‏ב-`inboundNotificationContent`, ומצביע שהיה נשאר בה היה פותח את
   * ‏ההעשרה של העובד לכל המשרד — הדליפה שנסגרה בהתראות המרכזייה.
   */
  it("אין בעלים — אין עוגן, וזו השורה המשרדית בלי תוכן", () => {
    expect(inboundNotificationAnchor(null, "01CONTACT")).toEqual({});
    expect(inboundNotificationContent(null, "תמצית").body).toBeNull();
  });
});

/**
 * ‎**ומה שהעוגן קונה בפועל: הצנזורה בקריאה חלה על השורה.**
 *
 * ‏זו הבדיקה שסוגרת את הממצא מקצה לקצה — ולא רק את צורת הערך.
 * ‏בלי העוגן `redactNotification` היה מחזיר את השורה כמות שהיא לכל
 * ‏נמען, כי שורה בלי עוגן פטורה. עם העוגן היא נשאלת מול אותו איחוד
 * ‏מקורות שהתיבה עצמה נשענת עליו.
 */
describe("‏השורה שנוצרה דרך נכס — נצנזרת כשהגישה נשללה", () => {
  const CONTACT = "01CONTACT";
  const row: RedactableNotification = {
    id: "01NOTIF",
    type: "email_reply",
    title: "📧 לקוח ענה במייל",
    body: "אשמח לקבוע סיור ביום חמישי",
    ...inboundNotificationAnchor(
      { userId: "01OWNER", source: "properties", cardId: null },
      CONTACT,
    ),
  } as RedactableNotification;
  const subjects = new Map<string, AnchorSubject>();

  it("‏הסוכן שהלקוח עדיין ברשימתו — רואה את התמצית", () => {
    const seen = redactNotification(
      row,
      { allowed: new Set([CONTACT]), userId: "01OWNER", capabilities: new Set() },
      subjects,
    );
    expect(seen.body).toBe("אשמח לקבוע סיור ביום חמישי");
  });

  /*
   * ‏הנכס עבר לעמית, או `properties.view_all` נשללה: הלקוח יצא
   * ‏מ-`visibleContactIds`, וזו בדיוק אותה שורה ישנה שנשארה בתיבה.
   */
  it("‏הנכס כבר אינו שלו — התמצית יורדת", () => {
    const seen = redactNotification(
      row,
      { allowed: new Set<string>(), userId: "01OWNER", capabilities: new Set() },
      subjects,
    );
    expect(seen.body).toBeNull();
    expect(seen.title).not.toBe("📧 לקוח ענה במייל");
    expect(seen.entityId).toBeNull();
  });

  it("‏מי שרואה את כל הלקוחות — רואה", () => {
    const seen = redactNotification(
      row,
      { allowed: null, userId: "01OTHER", capabilities: new Set() },
      subjects,
    );
    expect(seen.body).toBe("אשמח לקבוע סיור ביום חמישי");
  });
});

/**
 * ‎**והשאלה נשאלת שוב אחרי ההעלאה** (ביקורת Codex, P2).
 *
 * ‏הנמען והשם נבחרים בתוך הטרנזקציה, ואחריה מועלים הקבצים —
 * ‏עשרות מגה-בייט, במכוון מחוץ לטרנזקציה. השליחה בוואטסאפ קורית
 * ‏אחרי החלון הזה ובדקה רק שהמשתמש פעיל ומנוי, ולכן נכס שהועבר
 * ‏לעמית בזמן ההעלאה השאיר את שם הלקוח יוצא לסוכן הקודם — בערוץ
 * ‏שיוצא מהמערכת ואי אפשר לצנזר בדיעבד.
 */
describe("‏התראת הוואטסאפ אחרי העלאת הקבצים", () => {
  /**
   * ‏שירות עם בעלים שנקבע **בזמן השליחה**: זו כל התכונה — הבעלים
   * ‏אינו נקרא מהצילום שנלקח לפני ההעלאה.
   */
  function serviceOwnedBy(ownerNow: string | null): {
    notify: (userId: string | null) => Promise<void>;
    sent: string[];
  } {
    const sent: string[] = [];
    const tx = {
      buyer: {
        findMany: async () => (ownerNow === null ? [] : [{ id: "01B", ownerUserId: ownerNow }]),
      },
      lead: { findMany: async () => [] },
      property: { findMany: async () => [] },
      tenant: { findUnique: async () => ({ blockedModules: [] }) },
      user: {
        findMany: async (args: { where: { id?: { in: string[] } } }) =>
          (args.where.id?.in ?? []).map((id) => ({
            id,
            role: "agent",
            capabilityOverrides: [],
          })),
      },
    };
    const prisma = {
      withExplicitTenant: async <T>(_t: string, fn: (t: typeof tx) => Promise<T>): Promise<T> =>
        fn(tx),
      user: {
        findFirst: async () => ({ phone: "+972500000000", whatsappAccess: true }),
      },
    };
    const waSend = {
      sendText: async (_phone: string, text: string) => {
        sent.push(text);
        return true;
      },
      sendTemplate: async () => undefined,
    };
    const service = new EmailInboxService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      waSend as never,
    );
    const notify = (userId: string | null): Promise<void> =>
      (
        service as unknown as {
          notifyAgentOnWhatsApp: (
            tenantId: string,
            contactId: string,
            userId: string | null,
            customerName: string,
          ) => Promise<void>;
        }
      ).notifyAgentOnWhatsApp("01TENANT", "01CONTACT", userId, "דנה לוי");
    return { notify, sent };
  }

  it("‏הבעלים לא השתנה — ההתראה יוצאת", async () => {
    const { notify, sent } = serviceOwnedBy("01ME");
    await notify("01ME");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("דנה לוי");
  });

  /* ‏זה הממצא: הכרטיס עבר לעמית בזמן ההעלאה */
  it("‏הכרטיס עבר לעמית בזמן ההעלאה — שקט", async () => {
    const { notify, sent } = serviceOwnedBy("01COLLEAGUE");
    await notify("01ME");
    expect(sent).toEqual([]);
  });

  /* ‏ונשללה הבעלות לגמרי — גם אז שקט, ולא „אין בעלים ולכן הכול” */
  it("‏אין בעלים כשיר בזמן השליחה — שקט", async () => {
    const { notify, sent } = serviceOwnedBy(null);
    await notify("01ME");
    expect(sent).toEqual([]);
  });
});
