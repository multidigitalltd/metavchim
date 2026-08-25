"use client";

import { useCallback, useEffect, useState } from "react";
import {
  commissionTermsRejectionReason,
  defaultCommissionTerms,
  describeCommissionSide,
  COMMISSION_SIDES,
  COMMISSION_SIDE_LABEL,
  type CommissionTerms,
} from "@metavchim/shared";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { CommissionTermsTabs } from "./collaboration/commission-terms-tabs";
import { IconHandshake } from "./icons";
import { Notice } from "./notice";

/**
 * פתיחת קונה **או נכס** לשיתוף פעולה עם משרדים אחרים.
 *
 * עד כה זה היה כפתור אחד דחוס בשורת הפעולות של הכותרת, בין "וואטסאפ"
 * ל"חייג" — שלוש פעולות שאין ביניהן שום קשר. שיתוף קונה ברשת הוא
 * החלטה עסקית: הסוכן מוותר על חצי מהעמלה כדי למצוא נכס מהר יותר.
 * החלטה כזו צריכה אזור משלה, הסבר מה נחשף ומה לא, ואישור מפורש
 * שהיא בוצעה — ולא כפתור שנראה כמו "חייג".
 *
 * הזרימה: הזמנה ← הגדרת עמלה ותיאור ← שליחה ← אישור.
 *
 * ## למה רכיב אחד לשני הצדדים
 *
 * מרגע שהרשת דו-כיוונית, אותה החלטה בדיוק נלקחת על נכס: לוותר על
 * חלק מהעמלה כדי למצוא צד שני מהר יותר. שני קבצים כמעט זהים היו
 * נפרדים בעדכון הראשון — טקסט שמשתנה בצד אחד, טווח עמלה שמשתנה
 * בשני — והמשתמש היה פוגש שתי חוויות שונות לאותה פעולה.
 *
 * מה שכן שונה הוא **מה נחשף**, ולכן אוצר המילים מפוצל למפה אחת
 * למעלה במקום לפזר תנאים בגוף הרכיב.
 */

/** אוצר המילים של כל צד — ההבדל היחיד בין השניים. */
const COPY = {
  buyer: {
    title: "שיתוף פעולה עם משרדים אחרים",
    subtitle: "עוד עיניים על הביקוש הזה — בלי לחשוף את הלקוח.",
    invite:
      "רוצים למצוא לו נכס מהר יותר? אפשר לפתוח את הקונה הזה למשרדים אחרים ברשת.",
    privacy: "פרטיו האישיים לא נחשפים — מתפרסם ביקוש אנונימי בלבד",
    cta: "פתח את הקונה לשיתוף פעולה",
    sent: "הקונה נשלח לרשת המתווכים",
    sentBody:
      "הביקוש פורסם כאנונימי — בלי שם, בלי טלפון ועם תקציב מעוגל. משרדים שיש להם נכס מתאים יוכלו לפנות אליכם",
    noteLabel: "מה הקונה מחפש *",
    notePlaceholder:
      'לדוגמה: "מחפשים דירה משופצת לכניסה מהירה, גמישים על קומה אם יש מעלית"',
    stop: "להפסיק את שיתוף הקונה ברשת? הביקוש לא יוצג יותר למשרדים אחרים.",
    formHint:
      "השכונות ואזורי החיפוש מהדרישות יצורפו לביקוש אוטומטית. התיאור חובה — הוא מה שגורם למשרד אחר לעצור על המודעה.",
  },
  property: {
    title: "פרסום הנכס לרשת המתווכים",
    subtitle: "עוד עיניים על הנכס הזה — בלי לחשוף את הכתובת ואת הבעלים.",
    invite:
      "רוצים למצוא לו קונה מהר יותר? אפשר לפתוח את הנכס הזה למשרדים אחרים ברשת.",
    privacy:
      "הכתובת המדויקת ופרטי הבעלים לא נחשפים — מתפרסמים אזור, סוג, חדרים, שטח, קומה, מצב ומחיר",
    cta: "פרסם את הנכס לרשת",
    sent: "הנכס פורסם ברשת המתווכים",
    sentBody:
      "הפרסום כולל אזור, סוג, חדרים, שטח, קומה, מצב ומחיר — בלי רחוב, בלי מספר בית ובלי בעלים. משרדים שיש להם קונה מתאים יוכלו לפנות אליכם",
    noteLabel: "מה מיוחד בנכס *",
    notePlaceholder:
      'לדוגמה: "משופץ מהיסוד, מרפסת דרומית, חניה בטאבו, פינוי גמיש"',
    stop: "להפסיק את פרסום הנכס ברשת? הוא לא יוצג יותר למשרדים אחרים.",
    formHint:
      "שאר הפרטים והתמונות נלקחים מכרטיס הנכס אוטומטית. התיאור חובה — הוא מה שגורם למשרד אחר לעצור על המודעה.",
  },
} as const;

/**
 * אורך התיאור המזערי — זהה לשרת (`NetworkNoteSchema`).
 *
 * המספר חוזר כאן ולא מיובא כי הוא חוצה גבול רשת: המסך רק חוסך
 * לסוכן נסיעה מיותרת, והאכיפה נשארת בשרת בכל מקרה.
 */
const MIN_NOTE = 10;
/** אורך התיאור המרבי — זהה לשרת, מאותו נימוק בדיוק כמו המינימום. */
const MAX_NOTE = 300;

/** שלב בזרימה. `loading` קיים כי מצב השיתוף נקרא מהשרת. */
type Stage = "loading" | "invite" | "form" | "sent";

/** הפרסום הפעיל, כפי שהשרת מחזיר אותו. */
interface ActiveShare {
  id: string;
  /**
   * חלוקת העמלה לכל צד.
   *
   * השרת מחזיר גם `commissionSplit` — הכותרת — והוא אינו נקרא כאן
   * בכוונה: הוא נגזר מאחד הצדדים, ומסך שיציג אותו יאמר „50% / 50%”
   * על פרסום שתנאיו נוסחו במילים. פרסום שקדם להפרדה מקבל מהשרת שני
   * צדדים זהים, ולכן אין כאן מקרה חסר.
   */
  terms: CommissionTerms;
  notes?: string | null;
  /**
   * האם המשתמש הזה רשאי לגעת בתנאים.
   *
   * חלוקת העמלה היא התחייבות כלפי משרד אחר, ולכן רק מי שקבע אותה
   * (או מנהל) משנה אותה. חסר = שרת ישן שאינו מכיר את השדה; אז
   * הכפתורים נשארים כפי שהיו, והשרת עדיין יאכוף.
   */
  canManage?: boolean;
}

export function NetworkShareSection({
  kind,
  entityId,
  defaultNote,
}: {
  kind: "buyer" | "property";
  /** מזהה הקונה או הנכס — לפי `kind`. */
  entityId: string;
  /**
   * מילוי מראש לתיאור בפרסום **חדש** — למשל הערות הקונה מהכרטיס.
   *
   * המתווך כבר כתב מה הלקוח מחפש; להקליד את זה שוב בטופס השיתוף
   * זה בדיוק החיכוך שגורם לא לפרסם. פרסום קיים תמיד מציג את מה
   * שפורסם בפועל, לא את ההצעה.
   */
  defaultNote?: string;
}) {
  const copy = COPY[kind];
  /*
   * הנתיבים נגזרים מה-`kind` ולא מועברים כ-prop: מסך שיכול להעביר
   * נתיב שרירותי הוא מסך שיכול לפרסם דבר אחד לנתיב של דבר אחר.
   */
  const readPath =
    kind === "buyer"
      ? `/collaboration/share/buyer/${entityId}`
      : `/collaboration/listings/property/${entityId}`;
  const [stage, setStage] = useState<Stage>("loading");
  const [terms, setTerms] = useState<CommissionTerms>(defaultCommissionTerms);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** קיים = הקונה משותף כרגע; משמש כדי לעדכן במקום לפרסם מחדש. */
  const [share, setShare] = useState<ActiveShare | null>(null);

  /*
   * מצב השיתוף נקרא מהשרת ולא מונח מראש. בלי זה רענון של הכרטיס
   * החזיר את המסך למצב "הזמנה" גם כשהקונה כבר משותף, והשיתוף החוזר
   * נדחה ב"הקונה כבר משותף ברשת" — שגיאה על פעולה שהמסך הציע.
   */
  const load = useCallback(() => {
    apiGet<ActiveShare | null>(readPath)
      .then((active) => {
        if (active) {
          setShare(active);
          setTerms(active.terms);
          setNote(active.notes ?? "");
          setStage("sent");
        } else {
          setShare(null);
          /*
           * פרסום חדש נפתח עם הערות הכרטיס כתיאור — המתווך כבר כתב
           * מה הלקוח מחפש ואין סיבה להקליד שוב. רק לתוך שדה ריק:
           * טיוטה שהתחילו להקליד אינה נדרסת כשעריכת ההערות בכרטיס
           * מריצה את הטעינה מחדש.
           *
           * נחתך ל-`MAX_NOTE`: הערות הכרטיס מגיעות עד 4,000 תווים,
           * ו-`maxLength` על textarea אינו חותך ערך שהוקצה מקוד —
           * בלי החיתוך השרת היה דוחה את הפרסום על תיאור שהמסך עצמו
           * מילא (ביקורת Codex).
           */
          setNote((current) =>
            current === "" ? (defaultNote ?? "").slice(0, MAX_NOTE) : current,
          );
          setStage("invite");
        }
      })
      // כשל בקריאה לא נועל את האזור: המסך נופל למצב ההזמנה,
      // והשרת עדיין יאכוף שיתוף כפול אם ינסו
      .catch(() => setStage("invite"));
  }, [readPath, defaultNote]);

  useEffect(load, [load]);

  /**
   * מה חוסם שליחה — הודעה בעברית או `null`.
   *
   * אותו כלל משותף שהשרת אוכף, ולכן ההודעה זהה בשני הצדדים. היא
   * נושאת את שם הלשונית, כי „בחרתם אחר — כתבו איך תתחלק העמלה” על
   * מסך עם שתי לשוניות אינו אומר באיזו מהן לתקן.
   */
  const termsProblem = commissionTermsRejectionReason(terms);

  /** פרסום חדש, או עדכון כשהקונה כבר משותף — הכפתור אחד לשניהם. */
  async function publish(): Promise<void> {
    if (termsProblem !== null) {
      setError(termsProblem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = {
        terms,
        /*
          התיאור נשלח תמיד ואינו מותנה: הוא חובה בסכימת השרת, ושליחה
          מותנית הייתה מייצרת 400 עמום במקום את הודעת השדה.
        */
        note: note.trim(),
      };
      if (share) {
        await apiPatch(readPath, payload);
      } else if (kind === "buyer") {
        await apiPost("/collaboration/share", {
          buyerId: entityId,
          ...payload,
        });
      } else {
        await apiPost("/collaboration/listings", {
          propertyId: entityId,
          ...payload,
        });
      }
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השיתוף נכשל — נסו שוב");
      setBusy(false);
      return;
    }
    setBusy(false);
  }

  /** הפסקת שיתוף — הביקוש נסגר ואינו מוצג יותר ברשת. */
  async function stopSharing(): Promise<void> {
    if (!share) return;
    if (!window.confirm(copy.stop)) return;
    setBusy(true);
    setError(null);
    try {
      await apiDelete(
        kind === "buyer" ? `/collaboration/demands/${share.id}` : readPath,
      );
      setNote("");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הפסקת השיתוף נכשלה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="mv-list-card mb-[18px] px-[22px] py-[18px]"
      aria-labelledby="network-share-heading"
    >
      {/*
        כותרת עם אייקון בעיגול וגוף קריא, ולא שורה מודגשת מעל שתי
        פסקאות ב-13px.

        זה האזור היחיד בכרטיס שמציע למתווך לעשות משהו **חדש** — לפתוח
        לקוח למשרדים אחרים — וכל השכנוע נמצא בפסקאות. כשהן בגודל של
        הערת שוליים, מי שמהסס פשוט לא קורא אותן, ואז הכפתור למטה
        חסר הקשר.
      */}
      <header className="mv-hero mb-3">
        <span className="mv-hero-icon" aria-hidden="true">
          <IconHandshake s={22} />
        </span>
        <div>
          <h2
            id="network-share-heading"
            className="m-0 text-[19px] font-extrabold leading-tight"
          >
            {copy.title}
          </h2>
          <p
            className="m-0 mt-0.5 text-[15px]"
            style={{ color: "var(--color-text-muted)" }}
          >
            {copy.subtitle}
          </p>
        </div>
      </header>

      {stage === "loading" ? (
        <p
          className="m-0 mt-2 text-[14.5px]"
          aria-live="polite"
          style={{ color: "var(--color-text-muted)" }}
        >
          טוען…
        </p>
      ) : stage === "sent" ? (
        <div
          role="status"
          className="mt-3 rounded-xl border p-4"
          style={{
            borderColor: "var(--color-success)",
            background: "var(--color-primary-soft)",
          }}
        >
          <p className="m-0 mb-1 font-bold" style={{ fontSize: 15.5 }}>
            ✓ {copy.sent}
          </p>
          <p
            className="m-0 text-[14.5px]"
            style={{ color: "var(--color-text-muted)" }}
          >
            {copy.sentBody}.
          </p>
          {/*
            שתי השורות ולא צ'יפ אחד: זה המקום שבו המשרד בודק מה הוא
            בעצם התחייב, וחלוקה שונה בין הצדדים היא בדיוק מה שצריך
            להיקרא בבירור.
          */}
          <ul className="m-0 mt-2 list-none p-0 text-[14.5px]">
            {COMMISSION_SIDES.map((option) => (
              <li key={option}>
                {COMMISSION_SIDE_LABEL[option]}:{" "}
                <strong>{describeCommissionSide(terms[option])}</strong>
              </li>
            ))}
          </ul>
          {/*
            עדכון ולא פרסום מחדש: הביקוש הקיים מתעדכן במקום, ולכן
            ההיסטוריה וההצעות שכבר התקבלו עליו נשמרות
          */}
          {share?.canManage === false ? (
            /*
              ההסבר ולא רק היעדר הכפתורים: סוכן שרואה שיתוף פעיל בלי
              שום פעולה זמינה מניח שמשהו שבור, ופונה לתמיכה. משפט
              אחד הופך את זה מתקלה לכלל.
            */
            <p
              className="m-0 mt-3 text-[14px]"
              style={{ color: "var(--color-text-muted)" }}
            >
              את תנאי השיתוף קובע מי שפרסם אותם — הם התחייבות כלפי המשרד
              שיסגור את העסקה. לשינוי, פנו אליו או למנהל המשרד.
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="mv-btn-plain"
                style={{ padding: "5px 12px", fontSize: "var(--type-caption)" }}
                disabled={busy}
                onClick={() => setStage("form")}
              >
                עדכן עמלה או תיאור
              </button>
              <button
                type="button"
                className="mv-btn-plain"
                style={{ padding: "5px 12px", fontSize: "var(--type-caption)" }}
                disabled={busy}
                onClick={() => void stopSharing()}
              >
                הפסק שיתוף
              </button>
            </div>
          )}
          {error ? (
            <Notice tone="danger">{error}</Notice>
          ) : null}
        </div>
      ) : stage === "invite" ? (
        <>
          <p className="mv-explain m-0 mb-2.5">
            {copy.invite} <strong>{copy.privacy}</strong>, ואתם בוחרים את חלוקת
            העמלה.
          </p>
          {/*
            "כמה זה עולה לי" היא השאלה הראשונה שמתווך שואל לפני שהוא
            משתף, ובלי תשובה הוא פשוט לא לוחץ. שיתוף פעולה חינם;
            קרדיטים נוגעים אך ורק לקליטת הפניית לקוח.
          */}
          <p className="mv-explain m-0 mb-4">
            <strong style={{ color: "var(--color-primary)" }}>
              השיתוף חינם
            </strong>{" "}
            — בכל המסלולים ובלי קרדיטים. התשלום היחיד הוא חלוקת העמלה עם המשרד
            שיסגור איתכם את העסקה.
          </p>
          <button
            type="button"
            className="mv-btn-action"
            onClick={() => setStage("form")}
          >
            <IconHandshake s={14} /> {copy.cta}
          </button>
        </>
      ) : (
        <>
          <p className="mv-explain m-0 mb-4">{copy.formHint}</p>

          <div className="mb-4">
            <CommissionTermsTabs value={terms} onChange={setTerms} disabled={busy} />
          </div>

          <div className="mb-3">
            <label
              htmlFor="shareNote"
              className="mb-1 block text-sm font-semibold"
            >
              {copy.noteLabel}
            </label>
            {/*
              הסבר קצר מתחת לתווית, ולא רק כוכבית. „חובה” בלי „למה”
              נקרא כמו מכשול; המשפט הזה הופך אותו לשיקול.
            */}
            <p
              className="m-0 mb-1 text-sm"
              style={{ color: "var(--color-text-muted)" }}
            >
              שורה אחת במילים שלכם. זה מה שמבדיל מודעה שנענית ממודעה
              שנשארת בפיד.
            </p>
            <textarea
              id="shareNote"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={MAX_NOTE}
              rows={2}
              placeholder={copy.notePlaceholder}
              className="w-full rounded-lg border px-3 py-2"
              style={{
                borderColor: "var(--color-input-border)",
                background: "var(--color-bg)",
              }}
            />
            <p
              className="m-0 mt-1 text-sm"
              style={{ color: "var(--color-text-muted)" }}
            >
              אל תכתבו כאן שם, טלפון או כתובת מדויקת — הטקסט מוצג למשרדים אחרים.
            </p>
          </div>

          {/*
            ההסבר מוצג **כל הזמן** ולא רק אחרי לחיצה. הכפתור נחסם
            כשהתנאים אינם שלמים, וכשהצד החסר הוא הלשונית שאינה פתוחה
            לא היה על המסך דבר שמסביר למה — כפתור מת בלי סיבה.
          */}
          {termsProblem !== null ? (
            <Notice tone="warning">{termsProblem}</Notice>
          ) : null}
          {error ? (
            <Notice tone="danger">{error}</Notice>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {/*
              הכפתור נחסם עד שיש תיאור. השרת דוחה ממילא, אבל דחייה
              אחרי לחיצה היא לימוד בדרך הקשה — וכאן זה שדה אחד
              שאפשר לסמן מראש.
            */}
            <button
              type="button"
              className="mv-btn-action"
              disabled={
                busy || note.trim().length < MIN_NOTE || termsProblem !== null
              }
              onClick={() => void publish()}
            >
              {busy ? "שולח…" : share ? "שמור עדכון" : copy.cta}
            </button>
            <button
              type="button"
              className="mv-btn-plain"
              // ביטול חוזר למצב האמיתי: משותף ⟵ אישור, לא משותף ⟵ הזמנה
              onClick={() => setStage(share ? "sent" : "invite")}
            >
              ביטול
            </button>
          </div>
        </>
      )}
    </section>
  );
}
