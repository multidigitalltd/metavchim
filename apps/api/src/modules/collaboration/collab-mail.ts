import type { EmailService } from "../../core/email.service";
import type { PrismaService } from "../../core/prisma.service";

/**
 * מיילי הרשת — **מי מקבל, ולמה מייל ולא רק התראה.**
 *
 * ## למה מייל
 *
 * ההתראה במערכת מגיעה למי שכבר נמצא במסך. שיתוף פעולה מת בדיוק
 * במקום הזה: הצעה שממתינה שלושה ימים כי אף אחד לא נכנס לאזור הרשת
 * היא עסקה שלא קרתה. המייל הוא מה שמחזיר את המתווך פנימה, והוא
 * נשלח בכל **מפנה** בחיי החיבור — הצעה, פנייה, אישור, דחייה
 * ומעבר שלב — כך ששני הצדדים תמיד יודעים באותו רגע איפה הדברים
 * עומדים (בקשת המשתמש).
 *
 * ## מי הנמען
 *
 * הסוכן שהכרטיס שלו, ולא „המשרד” בהפשטה: הוא זה שמכיר את הלקוח
 * ויכול להחליט. בעל המשרד הוא הגיבוי — כרטיס בלי סוכן אחראי עדיין
 * צריך שמישהו יראה אותו.
 *
 * ## מה נכנס להודעה
 *
 * שם המשרד השני, מה קרה, וקישור למסך. **לא** פרטי לקוח, לא כתובת
 * מדויקת ולא מספרי טלפון: מייל יוצא מהמערכת ומהבקרות שלה, וכל מה
 * שנכנס אליו יושב מעכשיו בתיבה של מישהו אחר. מי שצריך את הפרטים
 * נכנס לחדר.
 *
 * ## Best-effort, תמיד
 *
 * הפעולה עצמה כבר בוצעה ונרשמה. כשל בשליחה נרשם ביומן ואינו
 * מבטל אותה — אחרת תיבת דואר שלא ענתה מגלגלת לאחור הצעה תקפה.
 */

/** נמען אחד — סוכן פעיל, או בעל המשרד כשאין. */
export async function collabRecipient(
  prisma: PrismaService,
  tenantId: string,
  userId: string | null,
): Promise<{ name: string; email: string } | null> {
  const agent =
    userId === null
      ? null
      : await prisma.user.findFirst({
          where: { id: userId, tenantId, isActive: true },
          select: { name: true, email: true },
        });
  if (agent) return agent;
  return prisma.user.findFirst({
    where: { tenantId, role: "owner", isActive: true },
    select: { name: true, email: true },
    orderBy: { createdAt: "asc" },
  });
}

export interface CollabMail {
  heading: string;
  paragraphs: string[];
  button: { label: string; url: string };
  subject: string;
}

/**
 * שליחה לנמען אחד. `false` כשלא נשלח דבר — אין שירות מוגדר, אין
 * נמען, או אין לו אימייל. זו אינה שגיאה: משרד בלי משתמש פעיל הוא
 * מצב אפשרי, והפעולה שקדמה למייל תקפה בלעדיו.
 */
export async function sendCollabMail(
  email: EmailService,
  to: { name: string; email: string } | null,
  mail: CollabMail,
): Promise<boolean> {
  if (to === null || to.email === "") return false;
  if (!(await email.isConfigured())) return false;
  await email.send(to.email, mail.subject, {
    heading: mail.heading,
    greeting: `שלום ${to.name},`,
    paragraphs: mail.paragraphs,
    button: mail.button,
    footnote:
      "ההודעה נשלחה כי אתם צד בשיתוף פעולה ברשת של מתווכים. אפשר לסגור את הפרסום במסך בכל רגע.",
  });
  return true;
}
