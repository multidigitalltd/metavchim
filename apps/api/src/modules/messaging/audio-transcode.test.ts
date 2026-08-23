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
  it("הפורמטים ש-Meta מקבלת", () => {
    for (const type of ["audio/aac", "audio/amr", "audio/mpeg", "audio/mp4", "audio/ogg"]) {
      expect(isWhatsAppAudio(type), type).toBe(true);
    }
  });

  it("מה שאנחנו שומרים בו אינו מתקבל — ולכן נדרשת המרה", () => {
    expect(isWhatsAppAudio("audio/wav")).toBe(false);
    expect(isWhatsAppAudio("audio/webm")).toBe(false);
    expect(isWhatsAppAudio("audio/webm;codecs=opus")).toBe(false);
  });

  it("פרמטרי הקודק אינם חלק מהטיפוס", () => {
    expect(isWhatsAppAudio("audio/ogg; codecs=opus")).toBe(true);
    expect(isWhatsAppAudio("AUDIO/OGG")).toBe(true);
  });
});

describe("toWhatsAppAudio", () => {
  it("פורמט נתמך עובר כמות שהוא — בלי המרה מיותרת", async () => {
    const body = Buffer.from("already-opus");
    const result = await toWhatsAppAudio(body, "audio/ogg; codecs=opus");
    expect(result).toEqual({ body, mimeType: "audio/ogg" });
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
