"use client";

import {
  CALL_HIGHLIGHT_LABELS,
  hasSpeakerTurns,
  parseDiarizedTranscript,
  type CallHighlights,
} from "@metavchim/shared";

/**
 * החלקים המשותפים לכרטיס השיחה — במסך השיחות ובכרטיס הליד.
 *
 * רכיב אחד לשניהם ולא שתי גרסאות: שיחה שנראית אחרת בשני מסכים
 * מכריחה את המתווך ללמוד אותה פעמיים, וכל תיקון עתידי היה צריך
 * להיעשות בשני מקומות — כלומר להישכח באחד מהם.
 */

/* צבעי הדוברים — שני גוונים ניטרליים מהחבילה, לא סמנטיים.
 * „דובר 1” אינו טוב או רע, ולכן הוא אינו ירוק ואינו אדום: הצבע
 * כאן עונה על „מי מדבר עכשיו”, ותפקידו להבחין ולא להעריך. */
const SPEAKER_TONES = [
  { bg: "var(--color-field)", accent: "var(--color-text-muted)" },
  { bg: "var(--color-surface-alt, var(--color-bg))", accent: "var(--color-text)" },
] as const;

/**
 * התמלול, כשיש דוברים — כל תור בגוש משלו.
 *
 * גוש טקסט אחד עם ירידות שורה הוא מה שהיה כאן, והוא קריא רק למי
 * שכבר יודע מה הוא מחפש. שיחה היא דו-שיח, והעין צריכה לתפוס מי
 * ענה למי בלי לקרוא כל מילה.
 *
 * כשאין תוויות — הקלטה מצד אחד, או תמלול שקדם לזיהוי הדוברים —
 * מוצג בדיוק מה שהיה: טקסט רציף. אין המצאה של „דובר 1” יחיד,
 * כי לא ידוע מי דיבר.
 */
export function CallTranscript({ transcript }: { transcript: string }): React.JSX.Element {
  const lines = parseDiarizedTranscript(transcript);
  if (!hasSpeakerTurns(lines)) {
    return (
      <div
        className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-[13px] border p-3.5 text-sm"
        style={{
          background: "var(--color-field)",
          borderColor: "var(--color-border)",
          lineHeight: 1.6,
        }}
      >
        {transcript}
      </div>
    );
  }

  /* מיפוי שם דובר → גוון, לפי סדר ההופעה ולא לפי המספר בשם:
   * תמלול שמתחיל ב„דובר 2” עדיין מקבל את הגוון הראשון. */
  const tones = new Map<string, (typeof SPEAKER_TONES)[number]>();
  for (const line of lines) {
    if (line.speaker !== null && !tones.has(line.speaker)) {
      tones.set(line.speaker, SPEAKER_TONES[tones.size % SPEAKER_TONES.length]!);
    }
  }

  return (
    <ol
      className="mt-2 max-h-80 list-none overflow-y-auto rounded-[13px] border p-3 text-sm"
      style={{ background: "var(--color-bg)", borderColor: "var(--color-border)", margin: 0 }}
    >
      {lines.map((line, index) => {
        const tone = line.speaker !== null ? tones.get(line.speaker) : undefined;
        return (
          <li
            key={`${line.timestamp ?? ""}-${index}`}
            className="mb-2 rounded-[11px] p-2.5 last:mb-0"
            style={{
              background: tone?.bg ?? "var(--color-field)",
              /* פס בצד ההתחלה — לוגי ולא ימני, כדי שיישאר נכון גם
               * אם המסך יוצג אי-פעם ב-LTR */
              borderInlineStart: `3px solid ${tone?.accent ?? "var(--color-border)"}`,
              lineHeight: 1.6,
            }}
          >
            <p
              className="m-0 mb-1 flex flex-wrap gap-2 text-[length:var(--type-caption-lg)] font-extrabold"
              style={{ color: "var(--color-text-muted)" }}
            >
              {line.speaker !== null ? <span>{line.speaker}</span> : null}
              {/* השעה היא מספר, ולכן ltr — אחרת „01:15” מוצג הפוך */}
              {line.timestamp !== null ? (
                <span dir="ltr" style={{ fontWeight: 400 }}>
                  {line.timestamp}
                </span>
              ) : null}
            </p>
            <p className="m-0">{line.text}</p>
          </li>
        );
      })}
    </ol>
  );
}

/** תקציב בשקלים → „2.4 מיליון ₪” / „850 אלף ₪”, כפי שנאמר בשיחה. */
function formatBudget(value: number): string {
  return value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)} מיליון ₪`
    : `${Math.round(value / 1000)} אלף ₪`;
}

/**
 * הפרטים שחולצו מהשיחה, כשדות.
 *
 * שורת הסיכום („הביע עניין · 4 חדרים · בני ברק”) קריאה לאדם אבל
 * אינה שדות: אי אפשר לסרוק בה בעין מה התקציב בלי לקרוא את כולה.
 * כאן כל פרט נושא את התווית שלו.
 *
 * ‎**מה שלא זוהה פשוט אינו מוצג**, ואינו מוצג כ„לא ידוע”: המחלץ
 * מוצא ביטויים בטקסט, ומה שלא נמצא יכול היה גם להיאמר ולא להיתפס.
 * „לא צוין תקציב” הייתה טענה על השיחה שאיננו יכולים להצדיק.
 */
export function CallHighlightFields({
  highlights,
}: {
  highlights: CallHighlights;
}): React.JSX.Element | null {
  const fields: { label: string; value: string; ltr?: boolean }[] = [];
  if (highlights.budget !== undefined) {
    fields.push({
      label: CALL_HIGHLIGHT_LABELS.budget,
      value: formatBudget(highlights.budget),
      ltr: true,
    });
  }
  if (highlights.rooms !== undefined) {
    fields.push({ label: CALL_HIGHLIGHT_LABELS.rooms, value: String(highlights.rooms), ltr: true });
  }
  if (highlights.city !== undefined) {
    fields.push({ label: CALL_HIGHLIGHT_LABELS.city, value: highlights.city });
  }
  if (highlights.callback !== undefined) {
    fields.push({ label: CALL_HIGHLIGHT_LABELS.callback, value: highlights.callback });
  }
  if (fields.length === 0) return null;

  return (
    <dl className="mt-3 mb-0 flex flex-wrap gap-2">
      {fields.map((field) => (
        <div
          key={field.label}
          className="rounded-[11px] border px-3 py-2"
          style={{ background: "var(--color-field)", borderColor: "var(--color-border)" }}
        >
          <dt
            className="text-[length:var(--type-caption-lg)] font-extrabold"
            style={{ color: "var(--color-text-muted)" }}
          >
            {field.label}
          </dt>
          <dd className="m-0 text-sm font-bold" {...(field.ltr ? { dir: "ltr" as const } : {})}>
            {field.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
