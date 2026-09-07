import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import {
  type PropertyFields,
  canConvertToProperty,
  freeTextTerms,
  isSharedTabuProperty,
  isValidSourceUrl,
  normalizeRange,
  priceRangeAgorot,
  propertyTypesForTerm,
  SHARED_TABU_PROPERTY_TYPE,
} from "@metavchim/shared";
import { ulid } from "ulid";
import { lockRecruitmentTarget } from "../../common/locks";
import { TenantContext } from "../../common/tenant-context";
import { PrismaService } from "../../core/prisma.service";
import { PropertiesService } from "../properties/properties.service";

/**
 * ‎**הסינון של הרשימה — אותה אוצר מילים של רשימת הנכסים.**
 *
 * ‏המחירים בשקלים והמרתם לאגורות בשרת, כמו בנכסים: המסך מדבר
 * ‏בשקלים, והמסד שומר אגורות. שדה חסר = בלי הגבלה.
 */
export interface RecruitmentListQuery {
  status?: string | undefined;
  source?: string | undefined;
  city?: string | undefined;
  /** ‏חיפוש חופשי — כתובת, שכונה, עיר, סוג נכס והערות. */
  q?: string | undefined;
  minPrice?: number | undefined;
  maxPrice?: number | undefined;
  minRooms?: number | undefined;
  maxRooms?: number | undefined;
  /** ‎„גודל” — שטח במ"ר. */
  minArea?: number | undefined;
  maxArea?: number | undefined;
}

/** ‏תנאי טווח על עמודה מספרית — ריק כששני הקצוות ריקים. */
function rangeWhere(
  field: string,
  range: { min?: number; max?: number },
): Record<string, unknown> {
  if (range.min === undefined && range.max === undefined) return {};
  return {
    [field]: {
      ...(range.min === undefined ? {} : { gte: range.min }),
      ...(range.max === undefined ? {} : { lte: range.max }),
    },
  };
}

/** שורה ברשימת „נכסים לגיוס”. */
export interface RecruitmentTargetDto {
  id: string;
  status: string;
  source: string;
  sourceUrl?: string;
  city?: string;
  neighborhood?: string;
  street?: string;
  houseNumber?: string;
  propertyType?: string;
  dealType?: string;
  /** ‏רישום בטאבו משותף — התיבה בטופס, כמו בשלושת האחרים. */
  sharedTabu?: boolean;
  rooms?: number;
  areaSqm?: number;
  floor?: number;
  totalFloors?: number;
  priceAgorot?: number;
  ownerName?: string;
  ownerPhone?: string;
  notes?: string;
  agentUserId?: string;
  /** הנכס שנוצר מהשורה הזו — קיים רק אחרי המרה. */
  convertedPropertyId?: string;
  convertedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * ‎`undefined` = „אל תיגע בשדה”, `null` = „נקה אותו”.
 *
 * ‏שתי המשמעויות נחוצות: בלי `null` אי אפשר היה למחוק ערך שהוזן,
 * ובלי `undefined` כל עדכון חלקי היה מוחק את מה שלא נשלח.
 */
export interface RecruitmentInput {
  status?: string;
  source?: string;
  sourceUrl?: string | null;
  city?: string | null;
  neighborhood?: string | null;
  street?: string | null;
  houseNumber?: string | null;
  propertyType?: string | null;
  dealType?: string | null;
  sharedTabu?: boolean;
  rooms?: number | null;
  areaSqm?: number | null;
  floor?: number | null;
  totalFloors?: number | null;
  priceAgorot?: number | null;
  ownerName?: string | null;
  ownerPhone?: string | null;
  notes?: string | null;
  agentUserId?: string | null;
}

/** שדה אופציונלי נכנס ל-DTO רק כשיש בו ערך — `exactOptionalPropertyTypes`. */
function opt<T>(value: T | null | undefined): { v: T } | undefined {
  return value === null || value === undefined ? undefined : { v: value };
}

type Row = {
  id: string;
  status: string;
  source: string;
  sourceUrl: string | null;
  city: string | null;
  neighborhood: string | null;
  street: string | null;
  houseNumber: string | null;
  propertyType: string | null;
  dealType: string | null;
  sharedTabu: boolean;
  rooms: unknown;
  areaSqm: number | null;
  floor: number | null;
  totalFloors: number | null;
  priceAgorot: bigint | null;
  ownerName: string | null;
  ownerPhone: string | null;
  notes: string | null;
  agentUserId: string | null;
  convertedPropertyId: string | null;
  convertedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toDto(row: Row): RecruitmentTargetDto {
  const rooms = row.rooms === null || row.rooms === undefined ? undefined : Number(row.rooms);
  return {
    id: row.id,
    status: row.status,
    source: row.source,
    ...(opt(row.sourceUrl) ? { sourceUrl: row.sourceUrl as string } : {}),
    ...(opt(row.city) ? { city: row.city as string } : {}),
    ...(opt(row.neighborhood) ? { neighborhood: row.neighborhood as string } : {}),
    ...(opt(row.street) ? { street: row.street as string } : {}),
    ...(opt(row.houseNumber) ? { houseNumber: row.houseNumber as string } : {}),
    ...(opt(row.propertyType) ? { propertyType: row.propertyType as string } : {}),
    ...(opt(row.dealType) ? { dealType: row.dealType as string } : {}),
    /* ‏תמיד, ולא `opt`: העמודה `NOT NULL`, ו„לא סומן” הוא ערך */
    sharedTabu: row.sharedTabu,
    ...(rooms === undefined ? {} : { rooms }),
    ...(opt(row.areaSqm) ? { areaSqm: row.areaSqm as number } : {}),
    ...(opt(row.floor) ? { floor: row.floor as number } : {}),
    ...(opt(row.totalFloors) ? { totalFloors: row.totalFloors as number } : {}),
    ...(row.priceAgorot === null ? {} : { priceAgorot: Number(row.priceAgorot) }),
    ...(opt(row.ownerName) ? { ownerName: row.ownerName as string } : {}),
    ...(opt(row.ownerPhone) ? { ownerPhone: row.ownerPhone as string } : {}),
    ...(opt(row.notes) ? { notes: row.notes as string } : {}),
    ...(opt(row.agentUserId) ? { agentUserId: row.agentUserId as string } : {}),
    ...(opt(row.convertedPropertyId)
      ? { convertedPropertyId: row.convertedPropertyId as string }
      : {}),
    ...(row.convertedAt === null ? {} : { convertedAt: row.convertedAt }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * ‎**נכסים לגיוס — מודעות שרודפים אחריהן, ולא נכסים שמייצגים.**
 *
 * ## ‏למה שירות נפרד ולא הרחבה של `PropertiesService`
 *
 * ‏אותו נימוק שבגללו הטבלה נפרדת: שירות הנכסים מחשב התאמות, מפרסם
 * לרשת ומעדכן מוכנות. נכס שהמשרד אינו מייצג אינו אמור לעבור באף
 * אחד מהמסלולים האלה, ו„לזכור לא לקרוא להם” הוא בדיוק סוג ההנחה
 * שנשברת בעריכה הבאה.
 *
 * ‏שירות הנכסים נקרא כאן **פעם אחת בלבד** — ברגע ההמרה, כשהנכס
 * באמת נעשה של המשרד. אז כל המסלולים האלה נכונים ורצויים.
 */
@Injectable()
export class RecruitmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly properties: PropertiesService,
  ) {}

  /**
   * ‎**הרשימה, עם אותם סינונים שיש לנכסים.**
   *
   * ## ‏למה זה לא היה שמיש בלעדיהם
   *
   * ‏רשימת גיוס גדלה מהר יותר מרשימת הנכסים — כל מודעה שנראתה
   * ‏נכנסת אליה — ועד עכשיו אפשר היה לסנן לפי שלב בלבד. „מה יש
   * ‏לי ברמת גן עד שני מיליון” נענה בגלילה של חמש מאות שורות.
   *
   * ## ‏אותם עוזרים בדיוק של הנכסים
   *
   * ‎`priceRangeAgorot`, `normalizeRange` ו-`freeTextTerms` הם
   * ‏אותן פונקציות ששאילתת הנכסים קוראת. שני ניסוחים של „טווח
   * ‏מחירים” היו נפרדים ביום שבו אחד מהם מתוקן — והמשתמש היה
   * ‏רואה שני מסכים שמסננים אחרת על אותה שאלה.
   */
  async list(query: RecruitmentListQuery = {}): Promise<RecruitmentTargetDto[]> {
    const tenantId = TenantContext.current().tenantId;
    const price = priceRangeAgorot(query.minPrice, query.maxPrice);
    const rooms = normalizeRange(query.minRooms, query.maxRooms);
    const area = normalizeRange(query.minArea, query.maxArea);
    const terms = freeTextTerms(query.q);

    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.recruitmentTarget.findMany({
        where: {
          tenantId,
          deletedAt: null,
          ...(query.status === undefined || query.status === "" ? {} : { status: query.status }),
          ...(query.source === undefined || query.source === "" ? {} : { source: query.source }),
          ...(query.city === undefined || query.city === "" ? {} : { city: query.city }),
          ...rangeWhere("priceAgorot", price),
          ...rangeWhere("rooms", rooms),
          ...rangeWhere("areaSqm", area),
          /*
           * ‏כל מונח חייב להתאים, וכל אחד יכול להתאים בשדה אחר —
           * ‏„פנטהאוס רמת גן” מוצא נכס שסוגו פנטהאוס ועירו רמת גן.
           * ‏אותו כלל בדיוק של רשימת הנכסים.
           *
           * ‎**שם הבעלים והטלפון שלו אינם בין השדות, בכוונה.**
           * ‏חיפוש לפי שם בעלים הופך את הרשימה לכלי לאיתור אנשים
           * ‏ולא נכסים, והשאלה שנשאלה כאן היא „איפה הנכס”. מי
           * ‏שמחפש אדם עושה זאת בחיפוש הכללי, שכפוף להיקף הראייה
           * ‏של הסוכן.
           */
          ...(terms.length > 0
            ? {
                AND: terms.map((term) => ({
                  OR: [
                    ...(propertyTypesForTerm(term).length > 0
                      ? [{ propertyType: { in: propertyTypesForTerm(term) } }]
                      : []),
                    { street: { contains: term, mode: "insensitive" as const } },
                    { neighborhood: { contains: term, mode: "insensitive" as const } },
                    { city: { contains: term, mode: "insensitive" as const } },
                    { notes: { contains: term, mode: "insensitive" as const } },
                  ],
                })),
              }
            : {}),
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: 500,
      });
      return rows.map((row) => toDto(row as unknown as Row));
    });
  }

  /**
   * ‎**מחיקה מרוכזת — הצורה שבה מנקים ייבוא שגוי.**
   *
   * ‏ייבוא של אלף שורות שהתברר כלא נכון נוקה עד עכשיו שורה-שורה,
   * ‏עם אישור לכל אחת. זו אותה פעולה שקיימת ברשימת הנכסים, ומאותה
   * ‏סיבה בדיוק.
   *
   * ‎**רכה, כמו המחיקה הבודדת**: „טעיתי” הוא רוב המקרים, ומחיקה
   * ‏שאי אפשר לבטל הופכת טעות אחת לאובדן.
   *
   * ‏מחזיר כמה ירדו וכמה דולגו — שורה שכבר נמחקה או שאינה של
   * ‏המשרד אינה שגיאה, אבל מסך שאומר „נמחקו 40” על 12 הוא שקר.
   */
  async removeMany(ids: readonly string[]): Promise<{ removed: number; skipped: number }> {
    let removed = 0;
    /*
     * ‏אחת-אחת ולא `updateMany` על כל המזהים: כל מחיקה נועלת את
     * ‏השורה ומנקה את הפולואפים שתלויים בה, וזו בדיוק העבודה
     * ‏ש-`remove` כבר עושה נכון. שכפול השאילתות כאן היה מייצר
     * ‏מסלול שני שישכח את הניקוי ביום שבו `remove` ישתנה.
     */
    for (const id of ids) {
      try {
        await this.remove(id);
        removed += 1;
      } catch (error) {
        if (error instanceof NotFoundException) continue;
        throw error;
      }
    }
    return { removed, skipped: ids.length - removed };
  }

  async getById(id: string): Promise<RecruitmentTargetDto> {
    const tenantId = TenantContext.current().tenantId;
    const row = await this.prisma.withTenant((tx) =>
      tx.recruitmentTarget.findFirst({ where: { id, tenantId, deletedAt: null } }),
    );
    if (!row) throw new NotFoundException("נכס לגיוס לא נמצא");
    return toDto(row as unknown as Row);
  }

  async create(input: RecruitmentInput): Promise<RecruitmentTargetDto> {
    const { tenantId, userId } = TenantContext.current();
    this.assertSourceUrl(input.sourceUrl);
    const id = ulid();
    const row = await this.prisma.withTenant((tx) =>
      tx.recruitmentTarget.create({
        data: {
          id,
          tenantId,
          ...this.writable(input),
          status: input.status ?? "new",
          source: input.source ?? "other",
          createdBy: userId ?? null,
        },
      }),
    );
    return toDto(row as unknown as Row);
  }

  async update(id: string, input: RecruitmentInput): Promise<RecruitmentTargetDto> {
    const tenantId = TenantContext.current().tenantId;
    this.assertSourceUrl(input.sourceUrl);
    return this.prisma.withTenant(async (tx) => {
      const existing = await tx.recruitmentTarget.findFirst({
        where: { id, tenantId, deletedAt: null },
        /* ‏הסוג הנוכחי נדרש להכרעת הרישום — ראו `registrationWrite` */
        select: { id: true, propertyType: true },
      });
      if (!existing) throw new NotFoundException("נכס לגיוס לא נמצא");
      const row = await tx.recruitmentTarget.update({
        where: { id },
        data: this.writable(input, existing),
      });
      return toDto(row as unknown as Row);
    });
  }

  /** מחיקה רכה — השורה יורדת מהרשימה ונשמרת להיסטוריה. */
  /**
   * ‎**מחיקה שמנקה גם את הפולואפים** (ביקורת Codex, P2).
   *
   * ‏מרגע שאפשר לתלות משימה על שורת גיוס, מחיקה שמסמנת `deletedAt`
   * ‏בלבד משאירה אותן פתוחות: הן נשארות ברשימת המשימות וביומן בלי
   * ‏תווית שאפשר לפתור, והעובד ישלח את התזכורת שלהן — הוא בודק רק
   * ‏שהמשימה פתוחה ושהמועד הגיע. „לחזור לבעלים” על נכס שנמחק.
   *
   * ‎**ואותה זהירות מול Google כמו ב-`TasksService.remove`**: משימה
   * ‏שיש לה אירוע ביומן מסומנת כבוצעה וממתינה לדחיפה, וסבב הסנכרון
   * ‏הוא שמוחק את האירוע ואז את השורה. מחיקה ישירה הייתה מוחקת את
   * ‏המזהה היחיד שמצביע על האירוע, והוא היה נשאר ביומן לנצח.
   *
   * ‏הכול בטרנזקציה אחת עם המחיקה עצמה: מחיקה שהצליחה והשאירה
   * ‏תזכורת חיה היא בדיוק המצב שהממצא מתאר.
   */
  async remove(id: string): Promise<void> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.withTenant(async (tx) => {
      /*
       * ‎**הנעילה לפני הכול — לפני השורה ולפני הפולואפים שתלויים בה**
       * ‏(ביקורת Codex, P2).
       *
       * ‏‎`updateMany` נועל בעצמו את השורה, אבל זה אינו הצד שנשבר:
       * ‏יצירת פולואפ קראה „השורה חיה” בלי לנעול דבר, המחיקה הספיקה
       * ‏לרוץ ולנקות, והמשימה נכתבה **אחרי** הניקוי. הנעילה כאן היא
       * ‏חצי הזוג — החצי השני ב-`TasksService`. ראו `common/locks.ts`.
       */
      await lockRecruitmentTarget(tx, tenantId, id);
      const { count } = await tx.recruitmentTarget.updateMany({
        where: { id, tenantId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (count === 0) throw new NotFoundException("נכס לגיוס לא נמצא");

      /*
       * ‎**כל הפולואפים שתלויים בשורה, ולא הפתוחים בלבד** (ביקורת
       * ‏Codex, P2).
       *
       * ‏משימה שכבר בוצעה נשארה מחוץ לשני הניקויים, ולכן נשארה
       * ‏ברשימת המשימות בלי תווית שאפשר לפתור — ו„פתיחה מחדש”
       * ‏בתיבת הסימון מחזירה אותה למצב פתוח: `TasksService.update`
       * ‏אינו בודק מחדש את הישות שהמשימה תלויה עליה. נוצרת משימה
       * ‏פתוחה על שורה שאיננה, ואיתה אירוע ביומן.
       *
       * ‏הסטטוס ירד מהתיאור. מה שמפריד כאן אינו „פתוחה או בוצעה”
       * ‏אלא **האם יש אירוע ביומן לנקות** — וזו בדיוק ההבחנה
       * ‏שבשתי השאילתות שמתחת.
       */
      const scope = {
        tenantId,
        entityType: "recruitment",
        entityId: id,
        deletedAfterSync: false,
      } as const;
      /* ‏עם אירוע ביומן — מסומנת וממתינה לסבב; בלעדיו נמחקת */
      await tx.task.updateMany({
        where: { ...scope, googleEventId: { not: null } },
        data: { status: "done", deletedAfterSync: true, googleSyncedAt: null },
      });
      await tx.task.deleteMany({ where: { ...scope, googleEventId: null } });
    });
  }

  /**
   * ‎**„המר לנכס שלי” — פעם אחת, ולא פעם אחת בכל לחיצה.**
   *
   * ## ‏למה תפיסה ולא בדיקה-ואז-יצירה
   *
   * ‏„קרא, ראה שאין נכס, צור” הוא מרוץ: שתי לחיצות (או שתי לשוניות)
   * קוראות שתיהן `null`, ושתיהן יוצרות. התוצאה היא **שני נכסים
   * זהים** במאגר, ואת השני אף אחד לא מוחק כי אף אחד לא יודע עליו.
   *
   * ‏לכן התפיסה היא עדכון מותנה: `convertedAt` נכתב רק כשהוא עדיין
   * ריק. שתי בקשות מקבילות — אחת מעדכנת שורה אחת, השנייה אפס, ורק
   * הראשונה יוצרת. האינדקס הייחודי על `convertedPropertyId` הוא
   * השכבה השנייה, ברמת המסד.
   *
   * ## ‏ולמה השחרור
   *
   * ‏אילו היצירה נכשלת אחרי התפיסה, השורה הייתה נשארת מסומנת
   * כמומרת בלי נכס — כלומר כפתור שנעלם ולקוח שאבד. השחרור מחזיר
   * אותה לתור. אותו דפוס בדיוק של הזמנת שיחת ההיכרות.
   *
   * ## ‏מה קורה בלחיצה שנייה
   *
   * ‏מזהה הנכס הקיים חוזר, ולא שגיאה: המשתמש לחץ „המר”, והתשובה
   * הנכונה לשאלה שלו היא הנכס — גם אם מישהו כבר יצר אותו.
   */
  async convert(id: string): Promise<{ propertyId: string }> {
    const tenantId = TenantContext.current().tenantId;

    const target = await this.prisma.withTenant((tx) =>
      tx.recruitmentTarget.findFirst({ where: { id, tenantId, deletedAt: null } }),
    );
    if (!target) throw new NotFoundException("נכס לגיוס לא נמצא");
    if (target.convertedPropertyId !== null) {
      /*
       * ‏מזהה רשום אינו „נכס קיים”: הוא נכתב בתפיסה, והיצירה עשויה
       * עדיין לרוץ. החזרה מיידית שלחה את המסך ל-`/properties/:id`
       * שעדיין מחזיר „לא נמצא”, והדף אינו מנסה שוב (ביקורת Codex).
       */
      await this.requireProperty(tenantId, target.convertedPropertyId);
      return { propertyId: target.convertedPropertyId };
    }
    if (!canConvertToProperty(target.status)) {
      throw new ConflictException('רק נכס בשלב „גויס” ניתן להמרה לנכס של המשרד');
    }

    /*
     * ‎**המזהה נקבע לפני התפיסה ונרשם יחד איתה.**
     *
     * ‏הגרסה הראשונה תפסה, יצרה, ואז רשמה את המזהה — ובין השניים
     * היה חלון: יצירה שנכשלה **אחרי** שהנכס כבר נשמר (הפרסום לרשת
     * מתבצע בסוף היצירה ויכול לזרוק) שחררה את התפיסה, וניסיון חוזר
     * יצר נכס שני. הראשון נשאר יתום — ואיש לא ידע עליו, כי מזההו
     * מעולם לא נרשם, ולכן גם האינדקס הייחודי לא יכול היה לתפוס אותו
     * (ביקורת Codex, P1).
     *
     * ‏עכשיו המזהה ידוע מראש ונרשם בתפיסה עצמה. אין רגע שבו קיים
     * נכס שאין אליו הפניה.
     */
    const propertyId = ulid();

    /*
     * ‎**התפיסה בודקת מחדש את המצב, ולא רק את `convertedAt`.**
     *
     * ‏בין הקריאה למעלה לעדכון כאן מישהו יכול היה למחוק את השורה או
     * להזיז אותה מ„גויס”. תפיסה שבודקת רק „טרם הומר” הייתה יוצרת נכס
     * מצילום מיושן, ועוקפת בשקט את הכלל שהשירות עצמו אוכף (ביקורת
     * Codex). התנאים כאן הם בדיוק אלה שנבדקו למעלה.
     */
    const claimed = await this.prisma.withTenant((tx) =>
      tx.recruitmentTarget.updateMany({
        where: {
          id,
          tenantId,
          deletedAt: null,
          status: "recruited",
          convertedAt: null,
          convertedPropertyId: null,
        },
        data: { convertedAt: new Date(), convertedPropertyId: propertyId },
      }),
    );

    if (claimed.count === 0) {
      /*
       * ‏מישהו הקדים, או שהמצב השתנה תחתינו. המזהה כבר רשום אצל
       * המנצח, ולכן **אין צורך לנחש כמה לחכות לו** — קוראים אותו.
       * הגרסה הקודמת סקרה שש פעמים ברבע שנייה, ופענוח הכתובת לבדו
       * יכול לקחת שש שניות: מי שהפסיד קיבל שגיאה על פעולה שהצליחה
       * (ביקורת Codex).
       */
      const again = await this.prisma.withTenant((tx) =>
        tx.recruitmentTarget.findFirst({
          where: { id, tenantId },
          select: { convertedPropertyId: true },
        }),
      );
      if (again?.convertedPropertyId) {
        await this.requireProperty(tenantId, again.convertedPropertyId);
        return { propertyId: again.convertedPropertyId };
      }
      throw new ConflictException("הנכס לגיוס השתנה — רעננו ונסו שוב");
    }

    /*
     * ‎**הנכס נבנה מהשורה שנתפסה, לא מהצילום שנקרא לפניה.**
     *
     * ‏עריכה שנכנסה בין הקריאה לתפיסה (כתובת, מחיר, בעלים) הייתה
     * נשמרת בשורת הגיוס אך **לא** בנכס שנוצר ממנה — הנכס היה נושא
     * את הערכים הישנים לתמיד (ביקורת Codex). התפיסה היא נקודת
     * הסדרה, ולכן הקריאה שאחריה היא המצב הקובע.
     */
    const claimedRow =
      (await this.prisma.withTenant((tx) =>
        tx.recruitmentTarget.findFirst({ where: { id, tenantId } }),
      )) ?? target;

    try {
      await this.properties.create({
        id: propertyId,
        fields: this.fieldsOf(claimedRow),
        /*
         * ‏נכס שגויס הוא נכס פעיל, לא טיוטה: הבעלים חתם, והמתווך
         * רוצה להתחיל לשווק אותו באותו רגע.
         */
        status: "active",
        ...(claimedRow.agentUserId === null ? {} : { agentUserId: claimedRow.agentUserId }),
        ...(claimedRow.ownerName !== null && claimedRow.ownerPhone !== null
          ? { owner: { name: claimedRow.ownerName, phone: claimedRow.ownerPhone } }
          : {}),
        ...(claimedRow.notes === null ? {} : { internalNotes: claimedRow.notes }),
      });
      return { propertyId };
    } catch (error: unknown) {
      /*
       * ‎**משחררים רק אם הנכס באמת אינו קיים.**
       *
       * ‏שחרור עיוור הוא מה שיצר את היתום: היצירה יכולה לזרוק אחרי
       * שהשורה כבר נשמרה. אם היא קיימת — ההפניה נכונה ונשארת, וניסיון
       * חוזר יקבל אותה מהבדיקה שבראש. אם אינה — השורה חוזרת לתור.
       */
      const exists = await this.prisma
        .withTenant((tx) =>
          tx.property.findFirst({ where: { id: propertyId, tenantId }, select: { id: true } }),
        )
        .catch(() => null);
      if (!exists) {
        await this.prisma
          .withTenant((tx) =>
            tx.recruitmentTarget.updateMany({
              where: { id, tenantId, convertedPropertyId: propertyId },
              data: { convertedAt: null, convertedPropertyId: null },
            }),
          )
          .catch(() => undefined);
      }
      throw error;
    }
  }

  /**
   * ‎**המתנה לנכס שמישהו אחר יוצר — ושגיאה כשהוא לא הגיע.**
   *
   * ‏הגרסה הקודמת חזרה בהצלחה גם כשהשורה לא הופיעה, ו„עדיף להחזיר
   * מזהה” היה רציונליזציה: היצירה יכולה לחרוג מהתקציב, ויכולה גם
   * להיכשל ולשחרר את התפיסה **אחרי** שהמפסיד כבר קרא את המזהה
   * הזמני. בשני המקרים המסך ניווט למזהה שלא יהיה קיים לעולם
   * (ביקורת Codex).
   *
   * ‏עכשיו זו שגיאה מפורשת: „עדיין רצה, נסו שוב”. תוצאה לא ידועה
   * אינה הצלחה.
   *
   * ‏התקציב נגזר מהאיטי שביצירה — פענוח הכתובת מול ספק חיצוני,
   * שפסק הזמן שלו שש שניות — ולא ממספר שנבחר באוויר.
   */
  private async requireProperty(tenantId: string, propertyId: string): Promise<void> {
    const deadline = Date.now() + 12_000;
    for (;;) {
      const row = await this.prisma
        .withTenant((tx) =>
          tx.property.findFirst({ where: { id: propertyId, tenantId }, select: { id: true } }),
        )
        .catch(() => null);
      if (row) return;
      if (Date.now() >= deadline) {
        throw new ConflictException("ההמרה עדיין רצה — רעננו בעוד רגע");
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  /**
   * ‏שדות הנכס לבדם — מה שההמרה מעתיקה.
   *
   * ‏השמות זהים לאלה של `PropertyFields` בכוונה: זה אותו טופס, ולכן
   * ההעתקה היא מיפוי אחד לאחד ולא תרגום שיכול לסטות.
   */
  private fieldsOf(row: {
    city: string | null;
    neighborhood: string | null;
    street: string | null;
    houseNumber: string | null;
    propertyType: string | null;
    dealType: string | null;
    sharedTabu: boolean;
    rooms: unknown;
    areaSqm: number | null;
    floor: number | null;
    totalFloors: number | null;
    priceAgorot: bigint | null;
  }): PropertyFields {
    const rooms = row.rooms === null || row.rooms === undefined ? undefined : Number(row.rooms);
    return {
      ...(row.city === null ? {} : { city: row.city }),
      ...(row.neighborhood === null ? {} : { neighborhood: row.neighborhood }),
      ...(row.street === null ? {} : { street: row.street }),
      ...(row.houseNumber === null ? {} : { houseNumber: row.houseNumber }),
      ...(row.propertyType === null
        ? {}
        : { propertyType: row.propertyType as PropertyFields["propertyType"] }),
      ...(row.dealType === null ? {} : { dealType: row.dealType as PropertyFields["dealType"] }),
      /*
       * ‎**ההמרה נושאת את הסימון** (ביקורת Codex, P1). בלעדיו נוצר
       * ‏נכס רגיל, והוא מוצע לקונים שסירבו במפורש למושאע — בזמן
       * ‏שהמתווך סימן את השורה בדיוק כדי שזה לא יקרה.
       *
       * ‎**ונגזר משני המקורות, ולא נקרא מהעמודה בלבד** (ביקורת
       * ‏Codex, P2). הכתיבה מנרמלת מעכשיו, אבל שורה שנכתבה לפניה
       * ‏— ובכלל, כל שורה שהסוג שלה הוא הייצוג הישן — חייבת להגיע
       * ‏להמרה כ„מושאע”: אחרת הזוג הסותר שיוצא מכאן נקרא בצד השני
       * ‏כפרישת הייצוג הישן, ושני הנתונים נמחקים.
       */
      sharedTabu: isSharedTabuProperty({
        sharedTabu: row.sharedTabu,
        propertyType: row.propertyType ?? undefined,
      }),
      ...(rooms === undefined ? {} : { rooms }),
      ...(row.areaSqm === null ? {} : { areaSqm: row.areaSqm }),
      ...(row.floor === null ? {} : { floor: row.floor }),
      ...(row.totalFloors === null ? {} : { totalFloors: row.totalFloors }),
      ...(row.priceAgorot === null ? {} : { priceAgorot: Number(row.priceAgorot) }),
    };
  }

  /**
   * ‎**הרישום המשותף בכתיבה — הדגל והסוג יחד, ולעולם לא סותרים**
   * ‏(ביקורת Codex, P2, פעמיים).
   *
   * ‏שני כיוונים, וכל אחד נשבר בנפרד:
   *
   * ‎1. ‏**הסוג מדליק.** הסכימה מקבלת `propertyType: "shared_tabu"`
   * ‏בלי הדגל — דרך ה-API ודרך הייבוא — והעמודה נופלת ל-`false`.
   * ‏השורה נושאת סוג שאומר „מושאע” ודגל שאומר „לא”.
   *
   * ‎2. ‏**ו„לא” מפורש פורש את הסוג הישן.** בלי זה מתווך שמוריד את
   * ‏הסימון בשורה ותיקה רואה אותה נשמרת בלי סימון — והסוג שנשאר
   * ‏מחזיר את העובדה בהמרה. הוא סימן „לא”, ונוצר נכס „כן”.
   *
   * ‎**והסוג לעולם אינו מכבה.** עדכון שנוגע רק בסוג אינו אומר דבר
   * ‏על הדגל, וגזירה סימטרית הייתה מוחקת סימון מפורש ברגע שמישהו
   * ‏שינה „דירה” ל„פנטהאוז”.
   *
   * ‏זה בדיוק הכלל של `fieldsToColumns` על הנכס, ובאותו סדר — כי
   * ‏זו אותה עובדה משפטית על אותו טופס.
   */
  private registrationWrite(
    input: RecruitmentInput,
    current?: { propertyType: string | null },
  ): { sharedTabu: boolean | undefined; retireLegacyType: boolean } {
    const effectiveType =
      input.propertyType === undefined ? (current?.propertyType ?? null) : input.propertyType;
    const legacy = effectiveType === SHARED_TABU_PROPERTY_TYPE;
    if (input.sharedTabu === false && legacy) {
      return { sharedTabu: false, retireLegacyType: true };
    }
    if (input.sharedTabu !== undefined) {
      return { sharedTabu: input.sharedTabu, retireLegacyType: false };
    }
    return {
      sharedTabu: input.propertyType === SHARED_TABU_PROPERTY_TYPE ? true : undefined,
      retireLegacyType: false,
    };
  }

  /**
   * ‎**הקישור נבדק בשרת ולא רק במסך.**
   *
   * ‏הוא מרונדר כ-`href`, ומסך הוא בקשה — לא אכיפה. `javascript:`
   * שנשמר כאן היה מריץ קוד אצל כל מי שלוחץ עליו במשרד.
   */
  private assertSourceUrl(url: string | null | undefined): void {
    if (url === undefined || url === null || url === "") return;
    if (!isValidSourceUrl(url)) {
      throw new ConflictException("קישור למודעה חייב להתחיל ב-http:// או https://");
    }
  }

  /**
   * השדות שהמסך רשאי לכתוב — `convertedPropertyId` אינו ביניהם.
   *
   * ‎`current` הוא הסוג שכבר רשום על השורה, ונדרש בדיוק לשם אותו
   * ‏דבר שבגללו `fieldsToColumns` דורש אותו: כדי לדעת מה „הסוג
   * ‏האפקטיבי” בעדכון חלקי שלא נגע בו.
   */
  private writable(
    input: RecruitmentInput,
    current?: { propertyType: string | null },
  ): Record<string, unknown> {
    const set = <T>(key: string, value: T | undefined): Record<string, T> =>
      value === undefined ? {} : ({ [key]: value } as Record<string, T>);
    const registration = this.registrationWrite(input, current);
    return {
      ...set("status", input.status),
      ...set("source", input.source),
      ...set("sourceUrl", input.sourceUrl === "" ? null : input.sourceUrl),

      ...set("city", input.city),
      ...set("neighborhood", input.neighborhood),
      ...set("street", input.street),
      ...set("houseNumber", input.houseNumber),
      ...set("propertyType", input.propertyType),
      ...set("dealType", input.dealType),
      /*
       * ‎**התיבה, והסוג הוותיק שמדליק אותה** (ביקורת Codex, P2).
       *
       * ‏הסכימה מקבלת `propertyType: "shared_tabu"` בלי הדגל — דרך
       * ‏ה-API ודרך `/import/recruitment` — והעמודה נופלת אז
       * ‏ל-`false`. השורה נושאת סוג שאומר „מושאע” ודגל שאומר „לא”,
       * ‏וההמרה שולחת את הצירוף הזה ל-`fieldsToColumns`, שקורא אותו
       * ‏כ„פרישת הייצוג הישן” — ומוחק את שניהם. נוצר נכס בלי סוג
       * ‏ובלי האזהרה המשפטית, והוא מוצע לקונים שסירבו במפורש.
       *
       * ‎**הסוג מדליק ולעולם לא מכבה** — אותו כלל שהנכס נשען עליו
       * ‏(`property.mapper.ts`): עדכון שנוגע רק בסוג אינו אומר דבר
       * ‏על הדגל, וגזירה סימטרית כאן הייתה מוחקת סימון מפורש ברגע
       * ‏שמישהו שינה „דירה” ל„פנטהאוז”.
       */
      ...set("sharedTabu", registration.sharedTabu),
      ...(registration.retireLegacyType ? { propertyType: null } : {}),
      ...set("rooms", input.rooms),
      ...set("areaSqm", input.areaSqm),
      ...set("floor", input.floor),
      ...set("totalFloors", input.totalFloors),
      ...set("priceAgorot", input.priceAgorot),
      ...set("ownerName", input.ownerName),
      ...set("ownerPhone", input.ownerPhone),
      ...set("notes", input.notes),
      ...set("agentUserId", input.agentUserId === "" ? null : input.agentUserId),
    };
  }
}
