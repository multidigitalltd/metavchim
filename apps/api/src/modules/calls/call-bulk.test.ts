import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { Capability } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { CallsService } from "./calls.service";

/**
 * ‎**פעולות מרוכזות ביומן השיחות — הספירה היא המוצר.**
 *
 * ‏המסך מדווח „X נמחקו, Y דולגו”, והמספרים האלה הם מה שמונע לחיצה
 * ‏שנייה על פעולה שכבר קרתה. שלוש הטענות כאן:
 *
 * ‎1. **כל שורה עוברת במסלול הבודד.** `remove` מריץ `assertCallAccess`
 *    ‏ורושם ביקורת לכל שיחה; שאילתה אחת על כל המזהים הייתה מוחקת
 *    ‏שיחות שהמשתמש אינו רשאי לראות, בלי עקבות.
 * ‎2. **„כבר היה כך” אינו כישלון ואינו שינוי** — הוא מספר שלישי.
 * ‎3. **העברה בין סוכנים היא פעולת מנהל**, והשער נאכף בשירות ולא
 *    ‏במסך.
 */

const CTX = (capabilities: Capability[]) => ({
  tenantId: "01TENANT",
  userId: "01ME",
  capabilities: new Set(capabilities),
  billingOnly: false,
});

function serviceWith(overrides: {
  tx?: Record<string, unknown>;
  audit?: { record: (...args: unknown[]) => Promise<void> };
}): CallsService {
  const tx = overrides.tx ?? {};
  const prisma = { withTenant: <T,>(fn: (t: unknown) => Promise<T>) => fn(tx) };
  return new CallsService(
    prisma as never,
    { encrypt: (v: string) => v, decrypt: (v: string) => v } as never,
    { getById: () => Promise.resolve(null) } as never,
    (overrides.audit ?? { record: () => Promise.resolve() }) as never,
    {} as never,
    {} as never,
  );
}

describe("מחיקה מרוכזת", () => {
  /*
   * ‎**אחת-אחת, ודרך `remove` עצמו.** זה מה שמבטיח ששער הגישה
   * ‏ורישום הביקורת רצים לכל שורה. הבדיקה מרגלת על המתודה ולא על
   * ‏המסד: הטענה היא על **המסלול**, לא על השאילתה.
   */
  it("עוברת דרך המחיקה הבודדת, פעם לכל מזהה", async () => {
    const service = serviceWith({});
    const remove = vi.spyOn(service, "remove").mockResolvedValue(undefined);
    const result = await TenantContext.run(CTX(["leads.edit"]), () =>
      service.removeMany(["01A", "01B", "01C"]),
    );
    expect(remove.mock.calls.map((call) => call[0])).toEqual(["01A", "01B", "01C"]);
    expect(result).toEqual({ done: 3, skipped: 0 });
  });

  /* ‏שורה שנעלמה בין הטעינה ללחיצה אינה שגיאה של מי שלחץ */
  it("ושורה שנעלמה נספרת כדילוג, בלי להפיל את השאר", async () => {
    const service = serviceWith({});
    vi.spyOn(service, "remove").mockImplementation((id: string) =>
      id === "01B" ? Promise.reject(new NotFoundException()) : Promise.resolve(),
    );
    const result = await TenantContext.run(CTX(["leads.edit"]), () =>
      service.removeMany(["01A", "01B", "01C"]),
    );
    expect(result).toEqual({ done: 2, skipped: 1 });
  });

  /*
   * ‎**וכשל שאינו „לא נמצא” עולה כלפי מעלה.** בליעה שלו הייתה
   * ‏מדווחת „דולגו” על תקלת מסד — כלומר מסתירה תקלה אמיתית מאחורי
   * ‏מספר שנראה תקין.
   */
  it("וכשל אמיתי אינו נבלע", async () => {
    const service = serviceWith({});
    vi.spyOn(service, "remove").mockRejectedValue(new Error("DB"));
    await expect(
      TenantContext.run(CTX(["leads.edit"]), () => service.removeMany(["01A"])),
    ).rejects.toThrow("DB");
  });
});

describe("פתיחת ליד לכמה שיחות", () => {
  /*
   * ‎**„כבר היה לה ליד” הוא מצב, לא כישלון.** בלי המספר הנפרד
   * ‏„0 לידים נפתחו” על עשרים שיחות משויכות נקרא ככישלון מלא.
   */
  it("מפרידה בין נפתח, כבר היה, ודילוג", async () => {
    const service = serviceWith({});
    vi.spyOn(service, "ensureLead").mockImplementation((id: string) => {
      if (id === "01NEW") return Promise.resolve({ leadId: "01L1", created: true });
      if (id === "01OLD") return Promise.resolve({ leadId: "01L2", created: false });
      return Promise.reject(new ForbiddenException("מחוץ להיקף"));
    });
    const result = await TenantContext.run(CTX(["leads.edit"]), () =>
      service.ensureLeadMany(["01NEW", "01OLD", "01NO"]),
    );
    expect(result).toEqual({ done: 1, already: 1, skipped: 1 });
  });
});

describe("פתיחת ליד — כשל שורה שאינו מפיל את הסבב", () => {
  /*
   * ‎**שיחה בלי מספר טלפון היא רשומה חוקית** — `create` מתיר להשמיט
   * ‏אותו — ו-`ensureLead` דוחה אותה ב-`BadRequest`. בלי הדחייה
   * ‏הזאת ברשימת הדילוגים, שיחה אחת כזאת החזירה 400 על כל הבקשה
   * ‏אחרי שכבר נפתחו לידים: המסך אומר „נכשל”, אינו מרענן, והמתווך
   * ‏לוחץ שוב (ביקורת Codex, P1).
   */
  it("שיחה בלי מספר נספרת כדילוג, והשאר נפתחות", async () => {
    const service = serviceWith({});
    vi.spyOn(service, "ensureLead").mockImplementation((id: string) =>
      id === "01NOPHONE"
        ? Promise.reject(new BadRequestException("לשיחה אין מספר טלפון"))
        : Promise.resolve({ leadId: `L${id}`, created: true }),
    );
    const result = await TenantContext.run(CTX(["leads.edit"]), () =>
      service.ensureLeadMany(["01A", "01NOPHONE", "01B"]),
    );
    expect(result).toEqual({ done: 2, already: 0, skipped: 1 });
  });
});

describe("שיוך מרוכז לנציג", () => {
  /*
   * ‎**השער בשירות, לא במסך.** תפקיד `agent` מחזיק ב-`leads.edit`
   * ‏ואין לו `tasks.assign`; בקשה ישירה אינה עוברת דרך הסרגל כלל.
   */
  it("נדחית בלי `tasks.assign` — ובלי לגעת בשום שיחה", async () => {
    const service = serviceWith({});
    const ensureLead = vi.spyOn(service, "ensureLead");
    await expect(
      TenantContext.run(CTX(["leads.edit"]), () => service.assignMany(["01A"], "01AGENT")),
    ).rejects.toThrow();
    expect(ensureLead).not.toHaveBeenCalled();
  });

  /*
   * ‎**קביעה חוזרת של אותו סוכן אינה העברה** — ואין לה מה לספר
   * ‏ביומן. שתי שיחות של אותו אדם הן ליד אחד, ולכן זה גם המקרה
   * ‏השכיח: השנייה „כבר אצלו”.
   */
  it("וליד שכבר אצל הנציג נספר בנפרד, בלי כתיבה ובלי ביקורת", async () => {
    const update = vi.fn(() => Promise.resolve({ count: 1 }));
    const record = vi.fn(() => Promise.resolve());
    const service = serviceWith({
      tx: {
        user: { findFirst: () => Promise.resolve({ id: "01AGENT" }) },
        lead: {
          findFirst: () => Promise.resolve({ assignedToUserId: "01AGENT" }),
          updateMany: update,
        },
      },
      audit: { record },
    });
    vi.spyOn(service, "ensureLead").mockResolvedValue({ leadId: "01L1", created: false });
    const result = await TenantContext.run(CTX(["leads.edit", "tasks.assign"]), () =>
      service.assignMany(["01A"], "01AGENT"),
    );
    expect(result).toEqual({ done: 0, already: 1, skipped: 0 });
    expect(update).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  /*
   * ‎**ההעברה נרשמת עם שני הצדדים.** „מי העביר את הליד הזה, ומתי”
   * ‏היא השאלה שנשאלת כשסוכן טוען שלא קיבל אותו — והתשובה חייבת
   * ‏להיות ביומן ולא בשחזור.
   */
  it("והעברה אמיתית כותבת את הליד ורושמת מאיפה לאן", async () => {
    const update = vi.fn(() => Promise.resolve({ count: 1 }));
    const record = vi.fn(() => Promise.resolve());
    const service = serviceWith({
      tx: {
        user: { findFirst: () => Promise.resolve({ id: "01NEWAGENT" }) },
        lead: {
          findFirst: () => Promise.resolve({ assignedToUserId: "01OLDAGENT" }),
          updateMany: update,
        },
      },
      audit: { record },
    });
    vi.spyOn(service, "ensureLead").mockResolvedValue({ leadId: "01L1", created: true });
    const result = await TenantContext.run(CTX(["leads.edit", "tasks.assign"]), () =>
      service.assignMany(["01A"], "01NEWAGENT"),
    );
    expect(result).toEqual({ done: 1, already: 0, skipped: 0 });
    expect(update).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]?.[1]).toMatchObject({
      action: "lead.agent_changed",
      entityType: "lead",
      entityId: "01L1",
      metadata: { from: "01OLDAGENT", to: "01NEWAGENT" },
    });
  });

  /*
   * ‎**ליד שאינו נראה אינו זז.** מנהל בלי `leads.view_all` אינו
   * ‏אמור להזיז ליד שאינו רואה — הסינון לפי בעלות חל גם כאן, ולא
   * ‏רק על השיחה.
   */
  /*
   * ‎**הנציג מאומת לפני שנפתח ולו ליד אחד** (ביקורת Codex, P1).
   *
   * ‏כשהבדיקה ישבה בתוך הטרנזקציה של כל שורה, מזהה סוכן שגוי פתח
   * ‏ליד לשיחה הראשונה ואז נדחה — הבקשה חוזרת 400, ובמסד נשאר ליד
   * ‏שאיש לא ביקש.
   */
  it("ונציג שאינו במשרד נדחה לפני שנפתח ליד", async () => {
    const service = serviceWith({
      tx: { user: { findFirst: () => Promise.resolve(null) } },
    });
    const ensureLead = vi.spyOn(service, "ensureLead");
    await expect(
      TenantContext.run(CTX(["leads.edit", "tasks.assign"]), () =>
        service.assignMany(["01A"], "01GHOST"),
      ),
    ).rejects.toThrow();
    expect(ensureLead).not.toHaveBeenCalled();
  });

  /*
   * ‎**שתי שיחות של אותו אדם הן ליד אחד** (ביקורת Codex, P2).
   *
   * ‏כשההעברה קרתה בתוך הלולאה, מנהל בלי `leads.view_all` איבד את
   * ‏הראייה על הליד מיד אחרי ההעברה הראשונה — ו-`ensureLead` של
   * ‏השיחה השנייה נכשל, כלומר „דולגה” במקום „כבר אצלו”. עכשיו כל
   * ‏השיחות נפתרות לפני שמועברת ולו אחת, והליד מועבר פעם אחת.
   */
  it("ושתי שיחות על אותו ליד — העברה אחת, ושתיהן נספרות", async () => {
    const update = vi.fn(() => Promise.resolve({ count: 1 }));
    const record = vi.fn(() => Promise.resolve());
    let moved = false;
    const service = serviceWith({
      tx: {
        user: { findFirst: () => Promise.resolve({ id: "01NEW" }) },
        lead: {
          findFirst: () => Promise.resolve({ assignedToUserId: moved ? "01NEW" : "01OLD" }),
          updateMany: (...args: unknown[]) => {
            moved = true;
            return update(...(args as []));
          },
        },
      },
      audit: { record },
    });
    /* ‏אותו ליד לשתי השיחות — בדיוק שתי שיחות של אותו מתקשר */
    vi.spyOn(service, "ensureLead").mockResolvedValue({ leadId: "01SAME", created: false });
    const result = await TenantContext.run(CTX(["leads.edit", "tasks.assign"]), () =>
      service.assignMany(["01A", "01B"], "01NEW"),
    );
    expect(result).toEqual({ done: 2, already: 0, skipped: 0 });
    expect(update).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("וליד שאינו נראה נספר כדילוג, בלי כתיבה", async () => {
    const update = vi.fn(() => Promise.resolve({ count: 0 }));
    const service = serviceWith({
      tx: {
        user: { findFirst: () => Promise.resolve({ id: "01AGENT" }) },
        lead: { findFirst: () => Promise.resolve(null), updateMany: update },
      },
    });
    vi.spyOn(service, "ensureLead").mockResolvedValue({ leadId: "01L1", created: false });
    const result = await TenantContext.run(CTX(["leads.edit", "tasks.assign"]), () =>
      service.assignMany(["01A"], "01AGENT"),
    );
    expect(result).toEqual({ done: 0, already: 0, skipped: 1 });
    expect(update).not.toHaveBeenCalled();
  });
});
