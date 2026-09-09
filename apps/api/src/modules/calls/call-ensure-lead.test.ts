import { describe, expect, it } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import type { Capability } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { CallsService } from "./calls.service";

/**
 * ‎**פתיחת ליד משיחה — ארבעה דברים שהיא חייבת לעשות נכון.**
 *
 * ‏שלושה מהם נתפסו בביקורת ולא בבדיקה, וכולם נראים תקינים בקריאה
 * ‏ראשונה: הפעולה „עבדה” — נפתח ליד, המסך התקדם — ומה שנשבר היה
 * ‏מה ש**לא** נכתב לצדו.
 */

const TENANT = "01TENANTAAAAAAAAAAAAAAAAAA";
const ME = "01MEAAAAAAAAAAAAAAAAAAAAAA";
const CALL = "01CALLAAAAAAAAAAAAAAAAAAAA";
const LEAD = "01LEADAAAAAAAAAAAAAAAAAAAA";
const NEW_CONTACT = "01NEWCONTACTAAAAAAAAAAAAAA";

const CAPS: Capability[] = ["properties.view", "buyers.view_own", "leads.view_own"];

/** ‏הליד נוצר לפני השיחה — כך שהחותם מותר. */
const LEAD_CREATED = new Date("2026-09-09T09:00:00Z");
const CALL_AT = new Date("2026-09-09T10:00:00Z");

interface Options {
  /** ‏השיחה כבר נושאת כרטיס — ואז אין מה לגזור. */
  contactId?: string | null;
  outcome?: string;
  occurredAt?: Date;
  /** ‎`create` מיזג לליד של סוכן אחר. */
  visible?: boolean;
  /** ‏מתי הליד שנוצר/מוזג נפתח. */
  leadCreatedAt?: Date;
}

interface Writes {
  call: Record<string, unknown> | null;
  firstResponse: number;
}

function serviceFor(options: Options): {
  service: CallsService;
  writes: Writes;
  tx: unknown;
} {
  const writes: Writes = { call: null, firstResponse: 0 };
  const tx = {
    $executeRaw: async () => 0,
    call: {
      findFirst: async (args: { select?: Record<string, boolean> }) =>
        args.select?.leadId !== undefined && args.select?.contactId === undefined
          ? { leadId: writes.call === null ? null : LEAD }
          : {
              leadId: null,
              contactId: options.contactId ?? null,
              phoneEncrypted: "+972501234567",
              summary: "שאל על 4 חדרים",
              direction: "inbound",
              outcome: options.outcome ?? "missed",
              occurredAt: options.occurredAt ?? CALL_AT,
              createdBy: ME,
            },
      updateMany: async (args: { data: Record<string, unknown> }) => {
        writes.call = args.data;
        return { count: 1 };
      },
    },
    lead: {
      findFirst: async () => ({
        contactId: NEW_CONTACT,
        createdAt: options.leadCreatedAt ?? LEAD_CREATED,
        assignedToUserId: ME,
      }),
      updateMany: async () => {
        writes.firstResponse += 1;
        return { count: 1 };
      },
    },
    buyer: { findFirst: async () => null },
    property: { findFirst: async () => null },
    /* ‏`assertCallAccess` → `isOrphanContact` שואל גם על קישורים */
    contactLink: { findFirst: async () => null },
    auditLog: { create: async () => ({ id: "01AUDIT" }) },
  };

  const prisma = { withTenant: async (fn: (t: unknown) => unknown) => fn(tx) };
  const crypto = { decrypt: (v: string) => v, encrypt: (v: string) => v };
  const contacts = {
    getById: async () => ({ id: NEW_CONTACT, name: "דנה", phone: "+972501234567" }),
  };
  const audit = { record: async () => undefined };
  const leads = {
    create: async () => ({
      id: LEAD,
      merged: false,
      visible: options.visible ?? true,
    }),
  };
  const service = new CallsService(
    prisma as never,
    crypto as never,
    contacts as never,
    audit as never,
    {} as never,
    {} as never,
    leads as never,
  );
  return { service, writes, tx };
}

const asUser = <T,>(fn: () => T, caps: Capability[] = [...CAPS, "leads.edit"]): T =>
  TenantContext.run(
    { tenantId: TENANT, userId: ME, capabilities: new Set(caps), billingOnly: false },
    fn,
  );

describe("‏פתיחת ליד משיחה", () => {
  /*
   * ‎**היכולת נבדקת בשירות, ולא רק בבקר** (ביקורת Codex, P1).
   *
   * ‏הנתיב נושא `@RequireCapability("leads.edit")`, וזה כיסה את
   * ‏המסך. הבוט קורא לשירות ישירות מתוך מצב ממתין, והמצב הממתין
   * ‏שורד בין הודעות: השאלה נשאלה כשהיכולת הייתה, והתשובה מגיעה
   * ‏אחרי שנשללה. בלי השער כאן, הליד נפתח בכל זאת.
   */
  it("‏נדחית בלי `leads.edit`, ואינה כותבת דבר", async () => {
    const built = serviceFor({ contactId: null });
    await expect(
      asUser(() => built.service.ensureLead(CALL), CAPS),
    ).rejects.toThrow(ForbiddenException);
    expect(built.writes.call, "השיחה חוברה בכל זאת").toBeNull();
  });

  /*
   * ‎**הכרטיס נכתב יחד עם הליד** (ביקורת Codex, P1).
   *
   * ‏במקרה שבשבילו הפעולה נבנתה — מתקשר לא מוכר — לשיחה אין
   * ‏כרטיס, ו-`create` פותח גם ליד וגם כרטיס. כתיבת הליד בלבד
   * ‏הייתה משאירה את השיחה בלי כרטיס לתמיד, והיסטוריה לפי לקוח
   * ‏לא הייתה מוצאת אותה גם אחרי שהליד הפך לקונה.
   */
  it("‏כותבת גם את הכרטיס שנוצר, לא רק את הליד", async () => {
    const built = serviceFor({ contactId: null });
    await asUser(() => built.service.ensureLead(CALL));
    expect(built.writes.call).toEqual({ leadId: LEAD, contactId: NEW_CONTACT });
  });

  it("‏ואינה דורסת כרטיס שכבר על השיחה", async () => {
    const built = serviceFor({ contactId: "01EXISTINGCONTACTAAAAAAAAA" });
    await asUser(() => built.service.ensureLead(CALL));
    expect(built.writes.call).toEqual({ leadId: LEAD });
  });

  /*
   * ‎**שיחה שנענתה היא מענה** (ביקורת Codex, P1). בלי החותם,
   * ‏אירוע `lead.created` קובע הסלמת SLA ומדדי המנטור סופרים
   * ‏„לא נענה” — על שיחה שבה כבר דיברו.
   */
  it("‏ומחתימה זמן מענה כששיחה נענתה", async () => {
    const built = serviceFor({ outcome: "answered" });
    await asUser(() => built.service.ensureLead(CALL));
    expect(built.writes.firstResponse).toBe(1);
  });

  it("‏ולא כששיחה לא נענתה", async () => {
    const built = serviceFor({ outcome: "missed" });
    await asUser(() => built.service.ensureLead(CALL));
    expect(built.writes.firstResponse).toBe(0);
  });

  /*
   * ‏אותו סייג כמו במסלול יצירת השיחה: שיחה שקדמה לליד הייתה
   * ‏נותנת זמן מענה שלילי — „ענה תוך שעה” בחינם, ונעילה של המענה
   * ‏האמיתי שיבוא אחריה.
   */
  it("‏ולא על שיחה שקדמה לליד שמוזגה אליו", async () => {
    const built = serviceFor({
      outcome: "answered",
      occurredAt: new Date("2026-09-09T08:00:00Z"),
      leadCreatedAt: LEAD_CREATED,
    });
    await asUser(() => built.service.ensureLead(CALL));
    expect(built.writes.firstResponse).toBe(0);
  });

  /*
   * ‎**ליד שמוזג לליד של עמית אינו שלי** (ביקורת Codex, P1).
   *
   * ‏חיבור השיחה אליו היה מפיל אותה מהרשימה של הסוכן הנוכחי —
   * ‏כלומר הרענון שאחרי ההמרה היה מעלים את השיחה מתחת לידיים,
   * ‏באמצע פעולה שהוא עצמו התחיל.
   */
  it("‏ואינה מחברת שיחה לליד שאינו נגיש למי שפתח", async () => {
    const built = serviceFor({ visible: false });
    await expect(asUser(() => built.service.ensureLead(CALL))).rejects.toThrow(
      ForbiddenException,
    );
    expect(built.writes.call, "השיחה חוברה בכל זאת").toBeNull();
  });
});
