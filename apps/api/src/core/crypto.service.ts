import { Injectable } from "@nestjs/common";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { normalizeEmail } from "@metavchim/shared";
import { loadEnv } from "../config/env";

/**
 * הצפנת PII ברמת עמודה (docs/04 §4):
 * - AES-256-GCM עם IV אקראי לכל ערך; פורמט אחסון: base64(iv | tag | ciphertext).
 * - phoneHash: HMAC-SHA256 במפתח נפרד — חיפוש ודה-דופליקציה בלי פענוח.
 */
@Injectable()
export class CryptoService {
  private readonly dataKey: Buffer;
  private readonly hashKey: string;

  constructor() {
    const env = loadEnv();
    this.dataKey = Buffer.from(env.DATA_ENCRYPTION_KEY, "base64");
    this.hashKey = env.PHONE_HASH_KEY;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.dataKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
  }

  decrypt(stored: string): string {
    const raw = Buffer.from(stored, "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", this.dataKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  }

  phoneHash(normalizedPhone: string): string {
    return createHmac("sha256", this.hashKey).update(normalizedPhone).digest("hex");
  }

  /**
   * חתימת שם לאיתור כפילויות. תחילית נפרדת כדי שחתימת שם וחתימת
   * טלפון לעולם לא יתנגשו — בלעדיה מספר שנכתב כשם היה מייצר את אותו
   * ערך, ושתי טבלאות שונות היו "מוצאות" התאמה שאינה קיימת.
   */
  nameHash(normalizedName: string): string {
    return createHmac("sha256", this.hashKey).update(`name:${normalizedName}`).digest("hex");
  }

  /**
   * חתימת אימייל — התאמת שולח נכנס (Gmail) לכרטיס בלי לפענח את כל
   * המאגר. אותה תחילית-תחום כמו בשם: "email:" מבטיח שאימייל, שם
   * וטלפון לעולם לא יתנגשו זה עם זה.
   */
  /**
   * חתימת אימייל — **מנרמלת בעצמה**, ואינה סומכת על הקורא.
   *
   * החתימה קיבלה קודם "אימייל מנורמל" והניחה שהוא אכן כזה. בפועל
   * הנרמול היה מפוזר על פני שישה מקומות ולא היה אחיד: חלק
   * ‎`.trim().toLowerCase()`‎ וחלק ‎`.toLowerCase()`‎ בלבד. כלומר
   * אותה כתובת עם רווח נגרר קיבלה חתימה אחרת לפי המסלול שיצר
   * אותה, ואותו אדם נספר כשני לקוחות — בדיוק התקלה ש-
   * `normalizeEmail` נכתב כדי למנוע, ושמעולם לא נקרא.
   *
   * הנרמול כאן ולא בקוראים: זה המקום היחיד שאי אפשר לעקוף אותו.
   * `normalizeEmail` אידמפוטנטי, ולכן קורא שכבר נירמל אינו מושפע.
   */
  emailHash(email: string): string {
    return createHmac("sha256", this.hashKey)
      .update(`email:${normalizeEmail(email)}`)
      .digest("hex");
  }

  /**
   * חתם המחבר בפורום המקצועי (docs/14) — **בעלות בלי זהות.**
   *
   * שרשור אנונימי אינו נושא מזהה משתמש; הוא נושא את החתם הזה. הוא
   * מספיק כדי שהמחבר יערוך את שלו וכדי להגביל קצב, ואינו ניתן להיפוך
   * ממבט על הטבלה. אותה תחילית-תחום כמו בשם ובאימייל — `forum:` —
   * כדי שחתם משתמש לעולם לא יתנגש עם חתם טלפון.
   */
  forumAuthorKey(userId: string): string {
    return createHmac("sha256", this.hashKey).update(`forum:${userId}`).digest("hex");
  }
}
