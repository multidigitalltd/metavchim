import * as SecureStore from "expo-secure-store";

/**
 * ‏ה-Session של המכשיר — ב-Keychain (iOS) / Keystore (Android).
 *
 * ‏זה המקום היחיד באפליקציה שנוגע בטוקן. המסכים מכירים רק „מחובר /
 * ‏לא מחובר”, ולקוח ה-API מצרף אותו בכותרת בלי להחזיק אותו במשתנה
 * ‏גלובלי שאפשר לקרוא ממנו.
 */
const KEY = "mv_session_token";

export async function readSessionToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY);
  } catch {
    // אחסון מאובטח שאינו זמין (מכשיר בלי נעילת מסך, למשל) — אין Session
    return null;
  }
}

export async function writeSessionToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(KEY, token, {
    // הטוקן נחוץ רק כשהאפליקציה פתוחה — אין סיבה שיהיה קריא לפני
    // הפתיחה הראשונה של המכשיר אחרי אתחול
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

export async function clearSessionToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // אין מה למחוק
  }
}
