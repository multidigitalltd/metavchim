import { Injectable } from "@nestjs/common";
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

  /**
   * ‎**עדכון jsonb במשפט אחד, לא קריאה-ואז-כתיבה.** RMW בצד הלקוח
   * תחת READ COMMITTED דורס כתיבה מקבילה לאותה עמודה — לשונית
   * נגישות פתוחה או „אל תציג יותר” באותו רגע היו נמחקים בשקט
   * (ביקורת Codex). `jsonb_set` נוגע בתת-המפתח `agent` בלבד, ושאר
   * העמודה נשאר כפי שהכותב האחר השאיר אותו — אותו דפוס בדיוק כמו
   * ‎`dismissPanel`.
   */
  async set(patch: AgentPrefs): Promise<AgentPrefs> {
    const { userId } = TenantContext.current();
    await this.prisma.$executeRaw`
      UPDATE users
      SET preferences = jsonb_set(
        COALESCE(preferences, '{}'::jsonb),
        '{agent}',
        COALESCE(preferences->'agent', '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb
      )
      WHERE id = ${userId}
    `;
    return this.get();
  }
}
