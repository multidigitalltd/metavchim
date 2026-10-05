"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@metavchim/ui";
import { apiDelete, apiGet, apiList } from "@/lib/api";
import { IconPhone } from "../icons";
import { formatDateTime } from "@/lib/format";

/**
 * יומן הפניות שהגיעו מהמרכזיות — **כולל אלה שנדחו**.
 *
 * ## למה המסך הזה קיים
 *
 * פנייה עם מפתח שאינו מוכר, חיבור מנוטרל או מסלול בלי מרכזייה
 * נדחתה ב-404 ולא הותירה שום עקבה בשום מקום. מסך האבחון של המשרד
 * הראה "לא התקבל אף אירוע" — אותו טקסט בדיוק שרואה משרד שהמרכזייה
 * שלו מעולם לא פנתה.
 *
 * שני המצבים דורשים פעולה הפוכה לגמרי: לתקן כתובת אצל הספק, מול
 * לרענן מפתח או לפתוח את הפיצ'ר במסלול. בלי ההבחנה השאלה "למה
 * השיחות לא מגיעות" נשארת בלי שום קצה חוט.
 *
 * ## למה כאן ולא בהגדרות המשרד
 *
 * הפנייה המעניינת ביותר היא זו שלא הצלחנו לשייך לאף משרד. מסך
 * שמסונן לפי משרד לא יכול להראות אותה מעצם הגדרתו — כלומר היה
 * מחמיץ בדיוק את התקלה השכיחה.
 *
 * ## ולמה יש כאן סינון וסיכום
 *
 * ‏רשימה של מאתיים שורות מעורבות מכל המשרדים אינה יומן שאפשר
 * ‏לעקוב אחריו: כל שאלה („מה קרה אצל המשרד הזה”, „הראה רק את מה
 * ‏שלא נותח”, „מה קרה בשיחה הזאת”) נענתה בגלילה ידנית. שורת
 * ‏הסיכום עונה על השאלה הראשונה — האם המצב תקין בכלל — והסינון
 * ‏מאפשר לרדת לשורות רק כשהתשובה שם חריגה.
 */

/** מה קרה לפנייה, בשפה של מי שצריך לפעול. */
const OUTCOMES: Record<string, { label: string; hint: string; ok: boolean }> = {
  accepted: {
    label: "נקלטה כשיחה",
    hint: "המפתח זוהה, האירוע נותח, והשיחה נרשמה",
    ok: true,
  },
  /*
   * צלצול נקרא בהצלחה ובכל זאת אינו יוצר שורת שיחה — כך נקבע
   * בכוונה, כי השיחה עוד לא קרתה. סימונו כ„נקלטה” היה מציג
   * מרכזייה ששולחת `Calling` ומאבדת את ה-`Hangup` כתקינה, בזמן
   * שאף שיחה אינה נרשמת אצלה.
   */
  preliminary: {
    label: "אירוע ביניים",
    hint: "צלצול או מענה — נקרא בהצלחה, אך שורת השיחה נכתבת רק באירוע המסיים (ניתוק). אם הוא אינו מגיע, לא תיווצר שיחה",
    ok: true,
  },
  /*
   * „התקבלה” הישנה נרשמה על ההגעה בלבד, ולכן פנייה שנזרקה מיד אחריה
   * נראתה כמו פנייה שהפכה לשיחה. זו הייתה בדיוק העמודה שמסתכלים בה
   * כשלקוח התקשר ואין רישום — והיא לא יכלה לענות.
   */
  unparsed: {
    label: "הגיעה ולא זוהתה",
    hint: "המפתח והמסלול תקינים, אבל לא היה באירוע די כדי לזהות שיחה — ראו את הסיבה",
    ok: false,
  },
  /*
   * לא „נדחתה” ולא „נקלטה”: הפנייה הגיעה, הובנה, והעיבוד אצלנו נפל.
   * המרכזייה תשלח שוב, ולכן שורה כזו לרוב מלווה בשורה נוספת שהצליחה
   * — ומי שרואה רק אותה צריך לדעת שהתקלה בצד שלנו.
   */
  failed: {
    label: "נפלה אצלנו",
    hint: "האירוע הובן אך העיבוד נכשל בשרת שלנו. הבקשה הוחזרה בשגיאה, והמרכזייה אמורה לשלוח שוב",
    ok: false,
  },
  unknown_key: {
    label: "מפתח לא מוכר",
    hint: "הכתובת אצל הספק מכילה מפתח ישן או שגוי — יש להעתיק מחדש ממסך ההגדרות של המשרד",
    ok: false,
  },
  disabled: {
    label: "חיבור מנוטרל",
    hint: "המפתח שייך למשרד, אבל החיבור אינו פעיל",
    ok: false,
  },
  no_feature: {
    label: "אין מרכזייה במסלול",
    hint: "המפתח תקין והחיבור פעיל — המסלול של המשרד אינו כולל מרכזייה",
    ok: false,
  },
  /*
   * ‎**התוצאה היחידה שבה הפנייה לא הגיעה לשרת בכלל.**
   *
   * ‏רוב המרכזיות אינן מנסות שוב, ולכן זו שיחה שאבדה. השורה נרשמת
   * ‏פעם אחת לכל מפתח בכל דקה, ולכן „אחת” כאן פירושה „דקה שבה
   * ‏המשרד הזה נחסם”, לא פנייה בודדת.
   */
  rate_limited: {
    label: "נחסמה — תקרת המשרד",
    hint: "המרכזייה של המשרד הזה שלחה יותר מ-60 אירועים בדקה. שורה אחת לכל דקה חסומה — לא לכל פנייה",
    ok: false,
  },
  /*
   * ‏מסקנה אחרת לגמרי: ייתכן שהמשרד הזה כמעט לא שלח, והכתובת
   * ‏רוויה מכל המשרדים שיושבים על אותה מרכזיית ענן. „שלחת יותר
   * ‏מדי” היה שולח אותו לחפש תקלה שאינה אצלו.
   */
  rate_limited_ip: {
    label: "נחסמה — תקרת הכתובת",
    hint: "התקרה המשותפת לכתובת של הספק נחצתה, לא זו של המשרד. ייתכן שהמשרד הזה כמעט לא שלח — הבדיקה היא מול הספק",
    ok: false,
  },
};

/**
 * ‎סדר התוצאות בשורת הסיכום ובסינון.
 *
 * ‏קבוע ולא „לפי כמות”: שורת סיכום שמשנה את סדר הגלולות בכל רענון
 * ‏מחייבת לקרוא אותה מחדש בכל פעם, וזו בדיוק העלות שהיא באה לחסוך.
 * ‏שתי התקינות ראשונות, ואחריהן התקלות לפי סדר החומרה לפעולה.
 */
const OUTCOME_ORDER = [
  "accepted",
  "preliminary",
  "unparsed",
  "failed",
  "unknown_key",
  "disabled",
  "no_feature",
  "rate_limited",
  "rate_limited_ip",
] as const;

/**
 * מה חסר היה באירוע שלא זוהה.
 *
 * `invalid_phone` אינו תקלה: כך נראית שיחה ממספר חסוי, והיא נפוצה.
 * הוא מנוסח כאן כעובדה ולא כאזהרה — אותה הבחנה שמסך ההגדרות של
 * המשרד כבר עושה.
 */
const ISSUES: Record<string, string> = {
  no_fields: "הבקשה הגיעה ריקה — כנראה Content-Type שאינו תואם לתבנית",
  no_call_id: "אין מזהה שיחה (callid)",
  no_phone: "לא הגיע מספר מתקשר — השדה חסר או שהספק שלח אותו ריק",
  invalid_phone: "המספר שהגיע אינו מספר תקין — כך נראית שיחה ממספר חסוי",
};

/**
 * ‎**מה שנקרא אחרת בטופס הלידים.**
 *
 * ‏„נקלטה כשיחה” אינו מה שקרה שם, ו„אין מרכזייה במסלול” אינו מצב
 * ‏שקיים בו כלל. אותה תוצאה, מילים של הנתיב שבו היא קרתה — אחרת
 * ‏המסך מסביר תקלה אחת במונחים של אחרת.
 */
const LEAD_OUTCOMES: Record<string, { label: string; hint: string; ok: boolean }> = {
  accepted: {
    label: "נקלט כליד",
    hint: "המפתח זוהה, הפרטים עברו את הבדיקה, והליד נוצר",
    ok: true,
  },
  unparsed: {
    label: "נדחתה בבדיקה",
    hint: "המפתח תקין, אבל גוף הבקשה לא עבר את הבדיקה — ראו את הסיבה",
    ok: false,
  },
  unknown_key: {
    label: "מפתח לא מוכר",
    hint: "המפתח שבכתובת אינו שייך לאף משרד, או שאינו בצורה תקינה — יש להעתיק מחדש ממסך ההגדרות",
    ok: false,
  },
  failed: {
    label: "נפלה אצלנו",
    hint: "הפרטים היו תקינים והעיבוד נכשל בשרת שלנו. הבקשה הוחזרה בשגיאה",
    ok: false,
  },
  rate_limited: {
    label: "נחסמה — תקרת המשרד",
    hint: "יותר מ-10 לידים בדקה מהמפתח של המשרד הזה. שורה אחת לכל דקה חסומה — לא לכל פנייה",
    ok: false,
  },
  rate_limited_ip: {
    label: "נחסמה — תקרת הכתובת",
    hint: "התקרה המשותפת לכתובת נחצתה, לא זו של המשרד. ייתכן שהמשרד הזה כמעט לא שלח",
    ok: false,
  },
};

/** ‏המקורות, בשמות שמי שקורא את היומן מזהה. */
const SOURCES: Record<string, string> = {
  telephony: "מרכזייה",
  lead: "טופס לידים",
};

function outcomeMeta(
  source: string,
  key: string,
): { label: string; hint: string; ok: boolean } | undefined {
  return (source === "lead" ? LEAD_OUTCOMES[key] : undefined) ?? OUTCOMES[key];
}

/**
 * ‏אותה הבחנה בסיבות: „כך נראית שיחה ממספר חסוי” נכון למרכזייה
 * ‏ומטעה לחלוטין בטופס, שבו מספר פסול הוא פשוט שדה שמולא לא נכון.
 */
const LEAD_ISSUES: Record<string, string> = {
  no_fields: "הבקשה הגיעה ריקה — כנראה Content-Type שאינו JSON, או גוף שלא נשלח",
  invalid_phone: "מספר הטלפון בטופס אינו תקין — כך נראה שדה שמולא בפורמט אחר",
  no_name: "שם הפונה חסר או קצר מדי (שני תווים לפחות)",
  bad_body:
    "שדה שאיננו מכירים, או שדה חובה שחסר. הבקשה נדחית במלואה בכוונה — כדי שהטעות תתגלה בבנייה ולא שבועיים אחר כך",
  honeypot: "השדה website מולא — הבקשה נבלעה כבוט. טופס אמיתי שיש בו שדה בשם הזה יש לשנות",
};

function issueText(source: string, key: string): string {
  return (source === "lead" ? LEAD_ISSUES[key] : undefined) ?? ISSUES[key] ?? key;
}

/**
 * ‎סוג האירוע וכיוונו, בעברית.
 *
 * ‏זה מה שמבדיל „מרכזייה תקינה” מ„מרכזייה ששולחת צלצול ומאבדת את
 * ‏הניתוק” — ההבחנה שהיומן לא ידע לעשות עד עכשיו, כי סוג האירוע
 * ‏כלל לא נשמר.
 */
const ACTIONS: Record<string, string> = {
  ringing: "צלצול",
  answered: "מענה",
  hangup: "ניתוק",
};

const DIRECTIONS: Record<string, string> = {
  inbound: "נכנסת",
  outbound: "יוצאת",
};

/** ‏חלונות הזמן לסינון. ריק = כל מה ששמור (תשעים יום). */
const WINDOWS: { value: string; label: string }[] = [
  { value: "", label: "כל מה ששמור" },
  { value: "1", label: "השעה האחרונה" },
  { value: "24", label: "24 שעות" },
  { value: "72", label: "3 ימים" },
  { value: "168", label: "שבוע" },
  { value: "720", label: "חודש" },
];

/**
 * ‎מה מוחקים בריקון.
 *
 * ‎„הכול” ראשון ולא אחרון: זו הדרישה השכיחה — לרוקן, לחייג שיחת
 * ‏בדיקה, ולראות שורה אחת במקום לחפש אותה בתוך רעש. הוא גם היחיד
 * ‏שמבקש אישור נפרד במלל.
 */
const PURGES: { value: string; label: string; confirm: string }[] = [
  { value: "0", label: "הכול", confirm: "למחוק את **כל** יומן הוובהוקים?" },
  { value: "168", label: "ישן משבוע", confirm: "למחוק כל פנייה שהגיעה לפני יותר משבוע?" },
  { value: "720", label: "ישן מחודש", confirm: "למחוק כל פנייה שהגיעה לפני יותר מחודש?" },
];

interface Hit {
  id: string;
  receivedAt: string;
  outcome: string;
  /** למה הפנייה לא הפכה לשיחה — `null` כשהיא כן */
  issue: string | null;
  tenantId: string | null;
  tenantName: string | null;
  keyPrefix: string;
  method: string;
  fieldKeys: string | null;
  /** מה שהספק שלח ואיננו צורכים — ראו התא בטבלה. */
  unmapped: string | null;
  /** מזהה השיחה אצל הספק — מה שמחבר את שלוש השורות של שיחה אחת. */
  callId: string | null;
  /** סוג האירוע — `ringing | answered | hangup`. */
  action: string | null;
  direction: string | null;
  /**
   * ארבע הספרות האחרונות של המתקשר — ולא המספר.
   *
   * המספר עצמו אינו נשמר ואינו יוצא מהשרת בשום צורה; החיפוש לפיו
   * נעשה מול חתימה. הסיומת היא מה שמאפשר לראות ברשימה לא מסוננת
   * ששתי שורות הן אותו מתקשר.
   */
  peerSuffix: string | null;
  /** ‏`telephony` | `lead` — מאיזה נתיב הגיעה. */
  source: string;
}

export function WebhookLogSection() {
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [summary, setSummary] = useState<{ source: string; outcome: string; count: number }[]>([]);
  const [failed, setFailed] = useState(false);

  /** ‏מרכזייה או לידים — ריק = שניהם. */
  const [source, setSource] = useState("");
  const [outcome, setOutcome] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [hours, setHours] = useState("");
  /** ‏השיחה שנבחרה מהטבלה — `null` כשלא סוננה שיחה מסוימת. */
  const [callId, setCallId] = useState<string | null>(null);
  /*
   * ‏שני מצבים למספר, ובכוונה: מה שמוקלד ומה שכבר מסונן. חיפוש
   * ‏על כל הקשה היה שולח בקשה לכל ספרה ומחזיר תשובות לחצאי מספר;
   * ‏החיפוש מדויק ממילא, ולכן הוא מופעל בשליחת הטופס.
   */
  const [phoneInput, setPhoneInput] = useState("");
  const [phone, setPhone] = useState("");

  const [purgeHours, setPurgeHours] = useState("168");
  const [purging, setPurging] = useState(false);
  /*
   * שגיאת ריקון נפרדת משגיאת טעינה: "טעינת היומן נכשלה" על לחיצה
   * על "רוקן" שולחת לחפש את התקלה במקום הלא נכון, וזו בדיוק
   * ההבחנה שכל המסך הזה קיים בשבילה.
   */
  const [purgeFailed, setPurgeFailed] = useState(false);

  /*
   * רשימת המשרדים מגיעה מהשרת ואינה נגזרת מהשורות שחזרו: משרד
   * ששיחותיו ישנות מהעמוד המוצג לא היה מופיע בה, ולא הייתה שום
   * דרך אחרת לבחור אותו — כלומר החיפוש בטווח של תשעים יום היה
   * חסום בדיוק על החיבורים השקטים, שהם הסיבה להיכנס ליומן.
   */
  const [offices, setOffices] = useState<{ id: string; name: string }[]>([]);

  /*
   * מונה בקשות — כל שינוי סינון פותח בקשה חדשה, ותשובה איטית של
   * סינון ישן שנוחתת אחרי החדשה הייתה דורסת את הטבלה בשורות שאינן
   * עונות על מה שמוצג בפקדים. תשובה שאינה של הבקשה האחרונה נזרקת.
   */
  const generation = useRef(0);

  const load = useCallback(() => {
    setFailed(false);
    generation.current += 1;
    const mine = generation.current;
    const params = new URLSearchParams();
    if (source !== "") params.set("source", source);
    if (outcome !== "") params.set("outcome", outcome);
    if (tenantId !== "") params.set("tenantId", tenantId);
    if (hours !== "") params.set("hours", hours);
    if (callId !== null) params.set("callId", callId);
    if (phone !== "") params.set("phone", phone);
    const query = params.toString();
    apiGet<{
      hits: Hit[];
      summary: { source: string; outcome: string; count: number }[];
      offices: { id: string; name: string }[];
    }>(`/platform/telephony-webhooks${query === "" ? "" : `?${query}`}`)
      .then((res) => {
        if (mine !== generation.current) return;
        setHits(apiList(res.hits, "hits"));
        setSummary(apiList(res.summary, "summary"));
        setOffices(apiList(res.offices, "offices"));
      })
      .catch(() => {
        if (mine !== generation.current) return;
        setFailed(true);
      });
  }, [source, outcome, tenantId, hours, callId, phone]);

  useEffect(load, [load]);

  /*
   * ‎**הסכום עוקב אחרי המקור שנבחר** (ביקורת Codex, P2).
   *
   * ‏סכום על שני המקורות מעל פילוח של אחד מהם הוא כותרת שסותרת
   * ‏את מה שמתחתיה: „101 פניות” ואז שורה אחת של ליד — או גרוע
   * ‏מכך, מספר גדול בלי שום פילוח כשאין פניות במקור שנבחר.
   */
  const total = summary
    .filter((row) => source === "" || row.source === source)
    .reduce((sum, row) => sum + row.count, 0);
  const filtered =
    outcome !== "" || tenantId !== "" || hours !== "" || callId !== null || phone !== "";

  /*
   * הריקון מרענן את הרשימה בעצמו: מסך שממשיך להציג שורות שנמחקו
   * זה עתה הוא בדיוק המקום שבו מפסיקים להאמין לכפתור.
   */
  function purge(): void {
    const option = PURGES.find((p) => p.value === purgeHours);
    if (option === undefined || !window.confirm(`${option.confirm}\n\nהפעולה אינה הפיכה.`)) {
      return;
    }
    setPurging(true);
    setPurgeFailed(false);
    apiDelete<{ deleted: number }>("/platform/telephony-webhooks", {
      olderThanHours: Number(option.value),
    })
      .then(() => load())
      .catch(() => setPurgeFailed(true))
      .finally(() => setPurging(false));
  }

  return (
    <section
      aria-labelledby="telephony-webhooks"
      className="mb-8 rounded-xl border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="telephony-webhooks" className="text-lg font-semibold">
          <IconPhone s={16} /> פניות ממרכזיות
        </h2>
        <Button variant="secondary" onClick={load}>
          רענן
        </Button>
      </div>

      <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        כל פנייה שהגיעה לכתובת הוובהוק, כולל פניות שנדחו, לשבועיים אחורה. רשימה ריקה אחרי
        שהספק הוגדר פירושה שהמרכזייה אינה פונה כלל — כלומר הכתובת אצלה שגויה או שהאירוע לא
        הופעל.
        <br />
        עמודת <b>לא ממופה</b> מראה שדות שהספק שולח ואיננו קוראים. שדה שמופיע שם באדום
        ונראה חשוב — שלחו לנו אותו, והוא ייקלט בגרסה הבאה.
      </p>

      {/*
        התמונה לפני השורות: „יש פניות בכלל, וכמה מהן הפכו לשיחות”.
        אלף שורות אינן עונות על זה, וזו השאלה הראשונה שנשאלת.
        קבוע על 24 שעות — סיכום שמשתנה עם הסינון אינו קו ייחוס.
      */}
      <div className="mb-3 flex flex-col gap-1 text-sm">
        <span style={{ color: "var(--color-text-muted)" }}>
          {total === 0 ? "לא הגיעה אף פנייה ב-24 השעות האחרונות" : `${total} פניות ב-24 השעות האחרונות:`}
        </span>
        {/*
          ‏שורה לכל מקור, ולא סיכום אחד: „נקלטה” על שיחה ו„נקלט”
          ‏על ליד הן שתי עובדות שונות, ומספר שמחבר אותן אינו עונה
          ‏על אף אחת מהשתיים.
        */}
        {Object.keys(SOURCES)
          .filter((src) => source === "" || source === src)
          .map((src) => {
            const rows = summary.filter((row) => row.source === src);
            const srcTotal = rows.reduce((sum, row) => sum + row.count, 0);
            if (srcTotal === 0) return null;
            return (
              <div key={src} className="flex flex-wrap items-center gap-2">
                <span style={{ color: "var(--color-text-muted)" }}>{SOURCES[src]}:</span>
                {OUTCOME_ORDER.map((key) => {
                  const count = rows.find((row) => row.outcome === key)?.count ?? 0;
                  if (count === 0) return null;
                  const meta = outcomeMeta(src, key);
                  return (
                    <span
                      key={key}
                      className="mv-pill"
                      title={meta?.hint ?? ""}
                      style={{
                        color: meta?.ok === true ? "var(--color-success)" : "var(--color-danger)",
                      }}
                    >
                      {meta?.label ?? key} · {count}
                    </span>
                  );
                })}
              </div>
            );
          })}
      </div>

      {/*
        הסינון הוא מה שהופך את היומן למשהו שאפשר לחקור בו. הוא רץ
        בשרת ולא כאן: סינון בדפדפן מסנן רק את מה שכבר נשלף, כלומר
        "הראה לי את המשרד הזה" היה מחזיר את מה שבמקרה היה בדף.
      */}
      <div className="mb-3 flex flex-wrap items-end gap-2">
        {/*
          ‏המקור ראשון, כי הוא מחליף את משמעות שאר הסינון: „נקלטה”
          ‏אינה אותה שאלה בשני הנתיבים.
        */}
        <label className="flex flex-col gap-1 text-sm">
          <span style={{ color: "var(--color-text-muted)" }}>מקור</span>
          <select
            className="mv-select"
            value={source}
            onChange={(e) => {
              const next = e.target.value;
              setSource(next);
              /*
               * ‎**תוצאה שאינה קיימת במקור החדש מתאפסת** (ביקורת
               * ‏Codex, P2). היא נעלמת מהרשימה אך נשארת ב-state,
               * ‏ולכן השאילתה יוצאת עם `outcome=no_feature&source=lead`
               * ‏ומחזירה טבלה ריקה בלי שום הסבר — בזמן שהבורר
               * ‏עצמו מציג „כל התוצאות”.
               */
              if (next === "lead" && outcome !== "" && !(outcome in LEAD_OUTCOMES)) {
                setOutcome("");
              }
            }}
            aria-label="סינון לפי מקור"
          >
            <option value="">כל המקורות</option>
            {Object.entries(SOURCES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span style={{ color: "var(--color-text-muted)" }}>תוצאה</span>
          <select
            className="mv-select"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            aria-label="סינון לפי תוצאה"
          >
            <option value="">כל התוצאות</option>
            {/*
              ‏בטופס הלידים אין „אירוע ביניים”, „חיבור מנוטרל” ולא
              ‏„מסלול בלי מרכזייה” — הצגתן הייתה מציעה סינון שלעולם
              ‏אינו מחזיר דבר.
            */}
            {OUTCOME_ORDER.filter(
              (key) => source !== "lead" || key in LEAD_OUTCOMES,
            ).map((key) => (
              <option key={key} value={key}>
                {outcomeMeta(source === "" ? "telephony" : source, key)?.label ?? key}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span style={{ color: "var(--color-text-muted)" }}>משרד</span>
          <select
            className="mv-select"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            aria-label="סינון לפי משרד"
          >
            <option value="">כל המשרדים</option>
            {offices.map((office) => (
              <option key={office.id} value={office.id}>
                {office.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span style={{ color: "var(--color-text-muted)" }}>טווח</span>
          <select
            className="mv-select"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            aria-label="סינון לפי טווח זמן"
          >
            {WINDOWS.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </select>
        </label>

        {/*
          המספר הוא מה שיש למי שבודק תלונה — לא מזהה שיחה ולא שעה
          מדויקת. החיפוש מדויק ורץ מול חתימה: המספר עצמו אינו נשמר
          ואינו יוצא מהשרת, ולכן הכתיב שהוקלד אינו משנה אבל חצי
          מספר לא יימצא.
        */}
        <form
          className="flex flex-col gap-1 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            setPhone(phoneInput.trim());
          }}
        >
          <label htmlFor="webhook-phone" style={{ color: "var(--color-text-muted)" }}>
            מספר מתקשר
          </label>
          <div className="flex items-center gap-2">
            <input
              id="webhook-phone"
              dir="ltr"
              inputMode="tel"
              placeholder="050-1234567"
              className="rounded-lg border px-3"
              style={{
                borderColor: "var(--color-input-border)",
                background: "var(--color-surface)",
                color: "var(--color-text)",
                minHeight: 38,
              }}
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
            />
            <Button type="submit" variant="secondary">
              חפש
            </Button>
          </div>
        </form>

        {filtered ? (
          <Button
            variant="secondary"
            onClick={() => {
              setOutcome("");
              setTenantId("");
              setHours("");
              setCallId(null);
              setPhone("");
              setPhoneInput("");
            }}
          >
            נקה סינון
          </Button>
        ) : null}
      </div>

      {/*
        שיחה שנבחרה יושבת מחוץ לרשימות הנפתחות: היא נבחרת בלחיצה על
        תא בטבלה, ובלי שורה שאומרת מה מסונן כרגע היה נראה שהיומן
        התרוקן.
      */}
      {callId === null ? null : (
        <p className="mb-3 text-sm">
          מוצגים אירועי שיחה{" "}
          <span dir="ltr" className="font-mono">
            {callId}
          </span>{" "}
          בלבד.{" "}
          <button
            type="button"
            className="underline"
            style={{ color: "var(--color-primary)" }}
            onClick={() => setCallId(null)}
          >
            הצג הכול
          </button>
        </p>
      )}

      {failed ? (
        <p className="text-sm" style={{ color: "var(--color-danger)" }}>
          טעינת היומן נכשלה.
        </p>
      ) : hits === null ? (
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          טוען…
        </p>
      ) : hits.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          {filtered
            ? "אין פניות שעונות על הסינון."
            : "לא הגיעה אף פנייה. אם מרכזייה אמורה לשלוח — הכתובת אצל הספק אינה מגיעה אלינו."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="mv-table w-full text-sm">
            <thead>
              <tr>
                <th className="text-start">מתי</th>
                <th className="text-start">מקור</th>
                <th className="text-start">תוצאה</th>
                <th className="text-start">משרד</th>
                <th className="text-start">שיחה</th>
                <th className="text-start">מתקשר</th>
                <th className="text-start">מפתח</th>
                <th className="text-start">שדות שהגיעו</th>
                <th className="text-start">לא ממופה</th>
              </tr>
            </thead>
            <tbody>
              {hits.map((hit) => {
                const meta = outcomeMeta(hit.source, hit.outcome);
                return (
                  <tr key={hit.id}>
                    <td dir="ltr" className="whitespace-nowrap">
                      {formatDateTime(hit.receivedAt)}
                    </td>
                    {/* ‏המקור לפני התוצאה: הוא מה שקובע איך לקרוא אותה */}
                    <td className="whitespace-nowrap">{SOURCES[hit.source] ?? hit.source}</td>
                    <td>
                      <span
                        className="mv-pill"
                        title={meta?.hint ?? ""}
                        style={{
                          color: meta?.ok === true ? "var(--color-success)" : "var(--color-danger)",
                        }}
                      >
                        {meta?.label ?? hit.outcome}
                      </span>
                      {/*
                        הסיבה צמודה לתוצאה ולא בעמודה משלה: „הגיעה
                        ולא זוהתה” בלי „חסר מספר מתקשר” אינה עוזרת,
                        ושתיהן נקראות כמשפט אחד.
                      */}
                      {hit.issue === null ? null : (
                        <span
                          className="mt-1 block text-sm"
                          style={{ color: "var(--color-text-muted)" }}
                        >
                          {issueText(hit.source, hit.issue)}
                        </span>
                      )}
                    </td>
                    {/* מפתח שלא זוהה אינו שייך לאף משרד — וזו התשובה עצמה */}
                    <td>{hit.tenantName ?? "—"}</td>
                    {/*
                      **הסיפור, ולא שורה בודדת.** שיחה אחת מגיעה
                      בשלוש פניות; בלי מזהה השיחה אי אפשר היה לדעת
                      אילו שורות הן אותה שיחה, ולכן „הצלצול הגיע
                      והניתוק לא” — התקלה השכיחה ביותר — לא נראתה
                      ביומן כלל. לחיצה מסננת לשיחה הזאת בלבד.
                    */}
                    <td>
                      {hit.callId === null ? (
                        <span style={{ color: "var(--color-text-muted)" }}>—</span>
                      ) : (
                        <button
                          type="button"
                          dir="ltr"
                          className="block max-w-[11rem] truncate font-mono underline"
                          style={{ color: "var(--color-primary)" }}
                          title={`הצג רק את אירועי השיחה ${hit.callId}`}
                          onClick={() => setCallId(hit.callId)}
                        >
                          {hit.callId}
                        </button>
                      )}
                      {hit.action === null ? null : (
                        <span className="block text-sm" style={{ color: "var(--color-text-muted)" }}>
                          {ACTIONS[hit.action] ?? hit.action}
                          {hit.direction === null
                            ? ""
                            : ` · ${DIRECTIONS[hit.direction] ?? hit.direction}`}
                        </span>
                      )}
                    </td>
                    {/*
                      ארבע ספרות ולא מספר. די כדי לראות ששתי שורות
                      הן אותו מתקשר; מי שמחפש מספר שלם עושה זאת
                      בשדה החיפוש, מול חתימה שאינה יוצאת מהשרת.
                    */}
                    <td dir="ltr" className="whitespace-nowrap font-mono">
                      {hit.peerSuffix === null ? (
                        <span style={{ color: "var(--color-text-muted)" }}>—</span>
                      ) : (
                        `⋯${hit.peerSuffix}`
                      )}
                    </td>
                    {/* השיטה תחת המפתח: שתיהן על הכתובת שהוגדרה אצל הספק */}
                    <td dir="ltr" className="whitespace-nowrap">
                      {hit.keyPrefix}…
                      <span className="block" style={{ color: "var(--color-text-muted)" }}>
                        {hit.method}
                      </span>
                    </td>
                    {/*
                      שמות השדות, וערכים לשדות הטכניים בלבד. מספרי
                      טלפון ושמות לקוחות נשמרים כשם השדה בלבד ולא
                      נכנסים לטבלה שנקראת בעיניים.
                    */}
                    <td dir="ltr" className="text-sm">
                      {hit.fieldKeys ?? "—"}
                    </td>
                    {/*
                      **השאלה המעניינת**: מה הספק שולח ואנחנו מתעלמים
                      ממנו. "אילו שדות הגיעו" עונה על חצי — החצי שחסר
                      הוא איפה יושב מידע שאנחנו מפספסים. שמות בלבד:
                      ערך של שדה שלא זיהינו יכול להיות כל דבר.
                    */}
                    <td dir="ltr" className="text-sm">
                      {hit.unmapped === null || hit.unmapped === "" ? (
                        <span style={{ color: "var(--color-text-muted)" }}>—</span>
                      ) : (
                        <span style={{ color: "var(--color-danger)" }}>{hit.unmapped}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/*
        הריקון בתחתית ומופרד: הוא אינו חלק מהקריאה של היומן, והוא
        אינו הפיך. שתי דרישות אמיתיות עומדות מאחוריו — "נקה לפני
        שאני עושה שיחת בדיקה", ו"הישן כבר לא רלוונטי" — ובלעדיו
        שתיהן דרשו גישה ישירה למסד.
      */}
      <div
        className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3 text-sm"
        style={{ borderColor: "var(--color-border)" }}
      >
        <span style={{ color: "var(--color-text-muted)" }}>
          היומן נשמר תשעים יום ונגזם מעצמו. לריקון יזום:
        </span>
        <select
          className="mv-select"
          value={purgeHours}
          onChange={(e) => setPurgeHours(e.target.value)}
          aria-label="מה למחוק מהיומן"
        >
          {PURGES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Button variant="secondary" onClick={purge} disabled={purging}>
          {purging ? "מוחק…" : "רוקן"}
        </Button>
        {purgeFailed ? (
          <span style={{ color: "var(--color-danger)" }}>הריקון נכשל. היומן לא השתנה.</span>
        ) : null}
      </div>
    </section>
  );
}
