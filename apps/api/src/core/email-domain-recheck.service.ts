import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { emailDomainStatus } from "@metavchim/shared";
import {
  DomainNotFoundAtProviderError,
  EmailDomainProviderService,
  type ProviderDomain,
} from "./email-domain-provider.service";
import { PrismaService } from "./prisma.service";

/**
 * כל שש שעות. רשומת DNS שנמחקה אצל רשם הדומיינים אינה מודיעה לאף
 * אחד — הסבב הוא מה שתוחם את חלון "שולחים עם DKIM שבור" לשעות
 * ולא לנצח. תדירות גבוהה יותר הייתה קונה מעט: שינויי DNS עצמם
 * מתפשטים בקצב של שעות.
 */
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** דקה וחצי אחרי העלייה — אחרי המיגרציות וההגדרות, כמו שאר הסורקים. */
const FIRST_SWEEP_DELAY_MS = 90 * 1000;

/** תוצאת בדיקה אחת — מה שהמסך והביקורת צריכים לדעת. */
export interface RecheckResult {
  row: {
    id: string;
    domain: string;
    providerDomainId: string;
    dkimHost: string;
    dkimValue: string;
    returnPathHost: string;
    returnPathValue: string;
    dkimVerified: boolean;
    returnPathVerified: boolean;
    verifiedAt: Date | null;
    fromEmail: string;
    fromName: string;
    lastCheckedAt: Date | null;
  };
  wasVerified: boolean;
  nowVerified: boolean;
}

/**
 * בדיקה חוזרת של אימות הדומיינים שהמשרדים חיברו.
 *
 * ## למה סורק, ולא רק כפתור במסך
 *
 * דגלי האימות נכתבים פעם אחת ונשארים. משרד שמחק את רשומת ה-DKIM
 * אצל רשם הדומיינים — בטעות, בהחלפת ספק DNS — ממשיך להישלח
 * מהכתובת שלו עם חתימה שבורה, והמסך ממשיך להציג "מאומת", עד
 * שמישהו ילחץ ידנית "בדקו אימות". איש אינו לוחץ על כפתור כדי לגלות
 * תקלה שאינו יודע עליה (ביקורת Codex). הסורק שואל את הספק מחדש,
 * מעדכן את הדגלים, ומרגע שהדומיין מסומן שבור השליחה חוזרת מעצמה
 * לכתובת הפלטפורמה — הנפילה הרכה שכבר קיימת ב-`EmailService`.
 *
 * ## למה ב-API ולא ב-Workers
 *
 * אותו נימוק כמו תפוגת הקרדיטים שמעליו: טוקן ה-Account מוצפן
 * ב-`platform_settings` ונקרא דרך `PlatformSettingsService`, ופתיחת
 * מסלול פענוח שני בתהליך אחר יקרה מהרווח. הסבב זול — קריאת ספק
 * אחת לכל דומיין מחובר, פעם בשש שעות.
 *
 * `recheckTenant` משמש גם את כפתור "בדקו אימות" במסך — מימוש אחד
 * לשני הקוראים, כדי ששניהם יכתבו את אותם דגלים באותם כללים.
 */
@Injectable()
export class EmailDomainRecheckService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailDomainRecheckService.name);
  private timer: NodeJS.Timeout | null = null;
  private kickoff: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: EmailDomainProviderService,
  ) {}

  onModuleInit(): void {
    this.kickoff = setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), SWEEP_INTERVAL_MS);
    }, FIRST_SWEEP_DELAY_MS);
    // אחרת התהליך לא יוצא בבדיקות ובסקריפטים קצרים
    this.kickoff.unref?.();
  }

  onModuleDestroy(): void {
    if (this.kickoff) clearTimeout(this.kickoff);
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.sweep();
    } catch (error: unknown) {
      this.logger.error(`בדיקת דומיינים חוזרת נכשלה: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }

  /** סבב אחד. ציבורי כדי שבדיקה תוכל להריץ אותו בלי לחכות שש שעות. */
  async sweep(): Promise<{ checked: number; broke: number }> {
    // בלי טוקן Account אין את מי לשאול — ואין גם דומיינים מחוברים
    if (!(await this.provider.isConfigured())) return { checked: 0, broke: 0 };

    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
    let checked = 0;
    let broke = 0;
    for (const tenant of tenants) {
      try {
        const result = await this.recheckTenant(tenant.id);
        if (result === null) continue;
        checked += 1;
        if (result.wasVerified && !result.nowVerified) broke += 1;
      } catch (error: unknown) {
        // משרד אחד שנכשל אינו עוצר את השאר — זו סריקה, לא עסקה.
        // דומיין שנעלם אצל הספק כבר סומן שבור לפני שהחריגה נזרקה.
        this.logger.warn(
          `בדיקת דומיין נכשלה למשרד ${tenant.id}: ${String(error)}`,
        );
      }
    }
    if (checked > 0) {
      this.logger.log(`בדיקת דומיינים: ${checked} נבדקו, ${broke} נשברו`);
    }
    return { checked, broke };
  }

  /**
   * בדיקה של משרד אחד מול הספק ועדכון הדגלים. `null` = אין דומיין.
   *
   * ‏`withExplicitTenant` — הסורק רץ בלי הקשר בקשה, והמזהה מגיע
   * מרשימת המשרדים, לא מקלט.
   *
   * דומיין שנעלם אצל הספק (נמחק שם ידנית) מסומן שבור — השליחה
   * חוזרת לכתובת הפלטפורמה — והחריגה ממשיכה לקורא: במסך היא הודעה
   * למנהל, בסורק היא שורת יומן.
   */
  async recheckTenant(tenantId: string): Promise<RecheckResult | null> {
    const row = await this.prisma.withExplicitTenant(tenantId, (tx) =>
      tx.emailDomain.findUnique({ where: { tenantId } }),
    );
    if (row === null) return null;
    const wasVerified = emailDomainStatus(row) === "verified";

    let providerState: ProviderDomain;
    try {
      providerState = await this.provider.verifyDomain(row.providerDomainId);
    } catch (error) {
      if (error instanceof DomainNotFoundAtProviderError) {
        await this.prisma.withExplicitTenant(tenantId, (tx) =>
          tx.emailDomain.update({
            where: { tenantId },
            data: {
              dkimVerified: false,
              returnPathVerified: false,
              lastCheckedAt: new Date(),
            },
          }),
        );
        if (wasVerified) {
          this.logger.error(
            `הדומיין ${row.domain} נעלם אצל ספק האימייל — השליחה חזרה לכתובת הפלטפורמה`,
          );
        }
      }
      throw error;
    }

    const nowVerified = emailDomainStatus(providerState) === "verified";
    const updated = await this.prisma.withExplicitTenant(tenantId, (tx) =>
      tx.emailDomain.update({
        where: { tenantId },
        data: {
          /*
           * אחרי אימות DKIM הספק מאפס את שדות ה-Pending בלי למלא
           * מיד את הקבועים בכל תשובה — ערך ריק ממנו אינו סיבה
           * למחוק את מה שהמנהל עוד צריך להעתיק.
           */
          dkimHost: providerState.dkimHost === "" ? row.dkimHost : providerState.dkimHost,
          dkimValue: providerState.dkimValue === "" ? row.dkimValue : providerState.dkimValue,
          returnPathHost:
            providerState.returnPathHost === "" ? row.returnPathHost : providerState.returnPathHost,
          returnPathValue:
            providerState.returnPathValue === ""
              ? row.returnPathValue
              : providerState.returnPathValue,
          dkimVerified: providerState.dkimVerified,
          returnPathVerified: providerState.returnPathVerified,
          lastCheckedAt: new Date(),
          // נקבע פעם אחת, במעבר הראשון לאימות מלא — לתצוגה ולתמיכה
          ...(nowVerified && row.verifiedAt === null ? { verifiedAt: new Date() } : {}),
        },
      }),
    );
    if (wasVerified && !nowVerified) {
      this.logger.error(
        `הדומיין ${row.domain} איבד אימות (DKIM: ${providerState.dkimVerified ? "תקין" : "שבור"}, Return-Path: ${providerState.returnPathVerified ? "תקין" : "שבור"}) — השליחה חזרה לכתובת הפלטפורמה`,
      );
    }
    return { row: updated, wasVerified, nowVerified };
  }
}
