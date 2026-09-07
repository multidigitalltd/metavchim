import { Injectable, Logger } from "@nestjs/common";
import {
  FUNNEL_AUDIENCES,
  FUNNEL_CHANNELS,
  FUNNEL_CLOCKS,
  FUNNEL_TRACKS,
  FUNNEL_OFFSET_DAYS_MAX,
  isFunnelClockAnchored,
  isFunnelOffsetInRange,
  type FunnelAudience,
  type FunnelChannel,
  type FunnelClock,
  type FunnelStageDef,
  type FunnelTrack,
} from "@metavchim/shared";
import { PrismaService } from "../../core/prisma.service";

/**
 * ‎**קריאת הגדרות השלבים — מהמסד, ולא מקבוע בקוד.**
 *
 * ‏זו הנקודה שבה „נערך במסך” מתממש. השורות מגיעות מ-`funnel_stages`,
 * והן הופכות כאן ל-`FunnelStageDef` — הטיפוס שהמנוע המשותף מכיר.
 *
 * ## ‏למה יש כאן ולידציה בכלל
 *
 * ‏עמודות `track`, `clock` ו-`audience` הן טקסט במסד, ולא טיפוס
 * מנייה. שורה שנערכה במסך יכולה לשאת ערך שאינו מוכר — בגלל תקלה,
 * בגלל עריכה ידנית במסד, או בגלל שדרוג שהסיר תנאי שעדיין רשום
 * בשורה ישנה.
 *
 * ‏**שורה כזו נזרקת ולא „מתוקנת”.** תיקון שקט היה משנה למי ההודעה
 * יוצאת בלי שאיש ביקש: תנאי `has_data` שלא זוהה והושמט הופך שלב
 * מכוון-קהל לשלב שיוצא לכולם. ההשמטה נרשמת ביומן כאזהרה, כי
 * שלב שנעלם מהמסלול הוא דבר שצריך לגלות.
 *
 * ‎**אבל „נזרק” אינו „לא היה”.** שלב פסול נעלם גם מחישוב המיצוי,
 * ‏ולכן אחרי שהשלבים התקפים פגו הרישום נסגר כ„מוצה” — ותיקון
 * ‏השורה מאוחר יותר לא מחזיר את הקוהורט (ביקורת Codex, P1). לכן
 * ‎`catalog` מחזיר גם את מפתחות הפסולים, ו-`funnelExitReason`
 * ‏אינו מכריז „מוצה” כל עוד קיימת הגדרה שלא הצלחנו לקרוא.
 */
/**
 * ‏שורת שלב שאינה תקפה — ועם המסלול שלה, כשהוא מזוהה.
 *
 * ‏`track: null` = גם המסלול אינו מוכר, ואז אי אפשר לדעת את מי
 * ‏השורה מייצגת; רק היא חוסמת סגירה בכל המסלולים.
 */
export interface InvalidStage {
  key: string;
  track: FunnelTrack | null;
}

@Injectable()
export class FunnelStageService {
  private readonly logger = new Logger(FunnelStageService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * ‎**כל השלבים — נקראים פעם אחת, ומסוננים בזיכרון.**
   *
   * ‎`funnel_stages` אינה תחת RLS — היא הגדרה של הפלטפורמה ואין בה
   * ‎`tenant_id` — ולכן היא נקראת מהלקוח הגלובלי כמו `platform_settings`.
   *
   * ## ‏למה בלי `where: { track }`
   *
   * ‏הקריאה סוננה במסד לפי המסלול, ו-`all()` קראה לה פעם לכל מסלול
   * ‏**מוכר**. כלומר שורה עם מסלול שגוי — הקלדה, ערך מדור קודם —
   * ‏נחתכה במסד ולא הגיעה ל-`toDef` לעולם, והאזהרה שכתובה שם על
   * ‏„מסלול לא מוכר” הייתה **קוד מת** (ביקורת Codex).
   *
   * ‏והשקט הוא הנזק: השלב נעלם גם מהשליחה וגם מחישוב המיצוי, ולכן
   * ‏אחרי שהשלבים שנשארו פגו הרישום נסגר כ„מוצה” — ותיקון המסלול
   * ‏מאוחר יותר לא יחזיר את הקוהורט. זו בדיוק התקלה ששלב כבוי היה
   * ‏גורם עד לתיקון הקודם, רק בלי שום סימן שקרתה.
   *
   * ‏שאילתה אחת בלי תנאי מחזירה את השורה הפסולה, `toDef` מזהה אותה
   * ‏ומזהיר, והיא נזרקת **בקול**. הטבלה היא הגדרת פלטפורמה בסדר
   * גודל של עשרות שורות, ולכן זו גם קריאה אחת במקום שתיים.
   */
  async catalog(): Promise<{ stages: FunnelStageDef[]; invalid: InvalidStage[] }> {
    const rows = await this.prisma.funnelStage.findMany({
      orderBy: [{ sortOrder: "asc" }, { key: "asc" }],
    });
    const stages: FunnelStageDef[] = [];
    const invalid: InvalidStage[] = [];
    for (const row of rows) {
      const def = this.toDef(row);
      if (def === null) {
        /*
         * ‎**המסלול של השורה הפסולה נשמר איתה** (ביקורת Codex, P2).
         *
         * ‏„יש הגדרה פסולה” נמסר קודם כדגל אחד לכל הרישומים, ולכן
         * ‏שורת גבייה שבורה — למשל בלי ערוצים מוכרים — מנעה סגירה
         * ‏של רישומי **המרה** שמוצו לגמרי. תקלת תצורה אחת נעצה את
         * ‏כל התור, וכל סבב המשיך לסרוק אותו עד שתתוקן.
         *
         * ‎`null` נשמר לשורה שגם המסלול שלה אינו מזוהה: שם באמת אי
         * ‏אפשר לדעת את מי היא מייצגת, ולכן היא חוסמת את כולם.
         */
        invalid.push({
          key: row.key,
          track: isOneOf(FUNNEL_TRACKS, row.track) ? row.track : null,
        });
      } else stages.push(def);
    }
    return { stages, invalid };
  }

  /**
   * ‏השלבים התקפים בלבד.
   *
   * ‏מי שמחשב **מיצוי** צריך גם את הפסולים — ראו `catalog`, ואת
   * ההסבר על „הגדרה חסרה” ב-`funnelExitReason`.
   */
  async all(): Promise<FunnelStageDef[]> {
    return (await this.catalog()).stages;
  }

  /** ‏שלבי מסלול אחד, לפי סדר התצוגה. */
  async forTrack(track: FunnelTrack): Promise<FunnelStageDef[]> {
    return (await this.all()).filter((stage) => stage.track === track);
  }

  /**
   * ‏שורה ⟵ הגדרה, או `null` כשהיא אינה תקפה.
   *
   * ‏השדות הטקסטואליים נבדקים מול אותן רשימות שהמנוע משתמש בהן —
   * ‏ולא מול עותק שלהן — כדי שהוספת תנאי חדש ב-shared לא תדרוש
   * עדכון כאן.
   */
  private toDef(row: {
    key: string;
    track: string;
    clock: string;
    offsetDays: number;
    audience: string[];
    channels: string[];
    enabled: boolean;
  }): FunnelStageDef | null {
    if (!isOneOf(FUNNEL_TRACKS, row.track)) {
      this.logger.warn(`שלב ${row.key}: מסלול לא מוכר (${row.track}) — הושמט`);
      return null;
    }
    if (!isOneOf(FUNNEL_CLOCKS, row.clock)) {
      this.logger.warn(`שלב ${row.key}: שעון לא מוכר (${row.clock}) — הושמט`);
      return null;
    }
    /*
     * ‎**ושני ערכים מוכרים אינם בהכרח צירוף מוכר.**
     *
     * ‏מסלול המרה עם שעון תשלום עובר את שתי הבדיקות שמעל, ואז אין
     * ‏לו עוגן: `funnelStageDueAt` מחזיר `null`, וזה נקרא כ„אי אפשר
     * ‏לעולם” במקום „אין ממה למדוד” — הרישום נסגר כ„מוצה” ותיקון
     * ‏השורה מאוחר יותר לא יחזיר אותו (ביקורת Codex, P1).
     *
     * ‏הכלל יושב ב-shared ליד השעונים עצמם, כי הוא נובע מהעוגנים
     * ‏ולא מהעדפה — ושם גם עורך השלבים בשלב ב׳ ימצא אותו.
     */
    if (!isFunnelClockAnchored(row.track, row.clock)) {
      this.logger.warn(
        `שלב ${row.key}: שעון ${row.clock} אינו מעוגן במסלול ${row.track} — השלב הושמט`,
      );
      return null;
    }
    /*
     * ‎**וגם ההיסט — ערך חוקי במסד אינו בהכרח תאריך שאפשר לחשב.**
     *
     * ‏`offset_days` הוא `INTEGER`, ולכן `2147483647` עובר את המסד.
     * ‏`funnelStageDueAt` מוסיף אותו לעוגן ומקבל `Invalid Date`,
     * ‏וזה נכנס לחישוב התפוגה ולעזרי שעון ירושלים ו**זורק** —
     * ‏כלומר שורת תצורה אחת מפילה את כל הסבב, לכל המשרדים. שלב
     * ‏פגום אמור להיות חסם מיצוי שנרשם, לא קריסה (ביקורת Codex, P2).
     */
    if (!isFunnelOffsetInRange(row.offsetDays)) {
      this.logger.warn(
        `שלב ${row.key}: היסט ${row.offsetDays} מחוץ לטווח (±${FUNNEL_OFFSET_DAYS_MAX}) — השלב הושמט`,
      );
      return null;
    }
    /*
     * ‎**תנאי שאינו מוכר פוסל את השלב, ולא מושמט ממנו.**
     *
     * ‏השמטה הייתה מרחיבה את הקהל בשקט: שלב שנועד למי שכבר הזין
     * נתונים היה יוצא לכולם, כולל למשרד ריק שההודעה מצביעה אצלו
     * על כלום.
     */
    const audience: FunnelAudience[] = [];
    for (const value of row.audience) {
      if (!isOneOf(FUNNEL_AUDIENCES, value)) {
        this.logger.warn(`שלב ${row.key}: תנאי לא מוכר (${value}) — השלב הושמט`);
        return null;
      }
      audience.push(value);
    }
    /*
     * ‏ערוץ לא מוכר **בודד** מושמט: הוא מצמצם ולא מרחיב, והתוצאה
     * הגרועה ביותר היא הודעה שיוצאת בערוץ אחד במקום בשניים. שלב
     * שנפסל בגלל זה היה שקט יותר וגרוע יותר.
     */
    const channels: FunnelChannel[] = [];
    for (const value of row.channels) {
      if (!isOneOf(FUNNEL_CHANNELS, value)) {
        this.logger.warn(`שלב ${row.key}: ערוץ לא מוכר (${value}) — הערוץ הושמט`);
        continue;
      }
      channels.push(value);
    }
    /*
     * ‎**אבל אפס ערוצים אינם „ערוץ אחד במקום שניים”.**
     *
     * ‏הנימוק שלמעלה מניח שנשאר במה לשלוח. רשימה ריקה — בין שהיא
     * ‏ברירת המחדל של העמודה ובין שכל הערכים בה לא זוהו — היא שלב
     * ‏**מופעל שאי אפשר לשלוח**, ו-`nextFunnelStage` אינו בודק
     * ‏ערוצים: הוא היה בוחר אותו שוב ושוב, וחוסם את השלבים שאחריו
     * ‏עד שיפוג. לכן דינו כדין תנאי קהל לא מוכר — מושמט, ובקול.
     */
    if (channels.length === 0) {
      this.logger.warn(`שלב ${row.key}: לא נותר ערוץ שליחה מוכר — השלב הושמט`);
      return null;
    }

    return {
      key: row.key,
      track: row.track satisfies FunnelTrack,
      clock: row.clock satisfies FunnelClock,
      offsetDays: row.offsetDays,
      audience,
      channels,
      enabled: row.enabled,
    };
  }
}

/** ‏שייכות לרשימה סגורה, בלי לוותר על הטיפוס. */
function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}
