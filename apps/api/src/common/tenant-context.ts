import { AsyncLocalStorage } from "node:async_hooks";
import type { Capability } from "@metavchim/shared";

/**
 * הקשר הדייר של הבקשה הנוכחית — נקבע פעם אחת ב-Middleware מתוך ה-Session
 * המאומת, לעולם לא מפרמטר של הלקוח (docs/04 §2).
 *
 * שכבת RLS: שירות ה-Prisma מריץ `SET app.tenant_id` לפי הערך הזה בכל
 * טרנזקציה, כך שגם שאילתה שגויה בקוד לא חוצה דיירים.
 */
export interface RequestContext {
  tenantId: string;
  userId: string;
  capabilities: ReadonlySet<Capability>;
  /**
   * המשרד מחובר אבל אינו רשאי לעבוד — ניסיון שפג או מנוי שהסתיים.
   *
   * זה **לא** אותו דבר כמו השהיה מהפלטפורמה. משרד מושהה אינו מתחבר
   * בכלל; משרד שתקופתו נגמרה נכנס, ומגיע למסך המנוי ולשם בלבד. אחרת
   * הוא נעול מחוץ למסך היחיד שיכול לפתור לו את הבעיה — וזה בדיוק
   * הרגע שבו הוא אמור לשלם.
   */
  billingOnly: boolean;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const TenantContext = {
  run<T>(ctx: RequestContext, fn: () => T): T {
    return storage.run(ctx, fn);
  },

  /** זורק אם אין הקשר — עדיף כשל מפורש מדליפה שקטה של שאילתה חסרת-דייר. */
  current(): RequestContext {
    const ctx = storage.getStore();
    if (!ctx) {
      throw new Error("TenantContext missing — endpoint reached data layer without auth context");
    }
    return ctx;
  },

  maybeCurrent(): RequestContext | undefined {
    return storage.getStore();
  },
};

export function requireCapability(capability: Capability): void {
  const ctx = TenantContext.current();
  if (!ctx.capabilities.has(capability)) {
    throw new Error(`Missing capability: ${capability}`);
  }
}
