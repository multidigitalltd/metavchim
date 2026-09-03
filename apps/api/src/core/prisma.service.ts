import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { TenantContext } from "../common/tenant-context";

export type TenantTx = Prisma.TransactionClient;

/**
 * שער הגישה היחיד לבסיס הנתונים.
 *
 * `withTenant` הוא הדרך המחייבת לגשת לטבלאות עסקיות: הוא פותח טרנזקציה,
 * מזריק את מזהה הדייר מ-TenantContext ל-`app.tenant_id`, ופוליסות ה-RLS
 * ב-PostgreSQL אוכפות שאף שורה של דייר אחר לא תיקרא או תיכתב — גם אם
 * הקוד העסקי שגה (docs/04 §2, ADR-003).
 *
 * גישה ישירה (this.user וכו') שמורה לשכבת האימות בלבד (users/sessions,
 * שאינן תחת RLS בכוונה).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * ‎`options` — אותן אפשרויות של `$transaction`, לקריאה שגדולה
   * באמת.
   *
   * ‏ברירת המחדל (5 שניות) נכונה לרוב המוחלט של הפעולות, ומסך
   * שחורג ממנה בדרך כלל עושה יותר מדי. יש יוצא דופן אחד אמיתי:
   * סיכום קריאה-בלבד שסופר טווחים ארוכים בשאילתה אחת אחרי השנייה
   * (המנטור). הפרמטר מפורש כדי שחריגה כזו תהיה **הצהרה במקום
   * הקריאה**, ולא העלאה גורפת של הסף לכולם. אותו דגם כמו
   * ‎`account-deletion`, שכבר מעביר `timeout` ל-`$transaction`.
   */
  async withTenant<T>(
    fn: (tx: TenantTx) => Promise<T>,
    options?: { timeout?: number; maxWait?: number },
  ): Promise<T> {
    const { tenantId } = TenantContext.current();
    return this.$transaction(async (tx) => {
      // set_config עם is_local=true — התקף פג בסוף הטרנזקציה, אין זליגה בין בקשות.
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    }, options);
  }

  /**
   * גישה תחת דייר שמזוהה במפורש, ולא מהקשר הבקשה.
   *
   * קיים בשביל מקרה אחד: פענוח ה-Session. הוא רץ *לפני*
   * `TenantContext.run`, ולכן `withTenant` לא יכול לשמש שם — הוא היה
   * זורק. שאילתה ישירה גם היא לא פתרון: הטבלאות העסקיות תחת FORCE
   * RLS, ותפקיד האפליקציה אינו עוקף אותן, כך שבלי `app.tenant_id`
   * התוצאה היא אפס שורות **בשקט** — הרשאות שנשמרו היו נעלמות בלי
   * שום שגיאה (ביקורת Codex).
   *
   * ה-tenantId חייב להגיע ממקור שרת מאומת (שורת ה-Session), לעולם
   * לא מקלט משתמש.
   */
  async withExplicitTenant<T>(tenantId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    });
  }

  /**
   * קריאת רשת שיתופי הפעולה: ביקושים אנונימיים גלויים לכל הסוכנויות
   * (docs/04 §7). פוליסת ה-RLS של shared_demands מתירה SELECT כשמוגדר
   * app.network_read — אין בטבלה PII, והקישור לקונה לא נחשף בשכבת ה-DTO.
   */
  async withNetworkRead<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.network_read', 'on', true)`;
      return fn(tx);
    });
  }

  /**
   * שולחן התמיכה — קריאה וכתיבה חוצות-דיירים על `support_tickets`
   * **בלבד**.
   *
   * פנייה לתמיכה שאי אפשר לקרוא היא פנייה חסרת טעם, ולכן זו החריגה
   * היחידה שנפתחה על טבלה שיש בה תוכן של משרדים. הגבול נשמר בשלוש
   * שכבות: הפוליסה קיימת רק על הטבלה הזו, הדגל נדלק רק כאן, וכל
   * קורא של הפונקציה הזו חסום מאחורי PlatformAdminGuard.
   *
   * אין לגזור מכאן מזהה דייר ולהמשיך איתו לטבלאות אחרות — הדרך
   * הנכונה לכך היא `withExplicitTenant`, שממשיכה להיאכף ב-RLS.
   */
  async withSupportDesk<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.support_desk', 'on', true)`;
      return fn(tx);
    });
  }

  /**
   * שולחן המשיכות — קריאה וכתיבה חוצות-דיירים על `payout_ledger`
   * ו-`payout_requests` **בלבד**.
   *
   * אותו דפוס כמו `withSupportDesk` ומאותה סיבה: בקשת משיכה שאי אפשר
   * לאשר אינה בקשה. הגבול נשמר בשלוש שכבות — הפוליסה קיימת רק על שתי
   * הטבלאות האלה, הדגל נדלק רק כאן, וכל קורא חסום מאחורי
   * PlatformAdminGuard.
   *
   * כאן יושבים פרטי חשבון בנק, ולכן ההקפדה חריפה במיוחד: אין לגזור
   * מזהה דייר מהשורות האלה ולהמשיך איתו לטבלאות אחרות.
   */
  async withPayoutDesk<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.payout_desk', 'on', true)`;
      return fn(tx);
    });
  }

  /**
   * ‎**משפטי המוטבציה של הפלטפורמה — ורק הם.**
   *
   * ‏שורה ב-`mentor_quotes` עם `tenant_id` ריק מוצגת בכל המשרדים,
   * ולכן היא אינה יכולה להיכתב מתוך הקשר דייר: פוליסת הקריאה על
   * השורות האלה היא `FOR SELECT` בלבד, בדיוק כדי שמשרד לא יוכל
   * לכתוב משפט שכל המערכת רואה.
   *
   * ‏הדגל כאן הוא הדרך היחידה לכתוב אותן, והוא מוגבל בשני הכיוונים:
   * ‏`USING` **וגם** `WITH CHECK` דורשים `tenant_id IS NULL`, ולכן
   * לשולחן הזה אין גישה לשורות של משרדים — גם לא למחיקה בטעות. זה
   * ההבדל מ-`withSupportDesk` ו-`withPayoutDesk`, שם הדגל פותח את
   * הטבלה כולה. כל קורא חסום מאחורי PlatformAdminGuard.
   */
  async withPlatformQuotes<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.platform_quotes', 'on', true)`;
      return fn(tx);
    });
  }

  /**
   * גישה ציבורית לפי טוקן הצעה (דף ההצעה ללקוח קצה): פוליסת RLS ייעודית
   * חושפת אך ורק את שורת ההצעה שהטוקן שלה הוצג — בלי הקשר דייר,
   * בלי גישה לשום טבלה אחרת.
   */
  async withPublicOffer<T>(token: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.offer_token', ${token}, true)`;
      return fn(tx);
    });
  }

  /**
   * ‎**הסרה מתזכורות ההפעלה — הטוקן שבתחתית התזכורת.**
   *
   * בלי הקשר דייר בכוונה: ההודעה נשלחת דווקא למי שהחשבון שלו ננעל,
   * ו„היכנסו למערכת כדי להסיר” אינה דרך סבירה להודיע על סירוב.
   * הפוליסה חושפת שורה אחת בטבלה שאין בה דבר מלבד הטוקן וההסרה.
   */
  async withPublicNudge<T>(token: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.nudge_token', ${token}, true)`;
      return fn(tx);
    });
  }

  /** גישת הלקוח החותם — הטוקן שבקישור הוא המפתח, בלי הקשר דייר. */
  async withPublicAgreement<T>(token: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.agreement_token', ${token}, true)`;
      return fn(tx);
    });
  }

  /**
   * גישה ציבורית לפי מפתח ה-Webhook של אינטגרציה (מרכזיית טלפון).
   *
   * הנתיב שהספק קורא לו ציבורי מעצם טבעו — מרכזייה לא מתחברת עם
   * עוגייה — ולכן אין בו הקשר דייר. אותה תבנית של דף ההצעה: הפוליסה
   * חושפת את שורת האינטגרציה של המפתח בלבד, ומשם נגזר הדייר לשאר
   * העבודה.
   */
  async withPublicIntegration<T>(key: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.integration_key', ${key}, true)`;
      return fn(tx);
    });
  }

  /**
   * גישה ציבורית לפי טוקן דף נחיתה של נכס — אותו דפוס: הפוליסה חושפת
   * את שורת הנכס של הטוקן ואת התמונות שלו בלבד.
   */
  async withPublicLanding<T>(token: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.landing_token', ${token}, true)`;
      return fn(tx);
    });
  }

  /**
   * גישה ציבורית לפי טוקן טופס הלקוח.
   *
   * **צר במתכוון: SELECT על שורה אחת בטבלה אחת.** הפוליסה חושפת את
   * שורת `intake_requests` של הטוקן בלבד, ומשם נגזר הדייר. כל השאר
   * — שם המשרד, שם הלקוח, הדרישות הקיימות והכתיבה עצמה — רץ תחת
   * `withExplicitTenant`.
   *
   * זו ההחלטה המרכזית באבטחת התכונה: החלופה, פוליסות כתיבה ציבוריות
   * על `buyers` ו-`contacts`, הייתה פותחת נתיב כתיבה לטבלאות הלקוחות
   * שתלוי בנכונות `USING` אחד. כאן טעות בפוליסה חושפת שורת בקשה,
   * ולא כרטיס לקוח.
   */
  async withPublicIntake<T>(token: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.intake_token', ${token}, true)`;
      return fn(tx);
    });
  }
}
