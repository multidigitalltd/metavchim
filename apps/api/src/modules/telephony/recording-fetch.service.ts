import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import {
  build015RecordingsListUrl,
  describeProviderResponse,
  dropped015ListRows,
  build015RecordingUrl,
  MAX_RECORDING_BYTES,
  parse015RecordingResponse,
  parse015RecordingsList,
  type Pbx015RecordingRow,
  pbx015ListRowKeys,
  parse015Status,
  pbx015RecordingPath,
  pbx015RecordingGroups,
  pbx015UniqueIdForms,
  split015RecordingPath,
  unmatched015ListKeys,
  nextRefusalStreak,
  type RecordingPullResult,
  CALL_OUTCOME_MISSED,
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

/**
 * השהיה בין **בקשה לבקשה** — כדי לא לחנוק את הספק.
 *
 * הסבב רץ בטור אבל בלי רווח: עשרים הקלטות בזו אחר זו במלוא המהירות,
 * וכל אחת שנכשלת מוסיפה עד ארבעה צירופי מועמדים, קריאת רשימה
 * וניסיון חוזר. כשמצטברות הרבה הקלטות אלה עשרות בקשות בשניות
 * ספורות, ואז 015 משיב „Bad request” על בקשות תקינות לחלוטין — מה
 * שנראה מבחוץ כתקלה אקראית שנפתרת בלחיצה שנייה (דיווח מהמשרד).
 *
 * ‎**היחידה היא הבקשה ולא ההקלטה.** ריווח סביב משיכה שלמה היה
 * מחטיא את מסלול הכישלון, שבו שש בקשות יוצאות בתוך „משיכה אחת” —
 * וזה בדיוק המסלול שרץ כשהספק כבר עמוס.
 *
 * שנייה לבקשה הופכת מנה מוצלחת של עשרים לכדקה. זה זמן רקע שאיש
 * אינו ממתין לו — ההקלטה מופיעה דקות אחרי השיחה בכל מקרה.
 */
const PAUSE_BETWEEN_REQUESTS_MS = 1_000;

/**
 * כמה סירובים רצופים עוצרים את הסבב.
 *
 * ‎**זה מה שמונע את מפולת השלג.** ברגע שהספק חונק, כל בקשה נוספת
 * גם נכשלת וגם מאריכה את החנק — ובלי עצירה הסבב היה ממשיך לירות
 * עוד תשע-עשרה הקלטות, לשרוף את חלון הניסיון של כולן, ולהציג
 * למתווך תשע-עשרה שגיאות שאין להן דבר עם ההקלטות עצמן.
 *
 * שלושה ולא אחד: הקלטה בודדת שאינה קיימת אצל הספק היא מצב רגיל
 * לחלוטין, ועצירה עליה הייתה מקפיאה את התור על שורה פגומה אחת.
 * רצף של שלושה כבר אינו נראה כמו מקרה.
 *
 * מה שנעצר אינו אבוד: התנאי לשליפה עדיין מתקיים, והסבב הבא ייקח
 * אותן.
 */
const REFUSALS_BEFORE_PAUSE = 3;

/**
 * גבול העמודה `provider_recording_detail` — **מספר של המסד, לא העדפה.**
 *
 * חריגה ממנו אינה נחתכת אלא **זורקת**, ו-`note` בולעת את השגיאה כדי
 * שרישום כישלון לא יפיל את הסבב. התוצאה הייתה השילוב הגרוע ביותר:
 * גם הסיבה וגם הפירוט אינם נכתבים, והשיחה נשארת עם מצב ישן או ריק
 * — בדיוק כשיש מה לומר (ביקורת Codex).
 */
const PROVIDER_DETAIL_MAX = 200;

/**
 * חיבור תיאור הספק למה שביקשנו, בתוך גבול העמודה.
 *
 * מה שנחתך הוא **תיאור הספק** ולא הפרמטרים: „לא נמצא” על הקלטה
 * שקיימת בממשק הוא שאלה על הבקשה, ולכן המזהים ששלחנו הם החלק שאי
 * אפשר לוותר עליו.
 */
function joinDetail(providerDetail: string, asked: string): string {
  const separator = " · ";
  const room = PROVIDER_DETAIL_MAX - asked.length - separator.length;
  if (room <= 0) return asked.slice(0, PROVIDER_DETAIL_MAX);
  const head =
    providerDetail.length > room ? `${providerDetail.slice(0, room - 1)}…` : providerDetail;
  return `${head}${separator}${asked}`;
}

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

/**
 * תוצאת משיכה אחת, לעיני הסבב בלבד.
 *
 * ‎`refused` הוא **הספק אמר לא** — זה מה שנספר לעצירה. כשל רשת או
 * תשובה פגומה אינם „לא” של הספק, ואינם מעידים על חנק, ולכן הם
 * ‎`other`. איחוד השניים היה עוצר את הסבב על תקלת רשת מקומית.
 */
/*
 * שלוש התוצאות והכלל שמכריע מה כל אחת עושה למונה יושבים ב-`shared`
 * (`nextRefusalStreak`), כדי שיהיו **נבדקים**. כאן זה היה שורה אחת
 * שאפשר להפוך בלי שאף בדיקה תרגיש — וזה קרה פעמיים.
 */
type PullResult = RecordingPullResult;

interface RecordingJob {
  callId: string;
  /**
   * מועד השיחה — נדרש לחלון הזמן של `recordings/list`.
   *
   * הרשימה של 015 מתבקשת בטווח זמנים, ולכן בלי המועד אין דרך לשאול
   * את הספק מה המזהה האמיתי של ההקלטה הזו.
   */
  occurredAt: Date;
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
  /**
   * מתי יצאה הבקשה האחרונה ל-015 — **לכל הבקשות, לא לכל שיחה.**
   *
   * הריווח היה במקור סביב `fetchOne` כולה, וזה החטיא בדיוק את המקרה
   * שבגללו הוא נוסף: שיחה שהמועמד הראשון שלה נדחה שולחת עוד שלושה
   * צירופים, ואז קריאת רשימה וניסיון חוזר — שש בקשות ברצף בתוך
   * „משיכה אחת”. כלומר דווקא מסלול הכישלון, זה שמופיע כשהספק כבר
   * עמוס, נשאר בלי ריווח — ויכול להיחנק בדיוק על המועמד הנכון
   * (ביקורת Codex).
   *
   * השעון גלובלי לשירות ולא לשיחה, כי מה שמעניין את הספק הוא הקצב
   * שמגיע אליו, ולא איך חילקנו אותו אצלנו לפעולות.
   */
  private lastRequestAt = 0;
  /** התור שמסדר את הפונים ל-`pace()` — ראו ההסבר שם. */
  private paceChain: Promise<void> = Promise.resolve();

  /**
   * ממתין עד שחלף הריווח מאז הבקשה הקודמת, ומסמן את הזמן החדש.
   *
   * ‎**הפונים משורשרים זה אחר זה, ולא ישנים במקביל.**
   *
   * הגרסה הראשונה קראה את `lastRequestAt`, ישנה עד המועד, ואז כתבה.
   * כל עוד רק הסבב קרא לה — והוא רץ בטור — זה הספיק. ברגע שגם
   * הייבוא היזום עבר דרכה נוצרה מקבילוּת אמיתית: שני פונים קוראים
   * את **אותה** חותמת, ישנים עד **אותו** מועד, ויוצאים יחד — כלומר
   * בדיוק הפרץ שהמנגנון בא למנוע, ודווקא בתרחיש שבגללו הוא הורחב
   * (ביקורת Codex).
   *
   * השרשרת מקצה את התור מראש: כל קריאה נתלית על קודמתה, ולכן
   * הקריאה והכתיבה של החותמת אינן יכולות להשתזר.
   *
   * ‎`catch` על החוליה הנשמרת ולא על המוחזרת: כשל של פונה אחד אינו
   * אמור לשבור את השרשרת לכל מי שאחריו, אבל גם אינו אמור להיבלע —
   * הוא מוחזר לקורא כרגיל.
   */
  private pace(): Promise<void> {
    const slot = this.paceChain.then(async () => {
      const wait = this.lastRequestAt + PAUSE_BETWEEN_REQUESTS_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastRequestAt = Date.now();
    });
    this.paceChain = slot.catch(() => undefined);
    return slot;
  }

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
      const jobs = await this.pending();
      let refusalsInARow = 0;
      for (const [index, job] of jobs.entries()) {
        /*
         * אין כאן השהיה: היא יושבת ב-`pace()` שנקראת לפני **כל**
         * בקשה לספק, כולל אלה שמסלול הכישלון של שיחה בודדת שולח.
         */
        const result = await this.fetchOne(job).catch((error: unknown) => {
          // כשל בשיחה אחת אינו עוצר את הסבב — הבאה בתור עשויה להצליח
          this.logger.warn(`משיכת הקלטה נכשלה (${job.callId}): ${String(error)}`);
          return "other" as PullResult;
        });
        /*
         * ‎**רק משיכה שהצליחה מאפסת.** ההערה הקודמת כאן הבטיחה בדיוק
         * את זה, והשורה שמתחתיה איפסה על כל מה שאינו סירוב — כולל
         * כישלון מקומי, שאינו מוכיח דבר על הספק. ראו `nextRefusalStreak`.
         */
        refusalsInARow = nextRefusalStreak(refusalsInARow, result);
        if (refusalsInARow >= REFUSALS_BEFORE_PAUSE) {
          /*
           * ‎**כאן אין מה להחזיר.** השורות שלא הגיע אליהן התור לא
           * סומנו מלכתחילה — הסימון נעשה לכל שיחה ברגע שמתחילים
           * לטפל בה — ולכן הן נשארות בתור כפי שהיו. ראו `claim`.
           */
          this.logger.warn(
            `${refusalsInARow} סירובים רצופים מ-015 — הסבב נעצר, ` +
              `${jobs.length - index - 1} הקלטות ממתינות לסבב הבא`,
          );
          break;
        }
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
  ): Promise<{
    found: number;
    linked: number;
    alreadyHad: number;
    withoutCall: number;
    /** הקלטות שהספק החזיר ואין בהן מזהה הורדה שאנחנו מכירים */
    withoutRecordId: number;
    /** שמות השדות בשורה הראשונה — שמות בלבד; ראו `pbx015ListRowKeys` */
    rowKeys: string[];
  }> {
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

    /*
     * קבוצת ההקלטות היא **הגדרה של המשרד**, ולכל משרד מספר אחר.
     * בלעדיה אין מה לבקש: התיעוד דורש `recordgroup` או `customer`,
     * והבקשה בלי שניהם היא בדיוק מה ששלחנו עד עכשיו.
     */
    const recordGroup = (config["recordGroup"] ?? "").trim();
    if (recordGroup === "") {
      throw new BadRequestException(
        "חסר מספר קבוצת ההקלטות (recordgroup) בהגדרות המרכזייה",
      );
    }

    /*
     * גם הייבוא היזום עובר במרווח. הוא נראה כמו מסלול נפרד — אדם
     * לוחץ, זו בקשה אחת — אבל הספק רואה תור אחד: לחיצה בזמן שהסבב
     * רץ מוסיפה בקשה בדיוק לתוך הרצף שהמרווח בא לפרוס.
     */
    await this.pace();
    const res = await fetch(
      build015RecordingsListUrl({
        authUsername,
        authPassword,
        recordGroup,
        fromEpochSeconds: from.getTime() / 1000,
        toEpochSeconds: to.getTime() / 1000,
      }),
      { signal: AbortSignal.timeout(60_000) },
    );
    if (!res.ok) throw new BadRequestException(`המרכזייה השיבה ${res.status}`);

    /*
     * אותה תפיסה שיש ב-`fetchOne`, ומאותו נימוק בדיוק — היא פשוט
     * לא הייתה כאן.
     *
     * ‎`res.json()` על גוף פגום זורק שגיאה שנושאת קטע מהגוף עצמו,
     * והגוף מגיע מהספק: הוא עלול להחזיר בו את כתובת הבקשה, שנושאת
     * ‎`auth_username` ו-`auth_password`. שגיאה שאינה נתפסת כאן
     * עולה ל-Nest ונרשמת ביומן על הודעתה — כלומר טקסט של הספק
     * עוקף את `describeProviderResponse` בשקט (ביקורת Codex, P1).
     *
     * מה שנרשם הוא עובדות שאנחנו כתבנו בלבד: הסטטוס ואורך הגוף.
     * האורך הוא מה שמבדיל בין דף שגיאה של שרת מתווך לבין תשובה
     * קצרה, וזה מספיק כדי לדעת לאן להסתכל.
     */
    const raw = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      this.logger.warn(
        `רשימת ההקלטות לא נקראה — גוף שאינו JSON תקין (סטטוס ${res.status}, ${raw.length} תווים)`,
      );
      throw new BadRequestException("התשובה מהמרכזייה לא נקראה — גוף שאינו JSON תקין");
    }

    /*
     * הקבוצה שביקשנו נמסרת לקורא: היא פרמטר של הבקשה ואינה שדה
     * שהתשובה חייבת לחזור עליו. הדרישה שתופיע בשורה הפילה כל שורה
     * בשקט, והייבוא דיווח „אין הקלטות אצל הספק” על תשובה מלאה.
     */
    const rows = parse015RecordingsList(body, recordGroup);
    /*
     * **שורה שנשמטה מדווחת תמיד, לא רק כשכולן נשמטו.**
     *
     * שמות השדות אינם מתועדים, ולכן „שם שדה שאיננו מכירים” ו„אין
     * הקלטות” נראים זהים מבחוץ ודורשים פעולה הפוכה. הספירה היא מה
     * שמבדיל, ואחריה שמות המפתחות — שמות בלבד, בלי ערכים, כי שורת
     * הקלטה נושאת מספרי טלפון.
     */
    const dropped = dropped015ListRows(body, recordGroup);
    if (dropped > 0) {
      const unknownKeys = unmatched015ListKeys(body);
      this.logger.warn(
        `רשימת ההקלטות: ${dropped} שורות בלי מזהים שאנחנו מכירים` +
          (unknownKeys.length > 0 ? ` · שדות לא מוכרים: ${unknownKeys.join(", ")}` : ""),
      );
    }

    let linked = 0;
    let alreadyHad = 0;
    let withoutCall = 0;
    let withoutRecordId = 0;
    await this.prisma.withExplicitTenant(tenantId, async (tx) => {
      for (const row of rows) {
        /*
         * ‎`recordings/get` דורש `recordid`, ולכן הקלטה בלעדיו אינה
         * ניתנת למשיכה. היא עדיין **נספרת**: „הספק החזיר ארבעים
         * הקלטות ואין לנו מזהה הורדה” הוא אבחון, ו„אין הקלטות” הוא
         * מבוי סתום — וזה מה שנראה מהשטח (ביקורת Codex).
         */
        const recordId = row.recordId;
        if (recordId === undefined) {
          withoutRecordId += 1;
          continue;
        }
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
            providerRecordingPath: pbx015RecordingPath({ ...row, recordId }),
            // איפוס החותמת מכניס את השיחה לראש התור בסבב הבא
            providerRecordingAttemptAt: null,
          },
        });
        linked += 1;
      }
    });

    /*
     * שמות השדות עולים למסך ולא רק ליומן. צורת השורה אינה מתועדת,
     * וכל עוד לא ראינו תשובה אמיתית כל בחירת שם היא הימור — הרצת
     * ייבוא אחת אצל המשרד עונה על השאלה. שמות בלבד: הערכים נושאים
     * מספרי טלפון.
     */
    const rowKeys = pbx015ListRowKeys(body);
    this.logger.log(
      `ייבוא הקלטות (${tenantId}): ${rows.length} אצל הספק, ${linked} סומנו למשיכה` +
        (withoutRecordId > 0 ? `, ${withoutRecordId} בלי מזהה הורדה` : ""),
    );
    return { found: rows.length, linked, alreadyHad, withoutCall, withoutRecordId, rowKeys };
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
            /*
             * שיחה שלא נענתה אינה ממתינה לחיבור — היא לא נמשכת
             * ממילא. סימונה „אין חיבור פעיל” היה שולח את המתווכת
             * לתקן הגדרה שאינה שבורה.
             */
            outcome: { not: CALL_OUTCOME_MISSED },
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
           * שיחה שלא נענתה אינה נמשכת — ראו `recordingWorthPulling`.
           * מה שיש בקובץ שלה הוא הודעת הפתיחה של המשרד ואולי צפצוף
           * של תא קולי, ותמלול שלו הוא עלות בלי תשובה.
           *
           * ‎`not` על ערך מפורש ולא רשימת מותרים: `unknown` פירושו
           * שאין בידינו ראיה, וההקלטה היא בדיוק הראיה החסרה. רק
           * ‎„לא נענתה” מפורשת עוצרת.
           */
          outcome: { not: CALL_OUTCOME_MISSED },
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
              /*
               * ‎`gte` ולא `gt`: „יצאה מהחלון” פירושו
               * ‎`now - occurredAt > GIVE_UP`, כלומר `occurredAt` **קטן**
               * מהסף — ולכן שיחה שיושבת בדיוק על הסף עדיין בפנים.
               * ‎`gt` הוציא אותה כאן בעוד המסך הכריז עליה „ננסה שוב”,
               * והבטיח משיכה שלא תקרה (ביקורת Codex).
               */
              occurredAt: { gte: new Date(now - GIVE_UP_AFTER_MS) },
            },
          ],
        },
        select: {
          id: true,
          providerCallId: true,
          providerRecordingPath: true,
          occurredAt: true,
        },
        orderBy: [
          { providerRecordingAttemptAt: { sort: "asc", nulls: "first" } },
          // בין אלה שטרם נוסו — הישנה קודם, כי הזמן שלה אוזל
          { occurredAt: "asc" },
        ],
        take,
      });
      if (calls.length === 0) return [];

      return calls.map((call) => ({
        callId: call.id,
        tenantId,
        occurredAt: call.occurredAt,
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
  private async note(job: RecordingJob, reason: string, detail?: string): Promise<void> {
    await this.prisma
      .withExplicitTenant(job.tenantId, (tx) =>
        tx.call.updateMany({
          where: { id: job.callId, tenantId: job.tenantId, recordingKey: null },
          data: {
            providerRecordingError: reason,
            /*
             * הפירוט נכתב **תמיד**, גם כשהוא ריק: סיבה חדשה בלי
             * פירוט חייבת למחוק את הפירוט של הסיבה הקודמת, אחרת
             * המסך יצרף הסבר על כשל שכבר לא קיים.
             */
            providerRecordingDetail: detail === undefined ? null : detail.slice(0, PROVIDER_DETAIL_MAX),
          },
        }),
      )
      .catch((error: unknown) =>
        this.logger.warn(`רישום סיבת כישלון נכשל (${job.callId}): ${String(error)}`),
      );
  }

  /**
   * סימון שיחה כ„נוסתה” — **ברגע שמתחילים בה, ולא בבחירה.**
   *
   * הסימון היה כתיבה גורפת על כל השורות שנבחרו, לפני הלולאה. זה
   * מנע משתי הרצות מקבילות לתפוס את אותן שורות, אבל יצר מצב שבו
   * שורה שהעצירה דילגה עליה מסומנת כאילו נוסתה — ובגיל שמעבר
   * לחלון הוויתור זה מוציא אותה מהתור **לצמיתות** (ביקורת Codex).
   *
   * ניסיתי קודם להחזיר את הדילוגים למצבם, וגם זה נמצא שביר: כתיבת
   * ההחזרה עצמה יכולה להיכשל, וכשל כזה מחזיר בדיוק את אותה אבידה
   * דרך הדלת האחורית. סימון לכל שיחה בתורה **מסיר את המחלקה
   * כולה**: מה שלא טופל לא סומן, ואין מה לתקן.
   *
   * ‎**מה שנמסר בתמורה:** שתי הרצות בתהליכים נפרדים יכולות לבחור
   * את אותה שורה ולמשוך אותה פעמיים. זו עבודה כפולה ולא נזק —
   * ‎`storeAudio` כותב את אותו קובץ — ומול אובדן קבוע של הקלטה זו
   * עסקה משתלמת בבירור.
   *
   * כשל בכתיבה הזו אינו עוצר את המשיכה: התוצאה היחידה היא שהשיחה
   * תיבחר שוב בסבב הבא, וזה בדיוק מה שרוצים ממנה.
   */
  private async claim(job: RecordingJob): Promise<void> {
    await this.prisma
      .withExplicitTenant(job.tenantId, (tx) =>
        tx.call.updateMany({
          where: { id: job.callId, tenantId: job.tenantId, recordingKey: null },
          data: { providerRecordingAttemptAt: new Date() },
        }),
      )
      .catch((error: unknown) =>
        this.logger.warn(`סימון ניסיון משיכה נכשל (${job.callId}): ${String(error)}`),
      );
  }

  private async fetchOne(job: RecordingJob): Promise<PullResult> {
    await this.claim(job);
    const ids = split015RecordingPath(job.recordingPath);
    if (!ids) {
      this.logger.warn(`נתיב הקלטה בצורה לא מוכרת: ${job.recordingPath}`);
      await this.note(job, RECORDING_ERRORS.path);
      return "other";
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
      return "other";
    }

    /*
     * **בנתיב יש יותר ממספר קבוצה אחד, והראשון אינו בהכרח הנכון.**
     *
     * ‎`54936/12048/2026/08/20/record_…` — הקוד לקח תמיד את הראשון,
     * וההנחה הזו לא נבדקה מול הספק עד שהתקבל „לא נמצא” על הקלטה
     * שקיימת בממשק של 015 (דיווח מהשטח). כשהמספר שגוי התשובה זהה
     * לחלוטין לתשובה על הקלטה שנמחקה — ולכן ניחוש מתוקן היה רק
     * מחליף הנחה בהנחה. שניהם נשלחים, והספק מכריע.
     */
    /*
     * **ההגדרה קודמת לנתיב.**
     *
     * הגזירה מהנתיב הייתה ניחוש מלכתחילה, ובעל הפלטפורמה אישר שהיא
     * שגויה: בנתיב `54936/12048/…` הקבוצה היא השני, ולכל משרד מספר
     * אחר. מה שמוגדר במפורש הוא מה שנשלח; הנתיב נשאר נפילה לאחור
     * למשרד שטרם מילא את השדה, כדי שלא יאבד את מה שכבר עבד.
     */
    const configured = (config["recordGroup"] ?? "").trim();
    const fromPath = pbx015RecordingGroups(job.recordingPath);
    const guesses = fromPath.length > 0 ? fromPath : [ids.recordGroup];
    const groups =
      configured === "" ? guesses : [configured, ...guesses.filter((g) => g !== configured)];

    /*
     * **גם `uniqueid` הוא מועמד, ולא רק הקבוצה.**
     *
     * הקבוצה נבדקה מול הספק בשני ערכיה וקיבלה 404 בשניהם, כלומר היא
     * אינה החשוד. הצורה שאנחנו שולחים — עם הנקודה — היא ההנחה
     * הבאה בתור, והדוגמה בתיעוד היא ספרות בלבד.
     *
     * הסדר: **הקבוצה בחוץ והצורה בפנים.** הקבוצה המוגדרת היא הערך
     * המהימן היחיד כאן, ולכן שתי הצורות נבדקות איתה לפני כל ניחוש
     * מהנתיב — אם הצורה היא הבעיה, הניסיון **השני** פותר אותה.
     *
     * הקינון ההפוך נכתב כאן תחילה, והוא עשה בדיוק את ההפך ממה
     * שהוצהר: `נקודה/מוגדרת, נקודה/ניחוש, ספרות/מוגדרת` — הצורה
     * המתוקנת חיכתה מאחורי ניחוש הנתיב, וכל תשובה שאינה 404 על
     * הניחוש הייתה עוצרת את הלולאה לפניה (ביקורת Codex).
     */
    const uniqueIds = pbx015UniqueIdForms(job.providerCallId);
    const candidates = groups.flatMap((recordGroup) =>
      uniqueIds.map((uniqueId) => ({ uniqueId, recordGroup })),
    );
    let lastRefusal: { code: string; detail: string } | null = null;
    /* מה שנשלח בניסיון האחרון, כדי ששורת הכישלון תתאר את הבקשה שבאמת יצאה */
    let attemptedAuthoritative: { recordGroup: string; recordId: string } | null = null;

    for (const [index, candidate] of candidates.entries()) {
      const attempt = await this.attemptFetch(job, {
        authUsername,
        authPassword,
        recordGroup: candidate.recordGroup,
        uniqueId: candidate.uniqueId,
        recordId: ids.recordId,
      });
      if (attempt.kind === "audio") {
        if (index > 0) {
          /*
           * מה שעבד נרשם ביומן — זו התשובה לשאלה שהחזיקה את המסלול
           * הזה תקוע, והיא שווה שורה. מזהים בלבד, בלי אישורים.
           */
          this.logger.log(
            `הקלטה נמצאה בניסיון ${index + 1}: recordgroup=${candidate.recordGroup} ` +
              `uniqueid=${candidate.uniqueId === job.providerCallId ? "כפי שנשלח" : "ספרות בלבד"}` +
              ` — ${job.callId}`,
          );
        }
        await this.storeAudio(job, attempt.base64, attempt.contentType);
        return "stored";
      }
      if (attempt.kind === "refused") {
        lastRefusal = { code: attempt.code, detail: attempt.detail };
        // „לא נמצא” הוא בדיוק מה שמזהה שגוי מייצר — ננסה את הבא
        if (attempt.code === "404" && index + 1 < candidates.length) continue;
      }
      /*
       * כל שאר המצבים — רשת, גוף שאינו JSON, סירוב שאינו „לא נמצא”
       * — כבר נרשמו בתוך `attemptFetch`, ואין טעם לנסות צירוף אחר.
       */
      if (attempt.kind !== "refused") return "other";
      break;
    }

    /*
     * ‎**המזהה שמעולם לא נבדק — ועכשיו נשאלים עליו במקום לנחש.**
     *
     * הלולאה שלמעלה מנסה מטריצה של `recordgroup` × `uniqueid`, שתי
     * צורות לכל אחד. ‎`recordid` נשלח בכל הניסיונות כערך **קבוע
     * יחיד** — הוא היחיד שלא שונה מעולם, והוא היחיד שאנחנו מחלצים
     * ממחרוזת: „הספרות אחרי הקו התחתון האחרון” בשם הקובץ.
     *
     * ההנחה הזו לא אומתה מול הספק אף פעם, וכל עוד היא שגויה שום
     * צירוף של השניים האחרים לא יעזור — וזה בדיוק מה שנראה בשטח.
     *
     * ‎`recordings/list` מחזיר את המזהה מפי הספק עצמו. הקריאה נעשית
     * **רק אחרי שכל הניסיונות נכשלו**, כלומר בקשה אחת נוספת במקרה
     * שבו ממילא אין הקלטה — ולא עלות על המסלול המוצלח.
     *
     * זה תיקון שאינו תלוי בכך שהניתוח שלי נכון: הוא **מסיר את
     * הניחוש** במקום להחליף אותו בניחוש אחר.
     */
    if (lastRefusal !== null && lastRefusal.code === "404") {
      const authoritative = await this.recordIdFromProvider(job, {
        authUsername,
        authPassword,
        recordGroups: groups,
        uniqueIds,
        derivedRecordId: ids.recordId,
      });
      if (authoritative !== null) {
        /*
         * ‎**האבחון נרשם לפני הניסיון, ולא רק כשהוא מצליח.**
         *
         * כל התוספת הזו קיימת כדי לענות על שאלה אחת: האם המזהה
         * שחילצנו שווה לזה שהספק מכיר. אם השורה נכתבת רק במסלול
         * המוצלח, אז דווקא במקרה שבו המשיכה ממשיכה להיכשל — המקרה
         * שבו התשובה הכי נחוצה — לא נדע דבר (ביקורת Codex).
         */
        this.logger.log(
          `הספק מסר recordid=${authoritative.recordId} בקבוצה ${authoritative.recordGroup}` +
            ` · חילצנו recordid=${ids.recordId} בקבוצה ${ids.recordGroup}` +
            ` · ${authoritative.recordId === ids.recordId ? "זהה" : "**שונה**"}` +
            ` — ${job.callId}`,
        );
        attemptedAuthoritative = authoritative;
        const attempt = await this.attemptFetch(job, {
          authUsername,
          authPassword,
          recordGroup: authoritative.recordGroup,
          uniqueId: authoritative.uniqueId,
          recordId: authoritative.recordId,
        });
        if (attempt.kind === "audio") {
          /*
           * זו התשובה לשאלה שהחזיקה את המסלול תקוע חודש, ולכן היא
           * נרשמת במפורש ולא כהצלחה שקטה: אם המזהה מהספק שונה מזה
           * שחילצנו, הפענוח של שם הקובץ הוא הבאג — ואפשר לתקן אותו
           * במקור במקום להישען על הרשימה בכל משיכה.
           */
          this.logger.log(`הקלטה נמצאה עם המזהה שהספק מסר — ${job.callId}`);
          await this.storeAudio(job, attempt.base64, attempt.contentType);
          return "stored";
        }
        if (attempt.kind === "refused") {
          lastRefusal = { code: attempt.code, detail: attempt.detail };
        } else {
          // „audio” כבר טופל למעלה; מה שנשאר הוא „handled” — נרשם בפנים
          return "other";
        }
      }
    }

    if (lastRefusal !== null) {
      /*
       * הפרמטרים שנשלחו נכנסים לתיאור — **בלי האישורים.**
       *
       * „לא נמצא” על הקלטה שקיימת בממשק הוא שאלה על הבקשה, לא על
       * ההקלטה, ובלי לדעת מה ביקשנו אין דרך להשוות מול הממשק.
       * המזהים האלה הם מספרים פנימיים של המרכזייה — לא מספרי טלפון
       * ולא תוכן שיחה.
       *
       * ‎`uniqueid` נרשם ב**אורך ובצורה** ולא בערך: הוא מזהה שיחה
       * ספציפית, והדיווח הזה עובר בערוצים שאין סיבה שיישאו אותו.
       */
      const forms = uniqueIds
        .map((form) => `${form === job.providerCallId ? "כפי שנשלח" : "ספרות"}(${form.length})`)
        .join("|");
      const asked =
        `נשלח: recordgroup=${groups.join("|")} uniqueid=${forms} recordid=${ids.recordId}` +
        (attemptedAuthoritative === null
          ? ""
          : ` · ואז מהספק: recordgroup=${attemptedAuthoritative.recordGroup}` +
            ` recordid=${attemptedAuthoritative.recordId}`);
      await this.note(
        job,
        `${RECORDING_ERRORS.provider}_${lastRefusal.code}`,
        joinDetail(lastRefusal.detail, asked),
      );
      return "refused";
    }
    return "other";
  }

  /**
   * ‎`recordid` מפי הספק — במקום מחילוץ של שם הקובץ.
   *
   * ## למה רשימה ולא פענוח מתוקן
   *
   * אותו נימוק שכבר נכתב כאן על `recordgroup`: להחליף „הספרות אחרי
   * הקו התחתון האחרון” ב„הספרות שלפניו” זה להחליף הנחה בהנחה.
   * ‎`recordings/list` מחזיר את המזהה שהספק עצמו מכיר, וזו תשובה
   * ולא ניחוש.
   *
   * ## חלון הזמן
   *
   * הרשימה מתבקשת בטווח, ולכן נלקח יום לכל צד סביב מועד השיחה.
   * טווח צר מדי היה מפספס בגלל הפרשי אזור זמן אצל הספק; טווח רחב
   * מדי מחזיר הרבה שורות בלי צורך.
   *
   * ## מה נרשם ומה לא
   *
   * ‎`uniqueid` הוא מזהה שיחה ולכן נרשם בצורה ובאורך בלבד, כמו בכל
   * שאר המסלול הזה. מה שכן נרשם הוא **ספירות**: כמה שורות חזרו
   * וכמה מהן נשאו מזהה — זה מה שמבדיל „הספק לא מכיר את ההקלטה”
   * מ„הספק מכיר אותה ואנחנו שולחים מזהה אחר”.
   */
  private async recordIdFromProvider(
    job: RecordingJob,
    input: {
      authUsername: string;
      authPassword: string;
      recordGroups: string[];
      uniqueIds: string[];
      derivedRecordId: string;
    },
  ): Promise<{ recordGroup: string; uniqueId: string; recordId: string } | null> {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const from = (job.occurredAt.getTime() - DAY_MS) / 1000;
    const to = (job.occurredAt.getTime() + DAY_MS) / 1000;

    for (const recordGroup of input.recordGroups) {
      let rows: Pbx015RecordingRow[];
      try {
        await this.pace();
        const res = await fetch(
          build015RecordingsListUrl({
            authUsername: input.authUsername,
            authPassword: input.authPassword,
            recordGroup,
            fromEpochSeconds: from,
            toEpochSeconds: to,
          }),
          { signal: AbortSignal.timeout(60_000) },
        );
        if (!res.ok) {
          this.logger.warn(`רשימת ההקלטות השיבה ${res.status} (${job.callId})`);
          continue;
        }
        /*
         * ‎`res.text()` ואז `JSON.parse` בתוך `try` — מאותו נימוק
         * שכבר מנומק בייבוא: שגיאת פענוח נושאת קטע מהגוף, והגוף
         * עלול להחזיר את כתובת הבקשה על אישוריה.
         */
        rows = parse015RecordingsList(JSON.parse(await res.text()), recordGroup);
      } catch {
        this.logger.warn(`רשימת ההקלטות לא נקראה (${job.callId})`);
        continue;
      }

      const match = rows.find((row) => input.uniqueIds.includes(row.uniqueId));
      if (match === undefined) {
        this.logger.warn(
          `הספק החזיר ${rows.length} הקלטות בקבוצה ${recordGroup} ואף אחת אינה השיחה הזו — ${job.callId}`,
        );
        continue;
      }
      if (match.recordId === undefined) {
        this.logger.warn(
          `הספק מכיר את השיחה בקבוצה ${recordGroup} אך שורתה בלי מזהה הורדה — ${job.callId}`,
        );
        continue;
      }
      /*
       * ‎**הקבוצה של הספק, לא זו שביקשנו.**
       *
       * ‎`parse015RecordingsList` שומר בכוונה את `recordGroup` שהשורה
       * נושאת, ונופל לזו שביקשנו רק כשהיא חסרה. להחזיר כאן את משתנה
       * הלולאה זה לזרוק בדיוק את המידע שהלכנו לחפש: אם הספק אומר
       * שההקלטה יושבת בקבוצה אחרת, הניסיון החוזר היה חוזר לניחוש
       * שכבר נכשל (ביקורת Codex).
       */
      return {
        recordGroup: match.recordGroup,
        uniqueId: match.uniqueId,
        recordId: match.recordId,
      };
    }
    return null;
  }

  /**
   * פנייה אחת ל-015 — **התוצאה, לא תופעת הלוואי.**
   *
   * הופרדה כדי שאפשר יהיה לנסות יותר ממספר קבוצה אחד: כל מה שאינו
   * „הספק סירב” נרשם כאן ומסיים את המסלול, ו„סירב” חוזר לקורא כדי
   * שיחליט אם יש עוד מה לנסות.
   */
  private async attemptFetch(
    job: RecordingJob,
    input: {
      authUsername: string;
      authPassword: string;
      recordGroup: string;
      /** הצורה שנבדקת בניסיון הזה — עם הנקודה או ספרות בלבד. */
      uniqueId: string;
      recordId: string;
    },
  ): Promise<
    | { kind: "audio"; base64: string; contentType: string }
    | { kind: "refused"; code: string; detail: string }
    | { kind: "handled" }
  > {
    const { authUsername, authPassword } = input;
    const url = build015RecordingUrl({
      authUsername,
      authPassword,
      recordGroup: input.recordGroup,
      uniqueId: input.uniqueId,
      recordId: input.recordId,
    });

    let res: Response;
    try {
      await this.pace();
      res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    } catch (error: unknown) {
      // פסק זמן או תקלת רשת — נרשם כאן ולא נבלע ב-`tick`, כדי
      // שהמסך יבחין בין „לא הצלחנו להגיע” לבין „אין הקלטה”
      this.logger.warn(`פנייה ל-015 נכשלה (${job.callId}): ${String(error)}`);
      await this.note(job, RECORDING_ERRORS.network);
      return { kind: "handled" };
    }
    if (!res.ok) {
      /*
       * ‎**סירוב שמגיע ככשל HTTP הוא סירוב לכל דבר.**
       *
       * כאן נרשם קודם `handled`, ולכן הוא חזר לסבב כ-`other` ואיפס
       * את מונה הסירובים הרצופים. התוצאה: העצירה שנועדה לעצור חנק
       * עבדה רק על סירוב שנעטף ב-HTTP 200, בעוד שחנק אמיתי מגיע
       * דווקא כ-429 או 400 — כלומר המנגנון היה עיוור לצורה הנפוצה
       * ביותר של מה שהוא בא למנוע (ביקורת Codex).
       *
       * הרישום עובר לקורא, שם הוא נכתב יחד עם הפרמטרים ששלחנו.
       */
      this.logger.warn(`015 השיב ${res.status} על הקלטה ${job.recordingPath}`);
      return { kind: "refused", code: String(res.status), detail: `HTTP ${res.status}` };
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
      return { kind: "handled" };
    }

    const parsed = parse015RecordingResponse(payload);
    if (!parsed) {
      /*
       * „לא נקראה” בלי עוד מילה אינו שימושי, וזה היה הכשל של
       * הגרסה הקודמת (דיווח מהשטח).
       *
       * המצב הזה מכסה שני דברים שהתיקון שלהם הפוך: מעטפת שגיאה
       * של הספק — 015 מחזירה 200 גם על אישורים שגויים וגם על
       * הקלטה שנמחקה, ולכן `res.ok` אינו תופס אותה — לעומת שם
       * מפתח שאיננו מכירים, שבו ההקלטה שם ואנחנו מחפשים במקום
       * הלא נכון. בלי לדעת מה חזר אי אפשר להחליט לאן ללכת.
       *
       * התיאור **נבנה מצונזר** ואינו קיצור של הגוף: שמות מפתחות
       * תמיד, ערכים רק לשדות טכניים, כתובות נמחקות והסודות
       * מוחלפים. אותו עיקרון של `TelephonyWebhookHit`.
       */
      const detail = describeProviderResponse(payload, [authUsername, authPassword]);
      /*
       * **הספק ענה, ומה שהוא אמר יושב במעטפת.** 015 מחזירה 200 גם
       * על סיסמה שגויה וגם על הקלטה שנמחקה, והקוד האמיתי נמצא
       * ב-`responses`. „לא נקראה” על מקרה כזה הוא תיאור שגוי ולא
       * רק חסר: התשובה נקראה היטב, היא פשוט אמרה „לא”.
       */
      const status = parse015Status(payload);
      if (status !== null && status.code !== "200") {
        this.logger.warn(`015 סירבה (${status.code}) על הקלטה ${job.recordingPath}`);
        /*
         * הסירוב **חוזר לקורא** ואינו נרשם כאן: „לא נמצא” הוא בדיוק
         * מה שמספר קבוצה שגוי מייצר, והקורא הוא זה שיודע אם נשאר
         * מספר לנסות.
         */
        return { kind: "refused", code: status.code, detail };
      }
      this.logger.warn(`תשובת 015 לא נקראה על הקלטה ${job.recordingPath} — ${detail}`);
      await this.note(job, RECORDING_ERRORS.unreadable, detail);
      return { kind: "handled" };
    }
    return { kind: "audio", base64: parsed.base64, contentType: parsed.contentType };
  }

  /** האודיו שהגיע ⟵ אחסון, שיחה, ותור תמלול. */
  private async storeAudio(
    job: RecordingJob,
    base64: string,
    contentType: string,
  ): Promise<void> {
    const audio = Buffer.from(base64, "base64");
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
    await this.storage.put(key, audio, contentType);

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
