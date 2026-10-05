import { Injectable, Logger } from "@nestjs/common";
import { inflateRawSync } from "node:zlib";
import {
  decodeImportBytes,
  IMPORT_FEATURE,
  IMPORT_KIND_CAPABILITY,
  IMPORT_KIND_LABELS,
  IMPORT_ROW_LIMIT,
  importDoneText,
  parseBuyersCsv,
  parseLeadsCsv,
  parseRecruitmentCsv,
  sheetFormat,
  UNSUPPORTED_SHEET_TEXT,
  xlsxToCsv,
  type WhatsappImportKind,
} from "@metavchim/shared";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { TenantContext } from "../../common/tenant-context";
import type { RequestContext } from "../../common/tenant-context";
import { ImportWriteService, type ImportResult } from "../import/import-write.service";
import { WhatsAppSendService } from "./whatsapp-send.service";

/**
 * ‎**קובץ שנשלח בצ'אט — קריאה, ואז כתיבה דרך אותו מסלול של המסך.**
 *
 * ## ‏מה כאן ומה לא
 *
 * ‏כאן: הורדה, פענוח הקובץ לשורות, וספירה. הכתיבה עצמה היא
 * ‎`ImportWriteService` — **אותו שירות שהבקר מפעיל**. זו כל הסיבה
 * ‏שהוא חולץ מהבקר: מסלול כתיבה שני היה מדלג על איחוד לידים לפי
 * ‏טלפון, על `typedBy: "agent"`, ועל הורדת שדה פסול במקום השורה.
 *
 * ## ‏היכולת נבדקת **כאן**, ולא בשער של הבקר
 *
 * ‎`@RequireCapability` יושב על הנתיב, והסוכן אינו עובר בנתיבים.
 * ‏בלי הבדיקה הזו כל מי שיש לו את הסוכן בוואטסאפ היה יכול לייבא
 * ‏מאה קונים — גם סוכן שאין לו הרשאת עריכה. הערך נקרא מהקטלוג
 * ‏המשותף, כלומר מאותו מקום שהבקר מוגדר בו.
 *
 * ## ‏והפענוח רץ בשרת, לא בדפדפן
 *
 * ‏במסך, ה-xlsx מפוענח בצד הלקוח (`DecompressionStream`). כאן אין
 * ‏דפדפן, ולכן ה-inflate מוזרק מ-`node:zlib` — בדיוק הנקודה שבשבילה
 * ‎`xlsx-import.ts` מקבל את הפריסה כפרמטר.
 */
@Injectable()
export class WhatsappImportService {
  private readonly logger = new Logger(WhatsappImportService.name);

  constructor(
    private readonly sender: WhatsAppSendService,
    private readonly write: ImportWriteService,
    private readonly plans: PlanCatalogService,
  ) {}

  /**
   * ‎**מה חוסם ייבוא — היכולת של המשתמש והפיצ'ר של המסלול.**
   *
   * ‏שני כללים, מקום אחד. הבקר נושא את שניהם על הנתיב
   * ‎(`@RequireCapability` פר-נתיב, `@RequireFeature("data_io")`
   * ‏על המחלקה), והסוכן אינו עובר בבקרים — כלומר בלי השער הזה
   * ‏נשארו שתי דלתות פתוחות: סוכן בלי הרשאת עריכה, ומשרד במסלול
   * ‏שאינו כולל ייבוא בכלל. השני נמצא בביקורת Codex: המסלול
   * ‏הבסיסי כולל `voice_intake` ולא `data_io`, ולכן משרד שקנה
   * ‏וואטסאפ בלבד היה מייבא דרך הצ'אט מה שהמסך חוסם לו.
   *
   * ‎`null` = פתוח; מחרוזת = המשפט שנאמר למתווך.
   */
  async blockedReason(
    context: RequestContext,
    kind: WhatsappImportKind,
  ): Promise<string | null> {
    /*
     * ‎`context.capabilities` ולא רשומת המשתמש: זה **אותו** מקור
     * ‏שהבקרים נבדקים מולו, ולכן הרשאה שנשללה משפיעה מיד.
     */
    if (!context.capabilities.has(IMPORT_KIND_CAPABILITY[kind])) {
      return `אין לכם הרשאה לייבא ${IMPORT_KIND_LABELS[kind]} — מנהל המשרד יכול לתת אותה בהגדרות הצוות.`;
    }
    if (!(await this.plans.tenantHasFeature(context.tenantId, IMPORT_FEATURE))) {
      return "ייבוא וייצוא נתונים אינם כלולים במסלול של המשרד — אפשר לשדרג במסך החיוב.";
    }
    return null;
  }

  /**
   * ‏קריאת הקובץ לשורות — בלי לכתוב דבר.
   *
   * ‎`null` בשדה `rows` אינו קורה: כישלון חוזר כ-`error` עם משפט
   * ‏מוכן, כי „משהו השתבש” על קובץ שמתווך שלח הוא הרגע שבו הוא
   * ‏מפסיק לנסות.
   */
  async read(
    mediaId: string,
    fileName: string,
    fileMime: string,
    kind: WhatsappImportKind,
  ): Promise<
    { rows: Record<string, unknown>[]; total: number; unmapped: string[] } | { error: string }
  > {
    const format = sheetFormat(fileMime, fileName);
    if (format === "unsupported") return { error: UNSUPPORTED_SHEET_TEXT };

    const media = await this.sender.downloadMedia(mediaId);
    if (media === null) return { error: "לא הצלחתי להוריד את הקובץ — נסו לשלוח אותו שוב." };

    let csv: string;
    try {
      csv =
        format === "xlsx"
          ? await xlsxToCsv(new Uint8Array(media.buffer), async (data) => inflateRawSync(data))
          : /*
             * ‎**לא `toString("utf8")`.** הייצוא של webtiv הוא
             * ‏Windows-1255 מופרד בטאבים עם סיומת ‎.csv‎, וקריאה
             * ‏כ-UTF-8 מחזירה סימני שאלה במקום כל אות עברית.
             * ‏אותו מפענח בדיוק שהמסך משתמש בו.
             */
            decodeImportBytes(new Uint8Array(media.buffer)).text;
    } catch (error) {
      this.logger.warn(`קריאת קובץ ייבוא נכשלה: ${String(error)}`);
      return { error: "לא הצלחתי לקרוא את הקובץ — ודאו שהוא ‎.xlsx‎ או ‎.csv‎ תקין." };
    }

    const parsed =
      kind === "buyers"
        ? parseBuyersCsv(csv)
        : kind === "leads"
          ? parseLeadsCsv(csv)
          : parseRecruitmentCsv(csv);
    return {
      /*
       * ‎**אותה תקרה של הנתיב** — `IMPORT_ROW_LIMIT`, שממנו נבנית
       * ‏גם מעטפת ה-zod של הנתיב. קובץ גדול יותר נחתך ולא נדחה:
       * ‏500 שורות שנכנסות עדיפות על „הקובץ גדול מדי” שמשאיר את
       * ‏כולן בחוץ.
       */
      rows: parsed.rows.slice(0, IMPORT_ROW_LIMIT) as unknown as Record<string, unknown>[],
      /*
       * ‎**כמה היו, ולא כמה נשארו.** בלי המספר הזה קובץ של 900
       * ‏שורות הציג „קראתי 500 שורות”, המתווך אישר ייבוא שנראה
       * ‏שלם, ו-400 לקוחות לא נכנסו בלי שאיש ידע (ביקורת Codex).
       */
      total: parsed.rows.length,
      unmapped: parsed.unmappedHeaders,
    };
  }

  /**
   * ‏הכתיבה — אחרי שהמתווך אישר.
   *
   * ‏רצה בתוך `TenantContext` ובודקת את היכולת לפני כל שורה: ראו
   * ‏ההסבר על השער למעלה.
   */
  async write_(
    context: RequestContext,
    kind: WhatsappImportKind,
    rows: Record<string, unknown>[],
  ): Promise<{ text: string }> {
    const blocked = await this.blockedReason(context, kind);
    if (blocked !== null) return { text: blocked };
    let result: ImportResult;
    try {
      result = await TenantContext.run(context, () =>
        kind === "buyers"
          ? this.write.buyerRows(rows)
          : kind === "leads"
            ? this.write.leadRows(rows)
            : this.write.recruitmentRows(rows),
      );
    } catch (error) {
      this.logger.error(`ייבוא מהוואטסאפ נכשל: ${String(error)}`);
      return { text: "הייבוא נכשל באמצע — בדקו במסך מה נכנס לפני שתשלחו שוב." };
    }
    return { text: importDoneText(kind, result) };
  }
}
