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
      },
    });
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return {
      token,
      expiresAt,
      user: {
        id: user.id,
        tenantId: user.tenantId,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    };
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
      include: { user: true },
    });
    if (!session || session.expiresAt < new Date() || !session.user.isActive) {
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
      },
    };
  }
}
