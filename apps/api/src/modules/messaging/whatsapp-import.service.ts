import { Injectable, Logger } from "@nestjs/common";
import { inflateRawSync } from "node:zlib";
import {
  decodeImportBytes,
  IMPORT_KIND_CAPABILITY,
  IMPORT_KIND_LABELS,
  importDoneText,
  parseBuyersCsv,
  parseLeadsCsv,
  parseRecruitmentCsv,
  sheetFormat,
  UNSUPPORTED_SHEET_TEXT,
  xlsxToCsv,
  type WhatsappImportKind,
} from "@metavchim/shared";
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
  ) {}

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
  ): Promise<{ rows: Record<string, unknown>[]; unmapped: string[] } | { error: string }> {
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
       * ‎**אותה תקרה של הנתיב** (`ImportEnvelopeSchema`, 500).
       * ‏קובץ גדול יותר נחתך ולא נדחה: 600 שורות שנכנסות בלי 100
       * ‏עדיפות על „הקובץ גדול מדי” שמשאיר את כולן בחוץ — וזה
       * ‏נאמר בתצוגה המקדימה לפני האישור.
       */
      rows: parsed.rows.slice(0, 500) as unknown as Record<string, unknown>[],
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
    const capability = IMPORT_KIND_CAPABILITY[kind];
    if (!context.capabilities.has(capability)) {
      return {
        text: `אין לכם הרשאה לייבא ${IMPORT_KIND_LABELS[kind]} — מנהל המשרד יכול לתת אותה בהגדרות הצוות.`,
      };
    }
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
