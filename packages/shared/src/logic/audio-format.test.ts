import { describe, expect, it } from "vitest";
import { AUDIO_RECORDING_FORMATS, extensionForAudioType } from "./audio-format.js";

describe("extensionForAudioType", () => {
  it("מזהה את מה שכרום מקליט", () => {
    expect(extensionForAudioType("audio/webm;codecs=opus")).toBe("webm");
    expect(extensionForAudioType("audio/webm")).toBe("webm");
  });

  /*
   * הבדיקה שבגללה הקובץ הזה קיים: ספארי מחזיר `audio/mp4`, והקוד
   * שלח אותו בשם ‎.webm‎ — כלומר כל הכתבה מ-iPhone וב-iPad הגיעה
   * לשירות התמלול כקובץ שהוצהר עליו שקר.
   */
  it("ספארי מקליט mp4 — ולא webm", () => {
    expect(extensionForAudioType("audio/mp4")).toBe("m4a");
    expect(extensionForAudioType("audio/mp4;codecs=mp4a.40.2")).toBe("m4a");
    expect(extensionForAudioType("audio/x-m4a")).toBe("m4a");
  });

  it("מתעלם מאותיות גדולות ומרווחים", () => {
    expect(extensionForAudioType("AUDIO/WEBM; codecs=opus")).toBe("webm");
    expect(extensionForAudioType("  audio/mp4  ")).toBe("m4a");
  });

  it("מכל וידאו עם אודיו בלבד נחשב לאותו מכל", () => {
    expect(extensionForAudioType("video/webm")).toBe("webm");
    expect(extensionForAudioType("video/mp4")).toBe("m4a");
  });

  /*
   * ההתנהגות החשובה במקרה הלא-ידוע: לא לנחש „webm”. ניחוש שגוי הוא
   * מה שגרם לבאג, ו-`bin` משאיר את הזיהוי לפי התוכן.
   */
  it("סוג לא מוכר אינו הופך ל-webm בכוח", () => {
    expect(extensionForAudioType("audio/basic")).toBe("bin");
    expect(extensionForAudioType("")).toBe("bin");
    expect(extensionForAudioType(undefined)).toBe("bin");
    expect(extensionForAudioType(null)).toBe("bin");
  });

  it("כל פורמט מועדף מתמפה לסיומת שהוא מצהיר עליה", () => {
    for (const format of AUDIO_RECORDING_FORMATS) {
      expect(extensionForAudioType(format.mimeType), format.mimeType).toBe(format.extension);
    }
  });
});
