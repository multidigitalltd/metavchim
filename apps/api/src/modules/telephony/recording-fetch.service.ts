import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import {
  build015RecordingUrl,
  MAX_RECORDING_BYTES,
  parse015RecordingResponse,
  split015RecordingPath,
} from "@metavchim/shared";
import { ulid } from "ulid";
import { CryptoService } from "../../core/crypto.service";
import { PrismaService } from "../../core/prisma.service";
import { StorageService } from "../../core/storage.service";
import { TranscriptionService } from "../voice-intake/transcription.service";

/**
 * משיכת ההקלטות מהמרכזייה אל האחסון שלנו.
 *
 * ## למה מושכים ולא מסתפקים במצביע
 *
 * שתי סיבות, ואף אחת מהן אינה נוחות:
 *
 * **תמלול.** צינור התמלול קורא קובץ מהאחסון שלנו. בלי האודיו אצלנו
 * אין מה לתמלל, וכל מה שנבנה סביב תמלול שיחות — סיכום אוטומטי,
 * משימת המשך, חיפוש בתוכן — לא חל על שיחות מהמרכזייה.
 *
 * **ראיה.** הקלטה שיושבת אצל הספק תלויה במנוי פעיל ובמדיניות
 * שמירה שאיננו שולטים בה. מתווך שצריך להוכיח מה נאמר בשיחה לא
 * אמור לגלות בדיעבד שהקובץ נמחק.
 *
 * ## למה סבב ולא בתוך ה-Webhook
 *
 * שלוש סיבות. ה-Webhook חייב לענות מהר — 015 שולח שוב כשהתשובה
 * מתמהמהת, וכל שליחה חוזרת היא עוד ניסיון משיכה. ההקלטה אינה
 * בהכרח מוכנה בשנייה שבה השיחה הסתיימה. וכשל משיכה אינו אמור
 * להיראות לספק ככשל בקליטת האירוע — האירוע נקלט בהצלחה.
 *
 * ## אידמפוטנטיות בחינם
 *
 * התנאי לשליפה הוא „יש נתיב אצל הספק ואין עדיין מפתח אצלנו”, והוא
 * מפסיק להתקיים ברגע שהמשיכה הצליחה. אין דגל לנהל, ניסיון חוזר
 * קורה מעצמו בסבב הבא, ושתי הרצות במקביל לכל היותר יכתבו את אותו
 * קובץ פעמיים.
 */

/** כל חמש דקות — הקלטה שנוצרה בינתיים תיאסף בסבב הבא. */
const TICK_MS = 5 * 60 * 1000;

/** דקה אחרי העלייה, כדי לא להתחרות על החיבורים בזמן המיגרציות. */
const FIRST_TICK_DELAY_MS = 60 * 1000;

/**
 * כמה הקלטות בסבב אחד, **סך הכול על פני כל המשרדים**.
 *
 * הגנה על משך הסבב ולא מדיניות: כל משיכה היא קריאת רשת עם פסק זמן
 * של דקה, ותקציב גלובלי הוא מה שמונע מסבב אחד לגלוש אל תוך הבא.
 * מה שלא נכנס לתקציב ייתפס בסבב הבא — התנאי לשליפה עדיין מתקיים.
 */
const MAX_PER_SWEEP = 20;

/**
 * כמה זמן ממשיכים לנסות שיחה שהמשיכה שלה נכשלת.
 *
 * בלי גבול, הקלטה שהספק כבר מחק הייתה נשלפת בכל סבב לנצח — ותופסת
 * את המכסה של הקלטות שכן אפשר למשוך. שבוע הוא זמן ארוך דיו לכל
 * תקלה זמנית (מנוי, רשת, הקלטה שטרם הסתיימה).
 */
const GIVE_UP_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** שיחה אחת שממתינה למשיכה, עם אישורי המרכזייה של המשרד שלה. */
interface RecordingJob {
  callId: string;
  tenantId: string;
  providerCallId: string;
  recordingPath: string;
  secretsEncrypted: string | null;
  config: unknown;
}

@Injectable()
export class RecordingFetchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecordingFetchService.name);
  private timer: NodeJS.Timeout | null = null;
  private first: NodeJS.Timeout | null = null;
  /** סבב אחד בכל רגע — שניים היו מושכים את אותן שורות פעמיים. */
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly crypto: CryptoService,
    private readonly transcription: TranscriptionService,
  ) {}

  onModuleInit(): void {
    this.first = setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), TICK_MS);
    }, FIRST_TICK_DELAY_MS);
    // אחרת התהליך לא יוצא בבדיקות ובסקריפטים קצרים
    this.first.unref?.();
  }

  onModuleDestroy(): void {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const job of await this.pending()) {
        await this.fetchOne(job).catch((error: unknown) => {
          // כשל בשיחה אחת אינו עוצר את הסבב — הבאה בתור עשויה להצליח
          this.logger.warn(`משיכת הקלטה נכשלה (${job.callId}): ${String(error)}`);
        });
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * השיחות שממתינות למשיכה, עם פרטי ההתחברות של המשרד שלהן.
   *
   * ## למה מונים משרדים ולא שולפים שאילתה אחת חוצת-דיירים
   *
   * `calls` ו-`integrations` שתיהן תחת `FORCE ROW LEVEL SECURITY`,
   * ותפקיד האפליקציה אינו עוקף אותן. שאילתה גולמית אחת עם JOIN
   * ביניהן — הצורה הקומפקטית והמתבקשת כאן — הייתה מתקמפלת, עוברת
   * את הבדיקות, ו**מחזירה אפס שורות בשקט** בכל סבב, לנצח: בלי
   * `app.tenant_id` הפוליסה מסננת הכול. אין חריגה ואין לוג, רק
   * הקלטות שלעולם אינן נמשכות.
   *
   * לכן אותו דפוס כמו בשאר סבבי המערכת (`gmail-sync`,
   * `match-refresh`): המשרדים נמנים מ-`tenants`, שאינה תחת RLS,
   * וכל שליפה עסקית רצה בתוך `withExplicitTenant` — כלומר הבידוד
   * ממשיך להיאכף במסד גם בסבב שאין בו בקשה ואין בו משתמש.
   */
  private async pending(): Promise<RecordingJob[]> {
    const since = new Date(Date.now() - GIVE_UP_AFTER_MS);
    const tenants = await this.prisma.tenant.findMany({
      where: { status: { in: ["active", "trial"] } },
      select: { id: true },
    });

    const jobs: RecordingJob[] = [];
    for (const tenant of tenants) {
      // התקציב גלובלי, ולכן נבדק לפני כל משרד ולא רק בסופו
      if (jobs.length >= MAX_PER_SWEEP) break;
      jobs.push(...(await this.pendingFor(tenant.id, since, MAX_PER_SWEEP - jobs.length)));
    }
    return jobs;
  }

  /** השיחות הממתינות של משרד אחד — הכול תחת הקשר הדייר שלו. */
  private async pendingFor(
    tenantId: string,
    since: Date,
    take: number,
  ): Promise<RecordingJob[]> {
    return this.prisma.withExplicitTenant(tenantId, async (tx) => {
      const integration = await tx.integration.findFirst({
        where: { tenantId, kind: "telephony", provider: "015", status: "active" },
        select: { secretsEncrypted: true, config: true },
      });
      // משרד בלי מרכזיית 015 פעילה — אין למי לפנות, ואין מה לשלוף
      if (!integration) return [];

      const calls = await tx.call.findMany({
        where: {
          tenantId,
          providerRecordingPath: { not: null },
          recordingKey: null,
          providerCallId: { not: null },
          occurredAt: { gt: since },
        },
        select: { id: true, providerCallId: true, providerRecordingPath: true },
        orderBy: { occurredAt: "desc" },
        take,
      });

      return calls.map((call) => ({
        callId: call.id,
        tenantId,
        providerCallId: call.providerCallId!,
        recordingPath: call.providerRecordingPath!,
        secretsEncrypted: integration.secretsEncrypted,
        config: integration.config,
      }));
    });
  }

  private async fetchOne(job: RecordingJob): Promise<void> {
    const ids = split015RecordingPath(job.recordingPath);
    if (!ids) {
      this.logger.warn(`נתיב הקלטה בצורה לא מוכרת: ${job.recordingPath}`);
      return;
    }

    const secrets = this.readSecrets(job.secretsEncrypted);
    const config = (job.config ?? {}) as Record<string, string>;
    // אותה נפילה-לאחור כמו בחיוג: שם המשתמש עבר מסוד לשדה גלוי
    const authUsername = (config["authUsername"] ?? secrets["authUsername"] ?? "").trim();
    const authPassword = (secrets["authPassword"] ?? "").trim();
    if (authUsername === "" || authPassword === "") return;

    const url = build015RecordingUrl({
      authUsername,
      authPassword,
      recordGroup: ids.recordGroup,
      // מזהה השיחה כפי שהוובהוק שלח — לא כפי שהוא מופיע בשם הקובץ
      uniqueId: job.providerCallId,
      recordId: ids.recordId,
    });

    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) {
      this.logger.warn(`015 השיב ${res.status} על הקלטה ${job.recordingPath}`);
      return;
    }
    const parsed = parse015RecordingResponse(await res.json());
    if (!parsed) return;

    const audio = Buffer.from(parsed.base64, "base64");
    if (audio.length === 0) return;
    if (audio.length > MAX_RECORDING_BYTES) {
      this.logger.warn(`הקלטה חורגת מהגבול (${audio.length} בתים) — ${job.recordingPath}`);
      return;
    }

    /*
     * אותו דפוס מפתח כמו בהעלאה הידנית (`CallsService.attachRecording`),
     * כדי שמסלולי המחיקה — מחיקת לקוח ומחיקת חשבון — ימצאו גם את
     * ההקלטות שנמשכו מהמרכזייה. מפתח בצורה אחרת היה נשאר ב-S3 אחרי
     * שהמערכת הצהירה שהכול נמחק.
     */
    const key = `calls/${job.tenantId}/${job.callId}/${ulid()}`;
    await this.storage.put(key, audio, parsed.contentType);

    const available = (await this.transcription.status()).available;
    await this.prisma.withExplicitTenant(job.tenantId, async (tx) => {
      await tx.call.updateMany({
        where: { id: job.callId, tenantId: job.tenantId, recordingKey: null },
        data: {
          recordingKey: key,
          transcriptionStatus: available ? "pending" : "unavailable",
        },
      });
    });
    this.logger.log(`הקלטה נמשכה מ-015 לשיחה ${job.callId} (${audio.length} בתים)`);
  }

  /** אותה קריאה כמו ב-`TelephonyService` — סודות מוצפנים כגוש JSON. */
  private readSecrets(encrypted: string | null): Record<string, string> {
    if (!encrypted) return {};
    try {
      return JSON.parse(this.crypto.decrypt(encrypted)) as Record<string, string>;
    } catch {
      return {};
    }
  }
}
