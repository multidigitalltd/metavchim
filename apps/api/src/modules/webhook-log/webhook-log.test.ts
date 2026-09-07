import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CryptoService } from "../../core/crypto.service";
import type { PrismaService } from "../../core/prisma.service";
import { WebhookLogService } from "./webhook-log.service";

/**
 * ‎**היומן כמשהו שאפשר לעקוב אחריו — ומה שאסור שיישמר בו.**
 *
 * ‏שתי משפחות טענות, ושתיהן התנהגותיות ולא מבניות:
 *
 * ‎**1 · אפשר למצוא.** „לקוח התקשר ואין רישום” היא השאלה שבשבילה
 * ‏היומן קיים, והנתון היחיד שיש לשואל הוא מספר טלפון. חיפוש
 * ‏שעובד רק על כתיב אחד אינו עונה עליה.
 *
 * ‎**2 · ואי אפשר לקרוא.** יומן פלטפורמה שנקרא בעיניים אינו המקום
 * ‏שבו יישמרו מספרי הלקוחות של כל המשרדים בטקסט גלוי. הבדיקות
 * ‏כאן נועלות את ההבחנה הזו: חתימה נכנסת לטבלה, המספר לא, והחתימה
 * ‏עצמה אינה יוצאת מהשרת.
 */

interface Call {
  op: string;
  args: Record<string, unknown>;
}

/**
 * ‏פריזמה מדומה שרושמת את מה שנשאל ממנה.
 *
 * ‏הטענות כאן הן על **השאילתה** — איזו חתימה, אילו עמודות, איזה
 * ‏חתך זמן — ולכן מסד אמיתי היה מוסיף עלות בלי להוסיף ביטחון.
 */
function fakePrisma(rows: { receivedAt: Date }[] = []): {
  prisma: PrismaService;
  calls: Call[];
} {
  const calls: Call[] = [];
  const prisma = {
    webhookHit: {
      create: (args: Record<string, unknown>) => {
        calls.push({ op: "create", args });
        return Promise.resolve({});
      },
      findMany: (args: Record<string, unknown>) => {
        calls.push({ op: "findMany", args });
        return Promise.resolve(rows);
      },
      deleteMany: (args: Record<string, unknown>) => {
        calls.push({ op: "deleteMany", args });
        return Promise.resolve({ count: 7 });
      },
      groupBy: (args: Record<string, unknown>) => {
        calls.push({ op: "groupBy", args });
        return Promise.resolve([]);
      },
      count: (args: Record<string, unknown>) => {
        calls.push({ op: "count", args });
        return Promise.resolve(0);
      },
    },
  } as unknown as PrismaService;
  return { prisma, calls };
}

/**
 * ‏חתימה אמיתית באופייה — **ואטומה**.
 *
 * ‏גיבוב שמחזיר את המספר בתוכו (‎`hmac(+972…)`‎) היה מבטל בשקט את
 * ‏הבדיקה שהמספר אינו נשמר: כל ערך היה „מכיל את המספר”. אטימות
 * ‏היא בדיוק התכונה שנבדקת כאן, ולכן היא חייבת להתקיים גם בכפיל.
 */
function digest(phone: string): string {
  return createHash("sha256").update(phone).digest("hex");
}

const crypto = { phoneHash: digest } as unknown as CryptoService;

function service(rows: { receivedAt: Date }[] = []): {
  log: WebhookLogService;
  calls: Call[];
} {
  const { prisma, calls } = fakePrisma(rows);
  return { log: new WebhookLogService(prisma, crypto), calls };
}

const EVENT = {
  type: "hangup",
  direction: "inbound",
  providerCallId: "call-9",
};

const PHONE = "+972501234567";

const BASE = {
  source: "telephony" as const,
  outcome: "accepted" as const,
  tenantId: "01TENANTAAAAAAAAAAAAAAAAAA",
  key: "abc123xyz",
  method: "POST" as const,
  payload: { callid: "call-9" },
};

describe("‏מה נשמר על אירוע שנותח", () => {
  it("‏שומר את מזהה השיחה, הסוג והכיוון — שלושתם ריקים כשלא נותח", async () => {
    const { log, calls } = service();
    await log.record({ ...BASE, event: EVENT, peerPhone: PHONE });
    await log.record({ ...BASE, outcome: "unparsed", issue: "no_phone" });

    const [parsed, unparsed] = calls.map((c) => (c.args as { data: Record<string, unknown> }).data);
    expect(parsed).toMatchObject({ callId: "call-9", action: "hangup", direction: "inbound" });
    expect(unparsed).toMatchObject({ callId: null, action: null, direction: null });
  });

  it("‏חותם את מספר המתקשר ואינו כותב אותו", async () => {
    const { log, calls } = service();
    await log.record({ ...BASE, event: EVENT, peerPhone: PHONE });

    const data = (calls[0]?.args as { data: Record<string, unknown> }).data;
    expect(data["peerHash"]).toBe(digest("+972501234567"));
    /*
     * ‏זו הטענה שמגינה על עצמה מהתיקון הקל: מי שירצה „גם להציג את
     * ‏המספר” יוסיף עמודה, והבדיקה תיפול. סריקת כל הערכים ולא של
     * ‏שם עמודה מסוים, כי העמודה הבאה טרם נכתבה.
     */
    for (const value of Object.values(data)) {
      expect(String(value)).not.toContain("+972501234567");
      expect(String(value)).not.toContain("0501234567");
    }
  });

  it("‏שומר ארבע ספרות אחרונות בלבד — די כדי לזהות מתקשר חוזר", async () => {
    const { log, calls } = service();
    await log.record({ ...BASE, event: EVENT, peerPhone: PHONE });

    const data = (calls[0]?.args as { data: Record<string, unknown> }).data;
    expect(data["peerSuffix"]).toBe("4567");
  });
});

describe("‏חיפוש", () => {
  it("‏מוצא לפי מספר בכל כתיב — אותה חתימה שנשמרה", async () => {
    for (const typed of ["050-123-4567", "0501234567", "+972501234567", "972501234567"]) {
      const { log, calls } = service();
      await log.recent(50, { peerPhone: typed });
      const where = (calls[0]?.args as { where: Record<string, unknown> }).where;
      expect(where["peerHash"]).toBe(digest("+972501234567"));
    }
  });

  it("‏אינו מחזיר את החתימה עצמה לרשת", async () => {
    const { log, calls } = service();
    await log.recent(50, {});
    const select = (calls[0]?.args as { select: Record<string, unknown> }).select;
    expect(select["peerSuffix"]).toBe(true);
    expect(select["peerHash"]).toBeUndefined();
  });

  it("‏בלי סינון — בלי תנאים, כמו קודם", async () => {
    const { log, calls } = service();
    await log.recent(50);
    expect((calls[0]?.args as { where: Record<string, unknown> }).where).toEqual({});
  });

  it("‏מצרף את כל התנאים שנשלחו", async () => {
    const { log, calls } = service();
    const since = new Date("2026-01-01T00:00:00Z");
    await log.recent(50, {
      outcome: "unparsed",
      tenantId: "01TENANTAAAAAAAAAAAAAAAAAA",
      callId: "call-9",
      since,
    });
    expect((calls[0]?.args as { where: Record<string, unknown> }).where).toEqual({
      outcome: "unparsed",
      tenantId: "01TENANTAAAAAAAAAAAAAAAAAA",
      callId: "call-9",
      receivedAt: { gte: since },
    });
  });
});

describe("‏רשימת המשרדים לסינון", () => {
  /**
   * ‏נגזרת מכל מה ששמור ולא מהעמוד שמוצג: משרד ששיחותיו ישנות
   * ‏מהשורות שחזרו לא הופיע ברשימה, ולא הייתה שום דרך אחרת לבחור
   * ‏אותו — כלומר חיפוש התשעים יום היה חסום דווקא על החיבורים
   * ‏השקטים, שהם הסיבה להיכנס ליומן.
   */
  it("‏אינה מוגבלת לעמוד המוצג — ובלי תקרת שורות", async () => {
    const { log, calls } = service();
    await log.offices();
    const args = calls[0]?.args as { take?: unknown; where: Record<string, unknown> };
    expect(calls[0]?.op).toBe("groupBy");
    expect(args.take).toBeUndefined();
    expect(args.where).toEqual({ tenantId: { not: null } });
  });
});

describe("‏שמירה וריקון", () => {
  /**
   * ‏החלון הוא הבטחה שהמסך אומר בקול („נשמר תשעים יום”), ולכן
   * ‏קיצורו הוא שינוי התנהגות ולא כוונון. הבדיקה מודדת אותו מתוך
   * ‏החתך שנשלח למסד, ולא מקבוע שהיא קוראת.
   */
  it("‏גוזם מה שישן מתשעים יום", async () => {
    const { log, calls } = service();
    const before = Date.now();
    // ‏הגיזום רץ אחת לכמה כתיבות; פחות מזה אינו אמור לגעת במסד
    for (let i = 0; i < 25; i += 1) await log.record({ ...BASE, event: EVENT, peerPhone: PHONE });
    const deletes = calls.filter((c) => c.op === "deleteMany");
    expect(deletes.length).toBeGreaterThan(0);

    const where = (deletes[0]?.args as { where: { receivedAt: { lt: Date } } }).where;
    const days = (before - where.receivedAt.lt.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThanOrEqual(89.9);
    expect(days).toBeLessThanOrEqual(90.1);
  });

  /**
   * ‎**התקרה היא הגנה, ולא ניקיון.** הנתיב ציבורי: מי שיודע את
   * ‏הכתובת יכול להזרים לטבלה עד שהדיסק יימלא, והוא גם נדחה
   * ‏ב-404 וגם משאיר שורה. הבדיקה נועלת אותה במקום, כי הזזתה מחוץ
   * ‏לנתיב הקליטה (‎`CEILING_EVERY`‎) היא בדיוק סוג השינוי שיכול
   * ‏לבטל אותה בשקט.
   */
  it("‏מפיל את התקרה מדי כמה מאות כתיבות — ולא בכל גיזום", async () => {
    const { log, calls } = service([{ receivedAt: new Date("2026-01-01T00:00:00Z") }]);
    const skips = (): unknown[] =>
      calls.filter((c) => c.op === "findMany").map((c) => (c.args as { skip?: unknown }).skip);

    for (let i = 0; i < 25; i += 1) await log.record({ ...BASE, event: EVENT, peerPhone: PHONE });
    expect(skips()).toEqual([]);

    for (let i = 25; i < 500; i += 1) await log.record({ ...BASE, event: EVENT, peerPhone: PHONE });
    expect(skips()).toEqual([199_999]);
  });

  it("‏ריקון מלא מוחק הכול — בלי חתך זמן שמשאיר שורות", async () => {
    const { log, calls } = service();
    const deleted = await log.purge(0);
    expect(deleted).toBe(7);
    expect((calls[0]?.args as { where: Record<string, unknown> }).where).toEqual({});
  });

  /**
   * ‎**החתך הוא „שעה לפני רגע הקריאה” — ונעוץ משני צדדיו.**
   *
   * ‏הניסוח הקודם השווה מול `before` בלבד ודרש `>=`, אבל
   * ‏`lt = now_בפנים − שעה` ו-`now_בפנים ≥ before`, ולכן
   * ‏`before − lt ≤ שעה` **תמיד**. כלומר הטענה יכלה להתקיים רק
   * ‏כשאפס אלפיות שנייה חלפו בין השורות — היא עברה על מכונה
   * ‏מהירה ונפלה ב-CI ברגע שהשעון התקדם (`3599999`).
   *
   * ‏שני הגבולות יחד אינם יכולים להבהב, והם גם מדויקים יותר:
   * ‏`after` נלקח **אחרי** הקריאה ולכן `after − lt ≥ שעה`
   * ‏מובטח, ו-`before` נלקח לפניה ולכן `before − lt ≤ שעה`
   * ‏מובטח. הניסוח הקודם תפס חלון שגוי בכיוון אחד בלבד.
   */
  it("‏ריקון של הישן מוחק רק אותו", async () => {
    const { log, calls } = service();
    const before = Date.now();
    await log.purge(60 * 60 * 1000);
    const after = Date.now();
    const where = (calls[0]?.args as { where: { receivedAt: { lt: Date } } }).where;
    const cutoff = where.receivedAt.lt.getTime();
    expect(after - cutoff).toBeGreaterThanOrEqual(60 * 60 * 1000);
    expect(before - cutoff).toBeLessThanOrEqual(60 * 60 * 1000);
  });
});
