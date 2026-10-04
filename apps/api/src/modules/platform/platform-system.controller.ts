import { WEBHOOK_HIT_OUTCOMES } from "../webhook-log/webhook-log.service";
import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Query,
  ServiceUnavailableException,
  UseGuards,
  Logger,
} from "@nestjs/common";
import { z } from "zod";
import { IdSchema, type ServiceVersion } from "@metavchim/shared";
import { loadEnv } from "../../config/env";
import { PlatformAdmin } from "../../common/auth.decorators";
import { PlatformAdminGuard } from "../../common/platform-admin.guard";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { PrismaService } from "../../core/prisma.service";
import {
  BackupsService,
  type BackupsOverview,
  type BackupRunStatus,
  type RestoreStatus,
} from "./backups.service";
import {
  callUpdaterAgent,
  updaterFailure,
  updaterFailureMessage,
  type UpdateRunStatus,
} from "./updater-agent";
import { type DiskStatus, DiskSpaceService } from "./disk-space.service";
import { ServiceVersionsService } from "./service-versions.service";
import { WebhookLogService } from "../webhook-log/webhook-log.service";

/**
 * ניהול הפלטפורמה — הקמת משרדי תיווך חדשים מהממשק, בלי SSH.
 * גישה רק למי שמופיע ב-PLATFORM_ADMIN_EMAILS (בעל הפלטפורמה), בנוסף
 * להתחברות רגילה. כשהרשימה ריקה — המסך כבוי לגמרי.
 */

/**
 * קוד מסלול — מחרוזת ולא enum.
 *
 * המסלולים הפכו לנתונים שבעל הפלטפורמה עורך, ולכן enum בקוד היה
 * חוסם בדיוק את מה שהמסך נועד לאפשר: מסלול חדש. התקינות נבדקת מול
 * הקטלוג בפועל, שם היא גם רלוונטית.
 */
/**
 * ‎**סינון יומן הוובהוקים — שדה חסר פירושו „בלי הגבלה”.**
 *
 * ‏קריאה בלי פרמטרים מתנהגת בדיוק כמו קודם (חמישים האחרונות מכל
 * ‏המשרדים), ולכן אין כאן שינוי התנהגות למי שלא ביקש דבר.
 */
/* ‏מיוצא כדי שהשער יוכל לטעון שהוא מקבל כל תוצאה שהיומן רושם. */
export const TelephonyWebhookQuerySchema = z
  .object({
    /**
     * ‎**מרכזייה או טופס לידים.**
     *
     * ‏שתי שאלות נפרדות באותו יומן, ורשימה מעורבת אינה עונה על אף
     * ‏אחת מהן: „נקלטה” על שיחה ו„נקלטה” על ליד הן עובדות שונות.
     * ‏חסר = שתיהן, כמו שהיה לפני שהמקור השני נכנס.
     */
    source: z.enum(["telephony", "lead"]).optional(),
    /*
     * ‎**הרשימה הסגורה — נגזרת מהשירות ולא משוכפלת כאן.**
     *
     * ‏כתיב חופשי לא היה מסנן דבר, אבל רשימה שנכתבת פעם שנייה
     * ‏מתיישנת: תוצאה שנוספה בשירות ולא כאן נדחית ב-400, והמסך
     * ‏נשבר בדיוק כשמנהל מנסה לראות את השורות החדשות.
     */
    outcome: z.enum(WEBHOOK_HIT_OUTCOMES).optional(),
    tenantId: IdSchema.optional(),
    callId: z.string().max(120).optional(),
    /**
     * ‎**מספר המתקשר — החיפוש שאין לו תחליף.**
     *
     * ‏מי שבודק „לקוח התקשר ואין רישום” יודע מספר טלפון, לא מזהה
     * ‏שיחה. הערך מנורמל ונחתם בשירות היומן מול אותה חתימה
     * ‏שנשמרה, ולכן הכתיב שהוקלד אינו משנה — והמספר עצמו אינו
     * ‏קיים בטבלה בשום צורה.
     */
    phone: z.string().min(3).max(32).optional(),
    /** ‏„מה היה בשעה האחרונה” / „ביממה” — במקום לגלול לפי תאריך. */
    hours: z.coerce.number().int().min(1).max(24 * 90).optional(),
    /*
     * ‏מאתיים ולא חמישים: מרכזייה שולחת שלושה אירועים לשיחה, ולכן
     * ‏חמישים שורות הן פחות מעשרים שיחות — פחות משעה על משרד פעיל.
     */
    limit: z.coerce.number().int().min(1).max(500).default(200),
  })
  .strict();

/**
 * ‎ריקון היומן — כמה אחורה למחוק.
 *
 * ‎`0` = הכול, וזו דווקא הדרישה השכיחה: לרוקן, לחייג שיחת בדיקה,
 * ‏ולראות שורה אחת במקום לחפש אותה בתוך רעש. האישור על מחיקה
 * ‏מלאה יושב במסך, ולכן כאן זה ערך ככל ערך.
 *
 * ‏החסם העליון הוא חלון השמירה עצמו: „מחק ישן משנה” על יומן
 * ‏שנשמר תשעים יום אינו מוחק דבר, וכפתור שאינו עושה כלום גרוע
 * ‏משגיאה.
 */
const PurgeWebhookLogSchema = z
  .object({ olderThanHours: z.coerce.number().int().min(0).max(24 * 90) })
  .strict();

/** שם קובץ גיבוי — הוולידציה המחייבת היא ב-BackupsService (רשימת היתר). */
const BackupNameSchema = z.object({ name: z.string().min(1).max(120) }).strict();

/**
 * ‏המכונה עצמה — גרסאות ודיסק, עדכון גרסה וסוכן העדכון, גיבויים ושחזור,
 * ‏ויומן הוובהוק של המרכזיות.
 *
 * ‏אחד מארבעה בקרים תחת `/platform`, כולם מאחורי `PlatformAdminGuard` —
 * ‏פוצלו מבקר אחד של 3,600 שורות לפי תחום, בלי שינוי בנתיבים או בשערים.
 */
@Controller("platform")
@UseGuards(PlatformAdminGuard)
@PlatformAdmin()
export class PlatformSystemController {
  private readonly logger = new Logger(PlatformSystemController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly backups: BackupsService,
    private readonly serviceVersions: ServiceVersionsService,
    private readonly disk: DiskSpaceService,
    private readonly telephonyWebhookLog: WebhookLogService,
  ) {}

  /**
   * יומן הפניות לנתיב הוובהוק של המרכזיות — **כולל אלה שנדחו**.
   *
   * בפלטפורמה ולא בהגדרות המשרד, כי הפנייה המעניינת ביותר היא זו
   * שלא הצלחנו לשייך לאף משרד: מפתח שאינו מוכר. מסך המשרד יכול
   * להראות רק את מה שכבר זוהה כשלו, וזו בדיוק ההצגה שהחמיצה את
   * התקלה — "לא התקבל אף אירוע" נראה זהה בין מרכזייה שלא פנתה
   * לבין מרכזייה שפנתה ונדחתה.
   *
   * המפתח מוחזר בקידומת בת שישה תווים בלבד; ראו `webhook-log.service`.
   */
  /* ‏ראו את ההערה על `telephonyWebhooks` — שדה חסר פירושו „בלי הגבלה” */
  @Get("telephony-webhooks")
  async telephonyWebhooks(
    /**
     * ‎**סינון — מה שהופך רשימה למשהו שאפשר לחקור בו.**
     *
     * ‏בלי הפרמטרים האלה כל שאלה נענתה בגלילה ידנית של רשימה
     * ‏מעורבת מכל המשרדים. שדה שלא נשלח = בלי הגבלה, ולכן קריאה
     * ‏בלי פרמטרים מתנהגת בדיוק כמו קודם.
     */
    @Query(new ZodValidationPipe(TelephonyWebhookQuerySchema))
    query: z.infer<typeof TelephonyWebhookQuerySchema>,
  ): Promise<{
    hits: {
      id: string;
      receivedAt: Date;
      outcome: string;
      /** למה הפנייה לא הפכה לשיחה — `null` כשהיא כן. */
      issue: string | null;
      tenantId: string | null;
      tenantName: string | null;
      keyPrefix: string;
      method: string;
      fieldKeys: string | null;
      /** מה שהספק שלח ואיננו צורכים — ראו `unmappedFields`. */
      unmapped: string | null;
      /** ‏מזהה השיחה אצל הספק — מה שמחבר שורה לשיחה, ושורות זו לזו. */
      callId: string | null;
      /** ‏סוג האירוע — `ringing | answered | hangup`. */
      action: string | null;
      direction: string | null;
      /**
       * ‎ארבע הספרות האחרונות של המתקשר — ולא המספר.
       *
       * ‏די כדי לראות ברשימה לא מסוננת ששתי שורות הן אותו מתקשר;
       * ‏החיפוש המלא נעשה מול חתימה שאינה יוצאת מהשרת.
       */
      peerSuffix: string | null;
      /** ‏מרכזייה או טופס לידים — `telephony` | `lead`. */
      source: string;
    }[];
    /**
     * ‎**מה קרה ב-24 השעות האחרונות, לפני שמסתכלים בשורות.**
     *
     * ‏אלף שורות אינן אומרות אם המצב תקין. שורת סיכום עונה על
     * ‏השאלה הראשונה — האם יש פניות בכלל, וכמה מהן הפכו לשיחות.
     */
    summary: { source: string; outcome: string; count: number }[];
    /**
     * ‎**כל המשרדים שיש להם שורות ביומן — לרשימת הסינון.**
     *
     * ‏נגזר מכל מה ששמור ולא מהשורות שחזרו: משרד ששיחותיו ישנות
     * ‏מהעמוד המוצג לא היה מופיע ברשימה, ולא הייתה דרך אחרת
     * ‏לבחור אותו — כלומר החיפוש היה חסום דווקא על החיבורים
     * ‏השקטים.
     */
    offices: { id: string; name: string }[];
  }> {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [hits, summary, officeIds] = await Promise.all([
      this.telephonyWebhookLog.recent(query.limit, {
        ...(query.source === undefined ? {} : { source: query.source }),
        ...(query.outcome === undefined ? {} : { outcome: query.outcome }),
        ...(query.tenantId === undefined ? {} : { tenantId: query.tenantId }),
        ...(query.callId === undefined ? {} : { callId: query.callId }),
        ...(query.phone === undefined ? {} : { peerPhone: query.phone }),
        ...(query.hours === undefined
          ? {}
          : { since: new Date(Date.now() - query.hours * 60 * 60 * 1000) }),
      }),
      this.telephonyWebhookLog.summary(since24h),
      this.telephonyWebhookLog.offices(),
    ]);
    /*
     * שם המשרד ולא רק המזהה: בעל הפלטפורמה מסתכל על היומן כדי לענות
     * למישהו ששאל למה השיחות לא מגיעות, ומזהה ULID אינו תשובה.
     * שאילתה אחת לכל המשרדים ולא אחת לשורה.
     */
    const tenantIds = [
      ...new Set([...hits.map((h) => h.tenantId).filter((id) => id !== null), ...officeIds]),
    ];
    const tenants =
      tenantIds.length > 0
        ? await this.prisma.tenant.findMany({
            where: { id: { in: tenantIds } },
            select: { id: true, name: true },
          })
        : [];
    const nameById = new Map(tenants.map((t) => [t.id, t.name]));
    return {
      hits: hits.map((hit) => ({
        ...hit,
        tenantName: hit.tenantId === null ? null : (nameById.get(hit.tenantId) ?? null),
      })),
      summary,
      /*
       * משרד שנמחק משאיר שורות ביומן בלי שם — הן מסוננות מהרשימה
       * ולא מוצגות כמזהה ערום, שאינו בחירה שאפשר לעשות בה משהו.
       */
      offices: officeIds
        .flatMap((id) => {
          const name = nameById.get(id);
          return name === undefined ? [] : [{ id, name }];
        })
        .sort((a, b) => a.name.localeCompare(b.name, "he")),
    };
  }

  /**
   * ‎**ריקון היומן.**
   *
   * ‏הגיזום האוטומטי שומר על החסם ואינו עונה על מה שצריך מי
   * ‏שיושב מול המסך: „נקה לפני שאני עושה שיחת בדיקה”, ו„הישן כבר
   * ‏לא רלוונטי”. בלי הכפתור שניהם דרשו גישה ישירה למסד.
   *
   * ‏נרשם ביומן הביקורת של הפלטפורמה: מחיקת ראיות אבחון היא בדיוק
   * ‏הפעולה שצריכה להשאיר עקבה משלה.
   */
  @Delete("telephony-webhooks")
  @HttpCode(200)
  async purgeTelephonyWebhooks(
    @Body(new ZodValidationPipe(PurgeWebhookLogSchema))
    body: z.infer<typeof PurgeWebhookLogSchema>,
  ): Promise<{ deleted: number }> {
    const deleted = await this.telephonyWebhookLog.purge(
      body.olderThanHours * 60 * 60 * 1000,
    );
    this.logger.log(
      `יומן וובהוקים רוקן בידי ${TenantContext.current().userId}: ${deleted} שורות, ישן מ-${body.olderThanHours} שעות`,
    );
    return { deleted };
  }

  /**
   * גרסה מותקנת + זמינות סוכן העדכון — למסך הפלטפורמה.
   *
   * `services` הוא התיקון למה שקרה בפועל: המסך הציג `version` יחיד,
   * של ה-API, בזמן ששלושה קונטיינרים רצים. עדכון שהצליח בשניים
   * מתוכם נראה כמו הצלחה מלאה — "גרסה מותקנת bfd8d0a" מול משתמש
   * שלא רואה שום שינוי. `version` נשאר כפי שהיה, לתאימות.
   *
   * ה-web חסר כאן במתכוון: את הגרסה שלו שואל הדפדפן ישירות
   * מהקונטיינר ששירת אותו (`/version`), וזו המדידה הכנה מבין השתיים.
   */
  @Get("system")
  async systemInfo(): Promise<{
    version: string;
    updateAvailable: boolean;
    services: ServiceVersion[];
    /**
     * מצב הדיסק של השרת. מוצג תמיד ולא רק כשהוא נמוך: „כמה נשאר”
     * הוא מה שמפעיל הפלטפורמה בא לבדוק, ומספר שמופיע רק כשכבר
     * מאוחר אינו ניטור.
     */
    disk: DiskStatus;
  }> {
    const env = loadEnv();
    const [services, disk] = await Promise.all([
      this.serviceVersions.collect(),
      this.disk.status(),
    ]);
    return {
      version: env.APP_VERSION,
      updateAvailable: env.UPDATER_URL !== undefined && env.UPDATE_SECRET !== undefined,
      services,
      disk,
    };
  }

  /**
   * עדכון גרסה בלחיצת כפתור — **בעל הפלטפורמה בלבד**. הקריאה מגיעה
   * לסוכן העדכון שרץ לצד המערכת (infra/updater), שמושך תמונות עדכניות
   * ומרים אותן מחדש. ההפעלה מחדש היא של כל השרת, כלומר של כל המשרדים
   * יחד — ולכן זו לא פעולה של מנהל משרד.
   */
  @Post("system/update")
  @HttpCode(200)
  async triggerUpdate(): Promise<{ status: "started" }> {
    const env = loadEnv();
    if (env.UPDATER_URL === undefined || env.UPDATE_SECRET === undefined) {
      throw new ServiceUnavailableException("עדכון מרחוק אינו מוגדר בסביבה זו");
    }
    const res = await callUpdaterAgent("/update", { method: "POST" });
    if (res.status === 409) throw new ConflictException("עדכון כבר רץ — המתינו לסיומו");
    if (!res.ok) throw updaterFailure(res);
    return { status: "started" };
  }

  /**
   * ‎**מה עלה בגורל העדכון.**
   *
   * ‏עד כה `POST system/update` החזיר „הופעל” וזה היה כל מה שהמסך
   * ‏ידע אי פעם. עדכון שנכשל — משיכה שנדחתה, שירות שלא עלה — נראה
   * ‏בדיוק כמו עדכון שהצליח, והסיבה נשארה בלוג של קונטיינר הסוכן.
   *
   * ‏הסוכן שורד את ההפעלה מחדש (הוא קונטיינר נפרד), ולכן הוא זה
   * ‏שמחזיק את התשובה: ה-API עצמו נהרג באמצע ואינו יכול לזכור דבר.
   * ‏אותו מבנה בדיוק כמו `backups/restore/status`.
   */
  @Get("system/update/status")
  async updateStatus(): Promise<UpdateRunStatus> {
    const res = await callUpdaterAgent("/update/status", { method: "GET" });
    /*
     * ‎**404 מהסוכן אינו כישלון של השאילתה — הוא התשובה עליה.**
     *
     * ‏העדכון אינו מרים את הסוכן (הוא מריץ את `compose` מתוך עצמו),
     * ‏ולכן מיד אחרי שהשינוי הזה נפרס הסוכן שבשרת עדיין ישן ואינו
     * ‏מכיר את הנתיב. חריגה כאן הייתה נבלעת ב-`catch` של המסך, והוא
     * ‏היה נשאר בספינר לנצח — כלומר בדיוק השתיקה שהשינוי הזה בא
     * ‏לתקן, רק בניסוח חדש (ביקורת Codex).
     *
     * ‏לכן זו תוצאה מדווחת: „לא הצלחתי לדעת, והנה הפקודה שתתקן”.
     * ‏שאר הכשלים נשארים חריגות — שם כישלון הוא באמת כישלון.
     */
    if (res.status === 404) {
      return {
        running: false,
        startedAt: null,
        finishedAt: null,
        ok: false,
        message: updaterFailureMessage(res.status),
        stage: null,
      };
    }
    if (!res.ok) throw updaterFailure(res);
    return (await res.json()) as UpdateRunStatus;
  }

  /**
   * עדכון סוכן העדכון עצמו.
   *
   * נפרד מ-`system/update` בכוונה ולא חלק ממנו: הסוכן מחליף את עצמו,
   * וכל כישלון שם היה מפיל עדכון מערכת תקין. הפרדה גם אומרת שאפשר
   * לעדכן את המערכת עשר פעמים בלי לגעת בסוכן, ולגעת בו כשצריך.
   *
   * עד כה זו הייתה פקודה שמדביקים ב-SSH.
   */
  @Post("system/update-agent")
  @HttpCode(200)
  async updateAgent(): Promise<{ status: "started" }> {
    const res = await callUpdaterAgent("/update/self", { method: "POST" });
    if (res.status === 409) throw new ConflictException("פעולה כבר רצה — המתינו לסיומה");
    if (!res.ok) throw updaterFailure(res);
    return { status: "started" };
  }

  /** מצב הגיבויים: רשימה מקומית, חיווי טריות ומצב העותק מחוץ לשרת. */
  @Get("backups")
  async backupsOverview(): Promise<BackupsOverview> {
    return this.backups.overview();
  }

  /**
   * מחיקת גיבוי. השירות חוסם מחיקה של הדאמפ האחרון של המסד — ואם
   * הסנכרון החיצוני פעיל, העותק המרוחק עובר לארכיון ולא נמחק.
   */
  @Post("backups/delete")
  @HttpCode(200)
  async deleteBackup(
    @Body(new ZodValidationPipe(BackupNameSchema)) body: z.infer<typeof BackupNameSchema>,
  ): Promise<{ ok: true }> {
    await this.backups.remove(body.name);
    return { ok: true };
  }

  /**
   * שחזור מגיבוי — **בעל הפלטפורמה בלבד**, והפעולה ההרסנית ביותר
   * במערכת: היא מחליפה את הנתונים של כל המשרדים יחד ומפילה את
   * השירות לכמה דקות. סוכן העדכון לוקח דאמפ בטיחות לפני שהוא מתחיל.
   */
  @Post("backups/restore")
  @HttpCode(202)
  async restoreBackup(
    @Body(new ZodValidationPipe(BackupNameSchema)) body: z.infer<typeof BackupNameSchema>,
  ): Promise<{ status: "started" }> {
    await this.backups.startRestore(body.name);
    return { status: "started" };
  }

  @Get("backups/restore/status")
  async restoreStatus(): Promise<RestoreStatus> {
    return this.backups.restoreStatus();
  }

  /**
   * גיבוי ידני — "גבה עכשיו". לפני עדכון גרסה, לפני שינוי גדול, או
   * פשוט כדי לא לחכות לגיבוי היומי הבא. הקובץ שנוצר זהה לחלוטין
   * לגיבוי האוטומטי ומופיע באותה רשימה.
   */
  @Post("backups/run")
  @HttpCode(202)
  async runBackup(): Promise<{ status: "started" }> {
    await this.backups.startBackup();
    return { status: "started" };
  }

  /*
   * תרגיל שחזור לפי דרישה. אותו סקריפט שרץ שבועית — הראיה הידנית
   * והמתוזמנת חייבות להיות אותה בדיקה, אחרת "בדקנו" לא אומר כלום.
   */
  @Post("backups/verify")
  @HttpCode(202)
  async runVerify(): Promise<{ started: true }> {
    await this.backups.startVerify();
    return { started: true };
  }

  @Get("backups/run/status")
  async backupRunStatus(): Promise<BackupRunStatus> {
    return this.backups.backupStatus();
  }
}
