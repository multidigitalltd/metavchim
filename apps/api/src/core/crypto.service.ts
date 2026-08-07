import { Injectable } from "@nestjs/common";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
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
}
