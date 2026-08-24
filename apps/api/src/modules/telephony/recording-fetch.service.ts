import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import {
  build015RecordingsListUrl,
  build015RecordingUrl,
  MAX_RECORDING_BYTES,
  parse015RecordingResponse,
  parse015RecordingsList,
  pbx015RecordingPath,
  split015RecordingPath,
  unmatched015ListKeys,
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

/**
 * כמה להמתין לפני ניסיון חוזר על שיחה שכבר נוסתה.
 *
 * חצי שעה, ולא חמש דקות כמו קצב הסבב: הסיבות הנפוצות לכישלון —
 * הקלטה שהספק טרם הכין, מנוי שפג, תקלת רשת — אינן נפתרות בתוך סבב
 * אחד, וניסיון כל חמש דקות רק היה שורף את המכסה.
 */
const RETRY_AFTER_MS = 30 * 60 * 1000;

/** שיחה אחת שממתינה למשיכה, עם אישורי המרכזייה של המשרד שלה. */
/**
 * הסיבות שמשיכה יכולה להיכשל בהן — **רשימה סגורה.**
 *
 * הקוד הזה מגיע למסך של המתווך, ולכן הוא אינו הודעת השגיאה של
 * הספק: הודעה כזו עלולה לשאת נתיבים ומזהים, וכתובת המשיכה עצמה
 * נושאת שם משתמש וסיסמה. קוד מרשימה ידועה אפשר להציג, לתרגם
 * ולחפש — ואי אפשר לדלוף דרכו.
 */
export const RECORDING_ERRORS = {
  path: "path_unreadable",
  credentials: "missing_credentials",
  provider: "provider_rejected",
  unreadable: "response_unreadable",
  empty: "empty_audio",
  tooLarge: "too_large",
  network: "network_error",
  integration: "no_integration",
} as const;

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
    } catch (error: unknown) {
      /*
       * ‎`finally`‎ לבדו לא הספיק: `pending()` שנופל על תקלת מסד
       * זמנית היה מדחה את `tick()`, ושני הטיימרים זורקים את ההבטחה
       * עם `void`. דחייה לא-מטופלת מפילה את תהליך ה-API כולו — סבב
       * רקע לא אמור להיות מסוגל לעשות את זה (ביקורת Codex).
       */
      this.logger.error(`סבב משיכת ההקלטות נכשל: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * ייבוא הקלטות שהמרכזייה מחזיקה ואנחנו לא — **פעולה יזומה.**
   *
   * ## למה זה נחוץ
   *
   * הוובהוק מספר לנו על הקלטה בזמן שהשיחה מסתיימת, ולכן שיחה
   * שהאירוע שלה אבד, הגיע בלי שדה `recording`, או נקלטה בזמן
   * שההקלטה עוד לא הייתה מוכנה — נשארת אצלנו בלי אודיו לתמיד.
   * `recording/recordings/list` הוא הצד השני של אותו מטבע: מה
   * שאצל הספק, ולא מה שהוא טרח לספר לנו עליו.
   *
   * ## למה יזום ולא בסבב
   *
   * זו קריאה על טווח תאריכים שלם, והיא נוגעת במנוי של המשרד אצל
   * הספק. סריקה אוטומטית אחורה הייתה מושכת עשרות הקלטות בלי
   * שאיש ביקש. הכפתור נמצא במסך ההגדרות, אצל מי שמחזיק את
   * החיבור.
   *
   * ## מה הפעולה עושה בפועל
   *
   * **רק מסמנת.** היא כותבת את הנתיב לשיחות שאין להן אחד, ומשם
   * הסבב הקיים מושך את האודיו — עם אותה אידמפוטנטיות, אותו תור
   * הוגן ואותו ניקוי מפתח יתום שכבר נבדקו. מסלול הורדה שני היה
   * עותק שני של בדיוק ההיגיון שאסור שיתפצל.
   *
   * ## הגבול, ולמה הוא מדווח
   *
   * הקלטה שאין לה שיחה אצלנו — כלומר שיחה שקדמה לחיבור המרכזייה —
   * אין לה לאן להיתלות: אין כרטיס לקוח, אין ליד, אין מה להשמיע.
   * היא נספרת ומדווחת כ-`withoutCall` במקום להיבלע, כדי שהמשרד
   * יראה את הפער ולא יניח שהכול נכנס.
   */
  async importRange(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<{ found: number; linked: number; alreadyHad: number; withoutCall: number }> {
    const integration = await this.prisma.withExplicitTenant(tenantId, (tx) =>
      tx.integration.findFirst({
        where: { tenantId, kind: "telephony", provider: "015", status: "active" },
        select: { secretsEncrypted: true, config: true },
      }),
    );
    if (!integration) throw new BadRequestException("אין מרכזיית 015 מחוברת");

    const secrets = this.readSecrets(integration.secretsEncrypted);
    const config = (integration.config ?? {}) as Record<string, string>;
    const authUsername = (config["authUsername"] ?? secrets["authUsername"] ?? "").trim();
    const authPassword = (secrets["authPassword"] ?? "").trim();
    if (authUsername === "" || authPassword === "") {
      throw new BadRequestException("חסרים פרטי התחברות למרכזייה");
    }

    const res = await fetch(
      build015RecordingsListUrl({
        authUsername,
        authPassword,
        fromEpochSeconds: from.getTime() / 1000,
        toEpochSeconds: to.getTime() / 1000,
      }),
      { signal: AbortSignal.timeout(60_000) },
    );
    if (!res.ok) throw new BadRequestException(`המרכזייה השיבה ${res.status}`);
    const body: unknown = await res.json();

    const rows = parse015RecordingsList(body);
    if (rows.length === 0) {
      /*
       * שמות השדות אינם מתועדים. רשימה ריקה שהגיעה עם שורות היא
       * שינוי שם שדה אצל הספק — ובלי השורה הזו הוא היה נראה
       * כ"אין הקלטות" (השמות בלבד, בלי הערכים).
       */
      const unknownKeys = unmatched015ListKeys(body);
      if (unknownKeys.length > 0) {
        this.logger.warn(`רשימת ההקלטות הגיעה בשדות לא מוכרים: ${unknownKeys.join(", ")}`);
      }
    }

    let linked = 0;
    let alreadyHad = 0;
    let withoutCall = 0;
    await this.prisma.withExplicitTenant(tenantId, async (tx) => {
      for (const row of rows) {
        const call = await tx.call.findFirst({
          where: { tenantId, providerCallId: row.uniqueId },
          select: { id: true, recordingKey: true, providerRecordingPath: true },
        });
        if (!call) {
          withoutCall += 1;
          continue;
        }
        if (call.recordingKey !== null || call.providerRecordingPath !== null) {
          alreadyHad += 1;
          continue;
        }
        await tx.call.updateMany({
          where: { id: call.id, tenantId, providerRecordingPath: null, recordingKey: null },
          data: {
            providerRecordingPath: pbx015RecordingPath(row),
            // איפוס החותמת מכניס את השיחה לראש התור בסבב הבא
            providerRecordingAttemptAt: null,
          },
        });
        linked += 1;
      }
    });

    this.logger.log(
      `ייבוא הקלטות (${tenantId}): ${rows.length} אצל הספק, ${linked} סומנו למשיכה`,
    );
    return { found: rows.length, linked, alreadyHad, withoutCall };
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
    const now = Date.now();
    const tenants = await this.prisma.tenant.findMany({
      where: { status: { in: ["active", "trial"] } },
      select: { id: true },
    });

    const jobs: RecordingJob[] = [];
    for (const tenant of tenants) {
      // התקציב גלובלי, ולכן נבדק לפני כל משרד ולא רק בסופו
      if (jobs.length >= MAX_PER_SWEEP) break;
      jobs.push(...(await this.pendingFor(tenant.id, now, MAX_PER_SWEEP - jobs.length)));
    }
    return jobs;
  }

  /**
   * השיחות הממתינות של משרד אחד — הכול תחת הקשר הדייר שלו.
   *
   * ## סדר הוגן, ולא „החדשות קודם”
   *
   * המיון הוא לפי מועד הניסיון האחרון, ומי שטרם נוסה קודם לכולם.
   * הגרסה הראשונה מיינה לפי מועד השיחה יורד, וזו הייתה הרעבה: עשרים
   * השיחות החדשות ביותר שהמשיכה שלהן נכשלת — נתיב פגום, אישורים
   * שפגו, הקלטה שהספק טרם הכין — היו נבחרות מחדש בכל סבב ותופסות את
   * המכסה, בעוד שהשיחות הישנות יותר לא נמשכות **כלל** עד שיזדקנו
   * שבוע ויירדו מהחלון. כלומר דווקא אלה שהזמן אוזל להן (ראו
   * `GIVE_UP_AFTER_MS`) נדחקו אחרונות (ביקורת Codex).
   *
   * החותמת נכתבת לפני המשיכה ועל כל השורות שנבחרו יחד, ולכן היא
   * מתעדכנת גם אם התהליך נופל באמצע הסבב. הכתיבה היחידה הזו היא גם
   * מה שמונע משתי הרצות במקביל לבחור את אותן שורות.
   */
  private async pendingFor(tenantId: string, now: number, take: number): Promise<RecordingJob[]> {
    return this.prisma.withExplicitTenant(tenantId, async (tx) => {
      const integration = await tx.integration.findFirst({
        where: { tenantId, kind: "telephony", provider: "015", status: "active" },
        select: { secretsEncrypted: true, config: true },
      });
      /*
       * משרד בלי מרכזיית 015 פעילה — אין למי לפנות. אבל אם יש
       * שיחות שממתינות לנתיב שכבר הגיע, השתיקה כאן היא בדיוק מה
       * שהותיר את המתווך בלי מושג: ההקלטות לא נמשכות והמסך אומר
       * „אין הקלטה”.
       */
      if (!integration) {
        /*
         * ורושמים זאת על השיחות עצמן. בלי זה הן נשארות במצב
         * „ממתינה” לנצח, והמסך מבטיח „נמשכת תוך דקות” על משיכה
         * שלא תתחיל לעולם — שקר גרוע יותר מ„אין הקלטה”.
         *
         * התנאי מחריג **רק את מי שכבר מסומן `no_integration`**, ולא
         * כל שורה שיש עליה סיבה כלשהי. הגרסה הראשונה סיננה
         * ‎`providerRecordingError: null`‎ כדי לכתוב פעם אחת בלבד,
         * ובכך השאירה סיבה חולפת — `network_error` למשל — על שיחה
         * שהחיבור שלה כובה בינתיים: המסך המשיך לומר „לא הצלחנו
         * להגיע למרכזייה”, ושלח את המתווך לבדוק רשת במקום להפעיל
         * חיבור (ביקורת Codex).
         *
         * ‎`OR` מפורש ולא `not`: התנהגות `not` מול `NULL` תלויה
         * במימוש, ושורה שסיבתה ריקה היא בדיוק זו שחייבת להיכלל.
         */
        const marked = await tx.call.updateMany({
          where: {
            tenantId,
            providerRecordingPath: { not: null },
            recordingKey: null,
            OR: [
              { providerRecordingError: null },
              { providerRecordingError: { not: RECORDING_ERRORS.integration } },
            ],
          },
          data: { providerRecordingError: RECORDING_ERRORS.integration },
        });
        if (marked.count > 0) {
          this.logger.warn(
            `${marked.count} הקלטות ממתינות למשרד ${tenantId} — אין אינטגרציית 015 פעילה`,
          );
        }
        return [];
      }

      const calls = await tx.call.findMany({
        where: {
          tenantId,
          providerRecordingPath: { not: null },
          recordingKey: null,
          providerCallId: { not: null },
          /*
           * חלון הוויתור חל על מי ש**כבר נוסתה**, ולא על כל שורה.
           *
           * שיחה שחותמת הניסיון שלה ריקה טרם נגענו בה — אם משום
           * שהיא חדשה, אם משום שהסבב היה מושבת, ואם משום שמתווך
           * לחץ „נסו למשוך שוב”. הגרסה הראשונה סיננה לפי גיל בלבד,
           * ולכן הלחיצה הידנית על שיחה בת שבוע לא עשתה **כלום**:
           * הכפתור החזיר „בתור” והסבב לא בחר אותה לעולם (ביקורת
           * Codex). ניסיון ידני הוא החלטה של אדם, והוא גובר על
           * הוויתור האוטומטי — אבל פעם אחת, כי מיד אחריו נכתבת
           * חותמת חדשה והשורה חוזרת לכלל הרגיל.
           */
          OR: [
            { providerRecordingAttemptAt: null },
            {
              providerRecordingAttemptAt: { lt: new Date(now - RETRY_AFTER_MS) },
              occurredAt: { gt: new Date(now - GIVE_UP_AFTER_MS) },
            },
          ],
        },
        select: { id: true, providerCallId: true, providerRecordingPath: true },
        orderBy: [
          { providerRecordingAttemptAt: { sort: "asc", nulls: "first" } },
          // בין אלה שטרם נוסו — הישנה קודם, כי הזמן שלה אוזל
          { occurredAt: "asc" },
        ],
        take,
      });
      if (calls.length === 0) return [];

      await tx.call.updateMany({
        where: { id: { in: calls.map((call) => call.id) }, tenantId },
        data: { providerRecordingAttemptAt: new Date(now) },
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

  /**
   * רישום סיבת הכישלון על השורה.
   *
   * הכתיבה מותנית ב-`recordingKey: null` מאותו נימוק שהתפיסה
   * מותנית: אם בינתיים כבר נמשכה הקלטה (סבב מקביל, העלאה ידנית),
   * אסור לסמן את השיחה ככושלת.
   */
  private async note(job: RecordingJob, reason: string): Promise<void> {
    await this.prisma
      .withExplicitTenant(job.tenantId, (tx) =>
        tx.call.updateMany({
          where: { id: job.callId, tenantId: job.tenantId, recordingKey: null },
          data: { providerRecordingError: reason },
        }),
      )
      .catch((error: unknown) =>
        this.logger.warn(`רישום סיבת כישלון נכשל (${job.callId}): ${String(error)}`),
      );
  }

  private async fetchOne(job: RecordingJob): Promise<void> {
    const ids = split015RecordingPath(job.recordingPath);
    if (!ids) {
      this.logger.warn(`נתיב הקלטה בצורה לא מוכרת: ${job.recordingPath}`);
      await this.note(job, RECORDING_ERRORS.path);
      return;
    }

    const secrets = this.readSecrets(job.secretsEncrypted);
    const config = (job.config ?? {}) as Record<string, string>;
    // אותה נפילה-לאחור כמו בחיוג: שם המשתמש עבר מסוד לשדה גלוי
    const authUsername = (config["authUsername"] ?? secrets["authUsername"] ?? "").trim();
    const authPassword = (secrets["authPassword"] ?? "").trim();
    if (authUsername === "" || authPassword === "") {
      /*
       * זה היה `return` עירום — הכשל השקט ביותר בכל המסלול. משרד
       * שהאישורים שלו חסרים או פגו לא קיבל אף שורת יומן ואף סימן
       * במסך: ההקלטות פשוט לא הגיעו, וכל שיחה נראתה כאילו מעולם
       * לא הוקלטה.
       */
      this.logger.warn(`אישורי 015 חסרים למשרד ${job.tenantId} — משיכת הקלטות מושבתת`);
      await this.note(job, RECORDING_ERRORS.credentials);
      return;
    }

    const url = build015RecordingUrl({
      authUsername,
      authPassword,
      recordGroup: ids.recordGroup,
      // מזהה השיחה כפי שהוובהוק שלח — לא כפי שהוא מופיע בשם הקובץ
      uniqueId: job.providerCallId,
      recordId: ids.recordId,
    });

    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    } catch (error: unknown) {
      // פסק זמן או תקלת רשת — נרשם כאן ולא נבלע ב-`tick`, כדי
      // שהמסך יבחין בין „לא הצלחנו להגיע” לבין „אין הקלטה”
      this.logger.warn(`פנייה ל-015 נכשלה (${job.callId}): ${String(error)}`);
      await this.note(job, RECORDING_ERRORS.network);
      return;
    }
    if (!res.ok) {
      this.logger.warn(`015 השיב ${res.status} על הקלטה ${job.recordingPath}`);
      await this.note(job, `${RECORDING_ERRORS.provider}_${res.status}`);
      return;
    }
    /*
     * פענוח ה-JSON נתפס **כאן** ולא נופל ל-`tick`.
     *
     * ‎`res.json()` על גוף פגום זורק שגיאה שנושאת קטע מהגוף עצמו.
     * הגוף מגיע מהספק, והוא עלול להחזיר בו את כתובת הבקשה — וזו
     * נושאת `auth_username` ו-`auth_password`. ה-catch החיצוני מדפיס
     * ‎`String(error)`, ולכן בלי התפיסה הזו תשובה פגומה אחת הייתה
     * מדליפה את האישורים ליומן — ועוקפת בשקט את כל הרעיון של רשימת
     * הקודים הסגורה (ביקורת Codex).
     *
     * נרשמות רק עובדות שאנחנו כתבנו: מה קרה, ועל איזו שיחה.
     */
    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      this.logger.warn(`תשובת 015 לא נקראה (${job.callId}) — גוף שאינו JSON תקין`);
      await this.note(job, RECORDING_ERRORS.unreadable);
      return;
    }

    const parsed = parse015RecordingResponse(payload);
    if (!parsed) {
      this.logger.warn(`תשובת 015 לא נקראה על הקלטה ${job.recordingPath}`);
      await this.note(job, RECORDING_ERRORS.unreadable);
      return;
    }

    const audio = Buffer.from(parsed.base64, "base64");
    if (audio.length === 0) {
      // 015 מכין את ההקלטה לאחר סיום השיחה; ריק כאן הוא „עדיין לא”
      await this.note(job, RECORDING_ERRORS.empty);
      return;
    }
    if (audio.length > MAX_RECORDING_BYTES) {
      this.logger.warn(`הקלטה חורגת מהגבול (${audio.length} בתים) — ${job.recordingPath}`);
      await this.note(job, RECORDING_ERRORS.tooLarge);
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
    const claimed = await this.prisma.withExplicitTenant(job.tenantId, (tx) =>
      tx.call.updateMany({
        where: { id: job.callId, tenantId: job.tenantId, recordingKey: null },
        data: {
          recordingKey: key,
          transcriptionStatus: available ? "pending" : "unavailable",
          // הצלחה מנקה סיבת כישלון קודמת — אחרת המסך ימשיך להתלונן
          providerRecordingError: null,
        },
      }),
    );

    /*
     * העדכון מותנה, ולכן הוא יכול להפסיד: השיחה נמחקה בינתיים, מישהו
     * העלה לה הקלטה ידנית, או סבב מקביל הקדים. במקרה כזה הקובץ כבר
     * ב-S3 אבל אף שורה אינה מצביעה עליו — כלומר מסלולי המחיקה
     * (מחיקת לקוח, מחיקת חשבון) לא ימצאו אותו לעולם, והמערכת תצהיר
     * שהכול נמחק בזמן שאודיו של לקוח נשאר באחסון (ביקורת Codex).
     *
     * מפתח יתום נמחק כאן ועכשיו. הסבב הבא ימשוך שוב אם עדיין צריך.
     */
    if (claimed.count === 0) {
      await this.storage
        .delete(key)
        .catch((error: unknown) =>
          this.logger.error(`מפתח הקלטה יתום שלא נמחק (${key}): ${String(error)}`),
        );
      return;
    }
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
