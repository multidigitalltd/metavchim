import { ulid } from "ulid";
import { mentorCelebration, type MentorWinKind } from "@metavchim/shared";
import type { TenantTx } from "../core/prisma.service";
import { notifyOnce } from "./notify-once";

/**
 * הצלחה של המנטור — נרשמת **במקום שבו היא קורית**, בתוך אותה
 * טרנזקציה (docs/14 §2: חגיגה מיידית ובשם).
 *
 * פונקציה ולא שירות מוזרק, כמו `notifyOnce`: ארבעה מודולים שונים
 * קוראים לה (נכסים, הצעות, הסכמים, חדר העסקה), ותלות של כולם במודול
 * המנטור הייתה הופכת מודול צדדי לצומת. הרישום אידמפוטנטי — אותה
 * עסקה שסומנה „נמכר” פעמיים אינה נחגגת פעמיים — וההתראה שיוצאת
 * מיד נושאת אותו מפתח, כדי ששתי הכתיבות ייפלו יחד.
 *
 * ‎`true` = נרשם עכשיו; ‎`false` = כבר היה.
 */
export async function recordMentorWin(
  tx: TenantTx,
  win: {
    tenantId: string;
    userId: string;
    kind: MentorWinKind;
    entityType: string;
    entityId: string;
    /** כותרת הנכס — בלי שם הלקוח */
    title: string;
    /**
     * תחילת התקופה („2026-09-06”) להצלחה שחוזרת — יעד שבועי מושג שבוע
     * אחרי שבוע ואותה שורת יעד היא חגיגה חדשה בכל שבוע. ריק (ברירת
     * המחדל) לאירועים החד-פעמיים: עסקה נסגרת פעם אחת.
     */
    periodKey?: string;
    /**
     * הישות שההתראה מצביעה עליה, כשהיא שונה מזו שנרשמת ב-`mentor_wins`.
     * יעד שהושג נרשם על `mentor_goal` (זה מה שהושג), אבל ההתראה חייבת
     * לנחות במסך המנטור — ומפות הניתוב מכירות `mentor`, לא `mentor_goal`
     * (ביקורת Codex).
     */
    notifyEntityType?: string;
  },
): Promise<boolean> {
  const title = win.title.trim().slice(0, 200) || "נכס";
  const periodKey = win.periodKey ?? "";
  const inserted = await tx.$executeRaw`
    INSERT INTO mentor_wins (id, tenant_id, user_id, kind, entity_type, entity_id, title, period_key)
    VALUES (${ulid()}, ${win.tenantId}, ${win.userId}, ${win.kind}, ${win.entityType}, ${win.entityId}, ${title}, ${periodKey})
    ON CONFLICT (tenant_id, kind, entity_id, period_key) DO NOTHING`;
  if (inserted === 0) return false;

  // השם הפרטי — החגיגה פונה אליו בשמו („דנה, סגרת עסקה!”)
  const user = await tx.user.findFirst({
    where: { id: win.userId, tenantId: win.tenantId },
    select: { name: true },
  });
  const firstName = (user?.name ?? "").trim().split(/\s+/u)[0] ?? "";
  const message = mentorCelebration({ kind: win.kind, title }, firstName);
  await notifyOnce(tx, {
    tenantId: win.tenantId,
    dedupeKey: `mentor_win:${win.kind}:${win.entityId}${periodKey === "" ? "" : `:${periodKey}`}`,
    userId: win.userId,
    type: "mentor_win",
    title: message.title,
    body: message.body.slice(0, 500),
    entityType: win.notifyEntityType ?? win.entityType,
    entityId: win.entityId,
  });
  return true;
}
