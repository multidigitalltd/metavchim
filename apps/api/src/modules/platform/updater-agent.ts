import { ServiceUnavailableException } from "@nestjs/common";
import { loadEnv } from "../../config/env";

/**
 * הקריאה לסוכן העדכון (infra/updater) — מקום אחד.
 *
 * הסוכן הוא תהליך נפרד שרץ לצד המערכת עם גישה ל-Docker של המארח,
 * והוא **אינו מתעדכן יחד עם המערכת**: כפתור "עדכן גרסה" מושך את
 * ‎api/web/workers‎ בלבד, כי סוכן שמפיל את עצמו באמצע הפעולה משאיר
 * את השרת בלי סוכן בכלל.
 *
 * מכאן נובע מצב שקורה בפועל: המערכת חדשה, הסוכן ישן, ופעולה שנוספה
 * לאחרונה (למשל "גבה עכשיו") מוחזרת ממנו כ-404. עד כה זה הוצג
 * כ"סוכן העדכון החזיר שגיאה" — נכון ובלתי שמיש. המיפוי כאן הופך כל
 * תשובה כושלת להודעה שאומרת מה לעשות.
 */

/** תשובת הסוכן ↵ הודעה בעברית שאפשר לפעול לפיה. */
export function updaterFailure(res: Response): ServiceUnavailableException {
  if (res.status === 401) {
    return new ServiceUnavailableException(
      "סוכן העדכון דחה את הבקשה — UPDATE_SECRET במערכת ובסוכן אינם זהים",
    );
  }
  if (res.status === 404) {
    return new ServiceUnavailableException(
      "סוכן העדכון שרץ בשרת ישן מהמערכת ואינו מכיר את הפעולה הזו. " +
        "עדכנו אותו בשרת: docker compose -f docker-compose.prod.yml " +
        "--env-file .env.production pull updater && ... up -d updater",
    );
  }
  return new ServiceUnavailableException(`סוכן העדכון החזיר שגיאה (${res.status})`);
}

/**
 * קריאה לסוכן. הסוד נוסף כאן ולא אצל הקורא, כדי שלא ייווצר נתיב
 * קריאה שמדלג עליו.
 */
export async function callUpdaterAgent(path: string, init: RequestInit): Promise<Response> {
  const env = loadEnv();
  if (env.UPDATER_URL === undefined || env.UPDATE_SECRET === undefined) {
    throw new ServiceUnavailableException("סוכן העדכון אינו מוגדר בסביבה זו");
  }
  try {
    return await fetch(`${env.UPDATER_URL}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), "x-update-secret": env.UPDATE_SECRET },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ServiceUnavailableException("סוכן העדכון אינו זמין");
  }
}
