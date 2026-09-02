import { BadRequestException, Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { z } from "zod";
import { AnyAuthenticated, RequireCapability } from "../../common/auth.decorators";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { AuditService } from "../../core/audit.service";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { PrismaService } from "../../core/prisma.service";
import { WhatsAppConnectionService } from "./whatsapp-connection.service";

/**
 * חיבור המספר העסקי **של הסוכן** (docs/12) — מה שהמסך „וואטסאפ
 * ביזנס” קורא לו.
 *
 * ## למה הנתיבים האישיים אינם דורשים יכולת
 *
 * הקו הוא של הסוכן: הוא מחבר את המספר שבכיס שלו, הלקוחות שכותבים
 * אליו הם שלו, והלידים נוחתים אצלו. יכולת ניהולית כתנאי הייתה
 * אומרת שסוכן זקוק לאישור בעל המשרד כדי לחבר את הטלפון של עצמו.
 * לכן `@AnyAuthenticated` — פתוח בכוונה, ומוגבל **לקו שלו בלבד**
 * דרך ה-`userId` שמגיע מההקשר ולא מהבקשה.
 *
 * ## ולמה יש בכל זאת שני נתיבי משרד
 *
 * סוכן שעזב משאיר קו מחובר. בלי נתיב ניהולי הוא היה נשאר כך לנצח,
 * כי הבעלים היחיד שרשאי לנתק אותו כבר אינו במערכת. שני הנתיבים
 * האלה מחזירים נתוני משרד ולכן הם תחת `settings.manage`, ומופרדים
 * מהאישיים במקום להרחיב אותם בשקט לפי תפקיד.
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
   * הקו של הסוכן המחובר + מה שהפרונט צריך כדי לפתוח את הפופאפ.
   *
   * ‎`signup: null` = הפלטפורמה לא הוגדרה מול Meta, והמסך מציג הסבר
   * במקום כפתור שנשבר בלחיצה.
   */
  @Get()
  @AnyAuthenticated()
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
    const { tenantId, userId } = TenantContext.current();
    const [connections, signup, botIncluded] = await Promise.all([
      this.connections.list(tenantId, userId),
      this.connections.signupConfig(),
      this.plans.tenantHasFeature(tenantId, "whatsapp_bot"),
    ]);
    return { connections, signup, botIncluded };
  }

  /** סיום הזרימה: הפרונט מוסר את מה שהפופאפ החזיר, והשרת מחבר. */
  @Post()
  @AnyAuthenticated()
  async complete(
    @Body(new ZodValidationPipe(CompleteSchema)) body: z.infer<typeof CompleteSchema>,
  ): Promise<{ connection: Awaited<ReturnType<WhatsAppConnectionService["list"]>>[number] }> {
    const { tenantId, userId } = TenantContext.current();
    const result = await this.connections.complete(tenantId, userId, body);
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

  /** ניתוק הקו של הסוכן עצמו. קו של עמית אינו נמצא ולכן אינו נותק. */
  @Delete(":id")
  @AnyAuthenticated()
  async disconnect(@Param("id") id: string): Promise<{ ok: true }> {
    const { tenantId, userId } = TenantContext.current();
    const done = await this.connections.disconnect(tenantId, id, "user_request", userId);
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

  /** כל קווי המשרד — תצוגת ניהול, כדי לדעת מי מחובר ומי לא. */
  @Get("office")
  @RequireCapability("settings.manage")
  async listOffice(): Promise<{
    connections: Awaited<ReturnType<WhatsAppConnectionService["list"]>>;
  }> {
    const { tenantId } = TenantContext.current();
    return { connections: await this.connections.list(tenantId) };
  }

  /**
   * ניתוק קו של סוכן אחר — המסלול היחיד לשחרר מספר של מי שעזב.
   * נרשם ביומן עם סיבה אחרת, כדי שיהיה אפשר להבחין בין „ניתקתי את
   * שלי” לבין „המשרד ניתק אותי”.
   */
  @Delete("office/:id")
  @RequireCapability("settings.manage")
  async disconnectOffice(@Param("id") id: string): Promise<{ ok: true }> {
    const { tenantId } = TenantContext.current();
    const done = await this.connections.disconnect(tenantId, id, "office_admin");
    if (!done) throw new BadRequestException("החיבור לא נמצא או שכבר נותק");
    await this.prisma.withTenant(async (tx) => {
      await this.audit.record(tx, {
        action: "whatsapp.connection.disconnected",
        entityType: "whatsapp_connection",
        entityId: id,
        metadata: { by: "office_admin" },
      });
    });
    return { ok: true };
  }
}
