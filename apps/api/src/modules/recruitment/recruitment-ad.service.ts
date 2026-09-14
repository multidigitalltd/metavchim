import { Injectable, Logger } from "@nestjs/common";
import {
  AD_UNREADABLE_TEXT,
  buildRecruitmentAdPrompt,
  parseRecruitmentAd,
  recruitmentAddress,
  recruitmentAdSummary,
  RECRUITMENT_AD_SCHEMA,
  type RecruitmentAdRead,
} from "@metavchim/shared";
import { GeminiService } from "../../core/gemini.service";
import { RecruitmentService } from "./recruitment.service";
import type { RecruitmentTargetDto } from "./recruitment.service";

/**
 * ‎**מודעה מצולמת ⟵ נכס לגיוס.**
 *
 * ## ‏למה זה שווה מודול
 *
 * ‏המתווך רואה שלט „למכירה” ברחוב. עד עכשיו הוא צילם, ואז — אם
 * ‏זכר — ישב מול מחשב ומילא טופס. בין השניים נופלים רוב הנכסים
 * ‏לגיוס, וזה הפער היקר ביותר במקצוע.
 *
 * ## ‏מה השירות הזה **לא** עושה
 *
 * ‏הוא אינו כותב לטבלה בעצמו. `RecruitmentService.create` הוא
 * ‏המסלול היחיד שכותב שורת גיוס — אותו אחד שהטופס קורא לו — ולכן
 * ‏שורה שנוצרה מתמונה זהה לחלוטין לשורה שנוצרה ביד: אותה ולידציה,
 * ‏אותו `createdBy`, אותו `status`. מסלול כתיבה שני היה מייצר
 * ‏רשומות שנראות תקינות ומתנהגות אחרת.
 *
 * ## ‏והתמונה עצמה
 *
 * ‏אינה נשמרת. מה שנשמר הוא מה שנקרא ממנה — טקסט. שמירת התמונה
 * ‏הייתה פותחת שאלה של מדיה, מכסות ומחיקה על יכולת שכל תכליתה
 * ‏לחסוך הקלדה, ואת התמונה המקורית המתווך מחזיק בגלריה שלו ממילא.
 */
@Injectable()
export class RecruitmentAdService {
  private readonly logger = new Logger(RecruitmentAdService.name);

  constructor(
    private readonly gemini: GeminiService,
    private readonly recruitment: RecruitmentService,
  ) {}

  /**
   * ‏קריאת התמונה ופתיחת נכס לגיוס ממנה.
   *
   * ‎`null` כשלא נקרא דבר שאפשר לעבוד איתו — הקורא אומר זאת
   * ‏למתווך ואינו יוצר שורה ריקה שמישהו יצטרך למחוק.
   */
  async fromImage(image: {
    buffer: Buffer;
    mimeType: string;
  }): Promise<{ target: RecruitmentTargetDto; summary: string } | null> {
    const raw = await this.gemini.generateStructured(
      buildRecruitmentAdPrompt(),
      RECRUITMENT_AD_SCHEMA,
      {
        image: { mimeType: image.mimeType, data: image.buffer.toString("base64") },
      },
    );
    const read = parseRecruitmentAd(raw);
    if (read === null) {
      this.logger.log("מודעה מצולמת: לא נקראו פרטים שאפשר לעבוד איתם");
      return null;
    }

    const target = await this.recruitment.create({
      source: read.source,
      status: "new",
      ...fields(read),
    });
    return { target, summary: recruitmentAdSummary(read, recruitmentAddress(read, "בלי כתובת שנקראה")) };
  }

  /** ‏מה שנאמר כשהתמונה לא נקראה — מהצד המשותף, כמו כל נוסח. */
  static readonly unreadable = AD_UNREADABLE_TEXT;
}

/**
 * ‎**רק שדות שיש בהם ערך.**
 *
 * ‎`exactOptionalPropertyTypes` דוחה `undefined` מפורש, ו-`null`
 * ‏על שדה שלא נקרא הוא אמנם מותר אך מיותר: הוא כותב „ריק” על
 * ‏עמודה שממילא ריקה.
 */
function fields(read: RecruitmentAdRead): Record<string, unknown> {
  const entries: [string, unknown][] = [
    ["city", read.city],
    ["neighborhood", read.neighborhood],
    ["street", read.street],
    ["houseNumber", read.houseNumber],
    ["propertyType", read.propertyType],
    ["dealType", read.dealType],
    ["rooms", read.rooms],
    ["areaSqm", read.areaSqm],
    ["floor", read.floor],
    ["totalFloors", read.totalFloors],
    ["priceAgorot", read.priceAgorot],
    ["ownerName", read.ownerName],
    ["ownerPhone", read.ownerPhone],
    ["notes", read.notes === "" ? null : read.notes],
  ];
  return Object.fromEntries(entries.filter(([, value]) => value !== null));
}
