import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  ThrottleWebhook,
  WEBHOOK_THROTTLE,
  WEBHOOK_THROTTLER,
  webhookThrottleTarget,
  webhookTracker,
} from "./webhook-throttle";
import { WebhookThrottlerGuard } from "./webhook-throttler.guard";

/**
 * ‎**מי שולט בקצב — המשרד, לא כתובת ה-IP.**
 *
 * ‏כל המרכזיות שיושבות על אותה מרכזיית ענן מגיעות מאותן כתובות,
 * ‏וכך גם כל טופסי הלידים של אותה פלטפורמת שיווק. תקרה לפי IP
 * ‏חולקה בין כל המשרדים במקום להינתן לכל אחד.
 */
describe("webhookTracker", () => {
  it("‏שני משרדים — שני מונים", () => {
    const a = webhookTracker({ params: { key: "office-a-key" }, ip: "1.2.3.4" }, "key");
    const b = webhookTracker({ params: { key: "office-b-key" }, ip: "1.2.3.4" }, "key");
    expect(a).not.toBe(b);
  });

  /* ‏זו הבעיה עצמה: אותה כתובת, ולכן קודם אותו דלי. */
  it("‏אותו משרד מכתובות שונות — אותו מונה", () => {
    const a = webhookTracker({ params: { key: "same" }, ip: "1.2.3.4" }, "key");
    const b = webhookTracker({ params: { key: "same" }, ip: "9.9.9.9" }, "key");
    expect(a).toBe(b);
  });

  /*
   * ‏המחרוזת נוסעת אל `ThrottlerLimitDetail` ומשם אל לוגים. מפתח
   * ‏וובהוק מאפשר לזייף אירועים בשם המשרד.
   */
  it("‏המפתח עצמו אינו נמצא במונה", () => {
    const secret = "s3cret-webhook-key";
    expect(webhookTracker({ params: { key: secret }, ip: "1.2.3.4" }, "key")).not.toContain(secret);
  });

  /*
   * ‎**בלי מפתח נופלים ל-IP, ולא למחרוזת קבועה.**
   *
   * ‏מחרוזת קבועה לכולם הייתה מאחדת את כל הפניות לדלי אחד, ואז
   * ‏פנייה אחת ללא מפתח הייתה נועלת את כל המשרדים יחד — גרוע
   * ‏בהרבה ממה שהיה כאן קודם.
   */
  it("‏בלי מפתח — נופל ל-IP, ולא לדלי משותף", () => {
    const a = webhookTracker({ params: {}, ip: "1.2.3.4" }, "key");
    const b = webhookTracker({ params: {}, ip: "9.9.9.9" }, "key");
    expect(a).not.toBe(b);
    expect(webhookTracker({ params: { key: "" }, ip: "1.2.3.4" }, "key")).toBe(a);
  });
});

/** ‏הצהרה אחת שמחזיקה את שתי העובדות — המונה, והיומן. */
describe("ThrottleWebhook", () => {
  function decorate(): { handler: () => void } {
    const handler = (): void => undefined;
    const target = { handler };
    ThrottleWebhook({ source: "telephony", param: "key" }, 60)(
      target,
      "handler",
      Object.getOwnPropertyDescriptor(target, "handler") ?? { value: handler },
    );
    return target;
  }

  it("‏מסמן את היעד שהיומן קורא", () => {
    const { handler } = decorate();
    const context = { getHandler: () => handler } as never;
    expect(webhookThrottleTarget(context)).toEqual({ source: "telephony", param: "key" });
  });

  /*
   * ‏מונה בלי סימון = דחייה שלא מגיעה ליומן; סימון בלי מונה =
   * ‏תקרה שנשארה לפי IP. הצהרה אחת מונעת את שני החצאים.
   */
  it("‏ומגדיר את המונה השני באותה הצהרה", () => {
    const { handler } = decorate();
    const limit = Reflect.getMetadata(`THROTTLER:LIMIT${WEBHOOK_THROTTLER}`, handler) as unknown;
    const tracker = Reflect.getMetadata(`THROTTLER:TRACKER${WEBHOOK_THROTTLER}`, handler) as
      | ((req: unknown) => string)
      | undefined;
    expect(limit).toBe(60);
    expect(tracker).toBeTypeOf("function");
    expect(tracker?.({ params: { key: "abc" }, ip: "1.1.1.1" })).toContain("key:");
  });
});

/**
 * ‎**דחייה על תקרה נרשמת — ופעם אחת בחלון, לא בכל בקשה.**
 *
 * ‏הצפה היא בדיוק המצב שבו הדחיות מגיעות באלפים; רישום כל אחת היה
 * ‏הופך את היומן למגבר של ההצפה.
 */
describe("WebhookThrottlerGuard", () => {
  function guardWith(record: ReturnType<typeof vi.fn>): {
    guard: WebhookThrottlerGuard;
    contextFor: (key: string) => never;
  } {
    const guard = new WebhookThrottlerGuard(
      [{ name: "default", ttl: 60_000, limit: 300 }],
      { increment: vi.fn() } as never,
      { getAllAndOverride: () => undefined } as never,
      { record } as never,
    );
    const handler = (): void => undefined;
    Reflect.defineMetadata(WEBHOOK_THROTTLE, { source: "telephony", param: "key" }, handler);
    const contextFor = (key: string): never =>
      ({
        getHandler: () => handler,
        switchToHttp: () => ({ getRequest: () => ({ params: { key }, method: "POST" }) }),
      }) as never;
    return { guard, contextFor };
  }

  async function reject(guard: WebhookThrottlerGuard, context: never): Promise<void> {
    await guard["throwThrottlingException"](context, {} as never).catch(() => undefined);
  }

  it("‏הדחייה מגיעה ליומן, עם המקור הנכון", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const { guard, contextFor } = guardWith(record);
    await reject(guard, contextFor("office-a"));
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]?.[0]).toMatchObject({
      source: "telephony",
      outcome: "rate_limited",
      tenantId: null,
      key: "office-a",
    });
  });

  it("‏מאה דחיות של אותו מפתח — שורה אחת", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const { guard, contextFor } = guardWith(record);
    for (let i = 0; i < 100; i += 1) await reject(guard, contextFor("office-a"));
    expect(record).toHaveBeenCalledTimes(1);
  });

  /* ‏דחיסה לפי מפתח, ולא תקרה גלובלית שמסתירה משרד שני. */
  it("‏אבל משרד אחר מקבל שורה משלו", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const { guard, contextFor } = guardWith(record);
    await reject(guard, contextFor("office-a"));
    await reject(guard, contextFor("office-b"));
    expect(record).toHaveBeenCalledTimes(2);
  });

  it("‏ונתיב שאינו וובהוק אינו נרשם כלל", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const { guard } = guardWith(record);
    const plain = (): void => undefined;
    await reject(
      guard,
      {
        getHandler: () => plain,
        switchToHttp: () => ({ getRequest: () => ({ params: {}, method: "POST" }) }),
      } as never,
    );
    expect(record).not.toHaveBeenCalled();
  });
});

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sources(path, out);
    else if (entry.name.endsWith(".controller.ts")) out.push(path);
  }
  return out;
}

/**
 * ‎**שער: נתיב ציבורי שנושא מפתח משרד נספר לפי המפתח.**
 *
 * ‏הטענה היא ההכרעה עצמה — „מי משלם על הקצב” — ולא צורת הקוד:
 * ‏נתיב ציבורי שיש בו `:key` ומגביל קצב, חייב להגביל לפי המפתח.
 * ‏נתיב חדש שיוסיף `@Throttle({ default: … })` על `:key` ציבורי
 * ‏יחזיר בדיוק את הבאג שתוקן כאן, ולכן ייפול.
 */
describe("שער: תקרת וובהוק נספרת לפי המשרד", () => {
  const ROOT = join(__dirname, "..");

  it("‏אין נתיב ציבורי עם :key שמגביל לפי IP", () => {
    const offenders: string[] = [];
    for (const path of sources(ROOT)) {
      const src = readFileSync(path, "utf8");
      /* ‏כל בלוק דקורטורים שמסתיים ב-`(":key")` — Post או Get. */
      for (const [block] of src.matchAll(/@Public\(\)[\s\S]{0,400}?@(?:Post|Get)\("(:key)"\)/gu)) {
        if (/@Throttle\(/u.test(block)) {
          offenders.push(`${path.slice(ROOT.length + 1)}: @Throttle לפי IP על נתיב עם מפתח`);
        }
      }
    }
    expect(offenders, "תקרה שחוזרת להיספר לפי IP").toEqual([]);
  });

  /* ‏והצד החיובי: שני הנתיבים האלה אכן מצהירים. */
  it("‏ושני נתיבי הוובהוק מצהירים על ההגבלה לפי משרד", () => {
    const declaring = sources(ROOT)
      .filter(({ length }) => length > 0)
      .filter((path) => /@ThrottleWebhook\(/u.test(readFileSync(path, "utf8")))
      .map((path) => path.slice(ROOT.length + 1).replace(/\\/gu, "/"))
      .sort();
    expect(declaring).toEqual([
      "modules/leads/web-lead.controller.ts",
      "modules/telephony/telephony.controller.ts",
    ]);
  });
});
