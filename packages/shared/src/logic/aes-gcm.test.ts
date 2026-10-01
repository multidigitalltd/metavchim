import * as crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { AES_GCM_IV_BYTES, AES_GCM_TAG_BYTES, openAesGcm, sealAesGcm } from "./aes-gcm.js";

const KEY = new Uint8Array(32).fill(7);

/*
 * ‎**מה שכבר שמור במסד.** הוקטור הופק במימוש הקודם של `CryptoService`
 * ‏(IV קבוע, אותו מפתח), לפני שהפורמט עבר לכאן. אם הוא מפסיק להיפתח,
 * ‏כל שם, טלפון והגדרה מוצפנים במערכת מפסיקים להיפתח איתו.
 */
const STORED = "AQIDBAUGBwgJCgsMuc5c43SN+QwFfCwAWcd1lGzVPwK9fzWxyR4yK6WKknLn0WQGhWvQZ+qBWwR7zJGB";
const PLAINTEXT = "שלום, 050-1234567 — כהן";

describe("הצפנת עמודה", () => {
  it("‏ערך שהוצפן במימוש הקודם נפתח — הנתונים הקיימים לא נשברים", () => {
    expect(openAesGcm(Buffer.from(STORED, "base64"), KEY, crypto)).toBe(PLAINTEXT);
  });

  it("‏הלוך-חזור, כולל עברית ותווים מרובי בתים", () => {
    for (const text of ["", "a", PLAINTEXT, "🏠".repeat(50), "א".repeat(5000)]) {
      expect(openAesGcm(sealAesGcm(text, KEY, crypto), KEY, crypto)).toBe(text);
    }
  });

  it("‏הפורמט: IV, תג, ואז הטקסט המוצפן", () => {
    const sealed = sealAesGcm("abc", KEY, crypto);
    expect(sealed.length).toBe(AES_GCM_IV_BYTES + AES_GCM_TAG_BYTES + 3);
  });

  it("‏IV חדש לכל ערך — אותו טקסט אינו נותן אותה הצפנה", () => {
    const a = Buffer.from(sealAesGcm(PLAINTEXT, KEY, crypto)).toString("base64");
    const b = Buffer.from(sealAesGcm(PLAINTEXT, KEY, crypto)).toString("base64");
    expect(a).not.toBe(b);
  });

  it("‏ערך ששונה, או מפתח אחר — נכשל, ולא מחזיר זבל", () => {
    const sealed = sealAesGcm(PLAINTEXT, KEY, crypto);
    const tampered = new Uint8Array(sealed);
    tampered[tampered.length - 1]! ^= 1;
    expect(() => openAesGcm(tampered, KEY, crypto)).toThrow();
    expect(() => openAesGcm(sealed, new Uint8Array(32).fill(8), crypto)).toThrow();
  });
});
