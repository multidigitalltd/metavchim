/**
 * פענוח תאריך ושעה מעברית מדוברת — "מחר בעשר", "יום שלישי ב-4",
 * "ביום ראשון בשעה 16:30", "בעוד שעתיים". מנוע חוקים דטרמיניסטי.
 *
 * `now` מוזרק תמיד (ולא נלקח מהשעון הפנימי) כדי שהפענוח יהיה ניתן
 * לבדיקה ועקבי בין השרת לדפדפן.
 */

export interface ParsedDateTime {
  /** התאריך שזוהה; undefined = לא זוהה ויש לבקש מהמתווך */
  date?: Date;
  /** האם השעה נאמרה במפורש (אחרת נבחרה ברירת מחדל 10:00) */
  timeExplicit: boolean;
  evidence?: string;
}

const WEEKDAYS: [RegExp, number][] = [
  [/יום ראשון|ביום ראשון|ראשון/u, 0],
  [/יום שני|ביום שני|שני/u, 1],
  [/יום שלישי|ביום שלישי|שלישי/u, 2],
  [/יום רביעי|ביום רביעי|רביעי/u, 3],
  [/יום חמישי|ביום חמישי|חמישי/u, 4],
  [/יום שישי|ביום שישי|שישי/u, 5],
  [/שבת|מוצ["״]ש/u, 6],
];

const HOUR_WORDS: Record<string, number> = {
  אחת: 1, שתיים: 2, שלוש: 3, ארבע: 4, חמש: 5, שש: 6,
  שבע: 7, שמונה: 8, תשע: 9, עשר: 10, "אחת עשרה": 11, "שתים עשרה": 12,
};

/** שעה מהטקסט: "בעשר", "ב-16:30", "בשעה 4", "ב-9 בבוקר" */
function parseTime(text: string): { hour: number; minute: number; evidence: string } | undefined {
  // פורמט מספרי: 16:30 / 9:00
  const hhmm = /(?:בשעה\s*|ב-?\s*)?(?<h>[01]?\d|2[0-3]):(?<m>[0-5]\d)/u.exec(text);
  if (hhmm?.groups?.["h"] !== undefined && hhmm.groups["m"] !== undefined) {
    return {
      hour: Number(hhmm.groups["h"]),
      minute: Number(hhmm.groups["m"]),
      evidence: hhmm[0],
    };
  }

  // שעה עגולה במספר: "בשעה 4", "ב-16"
  const numeric = /(?:בשעה\s*|ב-\s*)(?<h>[01]?\d|2[0-3])(?!\d)/u.exec(text);
  // שעה במילים: "בעשר", "בשמונה וחצי"
  const wordMatch = /ב?(?<word>אחת עשרה|שתים עשרה|אחת|שתיים|שלוש|ארבע|חמש|שש|שבע|שמונה|תשע|עשר)(?<half>\s*וחצי)?/u.exec(text);

  let hour: number | undefined;
  let minute = 0;
  let evidence: string | undefined;

  if (numeric?.groups?.["h"] !== undefined) {
    hour = Number(numeric.groups["h"]);
    evidence = numeric[0];
  } else if (wordMatch?.groups?.["word"] !== undefined) {
    hour = HOUR_WORDS[wordMatch.groups["word"]];
    evidence = wordMatch[0];
    if (wordMatch.groups["half"]) minute = 30;
  }
  if (hour === undefined) return undefined;

  // "בבוקר" / "בערב" / "אחרי הצהריים" — הכרעת בוקר/ערב
  if (/בערב|בלילה|אחרי הצהריים|אחה["״]צ/u.test(text) && hour < 12) hour += 12;
  else if (!/בבוקר|בצהריים/u.test(text) && hour >= 1 && hour <= 7) hour += 12; // "ב-4" ⇒ 16:00

  if (/\s*וחצי/u.test(text) && minute === 0 && wordMatch) minute = 30;

  return { hour, minute, evidence: evidence ?? "" };
}

export function parseHebrewDateTime(transcript: string, now: Date): ParsedDateTime {
  const text = transcript.replace(/\s+/gu, " ").trim();
  const time = parseTime(text);
  const evidenceParts: string[] = [];

  const base = new Date(now.getTime());
  base.setSeconds(0, 0);

  let date: Date | undefined;

  // --- יום יחסי ---
  if (/מחרתיים/u.test(text)) {
    date = new Date(base);
    date.setDate(date.getDate() + 2);
    evidenceParts.push("מחרתיים");
  } else if (/מחר/u.test(text)) {
    date = new Date(base);
    date.setDate(date.getDate() + 1);
    evidenceParts.push("מחר");
  } else if (/היום/u.test(text)) {
    date = new Date(base);
    evidenceParts.push("היום");
  } else {
    // --- יום בשבוע: הקרוב שעוד לא עבר ---
    for (const [pattern, weekday] of WEEKDAYS) {
      const match = pattern.exec(text);
      if (!match) continue;
      date = new Date(base);
      const diff = (weekday - base.getDay() + 7) % 7;
      date.setDate(date.getDate() + (diff === 0 ? 7 : diff));
      evidenceParts.push(match[0]);
      break;
    }
  }

  // --- "בעוד X שעות/ימים" ---
  const inHours = /בעוד\s+(?<n>שעה|שעתיים|\d+)\s*(?:שעות)?/u.exec(text);
  if (date === undefined && inHours?.groups?.["n"] !== undefined) {
    const raw = inHours.groups["n"];
    const hours = raw === "שעה" ? 1 : raw === "שעתיים" ? 2 : Number(raw);
    if (!Number.isNaN(hours) && hours > 0 && hours <= 72) {
      date = new Date(base.getTime() + hours * 60 * 60 * 1000);
      return { date, timeExplicit: true, evidence: inHours[0] };
    }
  }

  if (date === undefined) return { timeExplicit: false };

  if (time) {
    date.setHours(time.hour, time.minute, 0, 0);
    if (time.evidence) evidenceParts.push(time.evidence);
  } else {
    date.setHours(10, 0, 0, 0); // ברירת מחדל — המתווך רואה ומתקן
  }

  return {
    date,
    timeExplicit: time !== undefined,
    evidence: evidenceParts.join(" "),
  };
}

/** סוג הפגישה מהטקסט — סיור בנכס הוא ברירת המחדל של מתווך. */
export function parseAppointmentKind(transcript: string): "viewing" | "meeting" | "call" {
  if (/שיחה|טלפון|לדבר/u.test(transcript)) return "call";
  if (/סיור|ביקור|להראות|לראות את הדירה|לראות את הנכס/u.test(transcript)) return "viewing";
  return "meeting";
}
