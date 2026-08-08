import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import * as argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
import { ulid } from "ulid";
import { resolveCapabilities, type Capability } from "@metavchim/shared";
import { PrismaService } from "../../core/prisma.service";
import type { RequestContext } from "../../common/tenant-context";

const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 שעות; Refresh בפעילות

export interface AuthenticatedUser {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: string;
  mustChangePassword: boolean;
  /** שם המשרד — מוצג בסרגל הצד; נטען פעם אחת עם ה-Session */
  tenantName?: string;
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

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

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
      select: { status: true },
    });
    if (tenant && !["active", "trial"].includes(tenant.status)) {
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
      select: { status: true },
    });
    if (tenant && !["active", "trial"].includes(tenant.status)) {
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
    if (input.preferences !== undefined) data.preferences = input.preferences as object;

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

  /** פענוח עוגיית Session → הקשר בקשה מלא, או null אם לא מאומת. */
  async resolveSession(
    token: string,
  ): Promise<{ context: RequestContext; user: AuthenticatedUser } | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: AuthService.hashToken(token) },
      include: { user: { include: { tenant: { select: { status: true, name: true } } } } },
    });
    if (!session || session.expiresAt < new Date() || !session.user.isActive) {
      return null;
    }
    // אכיפת השהיית משרד בכל בקשה — session שנוצר במרוץ מול ההשהיה
    // (login שהספיק לעבור אימות לפני מחיקת ה-sessions) נפסל כאן (Codex)
    if (!["active", "trial"].includes(session.user.tenant.status)) {
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
    const capabilities = resolveCapabilities(
      session.user.role,
      overrides.map((o) => ({
        capability: o.capability as Capability,
        effect: o.effect === "grant" ? "grant" : "deny",
        expiresAt: o.expiresAt,
      })),
      new Date(),
    );
    return {
      context: {
        tenantId: session.user.tenantId,
        userId: session.user.id,
        capabilities,
      },
      user: {
        id: session.user.id,
        tenantId: session.user.tenantId,
        name: session.user.name,
        email: session.user.email,
        role: session.user.role,
        mustChangePassword: session.user.mustChangePassword,
        tenantName: session.user.tenant.name,
      },
    };
  }
}
