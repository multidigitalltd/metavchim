import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * ‏מטמון התשובות האחרונות — כדי שהאפליקציה תפתח את מה שנטען בפעם
 * ‏הקודמת גם בלי קליטה, ותסמן שזה ישן.
 *
 * ‏המפתחות נושאים את מזהה המשתמש: מכשיר שעבר בין שני חשבונות אינו
 * ‏מציג לשני את הלידים של הראשון, וההתנתקות מוחקת את המרחב של מי
 * ‏שיצא. הערכים הם JSON של תשובות API — לא סודות, אבל נתוני משרד —
 * ‏ולכן הם נמחקים עם ההתנתקות ולא נשארים על המכשיר.
 */

const PREFIX = "mv-cache";
/**
 * ‏המרחב האחרון שנכתב אליו — נשמר גם באחסון, כי בהפעלה קרה עם Session
 * ‏שפג הזהות אינה ידועה (‎`/auth/me` מחזיר 401 לפני שיש משתמש), ובכל
 * ‏זאת המטמון של מי שיצא חייב להימחק (ביקורת Codex).
 */
const LAST_SCOPE_KEY = `${PREFIX}:last-scope`;
let scope: string | null = null;

/** ‏נקבע כשהזהות ידועה; בלי מרחב אין קריאה ואין כתיבה. */
export function setCacheScope(userId: string | null): void {
  scope = userId;
  if (userId !== null) {
    AsyncStorage.setItem(LAST_SCOPE_KEY, userId).catch(() => undefined);
  }
}

function fullKey(key: string): string | null {
  return scope === null ? null : `${PREFIX}:${scope}:${key}`;
}

export interface CacheEntry<T> {
  value: T;
  /** ‏מתי נשמר — לתווית „מלפני שעה” */
  at: number;
}

export async function readCache<T>(key: string): Promise<CacheEntry<T> | null> {
  const full = fullKey(key);
  if (full === null) return null;
  try {
    const raw = await AsyncStorage.getItem(full);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    return typeof parsed === "object" && parsed !== null && "value" in parsed ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeCache<T>(key: string, value: T): Promise<void> {
  const full = fullKey(key);
  if (full === null) return;
  try {
    await AsyncStorage.setItem(full, JSON.stringify({ value, at: Date.now() } satisfies CacheEntry<T>));
  } catch {
    // אחסון מלא או לא זמין — המסך עובד גם בלי מטמון
  }
}

/** ‏מחיקת המרחב של משתמש — בהתנתקות. */
export async function clearCacheScope(userId: string): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((key) => key.startsWith(`${PREFIX}:${userId}:`));
    await Promise.all(mine.map((key) => AsyncStorage.removeItem(key)));
    await AsyncStorage.removeItem(LAST_SCOPE_KEY);
  } catch {
    // אין מה למחוק
  }
}

/**
 * ‏מחיקת המרחב של מי שהיה מחובר אחרון — ליציאה שאינה התנתקות יזומה:
 * ‏Session שפג, שנותק ממכשיר אחר, או שהסיסמה הוחלפה. הזהות עצמה כבר
 * ‏אינה ידועה (או אינה נחוצה) — המרחב האחרון הוא מה שנמחק.
 */
export async function clearLastCacheScope(): Promise<void> {
  try {
    const last = await AsyncStorage.getItem(LAST_SCOPE_KEY);
    if (last !== null) await clearCacheScope(last);
  } catch {
    // אין מה למחוק
  }
}
