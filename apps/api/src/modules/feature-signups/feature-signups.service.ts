import { Injectable } from "@nestjs/common";
import { ulid } from "ulid";
import { TenantContext } from "../../common/tenant-context";
import { PrismaService } from "../../core/prisma.service";

/**
 * „עדכנו אותי כשזה עולה” — רישום עניין בפיצ'ר שטרם הושק.
 *
 * ## למה טבלה ולא כפתור שרק אומר תודה
 *
 * מסך „בקרוב” עם כפתור הרשמה שאינו רושם דבר הוא בדיוק אותה תקלה
 * שחוזרת כאן: המסך מצהיר הצהרה שאינה נכונה. מי שלחץ מאמין שיקבל
 * הודעה, וביום ההשקה אין למי לשלוח. הרישום נשמר, ולכן ההבטחה
 * ניתנת לקיום.
 *
 * ## למה גנרי ולא `forum_signups`
 *
 * זה הפיצ'ר השלישי שמוצג כ„בקרוב” (Kanko, המנטור, הפורום), ולכל
 * אחד מהם תגיע אותה בקשה. טבלה לפיצ'ר הייתה שלוש טבלאות זהות
 * ושלושה נתיבים זהים. השם נבדק מול רשימה סגורה כדי שהטבלה לא
 * תהפוך למזבלה של מחרוזות חופשיות.
 */

/** הפיצ'רים שאפשר להירשם אליהם. רשימה סגורה — ראו למעלה. */
export const SIGNUP_FEATURES = ["forum"] as const;
export type SignupFeature = (typeof SIGNUP_FEATURES)[number];

@Injectable()
export class FeatureSignupsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * רישום — **אידמפוטנטי**. לחיצה שנייה אינה כפילות ואינה שגיאה:
   * מי שלוחץ שוב רק מוודא שהוא רשום, וזו תשובה ולא תקלה.
   */
  async signUp(feature: SignupFeature): Promise<{ signed: true }> {
    const { tenantId, userId } = TenantContext.current();
    await this.prisma.withTenant((tx) =>
      tx.featureSignup.upsert({
        where: { tenantId_userId_feature: { tenantId, userId, feature } },
        create: { id: ulid(), tenantId, userId, feature },
        update: {},
      }),
    );
    return { signed: true };
  }

  /** האם המשתמש הזה כבר רשום — כדי שהמסך לא יציע להירשם פעמיים. */
  async status(feature: SignupFeature): Promise<{ signed: boolean }> {
    const { tenantId, userId } = TenantContext.current();
    const row = await this.prisma.withTenant((tx) =>
      tx.featureSignup.findUnique({
        where: { tenantId_userId_feature: { tenantId, userId, feature } },
        select: { id: true },
      }),
    );
    return { signed: row !== null };
  }
}
