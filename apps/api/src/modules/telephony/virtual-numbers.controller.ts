import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { ulid } from "ulid";
import { z } from "zod";
import {
  IdSchema,
  canonicalVirtualNumber,
  virtualNumberRejection,
} from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { RequireFeature } from "../../common/feature.guard";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { AuditService } from "../../core/audit.service";
import { PrismaService } from "../../core/prisma.service";

/**
 * מספרים וירטואליים — הגדרה של המשרד, ולכן `settings.manage`.
 *
 * המספר קובע לאיזה סוכן יגיע ליד ולאיזה נכס הוא ייקשר, כלומר הוא
 * מכוון עבודה של אחרים. זו אותה רמה בדיוק של חסימת מודול או משקלי
 * התאמה, ולא פעולה יומיומית של סוכן.
 *
 * מאחורי `telephony`: בלי מרכזייה אין שיחות נכנסות, ומסך שמגדיר
 * ניתוב לשיחות שלא יגיעו הוא הבטחה ריקה.
 */

const InputSchema = z
  .object({
    phone: z.string().trim().min(3).max(20),
    label: z.string().trim().min(2).max(60),
    leadSource: z.string().trim().max(20).default(""),
    assignedToUserId: IdSchema.nullable().default(null),
    propertyId: IdSchema.nullable().default(null),
    isActive: z.boolean().default(true),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

interface VirtualNumberRow {
  id: string;
  phone: string;
  label: string;
  leadSource: string;
  assignedToUserId: string | null;
  propertyId: string | null;
  isActive: boolean;
  /** כמה שיחות הגיעו למספר — המדידה שבשבילה הוא קיים. */
  callCount: number;
}

@RequireFeature("telephony")
@Controller("settings/virtual-numbers")
export class VirtualNumbersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * הרשימה **עם מונה השיחות**, ולא רק ההגדרות.
   *
   * מספר וירטואלי בלי מספר השיחות שהגיעו אליו הוא חצי תכונה: כל
   * הסיבה להקצות מספר לקמפיין היא לדעת כמה הוא הביא, ומסך שמראה
   * רק את ההגדרה מחייב לחפש את התשובה במקום אחר.
   *
   * ‎`groupBy` אחד ולא שאילתה לכל שורה: משרד עם עשרים מספרים היה
   * מייצר עשרים שאילתות בכל טעינת מסך.
   */
  @Get()
  @RequireCapability("settings.manage")
  async list(): Promise<{
    numbers: VirtualNumberRow[];
    users: { id: string; name: string }[];
  }> {
    const tenantId = TenantContext.current().tenantId;
    const [rows, counts, users] = await Promise.all([
      this.prisma.withTenant((tx) =>
        tx.virtualNumber.findMany({
          where: { tenantId },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            phone: true,
            label: true,
            leadSource: true,
            assignedToUserId: true,
            propertyId: true,
            isActive: true,
          },
        }),
      ),
      this.prisma.withTenant((tx) =>
        tx.call.groupBy({
          by: ["dialedNumber"],
          /*
           * **נכנסות בלבד.** בשיחה יוצאת `dialedNumber` מחזיק את
           * מספר המשרד שממנו חייגו — כלומר סוכן שמתקשר ללקוחות
           * דרך מספר הקמפיין היה מנפח את המדד בעצמו, והמסך מציג
           * את המספר הזה כ"שיחות שהגיעו אל המספר" (ביקורת Codex).
           *
           * זה בדיוק סוג הטעות שמדד קמפיין לא יכול להרשות לעצמו:
           * הוא נראה סביר, והחלטת תקציב מתקבלת לפיו.
           */
          where: { tenantId, direction: "inbound", dialedNumber: { not: null } },
          _count: { _all: true },
        }),
      ),
      this.prisma.withTenant((tx) =>
        tx.user.findMany({
          where: { tenantId, isActive: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
      ),
    ]);

    const byNumber = new Map(counts.map((row) => [row.dialedNumber, row._count._all]));
    return {
      numbers: rows.map((row) => ({ ...row, callCount: byNumber.get(row.phone) ?? 0 })),
      users,
    };
  }

  @Post()
  @RequireCapability("settings.manage")
  @HttpCode(201)
  async create(
    @Body(new ZodValidationPipe(InputSchema)) body: Input,
  ): Promise<{ id: string }> {
    const phone = this.assertValid(body);
    const tenantId = TenantContext.current().tenantId;
    const id = ulid();

    await this.prisma.withTenant(async (tx) => {
      await this.assertReferences(tx, tenantId, body);
      /*
       * בדיקה מפורשת לפני הכתיבה ולא הישענות על מפתח ייחודי:
       * ההודעה "המספר כבר מוגדר" מובנת, וכשל אילוץ גולמי מגיע
       * למסך כשגיאת שרת.
       */
      const existing = await tx.virtualNumber.findFirst({
        where: { tenantId, phone },
        select: { id: true },
      });
      if (existing) throw new BadRequestException("המספר הזה כבר מוגדר במשרד");

      await tx.virtualNumber.create({
        data: {
          id,
          tenantId,
          phone,
          label: body.label,
          leadSource: body.leadSource,
          assignedToUserId: body.assignedToUserId,
          propertyId: body.propertyId,
          isActive: body.isActive,
          createdBy: TenantContext.current().userId,
        },
      });
      await this.audit.record(tx, {
        action: "virtual_number.create",
        entityType: "virtual_number",
        entityId: id,
        metadata: { label: body.label },
      });
    });
    return { id };
  }

  @Patch(":id")
  @RequireCapability("settings.manage")
  async update(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(InputSchema)) body: Input,
  ): Promise<{ ok: true }> {
    const phone = this.assertValid(body);
    const tenantId = TenantContext.current().tenantId;

    await this.prisma.withTenant(async (tx) => {
      await this.assertReferences(tx, tenantId, body);
      // מספר שכבר תפוס בשורה **אחרת** — ראו הנימוק ביצירה
      const clash = await tx.virtualNumber.findFirst({
        where: { tenantId, phone, id: { not: id } },
        select: { id: true },
      });
      if (clash) throw new BadRequestException("המספר הזה כבר מוגדר במשרד");

      const changed = await tx.virtualNumber.updateMany({
        where: { id, tenantId },
        data: {
          phone,
          label: body.label,
          leadSource: body.leadSource,
          assignedToUserId: body.assignedToUserId,
          propertyId: body.propertyId,
          isActive: body.isActive,
        },
      });
      if (changed.count === 0) throw new BadRequestException("המספר לא נמצא");
      await this.audit.record(tx, {
        action: "virtual_number.update",
        entityType: "virtual_number",
        entityId: id,
        metadata: { label: body.label, isActive: body.isActive },
      });
    });
    return { ok: true };
  }

  /**
   * מחיקה מוציאה את ההגדרה בלבד — **ההיסטוריה שורדת במלואה**.
   *
   * כל שיחה שכבר נקלטה מחזיקה גם את המספר (`dialedNumber`) וגם את
   * השם כפי שהיה באותו רגע (`dialedLabel`), ולכן מחיקת קמפיין
   * שהסתיים אינה הופכת את השיחות שהגיעו ממנו ל"מספר לא מוגדר".
   * הצילום ולא ההפניה הוא מה שמאפשר את זה.
   *
   * הכיבוי עדיין קיים ועדיף לרוב המקרים: הוא עוצר את הניתוב
   * ומשאיר את ההגדרה זמינה להפעלה מחדש בעונה הבאה.
   */
  @Delete(":id")
  @RequireCapability("settings.manage")
  @HttpCode(200)
  async remove(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<{ ok: true }> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.withTenant(async (tx) => {
      const deleted = await tx.virtualNumber.deleteMany({ where: { id, tenantId } });
      if (deleted.count === 0) throw new BadRequestException("המספר לא נמצא");
      await this.audit.record(tx, {
        action: "virtual_number.delete",
        entityType: "virtual_number",
        entityId: id,
        metadata: {},
      });
    });
    return { ok: true };
  }

  /** אימות הצורה, והחזרת המספר בצורתו הקנונית לשמירה. */
  private assertValid(body: Input): string {
    const reason = virtualNumberRejection(body);
    if (reason !== null) throw new BadRequestException(reason);
    return canonicalVirtualNumber(body.phone);
  }

  /**
   * הסוכן והנכס שייכים למשרד הזה.
   *
   * ה-RLS כבר מגן על הכתיבה, אבל מזהה של סוכן ממשרד אחר היה נשמר
   * בשקט ואז מנתב לידים לאדם שאינו קיים — כלומר לידים שנעלמים.
   * שגיאה בשמירה עדיפה על ניתוב שקט לשום מקום.
   */
  private async assertReferences(
    tx: Parameters<Parameters<PrismaService["withTenant"]>[0]>[0],
    tenantId: string,
    body: Input,
  ): Promise<void> {
    if (body.assignedToUserId !== null) {
      const user = await tx.user.findFirst({
        where: { id: body.assignedToUserId, tenantId, isActive: true },
        select: { id: true },
      });
      if (!user) throw new BadRequestException("הסוכן שנבחר אינו פעיל במשרד");
    }
    if (body.propertyId !== null) {
      const property = await tx.property.findFirst({
        where: { id: body.propertyId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!property) throw new BadRequestException("הנכס שנבחר לא נמצא");
    }
  }
}
