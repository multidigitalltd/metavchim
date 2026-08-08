import { describe, expect, it } from "vitest";
import {
  assignSpeakers,
  countSpeakers,
  formatDiarizedTranscript,
  formatTimestamp,
  mergeConsecutive,
  relabelByFirstAppearance,
  type SpeakerTurn,
  type TranscriptSegment,
} from "./diarize.js";

describe("assignSpeakers", () => {
  it("משייך לפי הדובר שחופף הכי הרבה", () => {
    const segments: TranscriptSegment[] = [{ start: 0, end: 3, text: "שלום" }];
    const turns: SpeakerTurn[] = [
      { start: 0, end: 1, speaker: "SPEAKER_00" },
      { start: 1, end: 4, speaker: "SPEAKER_01" },
    ];
    expect(assignSpeakers(segments, turns)[0]?.speaker).toBe("SPEAKER_01");
  });

  it("בדיבור על גבי דיבור מנצח מי שחופף יותר", () => {
    const segments: TranscriptSegment[] = [{ start: 10, end: 20, text: "רגע רגע" }];
    const turns: SpeakerTurn[] = [
      { start: 8, end: 12, speaker: "SPEAKER_00" },
      { start: 9, end: 20, speaker: "SPEAKER_01" },
    ];
    expect(assignSpeakers(segments, turns)[0]?.speaker).toBe("SPEAKER_01");
  });

  it("משייך לתור הקרוב כשאין חפיפה אבל הפער קטן", () => {
    const segments: TranscriptSegment[] = [{ start: 10, end: 11, text: "כן" }];
    const turns: SpeakerTurn[] = [{ start: 0, end: 9, speaker: "SPEAKER_00" }];
    expect(assignSpeakers(segments, turns)[0]?.speaker).toBe("SPEAKER_00");
  });

  it("לא מנחש כשהפער גדול מחלון החסד", () => {
    const segments: TranscriptSegment[] = [{ start: 60, end: 61, text: "הלו" }];
    const turns: SpeakerTurn[] = [{ start: 0, end: 9, speaker: "SPEAKER_00" }];
    expect(assignSpeakers(segments, turns)[0]?.speaker).toBeNull();
  });

  it("בלי תורי דיבור בכלל אין תוויות", () => {
    const segments: TranscriptSegment[] = [{ start: 0, end: 5, text: "שלום" }];
    expect(assignSpeakers(segments, [])[0]?.speaker).toBeNull();
  });
});

describe("relabelByFirstAppearance", () => {
  it("ממספר לפי סדר ההשמעה ולא לפי המספור של pyannote", () => {
    const labeled = relabelByFirstAppearance([
      { start: 0, end: 2, text: "א", speaker: "SPEAKER_03" },
      { start: 2, end: 4, text: "ב", speaker: "SPEAKER_00" },
      { start: 4, end: 6, text: "ג", speaker: "SPEAKER_03" },
    ]);
    expect(labeled.map((s) => s.speaker)).toEqual(["דובר 1", "דובר 2", "דובר 1"]);
  });

  it("משאיר null כ-null", () => {
    const labeled = relabelByFirstAppearance([{ start: 0, end: 1, text: "א", speaker: null }]);
    expect(labeled[0]?.speaker).toBeNull();
  });
});

describe("mergeConsecutive", () => {
  it("מאחד מקטעים רצופים של אותו דובר", () => {
    const merged = mergeConsecutive([
      { start: 0, end: 2, text: "שלום", speaker: "דובר 1" },
      { start: 2, end: 5, text: "מה שלומך", speaker: "דובר 1" },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.text).toBe("שלום מה שלומך");
    expect(merged[0]?.end).toBe(5);
  });

  it("לא מאחד מעבר לשתיקה ארוכה — חותמת הזמן של החזרה נשמרת", () => {
    const merged = mergeConsecutive([
      { start: 0, end: 2, text: "שלום", speaker: "דובר 1" },
      { start: 40, end: 42, text: "עוד משהו", speaker: "דובר 1" },
    ]);
    expect(merged).toHaveLength(2);
  });

  it("לא מאחד דוברים שונים", () => {
    const merged = mergeConsecutive([
      { start: 0, end: 2, text: "שלום", speaker: "דובר 1" },
      { start: 2, end: 4, text: "היי", speaker: "דובר 2" },
    ]);
    expect(merged).toHaveLength(2);
  });

  it("לא משנה את הקלט במקום", () => {
    const input = [
      { start: 0, end: 2, text: "שלום", speaker: "דובר 1" },
      { start: 2, end: 4, text: "עוד", speaker: "דובר 1" },
    ];
    mergeConsecutive(input);
    expect(input[0]?.text).toBe("שלום");
  });
});

describe("formatTimestamp", () => {
  it("מפרמט דקות ושניות", () => {
    expect(formatTimestamp(0)).toBe("00:00");
    expect(formatTimestamp(9)).toBe("00:09");
    expect(formatTimestamp(75)).toBe("01:15");
  });

  it("מוסיף שעות רק כשצריך", () => {
    expect(formatTimestamp(3661)).toBe("1:01:01");
  });

  it("לא נשבר על ערך שלילי", () => {
    expect(formatTimestamp(-5)).toBe("00:00");
  });
});

describe("formatDiarizedTranscript", () => {
  it("מסמן דוברים בשיחה דו-צדדית", () => {
    const result = formatDiarizedTranscript(
      [
        { start: 0, end: 3, text: "שלום, מדבר יוסי מהמשרד" },
        { start: 3, end: 7, text: "היי, כן, אני מחפשת שלושה חדרים" },
      ],
      [
        { start: 0, end: 3, speaker: "SPEAKER_00" },
        { start: 3, end: 7, speaker: "SPEAKER_01" },
      ],
    );
    expect(result.speakerCount).toBe(2);
    expect(result.text).toBe(
      "[00:00] דובר 1: שלום, מדבר יוסי מהמשרד\n[00:03] דובר 2: היי, כן, אני מחפשת שלושה חדרים",
    );
  });

  it("דובר יחיד — טקסט רציף בלי תוויות מיותרות", () => {
    const result = formatDiarizedTranscript(
      [
        { start: 0, end: 3, text: "הגעתם לתא הקולי" },
        { start: 3, end: 6, text: "אנא השאירו הודעה" },
      ],
      [{ start: 0, end: 6, speaker: "SPEAKER_00" }],
    );
    expect(result.speakerCount).toBe(1);
    expect(result.text).toBe("הגעתם לתא הקולי אנא השאירו הודעה");
  });

  it("בלי זיהוי דוברים מחזיר טקסט רציף", () => {
    const result = formatDiarizedTranscript([{ start: 0, end: 3, text: "שלום" }], []);
    expect(result.speakerCount).toBe(0);
    expect(result.text).toBe("שלום");
  });

  it("מקטע בלי דובר מוצג עם זמן ובלי תווית", () => {
    const result = formatDiarizedTranscript(
      [
        { start: 0, end: 3, text: "שלום" },
        { start: 60, end: 62, text: "רעש ברקע" },
        { start: 70, end: 73, text: "היי" },
      ],
      [
        { start: 0, end: 3, speaker: "SPEAKER_00" },
        { start: 70, end: 73, speaker: "SPEAKER_01" },
      ],
    );
    expect(result.speakerCount).toBe(2);
    expect(result.text).toContain("[01:00] רעש ברקע");
    expect(result.text).not.toContain("דובר 3");
  });

  it("מתעלם ממקטעים ריקים", () => {
    const result = formatDiarizedTranscript(
      [
        { start: 0, end: 3, text: "  " },
        { start: 3, end: 6, text: "שלום" },
      ],
      [{ start: 3, end: 6, speaker: "SPEAKER_00" }],
    );
    expect(result.text).toBe("שלום");
  });

  it("תמלול ריק לגמרי", () => {
    expect(formatDiarizedTranscript([], [])).toEqual({ text: "", speakerCount: 0 });
  });
});

describe("countSpeakers", () => {
  it("סופר תוויות שונות ומתעלם מ-null", () => {
    expect(
      countSpeakers([
        { start: 0, end: 1, text: "א", speaker: "דובר 1" },
        { start: 1, end: 2, text: "ב", speaker: "דובר 2" },
        { start: 2, end: 3, text: "ג", speaker: "דובר 1" },
        { start: 3, end: 4, text: "ד", speaker: null },
      ]),
    ).toBe(2);
  });
});
