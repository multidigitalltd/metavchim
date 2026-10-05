import { ConsoleLogger, Injectable, Logger, type BeforeApplicationShutdown } from "@nestjs/common";
import {
  jerusalemDayStart,
  jerusalemWallParts,
  serverErrorDigest,
  serverErrorSignature,
  type ServerErrorRow,
} from "@metavchim/shared";
import { PlatformAdminNotifierService } from "./platform-admin-notifier.service";
import { PrismaService } from "./prisma.service";
import { Sweep } from "./sweeps";

/**
 * ‎**שגיאות השרת — נספרות, ונשלחות פעם ביום למנהלי הפלטפורמה.**
 *
 * ‏עד היום שגיאה בשרת נרשמה ביומן ושם נשארה: סבב שנכשל כל לילה, ספק
 * ‏שמחזיר 500, באג שמופיע רק אצל משרד אחד — איש לא ידע עד שמשרד
 * ‏התלונן. בלי שירות חיצוני:
 *
 * ‏1. ‎`ServerErrorLogger` — היומן של Nest, שכל `logger.error` עובר דרכו:
 * ‏   חריגה שלא טופלה בבקשה (ExceptionsHandler), סבב שנכשל, ספק שנפל.
 * ‏   הוא כותב ליומן כרגיל, ובנוסף סופר את השגיאה בזיכרון לפי חתימה.
 * ‏2. ‏כל דקה הספירה נכתבת ל-`server_errors` — שורה לכל סוג ביום.
 * ‏3. ‏כל בוקר מ-07:00 יוצא סיכום של אתמול, פעם אחת, ורק אם היו שגיאות.
 *
 * ‏שגיאות לקוח (4xx) אינן כאן: Nest אינו רושם אותן כשגיאה, והן אינן
 * ‏תקלה של השרת. משימות שנכשלו ב-Workers נכתבות לאותה טבלה משם.
 */

/** ‏כמה סוגים נספרים בנפרד בין שתי כתיבות. סערה של שגיאות אינה זיכרון אינסופי. */
const MAX_BUCKETS = 200;
const OVERFLOW = { source: "server-errors", signature: "שגיאות נוספות באותה דקה" };
/** ‏הסיכום יוצא מהשעה הזו בבוקר — כשהיום הקודם כבר נסגר ונכתב. */
const DIGEST_HOUR = 7;
const RETENTION_DAYS = 30;

interface Bucket extends ServerErrorRow {
  day: string;
}

/** ‏הספירה בזיכרון — של התהליך כולו, כי היומן נוצר לפני ה-DI. */
class ServerErrorBuffer {
  private buckets = new Map<string, Bucket>();

  record(source: string, message: string, at: Date = new Date()): void {
    const day = jerusalemWallParts(at).date;
    let signature = serverErrorSignature(message);
    let from = source.slice(0, 120);
    let key = `${day}\u0000${from}\u0000${signature}`;
    if (!this.buckets.has(key) && this.buckets.size >= MAX_BUCKETS) {
      ({ source: from, signature } = OVERFLOW);
      key = `${day}\u0000${from}\u0000${signature}`;
    }
    const bucket = this.buckets.get(key);
    if (bucket) {
      bucket.count += 1;
      bucket.lastAt = at;
      return;
    }
    this.buckets.set(key, { day, source: from, signature, count: 1, firstAt: at, lastAt: at });
  }

  /** ‏מה שנספר מאז הפעם הקודמת — והמונה מתאפס. */
  drain(): Bucket[] {
    const drained = [...this.buckets.values()];
    this.buckets = new Map();
    return drained;
  }

  /** ‏כתיבה שנכשלה — הספירה חוזרת ומתמזגת במה שנספר בינתיים. */
  restore(buckets: readonly Bucket[]): void {
    for (const bucket of buckets) {
      const key = `${bucket.day}\u0000${bucket.source}\u0000${bucket.signature}`;
      const current = this.buckets.get(key);
      if (current === undefined) {
        this.buckets.set(key, { ...bucket });
        continue;
      }
      current.count += bucket.count;
      if (bucket.firstAt < current.firstAt) current.firstAt = bucket.firstAt;
      if (bucket.lastAt > current.lastAt) current.lastAt = bucket.lastAt;
    }
  }
}

export const serverErrors = new ServerErrorBuffer();

function textOf(message: unknown): string {
  if (message instanceof Error) return message.message;
  if (typeof message === "string") return message;
  try {
    return JSON.stringify(message) ?? String(message);
  } catch {
    return String(message);
  }
}

/**
 * ‏היומן של האפליקציה (`main.ts`). כותב בדיוק כמו קודם, ובנוסף סופר.
 *
 * ‏ההקשר הוא הפרמטר האחרון כשהוא מחרוזת — כך `Logger` של Nest מעביר
 * ‏אותו (`new Logger("X").error(msg)` מגיע כ-`error(msg, undefined, "X")`).
 */
export class ServerErrorLogger extends ConsoleLogger {
  override error(message: unknown, ...optionalParams: unknown[]): void {
    super.error(message, ...(optionalParams as [string?, string?]));
    const last = optionalParams.at(-1);
    serverErrors.record(typeof last === "string" ? last : (this.context ?? "app"), textOf(message));
  }
}

@Injectable()
export class ServerErrorDigestService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(ServerErrorDigestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: PlatformAdminNotifierService,
  ) {}

  /**
   * ‏כתיבת הספירה. **של כל מופע לעצמו** — כל מופע סופר את השגיאות שלו,
   * ‏והטבלה מחברת. כישלון אינו נרשם כשגיאה (`console.warn`): שגיאה כאן
   * ‏הייתה נספרת, נכתבת ונכשלת שוב — לולאה.
   */
  @Sweep({ name: "server-errors-flush", everyMs: 60_000, firstDelayMs: 60_000, perInstance: true })
  async flush(): Promise<void> {
    const buckets = serverErrors.drain();
    for (const [index, bucket] of buckets.entries()) {
      try {
        await this.prisma.$executeRaw`
          INSERT INTO server_errors (day, source, signature, count, first_at, last_at)
          VALUES (${bucket.day}::date, ${bucket.source}, ${bucket.signature}, ${bucket.count},
                  ${bucket.firstAt}, ${bucket.lastAt})
          ON CONFLICT (day, source, signature) DO UPDATE SET
            count = server_errors.count + EXCLUDED.count,
            first_at = LEAST(server_errors.first_at, EXCLUDED.first_at),
            last_at = GREATEST(server_errors.last_at, EXCLUDED.last_at)`;
      } catch (error: unknown) {
        serverErrors.restore(buckets.slice(index));
        console.warn(`[server-errors] הכתיבה נכשלה, תנוסה שוב: ${String(error)}`);
        return;
      }
    }
  }

  /**
   * ‎**כיבוי מסודר כותב את מה שנספר** (ביקורת Codex, P2).
   *
   * ‏בלי זה כל פריסה הייתה מאבדת את השגיאות מאז הכתיבה האחרונה — ומופע
   * ‏שנופל בדקה הראשונה את כולן; הסיכום היה סופר פחות בדיוק ביום של
   * ‏פריסה. השלב הזה רץ אחרי `onModuleDestroy`, כש-Prisma כבר נותק,
   * ‏והשאילתה מחברת אותו מחדש לרגע.
   */
  async beforeApplicationShutdown(): Promise<void> {
    await this.flush();
  }

  /**
   * ‏הסיכום של אתמול — פעם אחת, מ-07:00. השורות נתפסות לפני השליחה
   * ‏(`notified_at`), כך ששני מופעים או שני סבבים אינם שולחים פעמיים;
   * ‏שליחה שלא הגיעה לאיש משחררת אותן לסבב הבא.
   */
  @Sweep({ name: "server-errors-digest", everyMs: 60 * 60 * 1000, firstDelayMs: 5 * 60 * 1000 })
  async digest(now: Date = new Date()): Promise<void> {
    const cutoff = jerusalemWallParts(jerusalemDayStart(now, -RETENTION_DAYS)).date;
    await this.prisma.$executeRaw`DELETE FROM server_errors WHERE day < ${cutoff}::date`;

    if (Number(jerusalemWallParts(now).time.slice(0, 2)) < DIGEST_HOUR) return;
    const day = jerusalemWallParts(jerusalemDayStart(now, -1)).date;
    const rows = await this.prisma.$queryRaw<
      { source: string; signature: string; count: number; first_at: Date; last_at: Date }[]
    >`
      UPDATE server_errors SET notified_at = now()
      WHERE day = ${day}::date AND notified_at IS NULL
      RETURNING source, signature, count, first_at, last_at`;
    if (rows.length === 0) return;

    const notice = serverErrorDigest(
      day,
      rows.map((row) => ({
        source: row.source,
        signature: row.signature,
        count: Number(row.count),
        firstAt: row.first_at,
        lastAt: row.last_at,
      })),
      (at) => jerusalemWallParts(at).time,
    );
    const outcome = await this.notifier.notify({
      ...notice,
      badge: { label: "סיכום יומי", tone: "warning" },
    });
    if (outcome.sent === 0) {
      await this.prisma.$executeRaw`
        UPDATE server_errors SET notified_at = NULL WHERE day = ${day}::date`;
      this.logger.warn(`סיכום השגיאות של ${day} לא נשלח לאף מנהל — ינוסה שוב`);
    }
  }
}
