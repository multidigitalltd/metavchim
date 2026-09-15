import { describe, expect, it } from "vitest";
import { CalendarSyncService } from "./calendar-sync.service";
import type { CalendarLink, GoogleCalendarService } from "./google-calendar.service";
import type { PrismaService } from "../../core/prisma.service";

/**
 * ‎**אירוע שנוצר ב-Google ואיבד את השורה שלו** (ביקורת Codex, P2).
 *
 * ‏הדחיפה קוראת אצווה, פונה ל-Google, ורק אז כותבת את המזהה חזרה —
 * ‏והשיחה עם Google היא רשת. בתוך החלון הזה אפשר למחוק את השורה:
 * ‏מחיקת שורת גיוס מנקה את הפולואפים שלה, מחיקת לקוח מנקה פגישות.
 *
 * ‏מה שקרה אז: `update` על שורה שאיננה זורק `P2025`, האצווה כולה
 * ‏נופלת, והאירוע שזה עתה נוצר נשאר ביומן של המתווך **לנצח** — אין
 * ‏שום מקום שמחזיק את המזהה שלו.
 *
 * ‏שני הכיוונים כאן, כי הכלל אחד: מה שנכון למשימה נכון לפגישה.
 */

const LINK: CalendarLink = {
  id: "01LINKAAAAAAAAAAAAAAAAAAAA",
  tenantId: "01TENANTAAAAAAAAAAAAAAAAAA",
  userId: "01USERAAAAAAAAAAAAAAAAAAAA",
  googleEmail: "agent@example.com",
  calendarId: "primary",
  refreshTokenEncrypted: "x",
  syncToken: null,
  lastSyncAt: null,
  lastError: null,
};

const NOW = new Date("2026-09-07T09:00:00.000Z");

type UpsertArgs = { googleEventId: string | null; cancelled: boolean };

/**
 * ‎`rowsAffected` הוא כל התרחיש: `0` פירושו שהשורה נמחקה בזמן
 * ‏שדיברנו עם Google.
 */
function serviceFor(input: {
  tasks?: Record<string, unknown>[];
  appointments?: Record<string, unknown>[];
  rowsAffected: number;
  calls: UpsertArgs[];
  /**
   * ‏מה קרה לשורה בזמן שדיברנו עם Google. `"marked"` הוא המצב
   * ‏שמחיקת שורת גיוס משאירה על פולואפ שכבר מסונכרן.
   */
  meanwhile?: "gone" | "marked";
  /**
   * ‏כמה פעמים הביטול המפצה נכשל מול Google לפני שהוא מצליח.
   * ‎`Infinity` — נכשל תמיד.
   */
  cancelFailures?: number;
}): CalendarSyncService {
  const tx = {
    task: {
      findMany: async () => input.tasks ?? [],
      updateMany: async (args: { where: { deletedAfterSync?: boolean } }) => ({
        /*
         * ‏המסד המדומה מכבד את התנאי: שורה שסומנה לניקוי אינה
         * ‏מתאימה ל-`deletedAfterSync: false`, וכתיבה ששכחה את
         * ‏התנאי הייתה תופסת אותה בכל זאת.
         */
        count:
          input.meanwhile === "marked" && args.where.deletedAfterSync === false
            ? 0
            : input.rowsAffected,
      }),
      deleteMany: async () => ({ count: input.rowsAffected }),
    },
    appointment: {
      findMany: async () => input.appointments ?? [],
      updateMany: async () => ({ count: input.rowsAffected }),
    },
  };
  const prisma = {
    withExplicitTenant: async <T>(_tenantId: string, fn: (t: typeof tx) => Promise<T>): Promise<T> =>
      fn(tx),
  } as unknown as PrismaService;
  const google = {
    upsertEvent: async (_link: CalendarLink, event: UpsertArgs) => {
      input.calls.push({ googleEventId: event.googleEventId, cancelled: event.cancelled });
      if (event.cancelled && (input.cancelFailures ?? 0) > 0) {
        input.cancelFailures = (input.cancelFailures ?? 0) - 1;
        throw new Error("Google החזיר שגיאה");
      }
      /* ‏יצירה מחזירה מזהה חדש; ביטול מחזיר `null`, כמו האמיתי */
      return event.cancelled ? null : (event.googleEventId ?? "gcal-new");
    },
  } as unknown as GoogleCalendarService;
  return new CalendarSyncService(prisma, google);
}

/** ‏שתי הפונקציות פרטיות — הן הגבול האמיתי, ולכן נקראות ישירות. */
function push(service: CalendarSyncService, which: "pushTasks" | "push"): Promise<number> {
  return (
    service as unknown as Record<string, (link: CalendarLink, now: Date) => Promise<number>>
  )[which]!(LINK, NOW);
}

const openTask = {
  id: "01TASKAAAAAAAAAAAAAAAAAAAA",
  title: "לחזור לבעלים",
  notes: null,
  status: "open",
  dueAt: NOW,
  googleEventId: null,
  deletedAfterSync: false,
};

const appointment = {
  id: "01APPTAAAAAAAAAAAAAAAAAAAA",
  title: "סיור",
  notes: null,
  status: "scheduled",
  startsAt: NOW,
  endsAt: null,
  googleEventId: null,
};

describe("‏דחיפה ליומן — אירוע לא נשאר בלי שורה", () => {
  it("‏משימה: השורה נעלמה בזמן הדחיפה ⇒ האירוע שנוצר נמחק", async () => {
    const calls: UpsertArgs[] = [];
    const pushed = await push(serviceFor({ tasks: [openTask], rowsAffected: 0, calls }), "pushTasks");
    expect(pushed).toBe(0);
    expect(calls).toEqual([
      { googleEventId: null, cancelled: false },
      { googleEventId: "gcal-new", cancelled: true },
    ]);
  });

  it("‏משימה: השורה קיימת ⇒ המזהה נשמר ואין ביטול", async () => {
    const calls: UpsertArgs[] = [];
    const pushed = await push(serviceFor({ tasks: [openTask], rowsAffected: 1, calls }), "pushTasks");
    expect(pushed).toBe(1);
    expect(calls).toEqual([{ googleEventId: null, cancelled: false }]);
  });

  it("‏פגישה: אותו כלל בדיוק", async () => {
    const calls: UpsertArgs[] = [];
    const pushed = await push(
      serviceFor({ appointments: [appointment], rowsAffected: 0, calls }),
      "push",
    );
    expect(pushed).toBe(0);
    expect(calls).toEqual([
      { googleEventId: null, cancelled: false },
      { googleEventId: "gcal-new", cancelled: true },
    ]);
  });

  /*
   * ‎**וגם „סומנה לניקוי” הוא שינוי שקרה תחתינו** (ביקורת Codex, P2).
   *
   * ‏מחיקת שורת גיוס אינה תמיד מוחקת את הפולואפ: משימה שכבר
   * ‏מסונכרנת נשארת עם `deletedAfterSync: true` ו-`googleSyncedAt: null`
   * ‏— סימן שממתין לסבב הבא. כתיבה שמתאימה על המזהה בלבד הייתה
   * ‏חותמת `googleSyncedAt` על הסימן, והשאילתה דורשת `null` — כלומר
   * ‏הסימן לא היה נבחר שוב לעולם, והאירוע נשאר ביומן.
   */
  it("‏השורה סומנה לניקוי בזמן הדחיפה ⇒ האירוע מבוטל, לא נחתם", async () => {
    const calls: UpsertArgs[] = [];
    const pushed = await push(
      serviceFor({
        tasks: [{ ...openTask, googleEventId: "gcal-1" }],
        rowsAffected: 1,
        meanwhile: "marked",
        calls,
      }),
      "pushTasks",
    );
    expect(pushed).toBe(0);
    expect(calls).toEqual([
      { googleEventId: "gcal-1", cancelled: false },
      { googleEventId: "gcal-1", cancelled: true },
    ]);
  });

  /*
   * ‎**וביטול מפצה שנכשל אינו „הצליח”** (ביקורת Codex, P2).
   *
   * ‏בכל מסלול אחר כישלון מול Google נגמר בסבב חוזר, כי השורה
   * ‏נשארת עם `googleSyncedAt: null`. כאן אין שורה, ולכן המזהה
   * ‏שביד הוא הדבר היחיד שמצביע על האירוע.
   */
  it("‏ביטול מפצה שנכשל עולה למעלה ואינו נבלע", async () => {
    const calls: UpsertArgs[] = [];
    await expect(
      push(
        serviceFor({
          tasks: [openTask],
          rowsAffected: 0,
          cancelFailures: Number.POSITIVE_INFINITY,
          calls,
        }),
        "pushTasks",
      ),
    ).rejects.toThrow();
    /* ‏הדחיפה עצמה, ואז שלושת ניסיונות הביטול */
    expect(calls.filter((call) => call.cancelled)).toHaveLength(3);
  });

  /*
   * ‎**וכשלון חולף נגמר מאליו** (ביקורת Codex, P2).
   *
   * ‏במסלול הזה אין סבב הבא — השורה נמחקה, ולכן אין מה לבחור שוב.
   * ‏רישום ביומן אינו מסלול ניסיון חוזר, ולכן הניסיון החוזר יושב
   * ‏כאן: 5xx בודד או ניתוק רגעי אינם משאירים אירוע יתום.
   */
  it("‏ביטול מפצה שנכשל פעם אחת מצליח בניסיון הבא", async () => {
    const calls: UpsertArgs[] = [];
    const pushed = await push(
      serviceFor({ tasks: [openTask], rowsAffected: 0, cancelFailures: 1, calls }),
      "pushTasks",
    );
    expect(pushed).toBe(0);
    expect(calls.filter((call) => call.cancelled)).toHaveLength(2);
  });

  /*
   * ‏שורה שממתינה לניקוי מבטלת תמיד, ולא רק בזכות הסטטוס: הענף
   * ‏שמתחת **מוחק** אותה, ולכן אירוע שהיה נוצר לה לא היה נשאר לו
   * ‏אף מצביע.
   */
  it("‏שורה שממתינה לניקוי מבטלת את האירוע גם כשהיא פתוחה", async () => {
    const calls: UpsertArgs[] = [];
    await push(
      serviceFor({
        tasks: [{ ...openTask, status: "open", deletedAfterSync: true, googleEventId: "gcal-1" }],
        rowsAffected: 1,
        calls,
      }),
      "pushTasks",
    );
    expect(calls).toEqual([{ googleEventId: "gcal-1", cancelled: true }]);
  });
});
