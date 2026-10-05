import { BadRequestException, Logger } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { autoNetworkPublish } from "./auto-network-publish";
import { TenantContext } from "./tenant-context";
import type { PrismaService } from "../core/prisma.service";

/**
 * ‎**אוטומציה שנכשלת בשקט אינה ניתנת להבחנה מאוטומציה שאינה קיימת.**
 *
 * זה היה הדיווח: המשרד סימן „כל נכס וקונה יעלה אוטומטית לשיתופים”,
 * פתח כרטיסים, ולא ראה אותם ברשת — בלי שום סימן למה. שני המסלולים
 * עטפו את הפרסום ב-`catch {}` ריק, ולכן כל סירוב (מכסה, קונה בלי
 * אזור חיפוש, מסלול שאינו מוכר) נעלם בלי לוג ובלי התראה.
 *
 * הבדיקות כאן הן על ההתנהגות שמחליפה אותו: הכרטיס שורד את הכשל,
 * והכשל **נראה** — ובלי לגרור לתוך ההתראה טקסט שאיש לא ניסח.
 */

interface Written {
  type: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  userId: string | null;
  dedupeKey: string;
}

/**
 * ‎`notifyOnce` כותבת ב-SQL גולמי, ולכן מה שנלכד כאן הוא הפרמטרים
 * שהתבנית מקבלת — בדיוק בסדר של `INSERT` שבעוזר.
 */
function fakePrisma(
  settings: Record<string, unknown>,
  /** ‏כמה שורות פרסום פעילות יש לכרטיס — מה ש-`published` שואלת. */
  live = 0,
): {
  prisma: PrismaService;
  written: Written[];
} {
  const written: Written[] = [];
  const tx = {
    sharedListing: { count: () => Promise.resolve(live) },
    sharedDemand: { count: () => Promise.resolve(live) },
    $executeRaw: (
      _strings: TemplateStringsArray,
      _id: string,
      _tenantId: string,
      userId: string | null,
      type: string,
      title: string,
      body: string | null,
      entityType: string | null,
      entityId: string | null,
      dedupeKey: string,
    ) => {
      written.push({ userId, type, title, body, entityType, entityId, dedupeKey });
      return Promise.resolve(1);
    },
  };
  const prisma = {
    tenant: { findUnique: () => Promise.resolve({ settings }) },
    withTenant: <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx),
  } as unknown as PrismaService;
  return { prisma, written };
}

const logger = new Logger("test");

function asAgent<T>(fn: () => T): T {
  return TenantContext.run(
    {
      tenantId: "01TENANTAAAAAAAAAAAAAAAAAA",
      userId: "01USERAAAAAAAAAAAAAAAAAAAA",
      capabilities: new Set(),
      billingOnly: false,
    },
    fn,
  );
}

describe("פרסום אוטומטי לרשת", () => {
  it("המתג כבוי — הפרסום אינו רץ בכלל", async () => {
    const { prisma, written } = fakePrisma({});
    let ran = false;
    await asAgent(() =>
      autoNetworkPublish({ prisma, logger }, "property", "01PROPAAAAAAAAAAAAAAAAAAAA", () => {
        ran = true;
        return Promise.resolve();
      }),
    );
    expect(ran).toBe(false);
    expect(written).toHaveLength(0);
  });

  it("המתג דלוק והפרסום הצליח — אין התראה", async () => {
    const { prisma, written } = fakePrisma({ autoShareProperties: true });
    await asAgent(() =>
      autoNetworkPublish({ prisma, logger }, "property", "01PROPAAAAAAAAAAAAAAAAAAAA", () =>
        Promise.resolve(),
      ),
    );
    expect(written).toHaveLength(0);
  });

  /*
   * הלב: הסירוב שלנו בעברית הוא בדיוק מה שהסוכן צריך לקרוא, והוא
   * מגיע אליו עם הכרטיס שממנו מפרסמים ידנית.
   */
  it("סירוב מנוסח שלנו מגיע כלשונו להתראה, עם הכרטיס", async () => {
    const { prisma, written } = fakePrisma({ autoShareBuyers: true });
    await asAgent(() =>
      autoNetworkPublish({ prisma, logger }, "buyer", "01BUYERAAAAAAAAAAAAAAAAAAA", () =>
        Promise.reject(
          new BadRequestException("לא ניתן לפרסם קונה בלי אזור חיפוש"),
        ),
      ),
    );
    expect(written).toHaveLength(1);
    const row = written[0]!;
    expect(row.type).toBe("network_autopublish_failed");
    expect(row.body).toContain("לא ניתן לפרסם קונה בלי אזור חיפוש");
    expect(row.entityType).toBe("buyer");
    expect(row.entityId).toBe("01BUYERAAAAAAAAAAAAAAAAAAA");
    expect(row.userId).toBe("01USERAAAAAAAAAAAAAAAAAAAA");
    expect(row.dedupeKey).toBe("network_autopublish_failed:01BUYERAAAAAAAAAAAAAAAAAAA");
  });

  /*
   * ‎**שגיאה שאיש לא ניסח אינה נכנסת לגוף ההתראה.** הודעת Prisma
   * נושאת שמות עמודות וערכים מתוך השורה, וההתראה נקראת בפעמון
   * ובוואטסאפ — כלומר מחוץ לשערי הראייה שהשורה עצמה עוברת בהם.
   */
  it("שגיאה שאינה סירוב שלנו אינה מדליפה את הטקסט שלה", async () => {
    const { prisma, written } = fakePrisma({ autoShareProperties: true });
    await asAgent(() =>
      autoNetworkPublish({ prisma, logger }, "property", "01PROPAAAAAAAAAAAAAAAAAAAA", () =>
        Promise.reject(new Error('Unique constraint failed on phone_hash "0501234567"')),
      ),
    );
    expect(written).toHaveLength(1);
    expect(written[0]!.body).not.toContain("0501234567");
    expect(written[0]!.body).toContain("שגיאה זמנית");
  });

  /*
   * ‎**כשל אחרי שהשמירה עברה אינו כשל.** שני מסלולי הפרסום מסיימים
   * את הטרנזקציה ורק אחריה שולפים את ה-DTO; שאילתה שנופלת שם מגיעה
   * לכאן כשגיאה, בזמן שהמודעה כבר חיה ברשת. התראה כזו הייתה שולחת
   * את הסוכן לפרסם ידנית כרטיס שכבר מפורסם — ושם הוא מקבל „כבר
   * מפורסם ברשת” ומאבד אמון בשתי ההודעות (ביקורת Codex).
   */
  it("הפרסום נשמר והשליפה שאחריו נפלה — אין התראת כשל", async () => {
    const { prisma, written } = fakePrisma({ autoShareProperties: true }, 1);
    await asAgent(() =>
      autoNetworkPublish({ prisma, logger }, "property", "01PROPAAAAAAAAAAAAAAAAAAAA", () =>
        Promise.reject(new Error("read-back failed")),
      ),
    );
    expect(written).toHaveLength(0);
  });

  /* ‏והכיוון השני: אין שורה, כלומר הפרסום באמת לא עבר. */
  it("הפרסום לא נשמר — ההתראה יוצאת", async () => {
    const { prisma, written } = fakePrisma({ autoShareProperties: true }, 0);
    await asAgent(() =>
      autoNetworkPublish({ prisma, logger }, "property", "01PROPAAAAAAAAAAAAAAAAAAAA", () =>
        Promise.reject(new BadRequestException("הנכס כבר מפורסם ברשת")),
      ),
    );
    expect(written).toHaveLength(1);
  });

  /*
   * ‎**ובדיקה שנפלה אינה משתיקה.** אותו מסד שנפל הרגע יכול להפיל גם
   * אותה, וההתנהגות הזהירה היא לדווח: „לא פורסם” שגוי הוא הטרדה,
   * „פורסם” שגוי הוא מודעה חיה שאיש אינו יודע עליה.
   */
  it("גם הבדיקה נפלה — מדווחים על כשל", async () => {
    const written: Written[] = [];
    let call = 0;
    const prisma = {
      tenant: { findUnique: () => Promise.resolve({ settings: { autoShareBuyers: true } }) },
      withTenant: (fn: (t: unknown) => Promise<unknown>) => {
        call += 1;
        if (call === 1) return Promise.reject(new Error("db down"));
        return fn({
          $executeRaw: (
            _s: TemplateStringsArray,
            _id: string,
            _t: string,
            userId: string | null,
            type: string,
            title: string,
            body: string | null,
            entityType: string | null,
            entityId: string | null,
            dedupeKey: string,
          ) => {
            written.push({ userId, type, title, body, entityType, entityId, dedupeKey });
            return Promise.resolve(1);
          },
        });
      },
    } as unknown as PrismaService;
    await asAgent(() =>
      autoNetworkPublish({ prisma, logger }, "buyer", "01BUYERAAAAAAAAAAAAAAAAAAA", () =>
        Promise.reject(new BadRequestException("לא ניתן לפרסם קונה בלי אזור חיפוש")),
      ),
    );
    expect(written).toHaveLength(1);
  });

  /* התראה שנפלה אינה מפילה את היצירה — הכרטיס כבר נשמר. */
  it("כשל בכתיבת ההתראה אינו מתפוצץ כלפי מעלה", async () => {
    const prisma = {
      tenant: { findUnique: () => Promise.resolve({ settings: { autoShareBuyers: true } }) },
      withTenant: () => Promise.reject(new Error("db down")),
    } as unknown as PrismaService;
    await expect(
      asAgent(() =>
        autoNetworkPublish({ prisma, logger }, "buyer", "01BUYERAAAAAAAAAAAAAAAAAAA", () =>
          Promise.reject(new BadRequestException("המסלול של המשרד אינו מוגדר")),
        ),
      ),
    ).resolves.toBeUndefined();
  });
});

/**
 * ‎**ומבנית: אף מסלול אינו חוזר ל-`catch` הריק.**
 *
 * שני העותקים שהוחלפו כאן היו זהים, והם נכתבו זה לצד זה. עותק
 * שלישי שייכתב מחר יחזיר את השקט בדיוק במקום אחד — וזו בדיוק
 * הצורה שבה התקלה הזו נולדה.
 */
describe("שני המסלולים עוברים בעוזר האחד", () => {
  const root = join(import.meta.dirname, "..", "modules");
  const sources = [
    join(root, "properties", "properties.service.ts"),
    join(root, "buyers", "buyers.service.ts"),
  ];

  for (const file of sources) {
    it(`${file.split("/").pop()!} מפרסם דרך autoNetworkPublish`, () => {
      const text = readFileSync(file, "utf8");
      expect(text).toContain("autoNetworkPublish(");
      expect(text).not.toMatch(/catch\s*\{\s*\/\/[^\n]*(רשת|פרסום ידני|שיתוף ידני)/u);
    });
  }
});
