import * as LocalAuthentication from "expo-local-authentication";

/**
 * ‏האם המכשיר עצמו נעול — קוד, תבנית, טביעת אצבע או פנים.
 *
 * ‏זה מה שמכריע כמה זמן ההתחברות נשמרת (ראו `session-lifetime.ts`
 * ‏בשרת): טלפון נעול מקבל Session של 30 יום שמתגלגל בכל פעילות, כי
 * ‏הנעילה של המכשיר היא ההגנה; טלפון בלי נעילה מקבל את 12 השעות של
 * ‏הדפדפן. הבדיקה אינה שואלת את המשתמש דבר — רק מה מוגדר במכשיר.
 * ‏כשהמודול אינו זמין (סימולטור ישן, תקלה) התשובה שלילית: קצר
 * ‏מדי עדיף על ארוך מדי.
 */
export async function deviceSecured(): Promise<boolean> {
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    return level !== LocalAuthentication.SecurityLevel.NONE;
  } catch {
    return false;
  }
}
