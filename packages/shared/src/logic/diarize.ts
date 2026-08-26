/**
 * שיוך דוברים לתמלול שיחה — הלוגיקה הטהורה שמאחורי "מי אמר מה".
 *
 * חלוקת העבודה בשרת (ראו infra/diarize):
 *   - faster-whisper מפיק את הטקסט עם חותמות זמן ברמת המשפט.
 *   - pyannote.audio מפיק *בנפרד* מקטעי דיבור עם תווית דובר, בלי טקסט.
 * שני הפלטים לא מדברים ביניהם — הקובץ הזה מחבר אותם לפי חפיפה בזמן.
 *
 * למה לא יישור ברמת המילה (מה ש-WhisperX עושה):
 * WhisperX משייך דוברים ברמת המילה, וזה מדויק יותר — אבל הוא דורש
 * מודל יישור (wav2vec2) בשפת השיחה. לעברית אין מודל כזה ב-WhisperX,
 * ומעבר ל-large-v3 הגנרי היה מחליף את המודל המכוונן לעברית
 * (ivrit-ai) שמתמלל כאן היום הרבה יותר טוב. שיוך לפי חפיפה שומר על
 * המודל העברי ומשלם בגרנולריות: התווית היא לכל משפט, לא לכל מילה.
 */

/* ==================== תקציב הזמן לזיהוי הדוברים ==================== */

/** רצפה: גם הקלטה בת חצי דקה משלמת את זמן הטעינה של הצינור. */
const DIARIZE_FLOOR_MS = 300_000;
/**
 * תקציב לכל שניית אודיו. הצינור עובר על ההקלטה פעמיים (סגמנטציה
 * ואז אשכול), ובפועל הוא נע סביב 0.5–1.5 מזמן ההקלטה על CPU צנוע.
 * פי 3 נותן מרווח גם לשרת עמוס, בלי להפוך את הפסקת החירום לתיאורטית.
 */
const DIARIZE_PER_AUDIO_SECOND_MS = 3_000;
/**
 * תקרה: הקלטה פגומה שמדווחת על אורך אבסורדי לא תחזיק את התור לנצח.
 * המקבילות היא 1 — בקשה תקועה חוסמת את כל השיחות שאחריה.
 */
const DIARIZE_CEILING_MS = 3_600_000;

/**
 * כמה זמן להמתין לזיהוי הדוברים של הקלטה באורך נתון.
 *
 * קבוע אחד לא עובד כאן: הוא או קצר מדי לשיחה של עשר דקות — ואז
 * *כל* שיחה ארוכה מאבדת תוויות בשקט אחרי שהשרת כבר עשה את העבודה —
 * או ארוך מדי לשיחה של דקה, ואז כשל אמיתי תופס את התור לשעה.
 */
export function diarizeTimeoutMs(audioSeconds: number): number {
  const budget = Math.max(0, audioSeconds) * DIARIZE_PER_AUDIO_SECOND_MS;
  return Math.min(DIARIZE_CEILING_MS, Math.max(DIARIZE_FLOOR_MS, Math.round(budget)));
}

/** מקטע טקסט מהתמלול — חותמות זמן בשניות מתחילת ההקלטה. */
export type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
};

/** מקטע דיבור מזוהה־דובר, כפי ש-pyannote מחזיר (SPEAKER_00 וכו'). */
export type SpeakerTurn = {
  start: number;
  end: number;
  speaker: string;
};

/** מקטע אחרי השיוך; `speaker` הוא null כשאי אפשר לשייך בביטחון. */
export type LabeledSegment = {
  start: number;
  end: number;
  text: string;
  speaker: string | null;
};

/**
 * חלון חסד לשיוך מקטע שלא חופף לשום תור דיבור.
 *
 * pyannote נוטה לסגור תור רגע לפני שהדובר באמת סיים, ומילה אחרונה
 * קצרה ("כן", "בסדר") נופלת מחוץ לכל תור. שיוך לתור הקרוב ביותר בתוך
 * שתי שניות מציל את המקרה הזה; מעבר לכך זה כבר ניחוש, והמקטע נשאר
 * בלי תווית במקום לקבל תווית שגויה.
 */
const NEAREST_TURN_TOLERANCE_SECONDS = 2;

/**
 * מעבר לפער כזה בין שני מקטעים של אותו דובר לא ממזגים אותם.
 *
 * מיזוג הוא מה שהופך "דובר 1: שלום / דובר 1: מה שלומך" לשורה אחת,
 * אבל אם אותו דובר חוזר לדבר אחרי שתיקה ארוכה, מיזוג היה מוחק את
 * חותמת הזמן של החזרה — ובשיחה בת עשר דקות זה בדיוק מה שמחפשים.
 */
const MERGE_GAP_SECONDS = 8;

/** אורך החפיפה בשניות בין שני קטעי זמן (0 כשאין). */
function overlapSeconds(a: { start: number; end: number }, b: { start: number; end: number }): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

/** המרחק בשניות בין שני קטעי זמן שאינם חופפים. */
function gapSeconds(a: { start: number; end: number }, b: { start: number; end: number }): number {
  if (a.start > b.end) return a.start - b.end;
  if (b.start > a.end) return b.start - a.end;
  return 0;
}

/**
 * משייך לכל מקטע טקסט את הדובר שהכי חופף לו בזמן.
 *
 * כששני דוברים מדברים יחד (דיבור על גבי דיבור) שניהם חופפים למקטע —
 * מנצח מי שחופף יותר, כי הוא זה שהטקסט ברובו שלו.
 */
export function assignSpeakers(
  segments: readonly TranscriptSegment[],
  turns: readonly SpeakerTurn[],
): LabeledSegment[] {
  return segments.map((segment) => {
    let best: SpeakerTurn | null = null;
    let bestOverlap = 0;
    for (const turn of turns) {
      const overlap = overlapSeconds(segment, turn);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = turn;
      }
    }

    if (!best) {
      // אין חפיפה בכלל — ננסה את התור הקרוב ביותר בתוך חלון החסד
      let nearest: SpeakerTurn | null = null;
      let nearestGap = Number.POSITIVE_INFINITY;
      for (const turn of turns) {
        const gap = gapSeconds(segment, turn);
        if (gap < nearestGap) {
          nearestGap = gap;
          nearest = turn;
        }
      }
      if (nearest && nearestGap <= NEAREST_TURN_TOLERANCE_SECONDS) best = nearest;
    }

    return { start: segment.start, end: segment.end, text: segment.text, speaker: best?.speaker ?? null };
  });
}

/**
 * ממיר תוויות שרירותיות ("SPEAKER_01") לתוויות לפי סדר ההופעה.
 *
 * המספור של pyannote אינו לפי סדר הדיבור — מי שנשמע ראשון בשיחה
 * עלול לקבל SPEAKER_03. "דובר 1" חייב להיות מי שהמתווך שומע ראשון,
 * אחרת הקריאה מבלבלת.
 */
export function relabelByFirstAppearance(segments: readonly LabeledSegment[]): LabeledSegment[] {
  const order = new Map<string, string>();
  for (const segment of segments) {
    if (segment.speaker && !order.has(segment.speaker)) {
      order.set(segment.speaker, `דובר ${order.size + 1}`);
    }
  }
  return segments.map((segment) => ({
    ...segment,
    speaker: segment.speaker ? (order.get(segment.speaker) ?? segment.speaker) : null,
  }));
}

/** מאחד מקטעים רצופים של אותו דובר לגוש קריאה אחד. */
export function mergeConsecutive(segments: readonly LabeledSegment[]): LabeledSegment[] {
  const merged: LabeledSegment[] = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      previous.speaker === segment.speaker &&
      segment.start - previous.end <= MERGE_GAP_SECONDS
    ) {
      previous.text = `${previous.text} ${segment.text}`.trim();
      previous.end = segment.end;
      continue;
    }
    merged.push({ ...segment });
  }
  return merged;
}

/** חותמת זמן קריאה: mm:ss, ומעל שעה h:mm:ss. */
export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** מספר הדוברים השונים שזוהו בפועל. */
export function countSpeakers(segments: readonly LabeledSegment[]): number {
  return new Set(segments.filter((s) => s.speaker).map((s) => s.speaker)).size;
}

/**
 * מרכיב את התמלול המוצג בכרטיס השיחה.
 *
 * כשזוהה דובר אחד בלבד — הודעה קולית, שיחה שהוקלטה מצד אחד — אין
 * שום מידע בתווית "דובר 1" בראש כל שורה, והיא רק מרעישה. במקרה
 * הזה מוחזר טקסט רציף, בדיוק כמו תמלול בלי זיהוי דוברים.
 */
export function formatDiarizedTranscript(
  segments: readonly TranscriptSegment[],
  turns: readonly SpeakerTurn[],
): { text: string; speakerCount: number } {
  const clean = segments
    .map((s) => ({ ...s, text: s.text.trim() }))
    .filter((s) => s.text.length > 0);
  if (clean.length === 0) return { text: "", speakerCount: 0 };

  const blocks = mergeConsecutive(relabelByFirstAppearance(assignSpeakers(clean, turns)));
  const speakerCount = countSpeakers(blocks);

  if (speakerCount < 2) {
    return { text: blocks.map((b) => b.text).join(" ").trim(), speakerCount };
  }

  const text = blocks
    .map((block) =>
      block.speaker
        ? `[${formatTimestamp(block.start)}] ${block.speaker}: ${block.text}`
        : `[${formatTimestamp(block.start)}] ${block.text}`,
    )
    .join("\n");
  return { text, speakerCount };
}

/** תור אחד בתמלול, כפי שהוא מוצג — מה שנשמר הוא טקסט, לא מבנה. */
export type TranscriptLine = {
  /** „דובר 1” וכו', או `null` כשהשורה אינה נושאת תווית. */
  speaker: string | null;
  /** ‎`mm:ss` כפי שנכתב, או `null` כשאין חותמת. */
  timestamp: string | null;
  text: string;
};

/*
 * ‎**קריאה חזרה של הפורמט שנכתב מעל.**
 *
 * ‎`formatDiarizedTranscript` משטח את `LabeledSegment[]` למחרוזת,
 * והמבנה נזרק — הוא אינו נשמר בשום עמודה. מסך שרוצה להציג כל דובר
 * כתור נפרד חייב להחזיר אותו, ויש לכך שתי דרכים: לשנות את מה
 * שנשמר, או לקרוא בחזרה את מה שכבר נשמר.
 *
 * כאן הדרך השנייה, ובכוונה: היא עובדת גם על כל השיחות שכבר תומללו,
 * ולא רק על אלה שיוקלטו מהיום. הסיכון המובהק בפרסור הוא פורמט זר —
 * וזה אינו זר: הוא נכתב בפונקציה שמעליה בקובץ הזה, ובדיקת הלוך-ושוב
 * אוכפת שהשתיים נשארות צמודות.
 *
 * ‎**מה שאי אפשר לדעת, ולכן לא מנוחש:** בשיחה עם דובר אחד הפורמט
 * מוותר על התוויות לגמרי, ואין דגל שמבחין בין „דובר יחיד” לבין
 * „תמלול ישן בלי זיהוי”. שתיהן חוזרות כשורה אחת בלי דובר — וזה
 * מדויק, כי בשתיהן באמת אין מידע על מי מדבר.
 */
const LINE_PATTERN = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(?:(דובר \d+):\s*)?(.*)$/u;

export function parseDiarizedTranscript(transcript: string): TranscriptLine[] {
  const text = transcript.trim();
  if (text === "") return [];
  const lines: TranscriptLine[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    const match = LINE_PATTERN.exec(line);
    if (match === null) {
      /*
       * שורה שאינה נושאת חותמת מצטרפת לתור שלפניה, ולא פותחת תור
       * חדש בלי דובר: תמלול עם ירידות שורה בתוך דברי דובר אחד היה
       * מתפצל לגושים שנראים כמו החלפת דובר.
       */
      const previous = lines[lines.length - 1];
      if (previous === undefined) lines.push({ speaker: null, timestamp: null, text: line });
      else previous.text = `${previous.text} ${line}`.trim();
      continue;
    }
    lines.push({
      timestamp: match[1] ?? null,
      speaker: match[2] ?? null,
      text: (match[3] ?? "").trim(),
    });
  }
  return lines;
}

/** האם התמלול נושא תוויות דובר — כלומר יש מה להציג כתורות. */
export function hasSpeakerTurns(lines: readonly TranscriptLine[]): boolean {
  return lines.some((line) => line.speaker !== null);
}
