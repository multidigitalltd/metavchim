import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import {
  CONTENT_NOTES_MAX,
  CONTENT_TITLE_MAX,
  parseContentUrl,
  type MentorContentKind,
} from "@metavchim/shared";
import { PrismaService } from "../../core/prisma.service";
import { TenantContext } from "../../common/tenant-context";

/** ‏שורת תוכן כפי שהמסך מקבל אותה. */
export interface MentorContentDto {
  id: string;
  title: string;
  notes: string;
  kind: MentorContentKind;
  ref: string;
  sourceUrl: string;
  sortOrder: number;
  /** ‏תוכן של הפלטפורמה מוצג בכל המשרדים ואינו ניתן לעריכה במשרד. */
  platform: boolean;
}

/**
 * ‎**תוכן לימודי במנטור — סרטונים ופודקאסטים.**
 *
 * ## ‏שני היקפים, שאילתה אחת
 *
 * ‎`tenantId IS NULL` הוא תוכן של הפלטפורמה, ו-`tenantId = X` הוא
 * ‏תוכן של משרד. המתווך רואה את שניהם באותה רשימה — הוא אינו אמור
 * ‏לדעת מי העלה מה — ולכן הקריאה מביאה את שניהם יחד.
 *
 * ## ‏מה נשמר
 *
 * ‎**מזהה, לא קוד הטמעה.** `parseContentUrl` קורא את הכתובת ומחזיר
 * ‏סוג ומזהה; המסך בונה את הנגן מהם ומהמקור הקבוע. כתובת שלא נקראה
 * ‏אינה נשמרת — שורה שלא תנוגן היא כרטיס שמישהו ילחץ עליו לשווא.
 *
 * ‏זו ההכרעה שנושאת את המשקל: „הטמעת סרטון” בניסוח הנאיבי פירושה
 * ‏שמנהל מדביק `<iframe>` שהאתר מרנדר — הזרקת HTML למסך של כל
 * ‏מתווך במערכת.
 */
@Injectable()
export class MentorContentService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * ‏מה שהמתווך רואה: תוכן הפלטפורמה ותוכן המשרד, בסדר אחד.
   *
   * ‏מיון לפי `sortOrder` ואז לפי מועד: המנהל קובע סדר, ומה שלא
   * ‏מוין נופל לסוף לפי הוותק.
   */
  async list(): Promise<MentorContentDto[]> {
    const tenantId = TenantContext.current().tenantId;
    const rows = await this.prisma.withTenant((tx) =>
      tx.mentorContent.findMany({
        /*
         * ‎`OR` ולא שתי שאילתות: ה-RLS מתיר את שתי הקבוצות (מדיניות
         * ‏הדייר ומדיניות הקריאה של הפלטפורמה), ולכן אחת מספיקה.
         */
        where: { OR: [{ tenantId }, { tenantId: null }] },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        take: 200,
      }),
    );
    return rows.map((row) => toDto(row));
  }

  /** ‏הוספת שורה למשרד. הפלטפורמה עוברת ב-`createPlatform`. */
  async create(input: { title: string; notes?: string; url: string }): Promise<MentorContentDto> {
    const tenantId = TenantContext.current().tenantId;
    const fields = readFields(input);
    const id = ulid();
    const row = await this.prisma.withTenant((tx) =>
      tx.mentorContent.create({
        data: {
          id,
          tenantId,
          createdBy: TenantContext.current().userId,
          ...fields,
        },
      }),
    );
    return toDto(row);
  }

  async remove(id: string): Promise<void> {
    const tenantId = TenantContext.current().tenantId;
    const removed = await this.prisma.withTenant((tx) =>
      tx.mentorContent.deleteMany({ where: { id, tenantId } }),
    );
    /*
     * ‎`deleteMany` עם `tenantId` מפורש, ולא `delete` על המזהה:
     * ‏שורה של הפלטפורמה גלויה למשרד בקריאה, ומחיקה לפי מזהה בלבד
     * ‏הייתה נחסמת ב-RLS עם שגיאה שנראית כמו תקלה. כאן היא פשוט
     * ‏אינה נמצאת, וזו התשובה הנכונה.
     */
    if (removed.count === 0) throw new NotFoundException("התוכן לא נמצא");
  }

  /* ------------------------------------------------------------------ */
  /*  שולחן הפלטפורמה — שורות שמוצגות בכל המשרדים                        */
  /* ------------------------------------------------------------------ */

  /**
   * ‏התוכן המשותף, כפי שמנהל הפלטפורמה עורך אותו.
   *
   * ‎`withPlatformContent` ולא `withTenant`: אין כאן הקשר דייר
   * ‏בכלל, והמדיניות מגבילה את השולחן לשורות `tenant_id IS NULL`
   * ‏— כלומר גם קריאה אינה רואה תוכן של משרדים.
   */
  async listPlatform(): Promise<MentorContentDto[]> {
    const rows = await this.prisma.withPlatformContent((tx) =>
      tx.mentorContent.findMany({
        where: { tenantId: null },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        take: 200,
      }),
    );
    return rows.map((row) => toDto(row));
  }

  async createPlatform(input: {
    title: string;
    notes?: string;
    url: string;
    sortOrder?: number;
  }): Promise<MentorContentDto> {
    const fields = readFields(input);
    const row = await this.prisma.withPlatformContent((tx) =>
      tx.mentorContent.create({
        data: {
          id: ulid(),
          tenantId: null,
          ...fields,
          ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
        },
      }),
    );
    return toDto(row);
  }

  async removePlatform(id: string): Promise<void> {
    const removed = await this.prisma.withPlatformContent((tx) =>
      tx.mentorContent.deleteMany({ where: { id, tenantId: null } }),
    );
    if (removed.count === 0) throw new NotFoundException("התוכן לא נמצא");
  }
}

/**
 * ‎**הכתובת נקראת כאן, לפני כל כתיבה.**
 *
 * ‏שני מסלולי הכתיבה (משרד ופלטפורמה) עוברים דרכה, ולכן אין דרך
 * ‏לשמור שורה שלא פוענחה. פענוח בקורא היה נכון ביום שנכתב.
 */
function readFields(input: { title: string; notes?: string; url: string }): {
  title: string;
  notes: string;
  kind: string;
  ref: string;
  sourceUrl: string;
} {
  const title = input.title.trim();
  if (title === "") throw new BadRequestException("חסרה כותרת");

  const embed = parseContentUrl(input.url);
  if (embed === null) {
    throw new BadRequestException(
      "הקישור אינו נקרא — הדביקו קישור מיוטיוב, ספוטיפיי, אפל פודקאסטס, או קישור https אחר",
    );
  }
  return {
    title: title.slice(0, CONTENT_TITLE_MAX),
    notes: (input.notes ?? "").trim().slice(0, CONTENT_NOTES_MAX),
    kind: embed.kind,
    ref: embed.ref,
    /* ‏הכתובת המקורית נשמרת לעריכה בלבד — הנגן נטען מ-`ref` */
    sourceUrl: input.url.trim().slice(0, 2000),
  };
}

function toDto(row: {
  id: string;
  tenantId: string | null;
  title: string;
  notes: string;
  kind: string;
  ref: string;
  sourceUrl: string;
  sortOrder: number;
}): MentorContentDto {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    kind: row.kind as MentorContentKind,
    ref: row.ref,
    sourceUrl: row.sourceUrl,
    sortOrder: row.sortOrder,
    platform: row.tenantId === null,
  };
}
