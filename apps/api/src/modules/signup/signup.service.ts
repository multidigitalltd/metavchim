import { BadRequestException, Injectable } from "@nestjs/common";
import { ulid } from "ulid";
import type { PlanDefinition } from "@metavchim/shared";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { PrismaService } from "../../core/prisma.service";
import { EmailService } from "../../core/email.service";
import { AuthService, type ValidatedUser } from "../auth/auth.service";

/**
 * הרשמה עצמית של משרד תיווך.
 *
 * עד כה משרד הוקם רק ידנית ממסך הפלטפורמה — כלומר כל לקוח חדש דרש
 * נוכחות של בעל הפלטפורמה. כאן המשרד נרשם בעצמו, מקבל תקופת ניסיון,
 * ומתחיל לעבוד מיד.
 *
 * ההרשמה יוצרת **דייר חדש**, וזו הפעולה הרגישה ביותר שנתיב ציבורי
 * יכול לעשות במערכת רב-דיירית. ההגנות:
 * - הגבלת קצב על הנתיב (Throttle בבקר)
 * - האימייל חייב להיות ייחודי בכל המערכת, כמו בכל התחברות
 * - רק מסלול ש**מסומן ציבורי** ניתן לבחירה — מסלול "רשת" נסגר בשיחה
 * - הדייר נפתח בסטטוס `trial` עם תאריך תפוגה, לא כלקוח משלם
 */
@Injectable()
export class SignupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlanCatalogService,
    private readonly email: EmailService,
  ) {}

  /** המסלולים שמוצגים בדף ההרשמה. */
  async offeredPlans(): Promise<PlanDefinition[]> {
    return this.plans.publicPlans();
  }

  async register(input: {
    agencyName: string;
    ownerName: string;
    email: string;
    phone?: string;
    password: string;
    plan: string;
  }): Promise<{ user: ValidatedUser; trialEndsAt: Date | null }> {
    const email = input.email.toLowerCase().trim();

    const plan = await this.plans.byCode(input.plan);
    /*
     * מסלול שאינו ציבורי נדחה גם אם הוא קיים.
     * הבחירה מגיעה מהדפדפן, ולכן "לא מוצג במסך" אינו אכיפה — בלי
     * הבדיקה הזו כל אחד היה יכול להירשם למסלול הרשת בשליחת הקוד שלו.
     */
    if (!plan || !plan.isPublic) {
      throw new BadRequestException("המסלול שנבחר אינו זמין להרשמה");
    }

    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      /*
       * הודעה מפורשת ולא "משתמש קיים" סתמי.
       *
       * זו אינה דליפת מידע חדשה: מסך ההתחברות ממילא מבדיל בין
       * "אימייל או סיסמה שגויים" לבין חשבון שקיים, ומי שמנסה להירשם
       * עם כתובת שכבר רשומה צריך לדעת שהפתרון הוא התחברות ולא
       * הרשמה נוספת.
       */
      throw new BadRequestException("הכתובת כבר רשומה במערכת — התחברו או אפסו סיסמה");
    }

    const tenantId = ulid();
    const userId = ulid();
    const passwordHash = await AuthService.hashPassword(input.password);
    const trialEndsAt =
      plan.trialDays > 0
        ? new Date(Date.now() + plan.trialDays * 24 * 60 * 60 * 1000)
        : null;

    /*
     * דייר ומשתמש בטרנזקציה אחת.
     *
     * דייר בלי בעלים הוא רשומה יתומה שאיש לא יכול להיכנס אליה, והיא
     * גם תופסת את שם המשרד. כשל בהצפנת הסיסמה או בכתיבת המשתמש חייב
     * לגרור את הדייר איתו.
     */
    const agencyName = input.agencyName.trim();
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.tenant.create({
        data: {
          id: tenantId,
          name: agencyName,
          plan: plan.code,
          // ניסיון ולא פעיל: התשלום עוד לא נגבה
          status: "trial",
          trialEndsAt,
          signupSource: "self",
        },
      });
      return tx.user.create({
        data: {
          id: userId,
          tenantId,
          name: input.ownerName.trim(),
          email,
          phone: input.phone?.trim() || null,
          passwordHash,
          role: "owner",
          // הסיסמה נבחרה על ידי המשתמש עצמו — אין מה להחליף
          mustChangePassword: false,
        },
        select: { id: true, name: true, email: true, role: true, passwordChangedAt: true },
      });
    });

    // מייל פתיחה — best-effort. משרד שנרשם בהצלחה לא אמור לראות
    // שגיאה כי ספק האימייל לא מוגדר בסביבה הזו.
    void this.sendWelcome(email, input.ownerName, plan, trialEndsAt);

    return {
      user: {
        id: created.id,
        tenantId,
        name: created.name,
        email: created.email,
        role: created.role,
        mustChangePassword: false,
        tenantName: agencyName,
        // החותמת מה-DB ולא מהשעון המקומי: היא זו שה-Session נחתם
        // מולה, ופער בין השניים היה פוסל את ה-Session מיד
        passwordChangedAt: created.passwordChangedAt,
      },
      trialEndsAt,
    };
  }

  private async sendWelcome(
    email: string,
    name: string,
    plan: PlanDefinition,
    trialEndsAt: Date | null,
  ): Promise<void> {
    try {
      if (!(await this.email.isConfigured())) return;
      const until =
        trialEndsAt === null
          ? ""
          : ` תקופת הניסיון פתוחה עד ${trialEndsAt.toLocaleDateString("he-IL")}.`;
      await this.email.send(
        email,
        "ברוכים הבאים למתווכים",
        `שלום ${name},\n\nהמשרד שלכם נפתח במסלול "${plan.name}".${until}\n\nאפשר להתחיל להזין נכסים וקונים כבר עכשיו.`,
      );
    } catch {
      // שליחת מייל אינה חלק מהצלחת ההרשמה
    }
  }
}
