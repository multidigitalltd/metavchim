import { ulid } from "ulid";
import {
  DEFAULT_PBX_SILENT_HOURS,
  DEFAULT_PBX_WATCH,
  pbxSilenceDedupeKey,
  pbxSilenceMessage,
  shouldAlertPbxSilence,
} from "@metavchim/shared";
import { prisma, withTenant } from "../runtime.js";
import { automationSettings } from "../tenant-settings.js";

/**
 * ניקוי יומן משימות הסוכן — שמירת נתונים מינימלית (ISO 27001 A.5.33).
 *
 * היומן צובר תמלולים עם שמות ופרטי לקוחות קצה, ושתי המטרות שלו —
 * מדידת עלות ודאטה לאימון — לא דורשות היסטוריה אינסופית: חצי שנה
 * של פקודות היא גם מדגם אימון מספק וגם חלון עלות רלוונטי. מה
 * שמעבר לכך הוא PII שנשמר בלי תכלית. מי שרוצה לשמר את הדאטה מוריד
 * את קובץ הייצוא מהמסך לפני שהחלון נסגר.
 *
 * דייר-דייר תחת RLS, כמו שאר הסורקים כאן ומאותה סיבה — שאילתה בלי
 * הקשר דייר מוחקת אפס שורות בלי שגיאה.
 */
/**
 * ‎**מרכזייה ששתקה — ומי שם לב.**
 *
 * שני משרדים לא קיבלו אף אירוע מרכזייה ארבעה וחמישה ימים ואיש לא
 * ידע; שלישי נפל באמצע יום עבודה, וזה התגלה רק כשמתווך התלונן —
 * חמש שעות ו-47 דקות של שיחות שהספק לא שלח ולא ישלח, כי הוא אינו
 * שומר מה שלא יצא.
 *
 * ‎**רק משרד שהמרכזייה שלו מחוברת.** משרד בלי אינטגרציה פעילה אינו
 * „שותק” — הוא פשוט לא חיבר, והתראה עליו היא רעש שמלמד להתעלם.
 *
 * ההכרעה עצמה ב-`shouldAlertPbxSilence`, שם היא נבדקת בלי מסד ובלי
 * שעון. כאן רק השליפה והכתיבה.
 */
export async function processPbxSilenceSweep(): Promise<void> {
  const now = new Date();
  /*
   * ‎**המשרדים תחילה, והחיבור נבדק בתוך ההקשר שלהם.**
   *
   * ‏`integrations` תחת RLS, ושליפה רוחבית ממנה עוקפת את הבידוד —
   * זה מה שהשער `rls-access` אוסר, ובצדק. `tenants` אינה תחת RLS
   * (היא מרשם הדיירים עצמו), ולכן הסבב מתחיל ממנה כמו שאר הסבבים
   * כאן, ושואל על החיבור בתוך טרנזקציה עם `app.tenant_id`.
   */
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  let alerted = 0;

  for (const { id: tenantId } of tenants) {
    try {
      const settings = (await automationSettings(tenantId))["pbx_silent"];
      if (!settings.enabled) continue;

      /*
       * ‎**רק משרד שהמרכזייה שלו מחוברת.** משרד בלי חיבור פעיל אינו
       * „שותק” — הוא פשוט לא חיבר, והתראה עליו היא רעש שמלמד
       * להתעלם משאר ההתראות.
       */
      const connected = await withTenant(tenantId, async (tx) => {
        return tx.integration.findFirst({
          where: { tenantId, kind: "telephony", status: "active" },
          select: { id: true, createdAt: true },
        });
      });
      if (connected === null) continue;
      const window = settings.watch ?? DEFAULT_PBX_WATCH;
      const thresholdHours = settings.value ?? DEFAULT_PBX_SILENT_HOURS;

      /*
       * ‎**השיחה האחרונה, ולא הפגיעה האחרונה ביומן הוובהוקים.**
       * ‏`telephony_webhook_hits` מקבלת שורה גם מבדיקה ידנית ומכל
       * פנייה שלא נותחה — כלומר גם כשהמרכזייה עצמה שותקת. מה
       * שמעניין הוא שיחה נכנסת שנרשמה בפועל.
       */
      const last = await withTenant(tenantId, async (tx) => {
        return tx.call.findFirst({
          where: { tenantId, direction: "inbound", providerCallId: { not: null } },
          orderBy: { occurredAt: "desc" },
          select: { occurredAt: true },
        });
      });
      const lastInboundAt = last?.occurredAt ?? null;
      /*
       * ‎**משרד שרק חיבר את המרכזייה אינו „שותק”.**
       *
       * בלי שיחה כלל `monitoredHoursSince` סופר עד התקרה — כלומר
       * חודש — והסבב הראשון בתוך חלון הניטור היה מתריע מיד, בלי
       * קשר לסף שהוגדר. חיבור חדש (או חיבור מחדש) היה מקבל התראת
       * שווא בדיוק בזמן ההתקנה, שהוא הרגע הגרוע ביותר ללמד משרד
       * שההתראות שלנו לא מדויקות (ביקורת Codex).
       *
       * מועד יצירת החיבור הוא הבסיס: ממנו והלאה באמת מצפים לשיחות.
       */
      const since = lastInboundAt ?? connected.createdAt;

      if (
        !shouldAlertPbxSilence({ lastInboundAt: since, now, thresholdHours, window })
      ) {
        continue;
      }

      // הנוסח עדיין מבחין בין „הפסיקו להגיע” לבין „מעולם לא הגיעו”
      const message = pbxSilenceMessage({ lastInboundAt, now, window });
      const written = await withTenant(tenantId, async (tx) => {
        /*
         * ‎**מפתח ליום, ולא בדיקה של „כבר התרענו”.** מרכזייה שנפלה
         * נשארת נפולה, והסבב רץ כל שעה — בלי המפתח המשרד היה מקבל
         * את אותה התראה עשר פעמים ביום, וזו הדרך הבטוחה להרגיל אותו
         * לכבות אותה.
         */
        const key = pbxSilenceDedupeKey(tenantId, now);
        const seen = await tx.notification.findFirst({
          where: { tenantId, type: "pbx_silent", dedupeKey: key },
          select: { id: true },
        });
        if (seen !== null) return false;
        await tx.notification.create({
          data: {
            id: ulid(),
            tenantId,
            // לכל המשרד: אין סוכן אחד שהמרכזייה „שלו”
            userId: null,
            type: "pbx_silent",
            dedupeKey: key,
            title: message.title,
            body: message.body,
            entityType: "integration",
            entityId: tenantId,
          },
        });
        return true;
      });
      if (written) alerted += 1;
    } catch (error: unknown) {
      console.error(`[pbx-silence-sweep] ${tenantId}: ${String(error)}`);
    }
  }
  if (alerted > 0) {
    console.warn(`[pbx-silence-sweep] ${alerted} משרדים קיבלו התראה על שתיקת מרכזייה`);
  }
}
