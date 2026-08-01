import { Injectable, UnauthorizedException } from "@nestjs/common";
import * as argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
import { ulid } from "ulid";
import { ROLE_CAPABILITIES, type Capability } from "@metavchim/shared";
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
}

/**
 * משתמש שאומת אך טרם קיבל Session. `passwordChangedAt` נלכד בזמן
 * האימות ונחתם ל-Session — כך Session שנוצר במרוץ מול איפוס סיסמה
 * (אימות לפני האיפוס, יצירה אחריו) נושא חותמת ישנה ונפסל.
 */
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

  /** החלפת סיסמה ע"י המשתמש עצמו — מנקה את דגל mustChangePassword. */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
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
    // כל שאר ה-Sessions מבוטלים אחרי שינוי סיסמה (השארת הנוכחי בלבד).
    await this.prisma.session.deleteMany({ where: { userId } });
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
      include: { user: { include: { tenant: { select: { status: true } } } } },
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
    const capabilities = new Set<Capability>(ROLE_CAPABILITIES[session.user.role] ?? []);
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
      },
    };
  }
}
