import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import {
  type PropertyFields,
  canConvertToProperty,
  isValidSourceUrl,
} from "@metavchim/shared";
import { ulid } from "ulid";
import { TenantContext } from "../../common/tenant-context";
import { PrismaService } from "../../core/prisma.service";
import { PropertiesService } from "../properties/properties.service";

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

export interface RecruitmentInput {
  status?: string;
  source?: string;
  sourceUrl?: string;
  city?: string;
  neighborhood?: string;
  street?: string;
  houseNumber?: string;
  propertyType?: string;
  dealType?: string;
  rooms?: number;
  areaSqm?: number;
  floor?: number;
  totalFloors?: number;
  priceAgorot?: number;
  ownerName?: string;
  ownerPhone?: string;
  notes?: string;
  agentUserId?: string;
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

  async list(status?: string): Promise<RecruitmentTargetDto[]> {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.recruitmentTarget.findMany({
        where: {
          tenantId,
          deletedAt: null,
          ...(status === undefined || status === "" ? {} : { status }),
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: 500,
      });
      return rows.map((row) => toDto(row as unknown as Row));
    });
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
        select: { id: true },
      });
      if (!existing) throw new NotFoundException("נכס לגיוס לא נמצא");
      const row = await tx.recruitmentTarget.update({
        where: { id },
        data: this.writable(input),
      });
      return toDto(row as unknown as Row);
    });
  }

  /** מחיקה רכה — השורה יורדת מהרשימה ונשמרת להיסטוריה. */
  async remove(id: string): Promise<void> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.withTenant(async (tx) => {
      const { count } = await tx.recruitmentTarget.updateMany({
        where: { id, tenantId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (count === 0) throw new NotFoundException("נכס לגיוס לא נמצא");
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
      return { propertyId: target.convertedPropertyId };
    }
    if (!canConvertToProperty(target.status)) {
      throw new ConflictException('רק נכס בשלב „גויס” ניתן להמרה לנכס של המשרד');
    }

    // ‏התפיסה — מותנית ואטומית. אפס שורות = מישהו הקדים.
    const claimed = await this.prisma.withTenant((tx) =>
      tx.recruitmentTarget.updateMany({
        where: { id, tenantId, convertedAt: null },
        data: { convertedAt: new Date() },
      }),
    );
    if (claimed.count === 0) {
      /*
       * ‎**מישהו הקדים — ועכשיו צריך לחכות לו.**
       *
       * ‏בין התפיסה לכתיבת `convertedPropertyId` יש חלון של יצירת
       * הנכס. בקשה שנייה שנופלת בדיוק בתוכו רואה „נתפס” אבל עדיין
       * בלי מזהה — ואם היא תחזיר שגיאה כאן, לחיצה כפולה תראה
       * **אדום על פעולה שהצליחה**. אומת חי: חמש המרות במקביל יצרו
       * נכס אחד, וארבע מהן קיבלו שגיאה.
       *
       * ‏המתנה קצרה וחסומה סוגרת את החלון בלי לפתוח מרוץ חדש. אם
       * גם אחריה אין מזהה, הנוסח אומר „מתבצעת” ולא „נכשלה” — כי
       * זה מה שקורה.
       */
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const again = await this.prisma.withTenant((tx) =>
          tx.recruitmentTarget.findFirst({
            where: { id, tenantId },
            select: { convertedPropertyId: true },
          }),
        );
        if (again?.convertedPropertyId) return { propertyId: again.convertedPropertyId };
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new ConflictException("ההמרה מתבצעת כרגע — רעננו בעוד רגע");
    }

    try {
      const fields = this.fieldsOf(target);
      const property = await this.properties.create({
        fields,
        /*
         * ‏נכס שגויס הוא נכס פעיל, לא טיוטה: הבעלים חתם, והמתווך
         * רוצה להתחיל לשווק אותו באותו רגע.
         */
        status: "active",
        ...(target.agentUserId === null ? {} : { agentUserId: target.agentUserId }),
        ...(target.ownerName !== null && target.ownerPhone !== null
          ? { owner: { name: target.ownerName, phone: target.ownerPhone } }
          : {}),
        ...(target.notes === null ? {} : { internalNotes: target.notes }),
      });
      await this.prisma.withTenant((tx) =>
        tx.recruitmentTarget.update({
          where: { id },
          data: { convertedPropertyId: property.id },
        }),
      );
      return { propertyId: property.id };
    } catch (error: unknown) {
      /* ‏היצירה נכשלה — השורה חוזרת לתור, אחרת הכפתור נעלם לתמיד */
      await this.prisma
        .withTenant((tx) =>
          tx.recruitmentTarget.updateMany({
            where: { id, tenantId, convertedPropertyId: null },
            data: { convertedAt: null },
          }),
        )
        .catch(() => undefined);
      throw error;
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
      ...(rooms === undefined ? {} : { rooms }),
      ...(row.areaSqm === null ? {} : { areaSqm: row.areaSqm }),
      ...(row.floor === null ? {} : { floor: row.floor }),
      ...(row.totalFloors === null ? {} : { totalFloors: row.totalFloors }),
      ...(row.priceAgorot === null ? {} : { priceAgorot: Number(row.priceAgorot) }),
    };
  }

  /**
   * ‎**הקישור נבדק בשרת ולא רק במסך.**
   *
   * ‏הוא מרונדר כ-`href`, ומסך הוא בקשה — לא אכיפה. `javascript:`
   * שנשמר כאן היה מריץ קוד אצל כל מי שלוחץ עליו במשרד.
   */
  private assertSourceUrl(url: string | undefined): void {
    if (url === undefined || url === "") return;
    if (!isValidSourceUrl(url)) {
      throw new ConflictException("קישור למודעה חייב להתחיל ב-http:// או https://");
    }
  }

  /** השדות שהמסך רשאי לכתוב — `convertedPropertyId` אינו ביניהם. */
  private writable(input: RecruitmentInput): Record<string, unknown> {
    const set = <T>(key: string, value: T | undefined): Record<string, T> =>
      value === undefined ? {} : ({ [key]: value } as Record<string, T>);
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
