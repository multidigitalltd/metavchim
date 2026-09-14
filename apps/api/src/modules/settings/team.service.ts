import { BadRequestException, Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { ulid } from "ulid";
import { z } from "zod";
import {
  AssignableRoleSchema,
  limitState,
  WHATSAPP_AGENT_DENIAL_TEXT,
  whatsappAgentSeats,
} from "@metavchim/shared";
import { AuditService } from "../../core/audit.service";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { TenantContext } from "../../common/tenant-context";
import { whatsappSeatQuotaWhere } from "../../core/whatsapp-seat-quota";
import { AuthService } from "../auth/auth.service";
import { LoginThrottleService } from "../auth/login-throttle.service";

/** ‏איש צוות כפי שהוא מוצג — במסך ובשיחה. */
export interface TeamUserDto {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  lastLoginAt?: Date;
  /** נעול זמנית בגלל ניסיונות התחברות כושלים — ניתן לשחרור ע"י המנהל */
  locked: boolean;
  /** מספר הוואטסאפ האישי — הזהות מול הסוכן החכם */
  phone?: string;
  /** מנוי הסוכן בוואטסאפ פעיל למשתמש הזה (בעל המשרד כלול תמיד) */
  whatsappAccess: boolean;
}

/**
 * ‎**מי שנכנס למשרד — נבדק כאן, במקום שכותב.**
 *
 * ## ‏למה לא מספיק שהסכימה של הבקר בודקת
 *
 * ‏היא בודקת את **המסלול שלה**. יש שני מסלולים: הטופס עובר בבקר,
 * ‏ו„תוסיף סוכן” מהשיחה עובר ב-`/agent/execute` — ששם צמצום
 * ‏הפרמטרים מסנן **מפתחות בלבד** (`params[field.key] = body.params[field.key]`)
 * ‏ואינו נוגע בערכים. הרשימה `values` שבקטלוג מגבילה את מה
 * ‏שהמודל **מתבקש לייצר**, לא את מה שהנתיב **מקבל**.
 *
 * ## ‏מה זה אפשר
 *
 * ‏מנהל עם `users.manage` ששולח `memberRole: "owner"` ישירות היה
 * ‏פותח חשבון **בעלים** — עם `billing.manage` וכל מערך היכולות,
 * ‏ועם שורה שמסך ההגדרות עצמו מסרב לערוך אחר כך. כלומר העלאת
 * ‏דרגה עצמית דרך נתיב צדדי (ביקורת Codex, P1).
 *
 * ‏ואימייל פגום („dana”) היה נכנס, השליחה הייתה נכשלת, והיה נשאר
 * ‏חשבון שאי אפשר להיכנס אליו ושתופס מקום במכסה (P2).
 *
 * ‎**הבדיקה יושבת כאן ולא נוספת שם**: זה המקום היחיד שכל מסלול
 * ‏כתיבה חייב לעבור בו, והבקר מייבא את אותה סכימה — הגדרה אחת.
 */
export const TeamMemberInputSchema = z
  .object({
    name: z.string().min(2).max(120),
    email: z.string().email().max(254),
    /* ‏`owner` אינו ברשימה: הוא נקבע בהקמת המשרד ואינו ניתן להענקה */
    role: AssignableRoleSchema,
  })
  .strict();

/**
 * ‎**צוות המשרד — מסלול אחד לקריאה ואחד ליצירה.**
 *
 * ## ‏למה זה יצא מהבקר
 *
 * ‏יצירת משתמש הייתה כתובה **בתוך** `settings.controller.ts`, ולכן
 * ‏הייתה מגיעה רק ממי שעובר בבקר. הסוכן בוואטסאפ אינו עובר בבקרים
 * ‏אלא קורא לשירותים ישירות, ו„תוסיף סוכן דנה” משם היה חייב מסלול
 * ‏כתיבה שני.
 *
 * ‏מסלול שני כאן אינו „עוד שאילתה”: הוא היה מדלג על מכסת המשתמשים
 * ‏של המסלול, על המנעול שמונע שתי בקשות מקבילות מלחצות אותה, ועל
 * ‏רישום היומן שיושב **באותה טרנזקציה** — כלומר חשבון בלי עקבה.
 * ‏השרשרת הזו נבנתה מביקורות, ואין שום סיכוי שהיא תשוחזר נכון
 * ‏פעמיים.
 *
 * ‎**שום התנהגות לא משתנה כאן.** הקוד זהה למה שהיה בבקר; הבקר
 * ‏מאציל, וזה הכול.
 */
@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly plans: PlanCatalogService,
    private readonly loginThrottle: LoginThrottleService,
  ) {}

  async list(): Promise<TeamUserDto[]> {
    const tenantId = TenantContext.current().tenantId;
    const rows = await this.prisma.user.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        phone: true,
        whatsappAccess: true,
      },
    });
    return Promise.all(
      rows.map(async (u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        isActive: u.isActive,
        lastLoginAt: u.lastLoginAt ?? undefined,
        locked: await this.loginThrottle.isLocked(u.email),
        phone: u.phone ?? undefined,
        whatsappAccess: u.whatsappAccess,
      })),
    );
  }

  /**
   * ‏הוספת איש צוות.
   *
   * ‏הסיסמה הזמנית מוחזרת ואינה נשמרת בגלוי: המסך מציג אותה פעם
   * ‏אחת. **מי שאינו יכול להציג אותה בבטחה — הסוכן בוואטסאפ —
   * ‏מתעלם ממנה ושולח קישור לקביעת סיסמה במייל.** סיסמה פעילה
   * ‏בהודעת צ'אט נשארת שם, נקראת בעדכון מסך, ונשלחת הלאה.
   */
  async create(input: {
    name: string;
    email: string;
    role: string;
  }): Promise<{ user: TeamUserDto; tempPassword: string }> {
    /*
     * ‏הבדיקה לפני כל דבר אחר, וכאן ולא אצל הקורא: זה המקום
     * ‏שכותב, ולכן זה המקום שחייב לדחות. ראו ההסבר על הסכימה.
     */
    const parsed = TeamMemberInputSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new BadRequestException(
        issue?.path[0] === "email"
          ? "האימייל אינו תקין"
          : issue?.path[0] === "role"
            ? "התפקיד אינו ניתן להענקה"
            : "השם אינו תקין",
      );
    }
    const tenantId = TenantContext.current().tenantId;
    const email = parsed.data.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new BadRequestException("האימייל כבר רשום במערכת");

    const tempPassword = `Mv-${randomBytes(9).toString("base64url")}`;
    const id = ulid();
    const passwordHash = await AuthService.hashPassword(tempPassword);
    // יצירה + Audit בטרנזקציה אחת — אין חשבון בלי רישום (ביקורת Codex)
    await this.prisma.withTenant(async (tx) => {
      // המכסה נבדקת באותה טרנזקציה שיוצרת, אחרי נעילת הדייר
      await this.assertSeatAvailable(tx, tenantId);
      await tx.user.create({
        data: {
          id,
          tenantId,
          name: parsed.data.name,
          email,
          role: parsed.data.role,
          passwordHash,
          mustChangePassword: true,
        },
      });
      await this.audit.record(tx, {
        action: "users.create",
        entityType: "user",
        entityId: id,
        metadata: { role: parsed.data.role },
      });
    });
    return {
      user: {
        id,
        name: parsed.data.name,
        email,
        role: parsed.data.role,
        isActive: true,
        locked: false,
        whatsappAccess: false,
      },
      tempPassword,
    };
  }

  /**
   * מכסת המשתמשים הפעילים של המסלול.
   *
   * נבדקת על **המושב הבא** ולא על המצב הקיים: משרד שהמכסה שלו הוקטנה
   * ממשיך לעבוד עם מי שכבר יש לו, ורק תפיסת מושב נוסף נחסמת. חסימת
   * הקיימים הייתה מנתקת סוכנים באמצע יום עבודה בגלל שינוי תמחור.
   *
   * נקראת משתי נקודות ולא רק מיצירה: **הפעלה מחדש של משתמש מושבת
   * תופסת מושב בדיוק כמו יצירה**. בלי זה אפשר היה להשבית סוכן, ליצור
   * מחליף, ולהפעיל את הראשון בחזרה — ולעבור את המכסה בלי שום חסימה
   * (ביקורת Codex).
   *
   * הטבלה users מחוץ ל-RLS (ראו הערה ב-schema.prisma), ולכן הספירה
   * הישירה כאן תקפה — התנאי `tenantId` הוא זה שמבודד.
   */
  async assertSeatAvailable(tx: TenantTx, tenantId: string): Promise<void> {
    const plan = await this.plans.forTenant(tenantId, tx);
    // מסלול שאי אפשר לפתור חוסם ולא פותח — ראו properties.service
    if (plan === undefined) {
      throw new BadRequestException("המסלול של המשרד אינו מוגדר — פנו לתמיכה");
    }
    if (plan.maxUsers === null) return;
    /*
     * מנעול ייעוץ ברמת הדייר, בתוך הטרנזקציה שכותבת.
     *
     * שתי בקשות מקבילות שספרו את אותו מצב לפני שאחת מהן כתבה היו
     * שתיהן עוברות, והמכסה הייתה נחצית בשקט (ביקורת Codex).
     */
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seat-quota:${tenantId}`}))`;
    const used = await tx.user.count({ where: { tenantId, isActive: true } });
    if (limitState(used, plan.maxUsers).blocked) {
      throw new BadRequestException(
        `מסלול "${plan.name}" כולל ${plan.maxUsers} משתמשים. לתוספת משתמשים יש לשדרג מסלול.`,
      );
    }
  }

  /**
   * מקומות בתשלום פעילים — נספרים **מחוץ ל-RLS**.
   *
   * ‎`whatsapp_seats` היא טבלת פלטפורמה, כמו `payments`: ההפעלה
   * מגיעה מהוובהוק של קארדקום בלי הקשר דייר. הסינון לפי דייר נאכף
   * כאן, מפורשות, ולא נשען על מדיניות שאינה קיימת על הטבלה.
   *
   * ‏ציבורית כי שלושה קוראים לה: בדיקת המקום ביצירה, בדיקת המקום
   * ‏בהקצאה, ומסך ההגדרות שמציג „כמה מקומות יש לכם”. הגדרה שנייה
   * ‏למי שרק **מציג** הייתה המקום שבו המסך מתחיל לחלוק על השער.
   */
  async paidSeatCount(tenantId: string): Promise<number> {
    return this.prisma.whatsappSeat.count({
      where: whatsappSeatQuotaWhere(tenantId, new Date()),
    });
  }

  /**
   * ‎**מקום פנוי לסוכן הוואטסאפ** — אחרת הרכישה היא בקשה ולא תנאי.
   *
   * מקום אחד כלול, וכל נוסף כרוך בתשלום; בעל הפלטפורמה מעלה את
   * המספר כשהמשרד רוכש. הספירה היא על מי שמוקצה לו המקום **ופעיל**:
   * חשבון מושבת אינו שולח הודעות, ואין סיבה שיחזיק מקום ששולם עליו.
   *
   * הנעילה זהה לזו של מכסת המשתמשים ונלקחת באותה עסקה — היא ניתנת
   * לנעילה חוזרת, ולכן קריאה מתוך מסלול שכבר נעל אינה נחסמת.
   */
  async assertWhatsappSeatAvailable(tx: TenantTx, tenantId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seat-quota:${tenantId}`}))`;
    const tenant = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { whatsappAgentSeatsExtra: true },
    });
    const seats = whatsappAgentSeats({
      planHasAgent: await this.plans.tenantHasFeature(tenantId, "voice_intake", tx),
      granted: tenant?.whatsappAgentSeatsExtra ?? 0,
      paid: await this.paidSeatCount(tenantId),
    });
    if (seats === 0) {
      throw new BadRequestException(WHATSAPP_AGENT_DENIAL_TEXT.plan);
    }
    const used = await tx.user.count({
      where: { tenantId, isActive: true, whatsappAccess: true },
    });
    if (used >= seats) {
      throw new BadRequestException(
        seats === 1
          ? "הסוכן בוואטסאפ כלול לסוכן אחד במשרד. כדי להעביר אותו — כבו אותו אצל מי שמחזיק בו כרגע, או פנו אלינו להוספת מקום."
          : `המשרד מחזיק ${seats} מקומות לסוכן בוואטסאפ, וכולם תפוסים. כבו אצל אחד המחזיקים, או פנו אלינו להוספת מקום.`,
      );
    }
  }
}
