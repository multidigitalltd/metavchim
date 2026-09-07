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
      const { count } = await tx.recruitmentTarget.updateMany({
        where: { id, tenantId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (count === 0) throw new NotFoundException("נכס לגיוס לא נמצא");

      const scope = {
        tenantId,
        entityType: "recruitment",
        entityId: id,
        status: "open",
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
  private assertSourceUrl(url: string | null | undefined): void {
    if (url === undefined || url === null || url === "") return;
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
