import { describe, expect, it } from "vitest";
import { ViewingReminderService } from "./viewing-reminder.service";

/**
 * ‎**שם מפוענח שנכתב לתוך טקסט חופשי — הדליפה שאין לה שער.**
 *
 * ‏כשתזכורת הסיור אינה נמסרת נפתחת משימה, והיא מוטלת על מי שקבע
 * ‏את הסיור. הנוסח כלל את **שמו של הנמען** — בעל הנכס או הדייר —
 * ‏ולכן סוכן שנחסם מבעלי הנכסים של המשרד קיבל את השם דרך לוח
 * ‏המשימות. ומשם הוא המשיך: `CalendarSyncService` מעתיק את ההערות
 * ‏לתיאור האירוע ב-Google (ביקורת Codex, P1).
 *
 * ## ‏למה התיקון בכתיבה ולא בקריאה
 *
 * ‏סינון בקריאה היה צריך לחזור על עצמו בכל קורא — לוח המשימות,
 * ‏סנכרון היומן, ייצוא — ולפספס את הרביעי. **שם שלא נכתב אינו
 * ‏דורש שער בשום מקום.** זו גם הסיבה שהבדיקה הזו בודקת את מה
 * ‏שנכתב, ולא את מה שמוחזר.
 */

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const OWNER = "01OWNERUSERAAAAAAAAAAAAAAA";

function serviceFor(created: { notes?: string }[]): ViewingReminderService {
  const tx = {
    task: {
      findFirst: async () => null,
      create: async (args: { data: { notes?: string } }) => {
        created.push(args.data);
        return args.data;
      },
    },
  };
  const service = Object.create(ViewingReminderService.prototype) as Record<string, unknown>;
  service["prisma"] = {
    withExplicitTenant: async <T>(_t: string, fn: (t: typeof tx) => Promise<T>): Promise<T> =>
      fn(tx),
  };
  return service as never;
}

const APPOINTMENT = {
  id: "01APPTAAAAAAAAAAAAAAAAAAAA",
  startsAt: new Date("2026-09-10T09:00:00.000Z"),
  buyerId: null,
  propertyId: "01PROPAAAAAAAAAAAAAAAAAAAA",
  createdBy: OWNER,
  ownerUserId: OWNER,
};

async function openTaskWith(
  unreachable: { audience: "occupant" | "buyer"; name: string; optedOut: boolean }[],
): Promise<string> {
  const created: { notes?: string }[] = [];
  const service = serviceFor(created) as unknown as {
    openTask: (
      tenantId: string,
      appointment: typeof APPOINTMENT,
      unreachable: readonly unknown[],
      address: string,
      when: string,
    ) => Promise<boolean>;
  };
  await service.openTask(TENANT, APPOINTMENT, unreachable, "אחוזה 5, רעננה", "מחר ב-12:00");
  return created[0]?.notes ?? "";
}

describe("משימת תזכורת שלא נמסרה", () => {
  it("אינה נושאת את שם הנמען", async () => {
    const notes = await openTaskWith([
      { audience: "occupant", name: "רותי בעלת הדירה", optedOut: false },
    ]);
    expect(notes).not.toContain("רותי");
  });

  /*
   * ‏החצי השני: השמטת השם אינה מרוקנת את המשימה. המתווך עדיין
   * ‏חייב לדעת **מי** לא קיבל ומה לעשות — אחרת המשימה היא רעש.
   */
  it("ועדיין אומרת מי לא קיבל ומה לעשות", async () => {
    const notes = await openTaskWith([
      { audience: "occupant", name: "רותי בעלת הדירה", optedOut: false },
    ]);
    expect(notes).toContain("בעל הנכס/הדייר");
    expect(notes).toContain("אחוזה 5, רעננה");
    expect(notes).toContain("להתקשר");
  });

  it("קונה מסומן כקונה", async () => {
    const notes = await openTaskWith([
      { audience: "buyer", name: "דני הקונה", optedOut: false },
    ]);
    expect(notes).toContain("הקונה");
    expect(notes).not.toContain("דני");
  });

  /*
   * ‏„ביקש לא לקבל הודעות” הוא מידע תפעולי ולא זהות — הוא נשאר,
   * ‏כי בלעדיו המתווך ינסה שוב לשלוח במקום להרים טלפון.
   */
  it("סירוב לקבל הודעות נשאר בנוסח", async () => {
    const notes = await openTaskWith([
      { audience: "occupant", name: "רותי בעלת הדירה", optedOut: true },
    ]);
    expect(notes).toContain("ביקש/ה לא לקבל הודעות");
    expect(notes).not.toContain("רותי");
  });

  /*
   * ‏שני נמענים מאותו תפקיד — בעלים ודייר — הופכים לשורה אחת ולא
   * ‏לשתיים זהות. `Set` ולא `map`.
   */
  it("שני נמענים מאותו תפקיד אינם מוכפלים", async () => {
    const notes = await openTaskWith([
      { audience: "occupant", name: "רותי", optedOut: false },
      { audience: "occupant", name: "משה", optedOut: false },
    ]);
    expect(notes.match(/בעל הנכס\/הדייר/gu)).toHaveLength(1);
  });
});
