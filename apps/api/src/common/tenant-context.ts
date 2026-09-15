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
  /**
   * לא undefined = הבקשה הזו מבוצעת ע"י התמיכה, בתוך חלון ההסכמה.
   * כל רישום ביומן נושא את הכתובת — "מי עשה" חייב להיות אמת גם
   * כשהתמיכה פועלת בשם המשתמש.
   */
  supportAdminEmail?: string;
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

/**
 * ‎**האדם שמבצע את הפעולה — או `null` כשאין כזה.**
 *
 * ‏„מי עשה” ו„איזה דייר” אינן אותה שאלה, ולכן `userId` לבדו אינו
 * ‏התשובה: `TenantContext.run` נקרא גם עם הקשר משרדי שאין לו אדם
 * ‏(טופס ציבורי, סבב רקע), ושם `userId` הוא **מחרוזת ריקה** ולא
 * ‏`null` — כלומר `?? null` אינו תופס אותו, ומחרוזת ריקה נכתבת
 * ‏למסד כאילו היא מזהה.
 *
 * ‏וקוראים שרצים גם בבקשה וגם ברקע צריכים תשובה ולא חריגה, ולכן
 * ‏`maybeCurrent` ולא `current`.
 *
 * ‏הכתיבה היחידה שנשענת על זה היום היא `sent_by_user_id` בטוקן
 * ‏התשובה, ושם ההבחנה היא בדיוק ההבדל בין „ההודעה יצאה מסוכן” ל-
 * ‏„ההודעה יצאה מהמערכת”.
 */
export function actingUserId(): string | null {
  const ctx = TenantContext.maybeCurrent();
  return ctx === undefined || ctx.userId === "" ? null : ctx.userId;
}

