import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { statfs } from "node:fs/promises";
import { ulid } from "ulid";
import { loadEnv } from "../../config/env";
import { EmailService } from "../../core/email.service";
import { PrismaService } from "../../core/prisma.service";
import { WhatsAppSendService } from "../messaging/whatsapp-send.service";

/**
 * ‎**ניטור מקום בדיסק, והתראה לפני שנגמר.**
 *
 * ## למה זה קיים
 *
 * דיסק שמתמלא אינו נופל ברעש: Postgres מפסיק לכתוב, הגיבוי מדלג על
 * ארכיון המדיה **בשקט** (יש לו סף `BACKUP_MIN_FREE_MB` משלו), והמערכת
 * נראית „איטית” עד שמישהו נכנס ב-SSH ומריץ `df`. בפעם הראשונה שזה
 * קרה, כ-9GB של תמונות Docker יתומות הצטברו מפריסות יומיות והסיבה
 * התבררה רק אחרי ניחוש נכון מה למדוד.
 *
 * ## מה נמדד — ולמה דווקא הנתיב הזה
 *
 * ‏`statfs` על נתיב שמחובר בהצמדה למארח (`/backups`) מחזיר את מצב
 * הדיסק של **השרת**. מדידה על נתיב פנימי של הקונטיינר הייתה מחזירה
 * את שכבת ה-overlay — מספר שנראה תקין בזמן שהמארח מלא.
 *
 * ## למה ההתראה אינה עוברת דרך מנגנון הדחיפה של הדיירים
 *
 * סריקת הדחיפה לוואטסאפ מותנית בפיצ'ר `voice_intake` **פר-דייר**.
 * דיסק מלא הוא תקלת תשתית ולא פיצ'ר של משרד, ולכן ההודעה נשלחת
 * ישירות: התראה קריטית שנחסמת בגלל מסלול של דייר היא בדיוק סוג
 * הכשל שהיא נועדה למנוע.
 */

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
/**
 * שקט בין התראות חוזרות. בלעדיו כל בדיקה הייתה שולחת מייל ווואטסאפ —
 * 96 ביום — וזה נגמר בהשתקת הערוץ ולא בפינוי דיסק.
 */
const REALERT_MS = 12 * 60 * 60 * 1000;
const GB = 1024 ** 3;

export interface DiskStatus {
  /** null = הניטור כבוי או שהנתיב אינו נגיש */
  freeBytes: number | null;
  totalBytes: number | null;
  thresholdBytes: number;
  low: boolean;
}

@Injectable()
export class DiskSpaceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DiskSpaceService.name);
  private timer: NodeJS.Timeout | null = null;
  /**
   * מתי נשלחה ההתראה האחרונה. בזיכרון ולא במסד: זהו מצב תפעולי ולא
   * נתון, והמחיר של אובדנו בהפעלה מחדש הוא התראה אחת נוספת — עדיף
   * על מפתח הגדרות שאינו אמור להופיע בשום מסך.
   */
  private lastAlertAt: number | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly whatsapp: WhatsAppSendService,
  ) {}

  onModuleInit(): void {
    if (loadEnv().DISK_MIN_FREE_GB === 0) {
      this.logger.log("ניטור דיסק כבוי (DISK_MIN_FREE_GB=0)");
      return;
    }
    /* ‏unref כדי שהטיימר לא יחזיק את התהליך בחיים בכיבוי מסודר */
    this.timer = setInterval(() => void this.tick(), CHECK_INTERVAL_MS);
    this.timer.unref();
    /* בדיקה מיידית: דיסק שכבר מלא בעלייה אינו צריך לחכות רבע שעה */
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** מצב הדיסק — למסך הפלטפורמה. לעולם אינו זורק. */
  async status(): Promise<DiskStatus> {
    const env = loadEnv();
    const thresholdBytes = env.DISK_MIN_FREE_GB * GB;
    if (env.DISK_MIN_FREE_GB === 0) {
      return { freeBytes: null, totalBytes: null, thresholdBytes, low: false };
    }
    try {
      const fs = await statfs(env.DISK_MONITOR_PATH);
      const freeBytes = fs.bavail * fs.bsize;
      const totalBytes = fs.blocks * fs.bsize;
      return { freeBytes, totalBytes, thresholdBytes, low: freeBytes < thresholdBytes };
    } catch (error) {
      /*
       * נתיב שאינו נגיש אינו „דיסק מלא”. `low: false` כדי שהמסך לא
       * יצעק על תקלת הגדרה — היא נרשמת ביומן ומטופלת אחרת.
       */
      this.logger.warn(
        `לא ניתן למדוד את ${env.DISK_MONITOR_PATH}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { freeBytes: null, totalBytes: null, thresholdBytes, low: false };
    }
  }

  private async tick(): Promise<void> {
    try {
      const status = await this.status();
      if (!status.low || status.freeBytes === null) {
        /* התאושש — ההתראה הבאה תצא מיד ולא אחרי חלון השקט */
        if (this.lastAlertAt !== null) {
          this.logger.log("מקום בדיסק חזר לתקין");
          this.lastAlertAt = null;
        }
        return;
      }
      if (this.lastAlertAt !== null && Date.now() - this.lastAlertAt < REALERT_MS) return;
      this.lastAlertAt = Date.now();
      await this.alert(status.freeBytes, status.totalBytes);
    } catch (error) {
      this.logger.error(`בדיקת דיסק נכשלה: ${String(error)}`);
    }
  }

  /**
   * שלושת הערוצים, **כל אחד עטוף בנפרד**: מייל שנכשל אינו מונע את
   * הוואטסאפ, וזו בדיוק הנקודה שבה התראה על תשתית שבורה נשלחת דרך
   * תשתית שאולי שבורה בעצמה.
   */
  private async alert(freeBytes: number, totalBytes: number | null): Promise<void> {
    const freeGb = (freeBytes / GB).toFixed(1);
    const totalGb = totalBytes === null ? "?" : (totalBytes / GB).toFixed(0);
    const title = "⚠️ מקום בדיסק אוזל";
    const body =
      `נותרו ${freeGb}GB פנויים מתוך ${totalGb}GB בשרת. ` +
      "נקו תמונות Docker יתומות (docker image prune -f) או גיבויים ישנים.";
    this.logger.error(`${title} — ${freeGb}GB פנויים`);

    const admins = await this.platformAdmins();
    if (admins.length === 0) {
      this.logger.warn("אין מנהלי פלטפורמה מוגדרים — ההתראה נרשמה ביומן בלבד");
      return;
    }

    for (const admin of admins) {
      try {
        await this.email.send(admin.email, title, {
          heading: "מקום בדיסק אוזל בשרת",
          paragraphs: [
            body,
            "כל עוד יש מקום המערכת עובדת כרגיל. כשהוא נגמר — בסיס הנתונים מפסיק לכתוב, והגיבוי מדלג על ארכיון המדיה בשקט.",
          ],
        });
      } catch (error) {
        this.logger.warn(`מייל התראת דיסק ל-${admin.email} נכשל: ${String(error)}`);
      }

      if (admin.phone) {
        try {
          await this.whatsapp.sendText(admin.phone, `${title}\n\n${body}`);
        } catch (error) {
          this.logger.warn(`וואטסאפ התראת דיסק ל-${admin.email} נכשל: ${String(error)}`);
        }
      }

      /* התראה במערכת — הפעמון. `notifications` תחת RLS, ולכן בהקשר דייר */
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.tenant_id', ${admin.tenantId}, true)`;
          await tx.notification.create({
            data: {
              id: ulid(),
              tenantId: admin.tenantId,
              userId: admin.id,
              type: "platform_disk_low",
              title,
              body: body.slice(0, 500),
            },
          });
        });
      } catch (error) {
        this.logger.warn(`התראת דיסק במערכת ל-${admin.email} נכשלה: ${String(error)}`);
      }
    }
  }

  /**
   * מנהלי הפלטפורמה — לפי `PLATFORM_ADMIN_EMAILS`, אותה רשימה
   * שהשומר של המסך משתמש בה, כדי שלא ייווצרו שתי הגדרות שנפרדות.
   */
  private async platformAdmins(): Promise<
    { id: string; email: string; tenantId: string; phone: string | null }[]
  > {
    const emails = loadEnv().PLATFORM_ADMIN_EMAILS;
    if (emails.length === 0) return [];
    return this.prisma.user.findMany({
      where: { email: { in: emails }, isActive: true },
      select: { id: true, email: true, tenantId: true, phone: true },
    });
  }
}
