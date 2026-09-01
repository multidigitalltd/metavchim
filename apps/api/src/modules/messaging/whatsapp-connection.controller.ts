import { BadRequestException, Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { z } from "zod";
import { RequireCapability } from "../../common/auth.decorators";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { AuditService } from "../../core/audit.service";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { PrismaService } from "../../core/prisma.service";
import { WhatsAppConnectionService } from "./whatsapp-connection.service";

/**
 * חיבור המספר העסקי של המשרד (docs/12) — מה שהמסך „וואטסאפ ביזנס”
 * בהגדרות קורא לו.
 *
 * ‎`settings.manage` ולא יכולת חדשה: זו הגדרת משרד לכל דבר, וחיבור
 * או ניתוק של הקו הראשי הוא בדיוק מה שבעל המשרד עושה ולא סוכן.
 */

const CompleteSchema = z.object({
  /**
   * ה-`code` שחזר מפופאפ Meta. חד-פעמי וקצר-מועד — הוא נוסע מהדפדפן
   * לשרת ומומר שם, כי ההמרה דורשת את ה-App Secret.
   */
  code: z.string().min(10).max(1000),
  /** מזהי ה-WABA והקו שחזרו באותו אירוע. ספרות בלבד. */
  wabaId: z.string().regex(/^\d{5,30}$/u),
  phoneNumberId: z.string().regex(/^\d{5,30}$/u),
});

@Controller("whatsapp/connections")
export class WhatsAppConnectionController {
  constructor(
    private readonly connections: WhatsAppConnectionService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly plans: PlanCatalogService,
  ) {}

  /**
   * מצב החיבור + מה שהפרונט צריך כדי לפתוח את הפופאפ.
   *
   * ‎`signup: null` = הפלטפורמה לא הוגדרה מול Meta, והמסך מציג הסבר
   * במקום כפתור שנשבר בלחיצה.
   */
  @Get()
  @RequireCapability("settings.manage")
  async list(): Promise<{
    connections: Awaited<ReturnType<WhatsAppConnectionService["list"]>>;
    signup: { appId: string; configId: string } | null;
    /**
     * ‎**האם הבוט כלול במסלול של המשרד.**
     *
     * החיבור וקליטת הפניות פתוחים לכל מסלול — הם אינם עולים לנו
     * דבר. הבוט הוא קריאת LLM לכל תשובה, ולכן הוא פיצ'ר בתשלום.
     * המסך מציג את ההבחנה הזו במפורש, כי „וואטסאפ” שנראה כפיצ'ר
     * אחד וגובה על חציו הוא בדיוק מה שמייצר תחושת הפתעה בחשבונית.
     */
    botIncluded: boolean;
  }> {
    const { tenantId } = TenantContext.current();
    const [connections, signup, botIncluded] = await Promise.all([
      this.connections.list(tenantId),
      this.connections.signupConfig(),
      this.plans.tenantHasFeature(tenantId, "whatsapp_bot"),
    ]);
    return { connections, signup, botIncluded };
  }

  /** סיום הזרימה: הפרונט מוסר את מה שהפופאפ החזיר, והשרת מחבר. */
  @Post()
  @RequireCapability("settings.manage")
  async complete(
    @Body(new ZodValidationPipe(CompleteSchema)) body: z.infer<typeof CompleteSchema>,
  ): Promise<{ connection: Awaited<ReturnType<WhatsAppConnectionService["list"]>>[number] }> {
    const { tenantId } = TenantContext.current();
    const result = await this.connections.complete(tenantId, body);
    if (!result.ok) throw new BadRequestException(result.reason);

    /*
     * ‏ביומן נרשם המספר ולא הטוקן — „מי חיבר איזה קו ומתי” הוא מה
     * שצריך לענות עליו אחרי שנתיים, וסוד אינו הופך למידע ניהולי
     * מפני שהוא נוח.
     */
    await this.prisma.withTenant(async (tx) => {
      await this.audit.record(tx, {
        action: "whatsapp.connection.created",
        entityType: "whatsapp_connection",
        entityId: result.connection.id,
        metadata: { displayPhone: result.connection.displayPhone },
      });
    });
    return { connection: result.connection };
  }

  @Delete(":id")
  @RequireCapability("settings.manage")
  async disconnect(@Param("id") id: string): Promise<{ ok: true }> {
    const { tenantId } = TenantContext.current();
    const done = await this.connections.disconnect(tenantId, id, "user_request");
    if (!done) throw new BadRequestException("החיבור לא נמצא או שכבר נותק");
    await this.prisma.withTenant(async (tx) => {
      await this.audit.record(tx, {
        action: "whatsapp.connection.disconnected",
        entityType: "whatsapp_connection",
        entityId: id,
      });
    });
    return { ok: true };
  }
}
