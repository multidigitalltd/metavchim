import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import * as argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
import { ulid } from "ulid";
import {
  applyBlockedModules,
  isTrialExpired,
  resolveCapabilities,
  type Capability,
} from "@metavchim/shared";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { PrismaService } from "../../core/prisma.service";
import type { RequestContext } from "../../common/tenant-context";

const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 שעות; Refresh בפעילות

/** חיבור פתוח כפי שהוא מוצג — בלי הטוקן ובלי ה-hash שלו. */
export interface SessionInfo {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  expiresAt: Date;
  /** המכשיר שממנו נשלחה הבקשה הזו */
  current: boolean;
  /** לא null = חיבור של התמיכה בהסכמת המשרד, ולא של המשתמש */
  supportAdminEmail: string | null;
}

export interface AuthenticatedUser {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: string;
  mustChangePassword: boolean;
  /** שם המשרד — מוצג בסרגל הצד; נטען פעם אחת עם ה-Session */
  tenantName?: string;
  /**
   * סוף תקופת הניסיון — כדי שהמערכת תוכל להזהיר לפני שהיא נועלת.
   * null = אין תפוגה (משרד משלם או שהוקם ידנית).
   */
  trialEndsAt?: string | null;
}

/**
 * משתמש שאומת אך טרם קיבל Session. `passwordChangedAt` נלכד בזמן
 * האימות ונחתם ל-Session — כך Session שנוצר במרוץ מול איפוס סיסמה
 * (אימות לפני האיפוס, יצירה אחריו) נושא חותמת ישנה ונפסל.
 */
/** הפרופיל של המשתמש עצמו — כולל העדפות שנוסעות איתו בין מכשירים. */
export interface ProfileDto {
  name: string;
  email: string;
  phone: string;
  /** false = החשבון מחובר דרך Google ואין לו סיסמה במערכת */
  hasPassword: boolean;
  preferences: Record<string, unknown>;
}

export interface ValidatedUser extends AuthenticatedUser {
  passwordChangedAt: Date;
}

/**
 * האם המשרד רשאי לעבוד עכשיו.
 *
 * שלושה תנאים ולא אחד: הסטטוס (השהיה מהפלטפורמה), תפוגת הניסיון,
 * ותפוגת המנוי בתשלום. שני האחרונים נוספו אחרי אותה תקלה בדיוק —
 * סטטוס אינו משתנה מעצמו, ולכן משרד היה ממשיך לעבוד לנצח.
 *
 * **הפרדה חשובה:** השהיה ותפוגה אינן אותו דבר. משרד מושהה אינו
 * מתחבר; משרד שתקופתו נגמרה **כן** מתחבר — ומגיע למסך המנוי ולשם
 * בלבד. נעילה מלאה שלו הייתה חוסמת אותו מחוץ למסך היחיד שפותר את
 * הבעיה, כלומר הופכת כל ניסיון שפג ללקוח אבוד.
 *
 * **התפוגות נבדקות כאן ולא בסורק.** זו הנקודה: סורק שלא רץ, או
 * שנפל, או שטרם הגיע לשורה הזו, היה נותן גישה חינם. התאריך על שורת
 * הדייר הוא מקור האמת, והוא נקרא ממילא בכל אימות Session.
 *
 * `null` בשני התאריכים פירושו "בלי תפוגה", וזה המצב של משרד שהוקם
 * ידנית מהפלטפורמה. ההפרדה בין שני השדות היא מה שמאפשר להפעיל משרד
 * בלי למחוק את היסטוריית הניסיון שלו.
 */
export interface TenantGateInput {
  status: string;
  trialEndsAt?: Date | null;
  paidUntil?: Date | null;
  /**
   * המסלול של המשרד חינמי — ולכן אין לו תפוגה, נקודה.
   *
   * זה אינו קיצור נוחות אלא תיקון של הנחה שגויה: „חינם = בלי
   * תפוגה” הוכרע פעם אחת, בהרשמה, ונכתב לשורה כתאריך. כל מה שקרה
   * אחר כך — מסלול ששויך מהפלטפורמה, מסלול שנערך והפך לחינמי,
   * מסלול חינמי שבזמן ההרשמה עוד לא נראה כזה — השאיר תאריך תפוגה
   * שפג אחרי 14 יום וסגר חשבון שאמור להיות לתמיד (דיווח המשתמש).
   *
   * מסלול חינמי אין ממה לגבות עליו ואין מה שיפוג בו, ולכן התשובה
   * נגזרת מהמסלול החי ולא ממה שנכתב פעם.
   */
  planIsFree?: boolean;
}

/**
 * השהיה מהפלטפורמה — נעילה מלאה, בלי התחברות בכלל.
 *
 * זו הנעילה של בעל הפלטפורמה, ולא של החיוב. משרד כזה אינו אמור
 * להיכנס לשום מסך, כולל מסך המנוי.
 */
export function tenantSuspended(tenant: TenantGateInput): boolean {
  return !["active", "trial"].includes(tenant.status);
}

/**
 * התקופה נגמרה — ניסיון שפג או מנוי בתשלום שהסתיים.
 *
 * `paidUntil`/`trialEndsAt` שווים `null` פירושם "בלי תפוגה", וזה
 * המצב של משרד שהוקם ידנית מהפלטפורמה.
 *
 * התפוגה נבדקת **כאן**, על שורת הדייר, ולא בסורק שאולי ירוץ: סורק
 * שנפל היה נותן גישה חינם לכל מי ששילם פעם אחת (ביקורת Codex).
 */
export function tenantPeriodEnded(tenant: TenantGateInput): boolean {
  // מסלול חינמי אינו פוקע — גם אם נשאר על השורה תאריך מלפני שהיה כזה
  if (tenant.planIsFree === true) return false;
  const now = Date.now();
  if (tenant.status === "trial") return isTrialExpired(tenant.trialEndsAt, new Date());
  if (tenant.status === "active") {
    return tenant.paidUntil instanceof Date && tenant.paidUntil.getTime() <= now;
  }
  return false;
}

export function tenantCanOperate(tenant: TenantGateInput): boolean {
  return !tenantSuspended(tenant) && !tenantPeriodEnded(tenant);
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlanCatalogService,
  ) {}

  static hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  static async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  /**
   * Login — אחת משתי הפעולות היחידות שרצות בלי הקשר דייר (יחד עם resolveSession).
   * הודעת השגיאה זהה בכל תרחיש כישלון — אין דליפת "האימייל קיים/לא קיים".
   */
  async login(
    email: string,
    password: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<{ token: string; expiresAt: Date; user: AuthenticatedUser }> {
    const user = await this.validateCredentials(email, password);
    return this.issueSession(user, meta);
  }

  /**
   * אימות אימייל+סיסמה בלבד, בלי יצירת Session — משמש גם את שלב
   * הסיסמה של התחברות עם קוד אימייל (OTP), כשזו מופעלת.
   */
  async validateCredentials(email: string, password: string): Promise<ValidatedUser> {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });

    // אימות דמה גם כשאין משתמש — עלות זהה, אין Timing Oracle.
    const hashToVerify =
      user?.passwordHash ??
      "$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    let passwordOk = false;
    try {
      passwordOk = await argon2.verify(hashToVerify, password);
    } catch {
      passwordOk = false;
    }

    if (!user || !user.isActive || !passwordOk) {
      throw new UnauthorizedException("אימייל או סיסמה שגויים");
    }

    // משרד מושהה/סגור — אין התחברות (השהיה מהפלטפורמה = נעילה מלאה:
    // ה-sessions הקיימים נמחקים בהשהיה, וכאן נחסמת התחברות מחדש)
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { status: true, trialEndsAt: true, paidUntil: true },
    });
    // השהיה חוסמת התחברות; תפוגה לא — ראו tenantCanOperate
    if (tenant && tenantSuspended(tenant)) {
      throw new UnauthorizedException("החשבון של המשרד מושהה — פנו לתמיכה");
    }

    return {
      id: user.id,
      tenantId: user.tenantId,
      name: user.name,
      email: user.email,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
      passwordChangedAt: user.passwordChangedAt,
    };
  }

  /**
   * כניסה עם זהות חיצונית מאומתת (Google) — **בלי הרשמה עצמית**.
   * הספק מוכיח בעלות על כתובת אימייל; ההרשאה עצמה תלויה בכך שהמשתמש
   * כבר הוזמן למשרד. אימייל לא מוכר ⇒ דחייה.
   */
  async loginWithVerifiedEmail(email: string): Promise<ValidatedUser> {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException("החשבון לא קיים במערכת — פנו למנהל המשרד");
    }

    /*
     * משתמש שהוזמן וטרם החליף את הסיסמה הזמנית: הכניסה עם Google
     * מוכיחה בעלות על הכתובת, ולכן אין טעם לחסום אותו במסך החלפת
     * סיסמה שהוא לא יוכל לעבור (הוא לא מכיר את הזמנית). במקביל
     * הסיסמה הזמנית — שמנהל המשרד יצר ומכיר — מבוטלת לגמרי, כדי
     * שלא תישאר דלת פתוחה לחשבון (docs/04 §3).
     */
    if (user.mustChangePassword) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: null, mustChangePassword: false, passwordChangedAt: new Date() },
      });
    }

    return this.getUserForSession(user.id);
  }

  /** שליפת משתמש לאחר אימות OTP — כולל בדיקות פעילות/סטטוס משרד. */
  async getUserForSession(userId: string): Promise<ValidatedUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) throw new UnauthorizedException();
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { status: true, trialEndsAt: true, paidUntil: true },
    });
    if (tenant && tenantSuspended(tenant)) {
      throw new UnauthorizedException("החשבון של המשרד מושהה — פנו לתמיכה");
    }
    return {
      id: user.id,
      tenantId: user.tenantId,
      name: user.name,
      email: user.email,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
      passwordChangedAt: user.passwordChangedAt,
    };
  }

  /** יצירת Session למשתמש שכבר אומת (סיסמה, ואם מופעל — גם קוד אימייל). */
  async issueSession(
    user: ValidatedUser,
    meta: { ip?: string; userAgent?: string },
  ): Promise<{ token: string; expiresAt: Date; user: AuthenticatedUser }> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await this.prisma.session.create({
      data: {
        id: ulid(),
        userId: user.id,
        tokenHash: AuthService.hashToken(token),
        expiresAt,
        ipAddress: meta.ip ?? null,
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
        // החותמת שנלכדה באימות — לא הערך העדכני. אם הסיסמה שונתה
        // בין האימות ליצירה, ה-Session נולד עם חותמת ישנה ונפסל.
        passwordEpoch: user.passwordChangedAt,
      },
    });
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return { token, expiresAt, user };
  }

  async getProfile(userId: string): Promise<ProfileDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return {
      name: user.name,
      email: user.email,
      phone: user.phone ?? "",
      hasPassword: user.passwordHash !== null,
      preferences: (user.preferences ?? {}) as Record<string, unknown>,
    };
  }

  /**
   * עריכת הפרופיל של המשתמש עצמו.
   *
   * שינוי האימייל מטופל בנפרד משאר השדות, כי הוא שינוי *זהות
   * ההתחברות* ולא עדכון פרט: מי שתפס מסך פתוח לרגע היה יכול להעביר
   * את החשבון לכתובת שלו ואז "לשכוח סיסמה". לכן נדרשת הסיסמה
   * הנוכחית, וכל שאר ה-Sessions מבוטלים אחריו.
   */
  async updateProfile(
    userId: string,
    input: {
      name?: string;
      phone?: string;
      email?: string;
      currentPassword?: string;
      preferences?: Record<string, unknown>;
    },
    /** הטוקן של הבקשה הנוכחית — נשמר כשמנתקים את שאר החיבורים */
    currentSessionToken?: string,
  ): Promise<ProfileDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    const data: {
      name?: string;
      phone?: string | null;
      email?: string;
      preferences?: object;
    } = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.phone !== undefined) data.phone = input.phone.trim() === "" ? null : input.phone.trim();
    /*
     * ההעדפות **ממוזגות** ולא מוחלפות.
     *
     * במסך הפרופיל יושבים כמה פקדים עצמאיים (נגישות, עדכוני
     * וואטסאפ), וכל אחד שולח את מה שהוא מכיר על גבי תצלום שקרא
     * בטעינה. החלפה מלאה גרמה לכך שהפקד ששמר אחרון מחק את מה
     * שהאחר שמר לפניו — שניהם הציגו „נשמר”, ואחד מהם שיקר
     * (ביקורת Codex). המיזוג ברמה העליונה בשרת פותר את זה לכל
     * הפקדים בבת אחת, גם עתידיים.
     */
    if (input.preferences !== undefined) {
      const current = (user.preferences ?? {}) as Record<string, unknown>;
      data.preferences = { ...current, ...input.preferences } as object;
    }

    const nextEmail = input.email?.trim().toLowerCase();
    const emailChanging = nextEmail !== undefined && nextEmail !== user.email;
    if (emailChanging) {
      if (user.passwordHash === null) {
        // חשבון Google: אין סיסמה לאמת מולה, והכתובת מנוהלת אצל הספק
        throw new BadRequestException(
          "החשבון מחובר דרך Google — כתובת האימייל מנוהלת שם ולא כאן",
        );
      }
      if (!input.currentPassword) {
        throw new BadRequestException("להחלפת כתובת האימייל יש להזין את הסיסמה הנוכחית");
      }
      const ok = await argon2.verify(user.passwordHash, input.currentPassword).catch(() => false);
      if (!ok) throw new UnauthorizedException("הסיסמה הנוכחית שגויה");

      const taken = await this.prisma.user.findUnique({ where: { email: nextEmail } });
      if (taken) throw new BadRequestException("הכתובת כבר רשומה במערכת");
      data.email = nextEmail;
    }

    const updated = await this.prisma.user.update({ where: { id: userId }, data });

    if (emailChanging) {
      /*
       * כל חיבור פתוח *אחר* נסגר — למעט זה שמבצע את השינוי.
       *
       * מחיקה גורפת הייתה מנתקת גם את המשתמש שעומד מול המסך: העוגייה
       * שלו מצביעה על שורה שנמחקה, הבקשה הבאה מוציאה אותו, ושמירות
       * שנעשו באותו מסך נבלעות. הסרת ה-Session הנוכחי מהמחיקה נותנת
       * בדיוק את מה שהודעת המסך מבטיחה (ביקורת Codex).
       */
      await this.revokeOtherSessions(userId, currentSessionToken);
    }

    return {
      name: updated.name,
      email: updated.email,
      phone: updated.phone ?? "",
      hasPassword: updated.passwordHash !== null,
      preferences: (updated.preferences ?? {}) as Record<string, unknown>,
    };
  }

  /**
   * "אל תציג יותר" לפאנל עזרה — מיזוג אטומי בשרת.
   *
   * עדכון jsonb במשפט אחד ולא קריאה-ואז-כתיבה בצד הלקוח: שני
   * מכשירים (או לשונית נגישות פתוחה) שכותבים preferences במקביל
   * דורסים זה את זה, והפאנל שנסגר חוזר (ביקורת Codex). התנאי מונע
   * כפילויות במערך והפעולה אידמפוטנטית.
   */
  async dismissPanel(userId: string, key: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE users
      SET preferences = jsonb_set(
        COALESCE(preferences, '{}'::jsonb),
        '{dismissedPanels}',
        COALESCE(preferences->'dismissedPanels', '[]'::jsonb) || to_jsonb(${key}::text)
      )
      WHERE id = ${userId}
        AND NOT (COALESCE(preferences->'dismissedPanels', '[]'::jsonb) @> to_jsonb(${key}::text))
    `;
  }

  /** החלפת סיסמה ע"י המשתמש עצמו — מנקה את דגל mustChangePassword. */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    currentSessionToken?: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash) throw new UnauthorizedException();
    const ok = await argon2.verify(user.passwordHash, currentPassword).catch(() => false);
    if (!ok) throw new UnauthorizedException("הסיסמה הנוכחית שגויה");

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await AuthService.hashPassword(newPassword),
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      },
    });
    // כל שאר ה-Sessions מבוטלים אחרי שינוי סיסמה — הנוכחי נשאר.
    // ההערה כאן תמיד הבטיחה זאת, אבל המחיקה הייתה גורפת בפועל.
    await this.revokeOtherSessions(userId, currentSessionToken);
  }

  /**
   * ביטול כל החיבורים הפתוחים של המשתמש חוץ מזה שמבצע את הפעולה.
   *
   * בלי הטוקן הנוכחי (קריאה פנימית ללא הקשר בקשה) המחיקה גורפת —
   * וזו ההתנהגות הנכונה שם.
   */
  private async revokeOtherSessions(userId: string, currentToken?: string): Promise<void> {
    await this.prisma.session.deleteMany({
      where: {
        userId,
        ...(currentToken ? { tokenHash: { not: AuthService.hashToken(currentToken) } } : {}),
      },
    });
  }

  async logout(token: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { tokenHash: AuthService.hashToken(token) } });
  }

  /**
   * החיבורים הפתוחים של משתמש — מה שמאפשר לו לראות שמישהו אחר
   * מחובר בשמו.
   *
   * **בלי `tokenHash`, לעולם.** הוא לא הסיסמה אבל הוא המפתח: מי
   * שיודע אותו אינו יכול לזייף עוגייה, אבל התשובה הזו נשלחת לדפדפן
   * ונשמרת בכל מקום שדפדפן שומר בו תשובות. אין שום סיבה שהיא תכיל
   * אותו.
   *
   * פגי תוקף אינם מוצגים: הם אינם חיבור פתוח, והצגתם הופכת רשימה
   * שנועדה לענות על „מי מחובר עכשיו” לארכיון שאי אפשר לקרוא.
   */
  async listSessions(userId: string, currentToken?: string): Promise<SessionInfo[]> {
    const currentHash = currentToken ? AuthService.hashToken(currentToken) : null;
    const rows = await this.prisma.session.findMany({
      where: { userId, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => ({
      id: row.id,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      /*
       * „זה המכשיר שאתה עליו עכשיו”. בלעדיו המשתמש רואה שתי שורות
       * דומות ואינו יודע איזו מהן לנתק — ומנתק את עצמו.
       */
      current: currentHash !== null && row.tokenHash === currentHash,
      /* חיבור של התמיכה, לא של המשתמש — מסומן במפורש */
      supportAdminEmail: row.supportAdminEmail,
    }));
  }

  /**
   * ניתוק חיבור בודד לפי מזהה.
   *
   * `userId` הוא חלק מהתנאי ולא נבדק אחרי השליפה: מזהה חיבור של
   * משתמש אחר פשוט אינו מוצא שורה, ולכן אי אפשר לנתק מישהו זר גם
   * במזהה מנוחש. מחזירה `false` כשלא נמחק דבר, כדי שהנתיב יחזיר
   * 404 ולא „בוצע” על פעולה שלא קרתה.
   */
  async revokeSession(userId: string, sessionId: string): Promise<boolean> {
    const { count } = await this.prisma.session.deleteMany({
      where: { id: sessionId, userId },
    });
    return count > 0;
  }

  /**
   * ניתוק כל החיבורים של משתמש — כולל הנוכחי שלו.
   *
   * זו הפעולה של מנהל המשרד על עובד, ולכן היא גורפת בכוונה: מנהל
   * שמנתק מכשיר שאבד ומשאיר חיבור אחד פתוח לא עשה כלום.
   *
   * `exceptToken` קיים בשביל המקרה ההפוך — משתמש שמנתק את **כל
   * השאר** מהמכשיר שלו ואינו רוצה למצוא את עצמו בחוץ.
   */
  async revokeAllSessions(userId: string, exceptToken?: string): Promise<number> {
    const { count } = await this.prisma.session.deleteMany({
      where: {
        userId,
        ...(exceptToken ? { tokenHash: { not: AuthService.hashToken(exceptToken) } } : {}),
      },
    });
    return count;
  }

  /** פענוח עוגיית Session → הקשר בקשה מלא, או null אם לא מאומת. */
  async resolveSession(
    token: string,
  ): Promise<{ context: RequestContext; user: AuthenticatedUser } | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: AuthService.hashToken(token) },
      include: {
        user: {
          include: {
            tenant: {
              select: {
                status: true,
                name: true,
                plan: true,
                trialEndsAt: true,
                paidUntil: true,
                supportAccessUntil: true,
                // חסימות הפלטפורמה — נקראות יחד עם שורת המשרד שממילא
                // נטענת כאן, בלי שאילתה נוספת לכל בקשה
                blockedModules: true,
              },
            },
          },
        },
      },
    });
    if (!session || session.expiresAt < new Date() || !session.user.isActive) {
      return null;
    }
    // אכיפת השהיית משרד בכל בקשה — session שנוצר במרוץ מול ההשהיה
    // (login שהספיק לעבור אימות לפני מחיקת ה-sessions) נפסל כאן (Codex)
    if (tenantSuspended(session.user.tenant)) {
      return null;
    }
    // עידן הסיסמה: Session שאומת מול סיסמה ישנה נפסל — גם אם נוצר
    // אחרי מחיקת ה-sessions שבאיפוס (מרוץ; ביקורת Codex)
    if (
      session.passwordEpoch === null ||
      session.passwordEpoch.getTime() < session.user.passwordChangedAt.getTime()
    ) {
      return null;
    }
    /*
     * Session של תמיכה חי רק בתוך חלון ההסכמה — **נבדק בכל בקשה**.
     *
     * הביטול של בעל המשרד חייב לתפוס מיד, לא בפקיעה הבאה: "ביטלתי
     * את הגישה" שמשאיר את התמיכה בפנים עוד שעה הופך את כפתור הביטול
     * להצהרה ריקה. תפוגת ה-Session עצמה מיושרת לחלון ממילא, אבל
     * הבדיקה כאן היא מה שהופך את הביטול המוקדם לאמיתי.
     */
    if (
      session.supportAdminEmail !== null &&
      (session.user.tenant.supportAccessUntil === null ||
        session.user.tenant.supportAccessUntil.getTime() <= Date.now())
    ) {
      return null;
    }
    /*
     * חריגי ההרשאה של המשתמש נטענים בכל בקשה, ולא נצרבים ב-Session.
     *
     * זו הנקודה היחידה במערכת שבה נקבעות היכולות בפועל, וזה מכוון:
     * מנהל שחוסם מודול מסוכן מצפה שזה יתפוס *עכשיו*, לא בכניסה הבאה
     * שלו. חריג צרוב היה משאיר סוכן מפוטר עם גישה מלאה עד שה-Session
     * יפוג. המחיר הוא שאילתה אחת לפי אינדקס — זניח מול בקשה שממילא
     * טוענת את המשתמש והדייר.
     *
     * הסינון לפי תפוגה נעשה בקוד (resolveCapabilities) ולא ב-SQL,
     * כדי שאותו כלל יהיה גם מה שהבדיקות מכסות וגם מה שהמסך מציג.
     *
     * withExplicitTenant ולא שאילתה ישירה: הפונקציה הזו רצה לפני
     * שקיים הקשר דייר, והטבלה תחת FORCE RLS — בלי app.tenant_id
     * התוצאה הייתה אפס שורות בשקט, כלומר כל ההרשאות מתעלמות.
     */
    const overrides = await this.prisma.withExplicitTenant(session.user.tenantId, (tx) =>
      tx.userCapability.findMany({
        where: { userId: session.user.id, tenantId: session.user.tenantId },
        select: { capability: true, effect: true, expiresAt: true },
      }),
    );
    /*
     * חסימת מודול של הפלטפורמה מוחלת **אחרי** חריגי המנהל, ולא
     * כחריג נוסף: חריג deny ברמת המשתמש נמחק בלחיצה של מנהל המשרד,
     * וחסימה שהנחסם יכול להסיר אינה חסימה. הכיוון חד־צדדי — היא
     * מורידה יכולות ולעולם לא מוסיפה.
     */
    const capabilities = applyBlockedModules(
      resolveCapabilities(
        session.user.role,
        overrides.map((o) => ({
          capability: o.capability as Capability,
          effect: o.effect === "grant" ? "grant" : "deny",
          expiresAt: o.expiresAt,
        })),
        new Date(),
      ),
      session.user.tenant.blockedModules,
    );
    /*
     * המסלול נקרא מהקטלוג המומטמן ולא מהמסד — הקוד הזה רץ על כל
     * בקשה, ושאילתה נוספת בכל אחת מהן היא מס.
     */
    const planIsFree = await this.plans.isFreeCode(session.user.tenant.plan);
    return {
      context: {
        tenantId: session.user.tenantId,
        userId: session.user.id,
        capabilities,
        // תקופה שנגמרה אינה פוסלת את ה-Session — היא מצמצמת אותו
        // למסך המנוי. האכיפה ב-AuthGuard.
        billingOnly: tenantPeriodEnded({ ...session.user.tenant, planIsFree }),
        ...(session.supportAdminEmail !== null
          ? { supportAdminEmail: session.supportAdminEmail }
          : {}),
      },
      user: {
        id: session.user.id,
        tenantId: session.user.tenantId,
        name: session.user.name,
        email: session.user.email,
        role: session.user.role,
        mustChangePassword: session.user.mustChangePassword,
        tenantName: session.user.tenant.name,
        /*
         * במסלול חינמי אין ספירה לאחור. הבאנר במסכים נגזר מהשדה
         * הזה, ולכן משרד חינמי עם תאריך ישן על השורה היה רואה
         * „הניסיון מסתיים בעוד X ימים” על חשבון שאינו מסתיים.
         */
        trialEndsAt: planIsFree ? null : (session.user.tenant.trialEndsAt?.toISOString() ?? null),
      },
    };
  }
}
