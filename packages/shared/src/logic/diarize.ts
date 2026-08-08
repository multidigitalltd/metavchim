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
