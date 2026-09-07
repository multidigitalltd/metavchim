import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  incomingCallTitle,
  missedCallTitle,
  publicNotificationTitle,
  type Capability,
  type RedactableNotification,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { publicNotification } from "../telephony/telephony.service";
import { redactUnauthorizedNotifications } from "./notification-visibility";

/**
 * ‎**התראה משרדית שנכתבה לפני שהגישה צומצמה** (ביקורת Codex, P1).
 *
 * ‏הכתיבה כבר מצנזרת: לקוח שאינו בהיקף הקורא מקבל כותרת בלי שם
 * ‏ובלי מספר, בלי מצביע ובלי גוף. אבל זה נכון **מרגע השלילה
 * ‏והלאה** — והשורות שכבר במסד המשיכו לצאת כמות שהן לכל אנשי
 * ‏המשרד: שם, טלפון, מצביע, ולפעמים קישור טופס נושא־אסימון.
 *
 * ‏מיגרציה שמנקה שורות ברגע השלילה הייתה ביטוי שני של הכלל, שצריך
 * ‏לרוץ מחדש בכל שינוי הרשאה ובכל העברת בעלות. הגבול נאכף בקריאה.
 */

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const ME = "01MEAAAAAAAAAAAAAAAAAAAAAA";
const OTHER = "01OTHERAAAAAAAAAAAAAAAAAAA";

/** ‏לקוח שאני רואה דרך כרטיס קונה שלי. */
const MINE = "01CONTACTMINE000000000001";
/** ‏בעל נכס של עמית — הלקוח שהשלילה נועדה להסתיר. */
const THEIRS = "01CONTACTTHEIRS0000000001";

/**
 * ‎**האדם שנראה דרך שני מקורות** — הוא לב הממצא: כרטיס הקונה שלי
 * ‏עליו, וליד של עמית על אותו אדם. שער הלקוח הוא איחוד, ולכן הוא
 * ‏אומר „מותר”; בעלות הליד היא שצריכה לצמצם.
 */
const SHARED = "01CONTACTSHARED000000001";
const BUYERS = [
  { id: "01BUYERMINE0000000000001", contactId: MINE, ownerUserId: ME },
  { id: "01BUYERSHARED00000000001", contactId: SHARED, ownerUserId: ME },
  /* ‏כרטיס של עמית על אותו אדם — קיים, ולכן הצנזור עליו הוא בגלל הבעלות */
  { id: "01BUYERTHEIRS0000000001", contactId: SHARED, ownerUserId: OTHER },
];
/**
 * ‏שיחה שהעובד תמלל: אין לה `createdBy`, ולכן ההתראה עליה נכתבת
 * ‏ברמת המשרד — עם תמצית השיחה בגוף.
 */
const CALLS: { id: string; contactId: string | null; leadId: string | null }[] = [
  { id: "01CALLTHEIRS00000000000001", contactId: null, leadId: "01LEADTHEIRS00000000000001" },
  { id: "01CALLMINE0000000000000001", contactId: MINE, leadId: null },
  /*
   * ‏שיחה ממספר לא מוכר פותחת **ליד**, לא לקוח — ולכן `contactId`
   * ‏שלה ריק וההיתר נגזר דרך הליד. בלי הנפילה הזו כל שיחה כזו
   * ‏נראית „בלי לקוח”, כלומר מצונזרת גם לסוכן שהיא שלו.
   */
  { id: "01CALLVIALEAD00000000001", contactId: null, leadId: "01LEADMINE0000000000000001" },
  /*
   * ‏השיחה של הממצא: היא נושאת `contactId` של אדם שאני **כן** רואה
   * ‏(דרך כרטיס הקונה שלי), אבל היא שייכת לליד של עמית.
   */
  { id: "01CALLCOLLEAGUE000000001", contactId: SHARED, leadId: "01LEADSHARED000000000001" },
];
const LEADS: { id: string; contactId: string; assignedToUserId: string }[] = [
  { id: "01LEADTHEIRS00000000000001", contactId: THEIRS, assignedToUserId: OTHER },
  { id: "01LEADMINE0000000000000001", contactId: MINE, assignedToUserId: ME },
  { id: "01LEADSHARED000000000001", contactId: SHARED, assignedToUserId: OTHER },
];

/*
 * ‎**הפיקסצ׳ר מכבד את ה-`where`.** `visibleContactIds` מוסיפה
 * ‏`ownerUserId`/`agentUserId` רק כשחסרה `view_all`, ומסד מדומה
 * ‏שמתעלם מהתנאי היה מחזיר אותה תשובה לסוכן ולמנהל — כלומר לא
 * ‏בודק דבר.
 */
const tx = {
  buyer: {
    findMany: async ({
      where,
      select,
    }: {
      where: { ownerUserId?: string; id?: { in: string[] } };
      select?: { id?: boolean };
    }) => {
      const rows = BUYERS.filter(
        (row) =>
          (where.ownerUserId === undefined || row.ownerUserId === where.ownerUserId) &&
          (where.id === undefined || where.id.in.includes(row.id)),
      );
      return select?.id === true
        ? rows.map((row) => ({
            id: row.id,
            contactId: row.contactId,
            ownerUserId: row.ownerUserId,
          }))
        : rows.map((row) => ({ contactId: row.contactId }));
    },
  },
  lead: {
    /*
     * ‎`leadOwnershipFilter` מחזירה `OR: [שלי, ללא משויך]` ולא
     * ‏`assignedToUserId` שטוח — פיקסצ׳ר שקורא רק את השטוח היה
     * ‏מחזיר **הכול** ומדווח „לא מסונן” כהצלחה. זו בדיוק התקלה
     * ‏שהופיעה כאן בפעם הראשונה שהבדיקה רצה.
     */
    findMany: async ({
      where,
      select,
    }: {
      where: {
        assignedToUserId?: string | null;
        id?: { in: string[] };
        OR?: { assignedToUserId: string | null }[];
      };
      select?: { id?: boolean };
    }) => {
      const owns = (assignedToUserId: string | null): boolean => {
        if (where.OR !== undefined) {
          return where.OR.some((branch) => branch.assignedToUserId === assignedToUserId);
        }
        return where.assignedToUserId === undefined
          ? true
          : where.assignedToUserId === assignedToUserId;
      };
      const rows = LEADS.filter(
        (row) => owns(row.assignedToUserId) && (where.id === undefined || where.id.in.includes(row.id)),
      );
      return select?.id === true
        ? rows.map((row) => ({
            id: row.id,
            contactId: row.contactId,
            /* ‏הבעלות מצמצמת, ולכן היא חלק מהשליפה ולא קישוט */
            assignedToUserId: row.assignedToUserId,
          }))
        : rows.map((row) => ({ contactId: row.contactId }));
    },
  },
  property: { findMany: async () => [] },
  contactLink: { findMany: async () => [] },
  call: {
    findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
      CALLS.filter((row) => where.id.in.includes(row.id)),
  },
};

function asUser<T>(capabilities: Capability[], fn: () => T): T {
  return TenantContext.run(
    { tenantId: TENANT, userId: ME, capabilities: new Set(capabilities), billingOnly: false },
    fn,
  );
}

/** ‏סוכן שמנהל המשרד צמצם: בלי `properties.view_all` ובלי `leads.view_all`. */
const SCOPED: Capability[] = ["properties.view", "buyers.view_own", "leads.view_own"];
/** ‏ברירת המחדל של כל תפקיד קיים. */
const DEFAULT: Capability[] = [...SCOPED, "properties.view_all", "leads.view_all", "buyers.view_all"];

const OFFICE_CALL: RedactableNotification = {
  userId: null,
  type: "call_missed",
  title: "📵 דנה כהן התקשרה ולא נענתה — +972501234567",
  body: "שלחו ללקוח: https://app.example/f/AbCd_1234",
  entityType: "lead",
  entityId: LEADS[0]!.id,
};
const OFFICE_MINE: RedactableNotification = {
  userId: null,
  type: "call_missed",
  title: "📵 יוסי לוי התקשר ולא נענה — +972502222222",
  body: "נפתח ליד חדש מהשיחה",
  entityType: "contact",
  entityId: MINE,
};

describe("‏התראה משרדית ישנה — הצנזורה בקריאה", () => {
  it("שורה שנכתבה לפני השלילה מצונזרת עכשיו", async () => {
    const [row] = await asUser(SCOPED, () =>
      redactUnauthorizedNotifications(tx as never, TENANT, [OFFICE_CALL]),
    );
    expect(row?.title).toBe(missedCallTitle(null, null));
    expect(row?.body).toBeNull();
    expect(row?.entityType).toBeNull();
    expect(row?.entityId).toBeNull();
    /* ‏ובמפורש: לא השם, לא המספר, ולא הקישור נושא־האסימון */
    expect(row?.title).not.toContain("דנה");
    expect(row?.title).not.toContain("97250");
  });

  /* ‏הצד השני, שבלעדיו „צנזר הכול” היה עובר ומרוקן את הפעמון */
  it("לקוח שכן בהיקף שלי עובר במלואו", async () => {
    const [row] = await asUser(SCOPED, () =>
      redactUnauthorizedNotifications(tx as never, TENANT, [OFFICE_MINE]),
    );
    expect(row).toEqual(OFFICE_MINE);
  });

  it("וברירת המחדל אינה משנה דבר", async () => {
    const rows = await asUser(DEFAULT, () =>
      redactUnauthorizedNotifications(tx as never, TENANT, [OFFICE_CALL, OFFICE_MINE]),
    );
    expect(rows).toEqual([OFFICE_CALL, OFFICE_MINE]);
  });

  /*
   * ‎**וגם שורה אישית — „היה מיועד לך אז” אינו „מותר לך עכשיו”**
   * ‏(ביקורת Codex, P1).
   *
   * ‏הניסוח הראשון פטר שורה אישית: „היא הגיעה לנמען שלה, וזה כבר
   * ‏התנאי”. אבל הכרטיס עובר בעלות, והמודול נשלל — ואז ההתראה
   * ‏הישנה נשארה פתוחה עם השם, הטלפון וקישור הטופס נושא־האסימון,
   * ‏בזמן שכל נתיב אחר לאותו אדם כבר דוחה את הנמען. כל שאר השערים
   * ‏כאן שואלים בהווה; זה היה היחיד שלא.
   */
  it("גם שורה אישית מצונזרת כשהמצביע כבר מחוץ להיקף", async () => {
    const personal = { ...OFFICE_CALL, userId: ME };
    const [row] = await asUser(SCOPED, () =>
      redactUnauthorizedNotifications(tx as never, TENANT, [personal]),
    );
    expect(row?.title).toBe(missedCallTitle(null, null));
    expect(row?.entityId).toBeNull();
  });

  /* ‏והצד השני: שורה אישית על לקוח שכן בהיקף שלי נשארת שלמה */
  it("ושורה אישית על הלקוח שלי עוברת במלואה", async () => {
    const personal = { ...OFFICE_MINE, userId: ME };
    const [row] = await asUser(SCOPED, () =>
      redactUnauthorizedNotifications(tx as never, TENANT, [personal]),
    );
    expect(row).toEqual(personal);
  });

  /* ‏ושורה בלי מצביע — אין בה עוגן, וממילא אין בה זהות */
  it("שורה משרדית בלי מצביע אינה נוגעת", async () => {
    const system: RedactableNotification = {
      userId: null,
      type: "platform_disk_low",
      title: "מקום האחסון מתמלא",
      body: "85%",
      entityType: null,
      entityId: null,
    };
    const [row] = await asUser(SCOPED, () =>
      redactUnauthorizedNotifications(tx as never, TENANT, [system]),
    );
    expect(row).toEqual(system);
  });

  /*
   * ‎**והתראת התמלול — מצביע `call`** (ביקורת Codex, P1).
   *
   * ‏העובד מתמלל ואין לו `createdBy`, ולכן ההתראה משרדית, והגוף
   * ‏שלה **הוא** תמצית השיחה. כל עוד `call` לא היה בין העוגנים,
   * ‏סוכן מוגבל קיבל את התמצית של שיחה עם לקוח שהוסתר ממנו.
   *
   * ‏השיחה נפתרת דרך הליד שלה כשאין לה `contactId` — וזה בדיוק
   * ‏המצב הנפוץ: שיחה ממספר לא מוכר פותחת ליד, לא לקוח.
   */
  it("התראת תמלול על שיחה של עמית — התמצית יורדת", async () => {
    const transcribed: RedactableNotification = {
      userId: null,
      type: "call_transcribed",
      title: "📝 השיחה עם דנה כהן תומללה",
      body: "הלקוחה מחפשת 4 חדרים ברמת גן, תקציב 2.4 מיליון",
      entityType: "call",
      entityId: CALLS[0]!.id,
    };
    const [row] = await asUser(SCOPED, () =>
      redactUnauthorizedNotifications(tx as never, TENANT, [transcribed]),
    );
    expect(row?.body, "תמצית השיחה נשארה").toBeNull();
    expect(row?.entityId).toBeNull();
    expect(row?.title).not.toContain("דנה");
  });

  /*
   * ‏והנפילה לליד היא זו שמחזיקה את המקרה הנפוץ: שיחה ממספר לא
   * ‏מוכר פותחת ליד ולא לקוח, ובלעדיה גם השיחות של הסוכן עצמו
   * ‏היו מצונזרות.
   */
  it("שיחה בלי לקוח נפתרת דרך הליד שלה — והיא של הסוכן", async () => {
    const viaLead: RedactableNotification = {
      userId: null,
      type: "call_transcribed",
      title: "📝 השיחה עם יוסי לוי תומללה",
      body: "מחפש 3 חדרים",
      entityType: "call",
      entityId: CALLS[2]!.id,
    };
    const [row] = await asUser(SCOPED, () =>
      redactUnauthorizedNotifications(tx as never, TENANT, [viaLead]),
    );
    expect(row).toEqual(viaLead);
  });

  /* ‏והצד השני: שיחה עם הלקוח שלי נשארת שלמה */
  it("ותמלול של שיחה עם הלקוח שלי נשאר", async () => {
    const mine: RedactableNotification = {
      userId: null,
      type: "call_transcribed",
      title: "📝 השיחה עם יוסי לוי תומללה",
      body: "מחפש 3 חדרים",
      entityType: "call",
      entityId: CALLS[1]!.id,
    };
    const [row] = await asUser(SCOPED, () =>
      redactUnauthorizedNotifications(tx as never, TENANT, [mine]),
    );
    expect(row).toEqual(mine);
  });

  /*
   * ‎**ובעלות הכרטיס מצמצמת — שער הלקוח לבדו אינו מספיק**
   * ‏(ביקורת Codex, P1).
   *
   * ‏הלקוח נראה לי דרך כרטיס הקונה **שלי**, ולכן שער הלקוח — שהוא
   * ‏איחוד מקורות — אומר „מותר”. אבל השיחה שייכת לליד של עמית,
   * ‏ו-`assertCallAccess` דוחה אותה במפורש. איחוד אינו יכול לחסום,
   * ‏ולכן הצמצום חייב לשבת מחוצה לו.
   */
  it("תמלול של שיחה על הליד של עמית — גם כשהלקוח נראה לי דרך כרטיס שלי", async () => {
    const transcribed: RedactableNotification = {
      userId: null,
      type: "call_transcribed",
      title: "📝 השיחה עם מיכל אבן תומללה",
      body: "מוכנה למכור, מבקשת 2.9 מיליון",
      entityType: "call",
      entityId: "01CALLCOLLEAGUE000000001",
    };
    const [row] = await asUser(SCOPED, () =>
      redactUnauthorizedNotifications(tx as never, TENANT, [transcribed]),
    );
    expect(row?.body, "תמצית השיחה של העמית נשארה").toBeNull();
    expect(row?.entityId).toBeNull();
  });

  /* ‏וכרטיס קונה של עמית — אותו כלל, עוגן אחר */
  it("מצביע לכרטיס קונה של עמית מצונזר, גם כשהלקוח נראה לי", async () => {
    const theirCard: RedactableNotification = {
      userId: null,
      type: "lead_returned",
      title: "מיכל אבן חזרה",
      body: "התעניינה שוב",
      entityType: "buyer",
      entityId: "01BUYERTHEIRS0000000001",
    };
    const [row] = await asUser(SCOPED, () =>
      redactUnauthorizedNotifications(tx as never, TENANT, [theirCard]),
    );
    expect(row?.entityId, "מצביע לכרטיס של עמית נשאר").toBeNull();
    expect(row?.body).toBeNull();
  });

  /* ‏ואותו מצביע לכרטיס **שלי** על אותו אדם — נשאר שלם */
  it("ומצביע לכרטיס הקונה שלי על אותו אדם נשאר", async () => {
    const myCard: RedactableNotification = {
      userId: null,
      type: "lead_returned",
      title: "מיכל אבן חזרה",
      body: "התעניינה שוב",
      entityType: "buyer",
      entityId: "01BUYERSHARED00000000001",
    };
    const [row] = await asUser(SCOPED, () =>
      redactUnauthorizedNotifications(tx as never, TENANT, [myCard]),
    );
    expect(row).toEqual(myCard);
  });

  /* ‏ולמנהל שרואה את כל הלידים — אותה שיחה נשארת שלמה */
  it("ולמי שרואה את כל הלידים היא נשארת", async () => {
    const transcribed: RedactableNotification = {
      userId: null,
      type: "call_transcribed",
      title: "📝 השיחה עם מיכל אבן תומללה",
      body: "מוכנה למכור",
      entityType: "call",
      entityId: "01CALLCOLLEAGUE000000001",
    };
    const [row] = await asUser(DEFAULT, () =>
      redactUnauthorizedNotifications(tx as never, TENANT, [transcribed]),
    );
    expect(row).toEqual(transcribed);
  });

  /*
   * ‎**כרטיס שנעלם מצונזר גם הוא.** מצביע שאינו מוביל עוד לאדם אינו
   * ‏„בטוח” — הוא בדיוק השורה שאי אפשר לבדוק, והכותרת שלה מלאה.
   */
  it("מצביע לכרטיס שנמחק — מצונזר, ולא נפתח כברירת מחדל", async () => {
    const gone = { ...OFFICE_CALL, entityId: "01LEADGONE0000000000000001" };
    const [row] = await asUser(SCOPED, () =>
      redactUnauthorizedNotifications(tx as never, TENANT, [gone]),
    );
    expect(row?.title).toBe(missedCallTitle(null, null));
    expect(row?.entityId).toBeNull();
  });
});

/**
 * ‎**והכותרת הציבורית היא אותה כותרת בשני הצדדים.**
 *
 * ‏הכתיבה מייצרת אותה דרך `publicNotification(true, …)`, והקריאה
 * ‏דרך `publicNotificationTitle(type)`. שני ניסוחים של „איך נראית
 * ‏התראה בלי זהות” היו נפרדים ביום שמישהו ישנה אחד מהם, ואז שורה
 * ‏ישנה ושורה חדשה היו נראות שונה באותו מסך.
 */
describe("‏הכותרת הציבורית — כתיבה וקריאה מסכימות", () => {
  const CALL = { contactName: "דנה כהן", peerPhone: "+972501234567" };

  it("שיחה שלא נענתה", () => {
    expect(publicNotificationTitle("call_missed")).toBe(
      publicNotification(true, {
        kind: "missed",
        ...CALL,
        leadId: null,
        contactId: null,
        body: null,
      }).title,
    );
  });

  it("שיחה נכנסת", () => {
    expect(publicNotificationTitle("incoming_call")).toBe(
      publicNotification(true, {
        kind: "incoming",
        ...CALL,
        leadId: null,
        contactId: null,
        body: null,
      }).title,
    );
  });

  /*
   * ‏וסוג שאינו בטבלה מקבל נוסח כללי ולא את הכותרת המקורית: סוג
   * ‏חדש שיישכח כאן יאבד את הכותרת שלו, ולא ידלוף.
   */
  it("סוג שאינו מוכר מקבל נוסח כללי", () => {
    const title = publicNotificationTitle("some_future_type");
    expect(title).toBe("התראה חדשה");
    expect(title).not.toBe(incomingCallTitle(null, null));
  });
});

/**
 * ‎**ושער מבני, כי הקורא הרביעי כבר קרה.**
 *
 * ‏`NotificationsService` מזהיר בראשו במפורש: „ערוץ רביעי היה עותק
 * ‏רביעי”. `AgentMemoryService` שכפל את התנאי בפנים בכל זאת — עם
 * ‏הערה שמצטטת את האזהרה — ולכן הצנזורה שנוספה בצד אחד לא הגיעה
 * ‏לשני. הכלל אינו „אל תשכפל”, אלא **שאין דרך שנייה לקרוא התראה**.
 */
describe("‏שער: אין דרך שנייה לקרוא התראה", () => {
  const API = join(import.meta.dirname, "..", "..");

  function sources(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) sources(full, out);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(full);
    }
    return out;
  }

  const FILES = sources(API).map((path) => ({ path, body: readFileSync(path, "utf8") }));

  /*
   * ‏התנאי עצמו: `userId: null` לצד `userId: <הנוכחי>`. מי שכותב
   * ‏אותו בידיים במקום לקרוא ל-`notificationVisibility()` הוא
   * ‏העותק הבא.
   */
  it("‏התנאי אינו נכתב בידיים בשום מקום", () => {
    const INLINE = /OR:\s*\[\s*\{\s*userId:\s*null\s*\}/u;
    const offenders = FILES.filter(
      (file) =>
        INLINE.test(file.body) && !file.path.endsWith("notification-visibility.ts"),
    ).map((file) => file.path.slice(API.length + 1));
    expect(offenders, offenders.join(", ")).toEqual([]);
  });

  /*
   * ‏וכל מי שקורא את התנאי חייב גם לצנזר: שער שנשאל ולא נאכף הוא
   * ‏בדיוק החצי שהממצא תיאר.
   */
  it("‏כל קורא שמשתמש בתנאי גם מצנזר", () => {
    const readers = FILES.filter(
      (file) =>
        file.body.includes("notificationVisibility()") &&
        !file.path.endsWith("notification-visibility.ts"),
    );
    /* ‏בלי זה השער עובר על אפס קוראים ואינו בודק דבר */
    expect(readers.length).toBeGreaterThanOrEqual(2);
    for (const file of readers) {
      const name = file.path.slice(API.length + 1);
      /*
       * ‎`markRead`/`markAllRead` כותבים ואינם מחזירים תוכן, ולכן
       * ‏די בכך שהקובץ מצנזר בכל מקום שבו הוא **מחזיר** שורות.
       */
      expect(file.body.includes("redactUnauthorizedNotifications("), name).toBe(true);
    }
  });
});

/**
 * ‎**ושני ערוצי הדחיפה — הם אינם קוראים, הם שולחים** (ביקורת Codex, P1).
 *
 * ‏המסך מצנזר בקריאה, ובעובד יושבים שני סבבים ששולחים את אותן
 * ‏שורות לטלפון: הוואטסאפ והדחיפה לדפדפן. השתקה, שעות שקט או חלון
 * ‏סגור רק מאריכים את הפער — ההתראה ממתינה בתור ויוצאת אחרי
 * ‏שהגישה כבר נשללה.
 *
 * ‏הטענה היא על **מה שנשלח**, לא על ניסוח מסוים: מה שנכנס לניסוח
 * ‏ההודעה ולמטען הדחיפה חייב להיות התוצר של `redactNotification`.
 */
describe("‏שער: אין דחיפה בלי צנזורה", () => {
  const WORKERS = readFileSync(
    join(import.meta.dirname, "..", "..", "..", "..", "workers", "src", "main.ts"),
    "utf8",
  );

  /*
   * ‏הטענה על **מה שנכנס לניסוח**, ולא על שמות המשתנים: הניסוח
   * ‏הקודם קיבע `redactNotification(row, allowed, anchorContacts)`,
   * ‏ולכן הוא נשבר ברגע שהשער נעשה מדויק יותר — כלומר חסם את
   * ‏התיקון שהוא בא להגן עליו.
   */
  it("‏סבב הוואטסאפ מנסח מתוך שורות מצונזרות", () => {
    expect(WORKERS).toMatch(/const items = queued\.map\(\(row\) => redactNotification\(/u);
    const at = WORKERS.indexOf("const message = formatNotifyMessage(items");
    expect(at, "ניסוח ההודעה נעלם").toBeGreaterThan(0);
    /* ‏והצנזורה קודמת לו, ולא אחריו */
    expect(WORKERS.search(/queued\.map\(\(row\) => redactNotification\(/u)).toBeLessThan(at);
  });

  it("‏והדחיפה לדפדפן בונה את המטען מתוך שורה מצונזרת", () => {
    expect(WORKERS).toMatch(/const notification = redactNotification\(raw,/u);
    const payload = WORKERS.indexOf("JSON.stringify(pushPayload(notification))");
    expect(payload, "מטען הדחיפה נעלם").toBeGreaterThan(0);
    expect(
      WORKERS.search(/const notification = redactNotification\(raw,/u),
      "המטען נבנה לפני הצנזורה",
    ).toBeLessThan(payload);
    /* ‏ואין יותר בנייה מהשורה הגולמית */
    expect(WORKERS).not.toContain("pushPayload(raw)");
  });

  /*
   * ‏ושניהם שואלים **פר-נמען**: קבוצת לקוחות אחת לכל המשרד הייתה
   * ‏מחזירה את אותה תשובה לסוכן ולמנהל.
   */
  it("‏הקבוצה נגזרת לכל נמען בנפרד", () => {
    const perRecipient = [...WORKERS.matchAll(/visibleContactIdSet\(/gu)];
    /* ‏הגדרה אחת ושתי קריאות — אחת בכל סבב */
    expect(perRecipient.length).toBe(3);
  });
});
