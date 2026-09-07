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
}): CalendarSyncService {
  const tx = {
    task: {
      findMany: async () => input.tasks ?? [],
      updateMany: async () => ({ count: input.rowsAffected }),
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
