"use client";

import {
  CALL_HIGHLIGHT_LABELS,
  CALL_SIDE_LABELS,
  hasSpeakerTurns,
  parseDiarizedTranscript,
  parseRoleTranscript,
  CALL_ROLE_LABELS,
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
  /*
   * ‎**תפקידים לפני מספרים.**
   *
   * שני פורמטים יושבים בעמודה הזו: „מתווך:” / „לקוח:” שמודל השפה
   * מייצר, ו-„[01:15] דובר 2:” של זיהוי הדוברים האקוסטי. הראשון
   * נבדק קודם כי הוא עונה על השאלה שבאמת נשאלת — מי מהשניים אמר
   * את זה — והשני נשאר בשביל כל מה שכבר תומלל.
   */
  const roleTurns = parseRoleTranscript(transcript);
  if (roleTurns.length >= 2) {
    return (
      <ol
        className="mt-2 max-h-80 list-none overflow-y-auto rounded-[13px] border p-3 text-sm"
        style={{ background: "var(--color-bg)", borderColor: "var(--color-border)", margin: 0 }}
      >
        {roleTurns.map((turn, index) => {
          /*
           * המתווך מקבל את צבע המערכת והלקוח נשאר ניטרלי. זו אינה
           * הערכה של מי חשוב יותר — היא מה שמאפשר לסרוק שיחה בעין
           * ולראות מיד מי הוביל אותה.
           */
          const mine = turn.role === "agent";
          return (
            <li
              key={`${turn.role}-${index}`}
              className="mb-2 rounded-[11px] p-2.5 last:mb-0"
              style={{
                background: mine ? "var(--color-primary-soft)" : "var(--color-field)",
                borderInlineStart: `3px solid ${
                  mine ? "var(--color-primary)" : "var(--color-text-muted)"
                }`,
                lineHeight: 1.6,
              }}
            >
              <p
                className="m-0 mb-1 text-[length:var(--type-caption-lg)] font-extrabold"
                style={{ color: mine ? "var(--color-primary)" : "var(--color-text-muted)" }}
              >
                {CALL_ROLE_LABELS[turn.role]}
              </p>
              <p className="m-0 whitespace-pre-wrap">{turn.text}</p>
            </li>
          );
        })}
      </ol>
    );
  }

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
/**
 * ‎**הגוון נגזר ממה שהשדה אומר, ולא מסדר ההופעה שלו.**
 *
 * ‏עשרה צ'יפים באותו אפור דורשים לקרוא את כולם כדי למצוא את השניים
 * שמשנים. החלוקה היא לפי מה שמתווך עושה עם השדה:
 *
 * - ‎`decision` — מה שקובע את כל השאר: הצד (קונה/מוכר) והבלעדיות.
 *   שדה אחד שגוי כאן הופך את השיחה כולה לעבודה ההפוכה.
 * - ‎`money` — תקציב ומימון. המספר שמכריע אם יש בכלל על מה לדבר.
 * - ‎`attention` — מה שדורש פעולה או שעלול לחסום: לוח זמנים,
 *   הסתייגויות, מה שהתחייבנו, ומתי לחזור.
 * - ‎`wanted` — מה שהוא מחפש. הרוב, ולכן ניטרלי: אחרת הכל צועק.
 */
type Tone = "decision" | "money" | "attention" | "wanted";

const TONE_DOMAIN: Record<Tone, string> = {
  decision: "mv-domain-green",
  money: "mv-domain-blue",
  attention: "mv-domain-peach",
  wanted: "mv-domain-neutral",
};

/**
 * ‎**הכותרת נמסרת פנימה, ולא נבנית בחוץ.**
 *
 * ‏מי שרוצה כותרת מעל התגיות חייב לדעת אם יהיו תגיות — ובדיקה
 * נפרדת אצל הקורא היא בדיקה שנייה שסוטה מהראשונה. `exclusivity`
 * למשל נשמר גם כ-`false`, ולכן „יש שדה” אינו „יש מה להציג”:
 * כותרת „פרטי לקוח” הייתה מופיעה מעל ריק, ונקראת כטענה על השיחה
 * („אין ללקוח דרישות”) במקום על מה שלא זוהה.
 *
 * ‏ההחלטה מתקבלת כאן, במקום שבו ממילא יודעים כמה שדות נבנו.
 */
export function CallHighlightFields({
  highlights,
  header,
}: {
  highlights: CallHighlights;
  header?: React.ReactNode;
}): React.JSX.Element | null {
  const fields: { label: string; value: string; ltr?: boolean; tone: Tone }[] = [];
  /*
   * ‎**הצד ראשון, ובכוונה.**
   *
   * „תקציב 2.4 מיליון, 4 חדרים, רמת גן” אינו אומר אם זה מי שמחפש
   * או מי שמוכר — ואלה שתי עבודות הפוכות. הצד הוא מה שקובע מה
   * עושים עם כל השאר, ולכן הוא נקרא ראשון.
   */
  if (highlights.side !== undefined) {
    fields.push({ tone: "decision", label: CALL_HIGHLIGHT_LABELS.side, value: CALL_SIDE_LABELS[highlights.side] });
  }
  if (highlights.propertyType !== undefined) {
    fields.push({ tone: "wanted", label: CALL_HIGHLIGHT_LABELS.propertyType, value: highlights.propertyType });
  }
  if (highlights.budget !== undefined) {
    fields.push({
      tone: "money",
      label: CALL_HIGHLIGHT_LABELS.budget,
      value: formatBudget(highlights.budget),
      ltr: true,
    });
  }
  if (highlights.rooms !== undefined) {
    fields.push({ tone: "wanted", label: CALL_HIGHLIGHT_LABELS.rooms, value: String(highlights.rooms), ltr: true });
  }
  if (highlights.areaSqm !== undefined) {
    fields.push({
      tone: "wanted",
      label: CALL_HIGHLIGHT_LABELS.areaSqm,
      value: `${highlights.areaSqm} מ״ר`,
      ltr: true,
    });
  }
  if (highlights.city !== undefined) {
    fields.push({ tone: "wanted", label: CALL_HIGHLIGHT_LABELS.city, value: highlights.city });
  }
  if (highlights.neighborhood !== undefined) {
    fields.push({ tone: "wanted", label: CALL_HIGHLIGHT_LABELS.neighborhood, value: highlights.neighborhood });
  }
  if (highlights.address !== undefined) {
    fields.push({ tone: "wanted", label: CALL_HIGHLIGHT_LABELS.address, value: highlights.address });
  }
  if (highlights.timeline !== undefined) {
    fields.push({ tone: "attention", label: CALL_HIGHLIGHT_LABELS.timeline, value: highlights.timeline });
  }
  if (highlights.financing !== undefined) {
    fields.push({ tone: "money", label: CALL_HIGHLIGHT_LABELS.financing, value: highlights.financing });
  }
  if (highlights.motivation !== undefined) {
    fields.push({ tone: "wanted", label: CALL_HIGHLIGHT_LABELS.motivation, value: highlights.motivation });
  }
  if (highlights.exclusivity === true) {
    fields.push({ tone: "decision", label: CALL_HIGHLIGHT_LABELS.exclusivity, value: "עלתה בשיחה" });
  }
  /*
   * הרשימות מאוחדות לשדה אחד ולא לשדה לכל פריט: „ביקש: מעלית,
   * חניה, ממ״ד” נסרק במבט, ושלושה כרטיסים נפרדים היו מציפים את
   * השורה ודוחקים את מה שחשוב ממנה.
   */
  for (const key of ["features", "objections", "commitments"] as const) {
    const items = highlights[key];
    if (items !== undefined && items.length > 0) {
      fields.push({
        tone: key === "features" ? "wanted" : "attention",
        label: CALL_HIGHLIGHT_LABELS[key],
        value: items.join(" · "),
      });
    }
  }
  if (highlights.callback !== undefined) {
    fields.push({ tone: "attention", label: CALL_HIGHLIGHT_LABELS.callback, value: highlights.callback });
  }
  if (fields.length === 0) return null;

  return (
    <div className={header === undefined ? undefined : "mt-4"}>
      {header}
      <dl className="m-0 flex flex-wrap gap-2">
        {fields.map((field) => (
          <div key={field.label} className={`mv-call-chip ${TONE_DOMAIN[field.tone]}`}>
            <dt className="font-extrabold">{field.label}:</dt>
            <dd className="m-0" {...(field.ltr ? { dir: "ltr" as const } : {})}>
              {field.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
