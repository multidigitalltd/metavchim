import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { parseAgentPrefs, type AgentPrefs } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { PrismaService } from "../../core/prisma.service";

/**
 * העדפות הסוכן של המשתמש — `preferences.agent` בפרופיל.
 *
 * זהו נתון **של הסוכן על עצמו** (איך לענות), לא רשומת CRM — ולכן
 * הכתיבה כאן אינה חריגה מהכלל „הסוכן כותב רק דרך השירותים
 * העסקיים”: אין שירות עסקי שההעדפה הזו שייכת לו, כמו שאין כזה
 * ל-`agent_events`.
 *
 * הכתיבה ממזגת את תת-המפתח `agent` בלבד, בקריאה-מיזוג-כתיבה בתוך
 * טרנזקציה — שאר העמודה (העדפות מסכים אחרים) אינו נגרר.
 */
@Injectable()
export class AgentPrefsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<AgentPrefs> {
    const { userId } = TenantContext.current();
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { preferences: true },
    });
    return parseAgentPrefs(user?.preferences);
  }

  async set(patch: AgentPrefs): Promise<AgentPrefs> {
    const { userId } = TenantContext.current();
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { preferences: true },
      });
      const current =
        typeof user?.preferences === "object" && user.preferences !== null
          ? (user.preferences as Record<string, unknown>)
          : {};
      const merged = { ...parseAgentPrefs(current), ...patch };
      await tx.user.update({
        where: { id: userId },
        data: {
          preferences: { ...current, agent: merged } as unknown as Prisma.InputJsonValue,
        },
      });
      return merged;
    });
  }
}
