import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { isWhatsAppAudio, toWhatsAppAudio } from "./audio-transcode";

const run = promisify(execFile);

/**
 * ההמרה עצמה נבדקת רק היכן ש-ffmpeg מותקן — בתמונת ה-API וב-CI.
 * בפיתוח מקומי בלעדיו הבדיקה מדולגת ולא נכשלת, בדיוק כפי שהקוד
 * עצמו נופל לקישור במקום לזרוק.
 */
const hasFfmpeg = await run("ffmpeg", ["-version"]).then(
  () => true,
  () => false,
);

describe("isWhatsAppAudio", () => {
  it("הפורמטים ש-Meta מקבלת ללא תנאי", () => {
    for (const type of ["audio/aac", "audio/amr", "audio/mpeg", "audio/mp4"]) {
      expect(isWhatsAppAudio(type), type).toBe(true);
    }
  });

  it("מה שאנחנו שומרים בו אינו מתקבל — ולכן נדרשת המרה", () => {
    expect(isWhatsAppAudio("audio/wav")).toBe(false);
    expect(isWhatsAppAudio("audio/webm")).toBe(false);
    expect(isWhatsAppAudio("audio/webm;codecs=opus")).toBe(false);
  });

  /*
   * ogg הוא מכולה, לא קודק: אותו טיפוס יכול להיות Vorbis, ש-Meta
   * דוחה. ההנחה שהוא Opus החזירה בדיוק את הכישלון שההמרה מונעת.
   */
  it("ogg עובר רק כשהקודק מוצהר Opus", () => {
    expect(isWhatsAppAudio("audio/ogg; codecs=opus")).toBe(true);
    expect(isWhatsAppAudio('audio/ogg;codecs="opus"')).toBe(true);
    expect(isWhatsAppAudio("audio/ogg")).toBe(false);
    expect(isWhatsAppAudio("audio/ogg; codecs=vorbis")).toBe(false);
  });

  it("הטיפוס נבדק בלי תלות ברישיות", () => {
    expect(isWhatsAppAudio("AUDIO/MPEG")).toBe(true);
  });
});

describe("toWhatsAppAudio", () => {
  it("פורמט נתמך עובר כמות שהוא — בלי המרה מיותרת", async () => {
    const body = Buffer.from("already-opus");
    const result = await toWhatsAppAudio(body, "audio/mpeg");
    expect(result).toEqual({ body, mimeType: "audio/mpeg" });
  });

  it("קלט שאי אפשר להמיר מחזיר null ולא זורק", async () => {
    // בייטים שאינם אודיו: ffmpeg נכשל, ואם אינו מותקן — הרצה נכשלת.
    // שתי הדרכים מגיעות לאותה תשובה, וזו הנקודה: הקורא נופל לקישור.
    expect(await toWhatsAppAudio(Buffer.from("not audio at all"), "audio/wav")).toBeNull();
  });

  it.skipIf(!hasFfmpeg)("wav אמיתי הופך ל-ogg/opus שוואטסאפ מקבלת", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wa-audio-test-"));
    try {
      const src = join(dir, "tone.wav");
      // שנייה של צליל — הקלט הקטן ביותר שהוא באמת wav ולא בייטים
      await run("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi",
        "-i", "sine=frequency=440:duration=1", src]);
      const result = await toWhatsAppAudio(await readFile(src), "audio/wav");
      expect(result).not.toBeNull();
      expect(result?.mimeType).toBe("audio/ogg");
      // חתימת מכולת Ogg — ההמרה באמת רצה ולא החזירה את הקלט
      expect(result?.body.subarray(0, 4).toString("ascii")).toBe("OggS");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
