/**
 * ‎**הצפנת עמודה — פורמט אחד לשני התהליכים.**
 *
 * ‏ה-API מצפין ומפענח (`CryptoService`), והעובדים מפענחים את אותן
 * ‏עמודות — שם איש קשר, הגדרות פלטפורמה. הפורמט היה כתוב פעמיים, עם
 * ‏הערה שאומרת „חייב להישאר זהה לשני הצדדים”. הערה אינה מנגנון: כאן
 * ‏הוא נכתב פעם אחת, ושני הצדדים קוראים לאותה פונקציה.
 *
 * ‏הפורמט: `iv (12) | tag (16) | ciphertext`, AES-256-GCM, IV אקראי
 * ‏לכל ערך. הקורא מקודד ל-base64 ומפענח ממנו.
 *
 * ## ‏למה הפונקציות מקבלות את `crypto` מבחוץ
 *
 * ‏החבילה הזו נטענת גם בדפדפן ובנייד, וייבוא של `node:crypto` כאן היה
 * ‏מגיע עד חבילת הדפדפן. מי שמצפין הוא תמיד תהליך Node, והוא מעביר את
 * ‏המודול שלו; הפורמט והאלגוריתם נשארים כאן.
 */

export const AES_GCM_IV_BYTES = 12;
export const AES_GCM_TAG_BYTES = 16;

/** ‏החלק של `node:crypto` שהפונקציות צריכות — המודול עצמו עונה עליו. */
export interface AesGcmCrypto {
  randomBytes(size: number): Uint8Array;
  createCipheriv(
    algorithm: "aes-256-gcm",
    key: Uint8Array,
    iv: Uint8Array,
  ): {
    update(data: string, inputEncoding: "utf8"): Uint8Array;
    final(): Uint8Array;
    getAuthTag(): Uint8Array;
  };
  createDecipheriv(
    algorithm: "aes-256-gcm",
    key: Uint8Array,
    iv: Uint8Array,
  ): {
    setAuthTag(tag: Uint8Array): unknown;
    update(data: Uint8Array, inputEncoding: undefined, outputEncoding: "utf8"): string;
    final(outputEncoding: "utf8"): string;
  };
}

/** ‏הצפנה — IV חדש לכל ערך. */
export function sealAesGcm(plaintext: string, key: Uint8Array, crypto: AesGcmCrypto): Uint8Array {
  const iv = crypto.randomBytes(AES_GCM_IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const head = cipher.update(plaintext, "utf8");
  const tail = cipher.final();
  return concatBytes([iv, cipher.getAuthTag(), head, tail]);
}

/**
 * ‏פענוח. זורק אם התג אינו תואם — ערך ששונה, מפתח אחר, או נתון קטוע.
 * ‏הפענוח ל-UTF-8 נעשה בתוך `node:crypto`, שמחבר תווים שנחתכו בין
 * ‏`update` ל-`final`.
 */
export function openAesGcm(sealed: Uint8Array, key: Uint8Array, crypto: AesGcmCrypto): string {
  const iv = sealed.subarray(0, AES_GCM_IV_BYTES);
  const tag = sealed.subarray(AES_GCM_IV_BYTES, AES_GCM_IV_BYTES + AES_GCM_TAG_BYTES);
  const ciphertext = sealed.subarray(AES_GCM_IV_BYTES + AES_GCM_TAG_BYTES);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext, undefined, "utf8") + decipher.final("utf8");
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
