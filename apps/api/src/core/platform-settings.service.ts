import { Injectable, Logger } from "@nestjs/common";
import { CryptoService } from "./crypto.service";
import { PrismaService } from "./prisma.service";

/**
 * הגדרות הפלטפורמה (מפתחות ספקים) — נשלטות ממסך /platform במקום
 * משתני סביבה + SSH. הערכים מוצפנים ב-DB, ומשתני הסביבה נשארים
 * כ-Fallback (סביבה שהוגדרה כבר בשרת ממשיכה לעבוד ללא שינוי).
 *
 * קאש קצר בזיכרון: הגדרות נקראות בכל שליחת מייל/וובהוק, ואין טעם
 * בשאילתה+פענוח בכל פעם. עדכון מהמסך מנקה את הקאש מיידית.
 */

export type PlatformSettingKey =
  | "postmarkServerToken"
  /**
   * טוקן ה-Account של Postmark — נפרד מטוקן השרת ובעל הרשאות
   * רחבות ממנו: הוא מנהל **דומיינים** (יצירה, אימות DKIM
   * ו-Return-Path, מחיקה) עבור הדומיינים שהמשרדים מחברים.
   * בלעדיו חיבור דומיין של משרד פשוט אינו זמין; השליחה הרגילה
   * ממשיכה לעבוד עם טוקן השרת בלבד.
   */
  | "postmarkAccountToken"
  | "emailFrom"
  /**
   * תיבת הדואר הפנימית: כתובת ה-Inbound של שרת Postmark, והסוד
   * שבנתיב ה-Webhook. שניהם ריקים = מיילים יוצאים בלי Reply-To
   * ייחודי ותשובות אינן נקלטות — והכל השאר ממשיך לעבוד.
   */
  | "emailInboundAddress"
  | "emailInboundSecret"
  /**
   * תיבת התמיכה של הפלטפורמה — כתובת ה-Inbound שלה והסוד שבנתיב.
   * שרת נפרד אצל הספק: פניות תמיכה ותשובות של לקוחות למשרדים הם
   * שני זרמים עם כללי זיהוי שונים.
   */
  | "supportInboundAddress"
  | "supportInboundSecret"
  /**
   * ה-Server Token של אותו שרת תמיכה — התשובות יוצאות דרכו ולא
   * דרך השרת של המשרדים. ריק = נשלח בטוקן הכללי; זה עדיין יוצא
   * **מכתובת התמיכה**, רק דרך אותו שרת.
   */
  | "supportServerToken"
  | "whatsappAppSecret"
  | "whatsappVerifyToken"
  /**
   * חיבור המספר של כל משרד דרך Embedded Signup (docs/12, ADR-006).
   *
   * ‎`whatsappAppId` הוא מזהה האפליקציה של הפלטפורמה — **ציבורי
   * מעצם טיבו**, הוא נשלח לדפדפן כדי לפתוח את פופאפ החיבור, וההצפנה
   * באחסון היא של המנגנון ואינה מעידה על סודיות (כמו `mapboxToken`).
   * ‎`whatsappSignupConfigId` הוא מזהה הקונפיגורציה של Facebook Login
   * for Business, המוגדרת פעם אחת אצל Meta. חסרים = כפתור החיבור
   * מוסתר, במקום להיכשל בלחיצה.
   */
  | "whatsappAppId"
  | "whatsappSignupConfigId"
  /**
   * הסוכן האישי בוואטסאפ — האסימון והמספר שדרכם הוא עונה.
   *
   * ה-Access Token הוא של System User קבוע (לא הטוקן הזמני ממסך
   * הפיתוח, שפג אחרי 24 שעות); ה-Phone Number ID הוא המזהה המספרי
   * שמופיע תחת המספר במסך WhatsApp → API Setup. המזהה משמש גם
   * בקליטה — הודעה שמגיעה אליו מנותבת לסוכן ולא לקליטת לידים.
   */
  | "whatsappAccessToken"
  | "whatsappPhoneNumberId"
  /**
   * המענה למספר לא רשום שכתב לסוכן — נוסח שיווקי הניתן לעריכה מהמסך.
   * ריק = הנוסח שבקוד (`prospect-reply.ts`), לא שתיקה.
   */
  | "whatsappProspectReply"
  /**
   * שם תבנית ההתראה המאושרת ב-Meta, ושפתה.
   *
   * Meta מתירה הודעה יזומה בטקסט חופשי רק בתוך 24 שעות מההודעה
   * האחרונה של המתווך. מחוץ לחלון — למשל התראה על שיחה שלא נענתה
   * בשש בבוקר — נדרשת תבנית מאושרת מראש עם שני פרמטרים (כותרת
   * ופירוט). ריק = דוחפים רק בתוך החלון, וזו התנהגות תקינה ולא
   * תקלה: המערכת אינה שולחת דבר שייפסל.
   */
  | "whatsappNotifyTemplate"
  | "whatsappNotifyTemplateLang"
  /**
   * ‎**האם התבנית שנרשמה כוללת כפתור „פתח במערכת” בכתובת דינמית.**
   *
   * ‏Meta מקפידה משני הצדדים: תבנית בלי כפתור שנשלח אליה רכיב כפתור
   * נדחית, ותבנית **עם** כפתור שלא קיבלה את ערכו נדחית גם היא.
   * לקוד אין דרך לדעת מה נרשם, ולכן זו הגדרה ולא ניחוש — ואי-התאמה
   * מתוקנת מהמסך, בלי גרסה חדשה.
   *
   * ברירת המחדל היא **בלי** כפתור: זה מה שנכון לתבנית שנרשמה לפני
   * שהאפשרות הזו הייתה קיימת.
   */
  | "whatsappNotifyTemplateButton"
  /**
   * תבנית ההזמנה למילוי טופס הדרישות, ושפתה.
   *
   * **תבנית נפרדת מ-`whatsappNotifyTemplate` בכוונה.** ההתראות
   * נשלחות למתווך, וזו נשלחת ל**לקוח** שהתקשר ולא נענה — נוסח,
   * קהל ומספר פרמטרים שונים (כאן אחד: הקישור). שימוש חוזר באותה
   * תבנית היה שולח ללקוח טקסט שנכתב לסוכן.
   *
   * ריק = לא נשלח דבר אוטומטית, ובמקום זה נפתחת משימה עם ההודעה
   * מוכנה. זו התנהגות תקינה ולא תקלה: מחוץ לחלון 24 השעות Meta
   * דוחה טקסט חופשי, והמערכת אינה שולחת דבר שייפסל.
   */
  | "whatsappIntakeTemplate"
  | "whatsappIntakeTemplateLang"
  /** כמו `whatsappNotifyTemplateButton`, לתבנית טופס הדרישות. */
  | "whatsappIntakeTemplateButton"
  /**
   * תבנית התזכורת שלפני סיור, ושפתה.
   *
   * ‎**תבנית שלישית ולא שימוש חוזר**, מאותו נימוק כמו הקודמות:
   * הנמען כאן הוא מוכר או קונה שקבוע לו סיור, הנוסח שונה, ומספר
   * הפרמטרים שונה — פרמטר אחד, הודעת התזכורת המלאה שהמשרד ניסח.
   *
   * ריק = התזכורת יוצאת במייל בלבד, ומי שאין לו מייל מגיע כמשימה
   * לסוכן. זו התנהגות תקינה ולא תקלה: Meta דוחה טקסט חופשי מחוץ
   * לחלון 24 השעות, והמערכת אינה שולחת דבר שייפסל.
   */
  | "whatsappViewingReminderTemplate"
  | "whatsappViewingReminderTemplateLang"
  /**
   * ‎**האם התבנית שנרשמה נושאת חמישה שדות, או נוסח אחד.**
   *
   * ריק/לא מסומן = נוסח אחד (`reminder_text`) — החוזה שלפיו נרשמו
   * התבניות הקיימות. שליחת חמישה שמות אחרים לתבנית כזו נדחית אצל
   * Meta, ובערוץ „שניהם” המייל מצליח ולכן לא נפתחת גם משימה: התזכורת
   * בוואטסאפ מפסיקה לצאת בשקט. ולכן זו הגדרה, וברירת המחדל היא הישן.
   */
  | "whatsappViewingReminderTemplateFields"
  /**
   * ‎**האם התבנית נרשמה עם שני כפתורי „תשובה מהירה”.**
   *
   * ‏מסומן = נשלחים רכיבי כפתור עם מטען לכל סיור, והלקוח יכול
   * לאשר או לבקש מועד אחר בלחיצה. תבנית שנרשמה בלי כפתורים
   * ומקבלת רכיבים כאלה נדחית אצל Meta — ולכן זו הגדרה מפורשת
   * וברירת המחדל היא בלי, כמו שאר כפתורי התבניות.
   *
   * ‎**הסדר אצל Meta הוא חלק מהחוזה**: ראשון אישור, שני שינוי
   * מועד. המטען נשלח לפי אינדקס, ולכן רישום בסדר הפוך מחזיר
   * „אישר” על לחיצה ב„צריך לשנות” — היפוך שקט שאין דרך לאמת
   * מכאן. ראו `VIEWING_REMINDER_REPLY_ORDER`.
   */
  | "whatsappViewingReminderTemplateButtons"
  /**
   * התראת "לקוח ענה במייל" לסוכן בוואטסאפ, מחוץ לחלון 24 השעות:
   * טקסט חופשי נדחה שם, ורק תבנית מאושרת עוברת. ריק = ההתראה
   * במערכת ובדחיפה בלבד — התנהגות תקינה, לא תקלה.
   */
  | "whatsappEmailReplyTemplate"
  | "whatsappEmailReplyTemplateLang"
  | "loginOtpEnabled"
  | "googleClientId"
  | "googleClientSecret"
  | "geminiApiKey"
  | "geminiModel"
  | "cardcomTerminalNumber"
  | "cardcomApiName"
  | "cardcomApiPassword"
  /**
   * לינט — הפקת חשבוניות מס קבלה על כל תשלום שנגבה.
   *
   * ההזדהות היא **שלישייה** ולא צמד: מזהה API, מפתח, ומזהה החברה
   * בתוך החשבון. שלושתם נוסעים בגוף כל בקשה (אין כותרת Authorization).
   *
   * הקודים שאחריהם הם של החשבון בלינט ולא של הפרוטוקול — סוג המסמך,
   * קטגוריית המע"מ ואמצעי התשלום נראים אחרת בכל חשבון, ולכן הם
   * הגדרה ולא קבוע בקוד. בלעדיהם לא מופק דבר, והמסך אומר מה חסר.
   */
  | "linetLoginId"
  | "linetKey"
  | "linetCompanyId"
  /** ברירת מחדל: https://app.linet.org.il/api */
  | "linetBaseUrl"
  | "linetDocType"
  | "linetVatCatTaxable"
  | "linetPaymentType"
  /** הפריט שעליו נרשמת שורת המסמך; ברירת מחדל "1". */
  | "linetItemId"
  /**
   * שיעור המע"מ באחוזים. הגדרה ולא קבוע — שיעור שמשתנה בחקיקה
   * אינו אמור לדרוש פריסה, ומסמכים ישנים שומרים את השיעור שהיה
   * נכון בזמנם.
   */
  | "vatPercent"
  /**
   * אחוז העמלה שהפלטפורמה גובה ממכירת הפניה בין משרדים.
   *
   * מספר עסקי ולא סוד ספק — הוא **מוצג** במסך הפלטפורמה ולשני צדדי
   * העסקה, בניגוד לשאר המפתחות כאן. ההצפנה באחסון היא של המנגנון
   * ואינה מעידה על סודיות.
   */
  | "referralFeePercent"
  /**
   * טוקן ציבורי (pk.*) לאריחי המפה.
   *
   * ציבורי מעצם טיבו — הוא נשלח לדפדפן כדי לצייר אריחים, וזה מה
   * שהספק מייעד אותו לו. הוא יושב כאן ולא בבנייה של המסך כדי שאפשר
   * יהיה להחליף ספק בלי בנייה מחדש.
   */
  /*
   * כלכלת הקרדיטים — **כל מספר כאן נועד להשתנות בלי פריסה.**
   *
   * תמחור של רשת דו-צדדית מתכייל תוך כדי תנועה, ומספר שקבוע בקוד הופך
   * כל שינוי מסחרי לגרסה חדשה. ברירות המחדל יושבות ב-`credit-economy`
   * המשותף ומשמשות רשת ביטחון בלבד.
   */
  | "creditUnitPriceAgorot"
  /** חבילות למכירה, JSON: [{credits, priceAgorot}] */
  | "creditPackages"
  /** תוספת למי שבוחר תמורה בקרדיטים במקום בכסף. */
  | "creditBonusPercent"
  /** עמלת הפלטפורמה כשהמוכר בחר כסף — מחיר הנזילות. */
  | "creditFeeCashPercent"
  /** סף משיכה מינימלי באגורות. */
  | "creditPayoutMinimumAgorot"
  /** תוקף קרדיט בחודשים; 0 = ללא תפוגה. */
  | "creditExpiryMonths"
  /** מענק פתיחה למשרד חדש. */
  | "creditInitialGrant"
  /*
   * המסמכים המשפטיים — פרטי המפעילה ונוסחי שני המסמכים.
   *
   * **אלה אינם סודות** אלא ההפך הגמור: הם מוצגים בעמודים ציבוריים,
   * ללא התחברות, לכל מי שנכנס. הם יושבים כאן משום שזה המקום שבו
   * בעלת הפלטפורמה משנה דברים בלי פריסה — וטקסט משפטי הוא בדיוק
   * מה שמשתנה אחרי בדיקה של עורך/ת דין, לא בגרסה הבאה של הקוד.
   * ההצפנה באחסון היא של המנגנון ואינה מעידה על סודיות, כמו
   * ב-`referralFeePercent`.
   *
   * ריק בכל מפתח = נוסח ברירת המחדל שבקוד. כך העמודים עובדים
   * במלואם ביום הראשון, לפני שמישהו נגע בהם.
   */
  | "legalOperator"
  | "legalCompanyId"
  | "legalAddress"
  | "legalPrivacyEmail"
  | "legalAccessibilityEmail"
  | "legalUpdatedAt"
  /** נוסח מלא שדורס את תנאי השימוש שבקוד. Markdown מצומצם. */
  | "legalTermsText"
  /** נוסח מלא שדורס את מדיניות הפרטיות שבקוד. Markdown מצומצם. */
  | "legalPrivacyText"
  | "mapboxToken"
  /**
   * כתובת סגנון האריחים — מה שמצייר את המפה בפועל.
   *
   * **חייב להיות סגנון שהספרייה יודעת לקרוא.** MapLibre אינה תומכת
   * בפרוטוקול `mapbox://`, וסגנון של Mapbox מפנה אליו פנימית לספרייט,
   * לגופנים ולמקורות — ולכן הוא נטען אך אינו מצייר דבר, וזו הייתה
   * בדיוק התקלה: פענוח כתובות עבד (REST רגיל) והמפה נשארה ריקה.
   * מעבר לכך, שימוש באריחי Mapbox מחוץ ל-SDK שלהם נוגד את תנאיהם.
   *
   * ברירת המחדל היא סגנון פתוח שאינו דורש מפתח, כדי שמפה תעבוד מיד
   * ובלי חשבון אצל אף ספק.
   */
  | "mapStyleUrl"
  /**
   * ספק פענוח הכתובות: none | govmap | mapbox.
   *
   * ברירת המחדל `none` אינה עצלות אלא החלטה: פנייה לשירות חיצוני עם
   * כתובות של לקוחות מתחילה כשמישהו בוחר בכך, לא כשמישהו שוכח לכבות.
   */
  | "geocodingProvider"
  /**
   * כתובת שאליה נשלחת התראה על פנייה חדשה לתמיכה.
   *
   * ריק = בלי התראה. הפנייה עצמה תמיד נשמרת ומופיעה בתור שבמסך
   * הפלטפורמה, ולכן הגדרה חסרה מעכבת מענה ואינה מאבדת פנייה.
   */
  | "supportEmail"
  /**
   * ‎**קוד המסלול שאליו חשבון שלא הופעל יורד — „מסלול השותפים”.**
   *
   * הגדרה ולא קבוע בקוד: השם והתוכן של המסלול הזה נקבעים בקטלוג
   * המסלולים, ותזכורת שכותבת שם קבוע מבטיחה ללקוח משהו שאולי נקרא
   * אחרת. ריק = התזכורת אומרת „החשבון ננעל” בלי להמציא מסלול.
   */
  | "partnerPlanCode"
  /*
   * השכרת מספרים וירטואליים — חשבון 015 **של הפלטפורמה**.
   *
   * נפרד לחלוטין מאישורי המרכזייה שכל משרד מגדיר לעצמו: כאן זה
   * החשבון שממנו הפלטפורמה קונה מספרים ומשכירה אותם למשרדים.
   * בלי שלושת הראשונים ההשכרה כבויה; המחיר הוא מספר עסקי שמוצג
   * במסך, כמו `referralFeePercent`.
   */
  | "pbx015AuthUsername"
  | "pbx015AuthPassword"
  /** קבוצת הנכנסות שממנה נשלפים המספרים הפנויים (`ingroup`). */
  | "pbx015Ingroup"
  /** מחיר ההשכרה החודשי באגורות. חלק מחודש מחויב כחודש מלא. */
  | "virtualNumberMonthlyAgorot";

const CACHE_TTL_MS = 30_000;

@Injectable()
export class PlatformSettingsService {
  private readonly logger = new Logger(PlatformSettingsService.name);
  private cache = new Map<string, string | null>();
  private cacheLoadedAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  private async load(): Promise<void> {
    if (Date.now() - this.cacheLoadedAt < CACHE_TTL_MS) return;
    try {
      const rows = await this.prisma.platformSetting.findMany();
      const next = new Map<string, string | null>();
      for (const row of rows) {
        try {
          next.set(row.key, this.crypto.decrypt(row.valueEncrypted));
        } catch {
          // ערך שנשמר עם מפתח הצפנה אחר — מדולג, ה-Fallback לסביבה יתפוס
          this.logger.warn(`פענוח ההגדרה ${row.key} נכשל — מדולגת`);
        }
      }
      this.cache = next;
      this.cacheLoadedAt = Date.now();
    } catch (error) {
      this.logger.warn(`טעינת הגדרות הפלטפורמה נכשלה: ${String(error)}`);
    }
  }

  /**
   * ערך ההגדרה מה-DB, או undefined אם לא הוגדרה שם.
   *
   * ‎trim‎ גם בקריאה: כל הערכים כאן הם מזהים וסודות של ספקים, ורווח
   * שנגרר בהדבקה ונשמר בעבר היה נשלח כמו שהוא — Google מחזיר על זה
   * ‎invalid_client‎ ושובר את ההתחברות. הניקוי בקריאה מתקן גם ערכים
   * מלוכלכים שכבר שמורים, בלי לחכות לשמירה מחדש.
   */
  async get(key: PlatformSettingKey): Promise<string | undefined> {
    await this.load();
    return this.cache.get(key)?.trim() ?? undefined;
  }

  async set(key: PlatformSettingKey, value: string, updatedBy: string): Promise<void> {
    const valueEncrypted = this.crypto.encrypt(value);
    await this.prisma.platformSetting.upsert({
      where: { key },
      create: { key, valueEncrypted, updatedBy },
      update: { valueEncrypted, updatedBy },
    });
    this.cacheLoadedAt = 0; // הקריאה הבאה תטען מחדש
  }

  async remove(key: PlatformSettingKey): Promise<void> {
    await this.prisma.platformSetting.deleteMany({ where: { key } });
    this.cacheLoadedAt = 0;
  }

  /** אילו מפתחות מוגדרים ב-DB — לתצוגת סטטוס בלי לחשוף את הערכים. */
  async configuredKeys(): Promise<PlatformSettingKey[]> {
    await this.load();
    return [...this.cache.keys()].filter((k) => (this.cache.get(k) ?? "") !== "") as PlatformSettingKey[];
  }
}
