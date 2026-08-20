import { ulid } from "ulid";
import type { PrismaService } from "../../core/prisma.service";

/**
 * התראה במערכת למשרד שהציע — ההצעה נדחתה, ולמה.
 *
 * הערוץ המובטח לסיבת הדחייה: המייל הוא Best-effort, וכשהוא כבוי או
 * נכשל, סיבה שנכתבה במיוחד למציע לא הייתה מגיעה אליו בשום מקום
 * (ביקורת Codex). ההתראה נכתבת אצל המשרד המציע — הסוכן שהציע אם
 * ידוע, ואחרת בעלי המשרד — ולכן דורשת הקשר דייר מפורש.
 *
 * נקראת **רק כשהמעבר קרה בפועל**: קריאה חוזרת על הצעה שכבר נדחתה
 * אינה מודיעה שוב — אחרת רענון כפול היה שולח את אותה דחייה פעמיים,
 * ועם סיבה שאולי שונה מזו שנשמרה.
 */
export async function notifyProposerDeclined(
  prisma: PrismaService,
  input: {
    proposerTenantId: string;
    /** הסוכן שהציע — `null` בהצעות שקדמו לעמודה; אז מודיעים לבעלים. */
    proposerUserId: string | null;
    decliningOffice: string;
    /** "הנכס שהצעתם ברשת" / "הקונה שהצעתם ברשת" */
    what: string;
    note: string | null;
  },
): Promise<void> {
  await prisma.withExplicitTenant(input.proposerTenantId, async (tx) => {
    const targets =
      input.proposerUserId !== null
        ? [{ id: input.proposerUserId }]
        : await tx.user.findMany({
            where: {
              tenantId: input.proposerTenantId,
              role: "owner",
              isActive: true,
            },
            select: { id: true },
          });
    const body =
      input.note === null
        ? `${input.decliningOffice} השיב שההצעה אינה מתאימה. אפשר להציע על פריטים אחרים בפיד.`
        : `${input.decliningOffice} השיב שההצעה אינה מתאימה: „${input.note}”`;
    for (const target of targets) {
      await tx.notification.create({
        data: {
          id: ulid(),
          tenantId: input.proposerTenantId,
          userId: target.id,
          type: "coop_offer_declined",
          title: `עדכון על ${input.what}`,
          body,
        },
      });
    }
  });
}
