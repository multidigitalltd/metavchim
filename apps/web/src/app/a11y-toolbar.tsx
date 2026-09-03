"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  A11Y_CHANGE_EVENT,
  A11Y_MAX_SCALE,
  A11Y_MIN_SCALE,
  A11Y_TOGGLES,
  activeA11yCount,
  clampFontScale,
  commitA11y,
  loadA11y,
  resetA11y,
  type A11yPrefs,
} from "@/lib/a11y-prefs";
import { persistA11yToServer, syncA11yFromServer } from "@/lib/a11y-sync";
import { isPublicPath } from "@/lib/public-paths";
import { IconAccessibility, IconX } from "./icons";
import { ThemeToggle } from "./theme-toggle";

/**
 * ‎**כפתור הנגישות — במסכים הציבוריים בלבד.**
 *
 * ## למה דווקא שם
 *
 * דף ההצעה, דף החתימה, דף הנחיתה של הנכס, טופס הלקוח ומסך
 * ההתחברות פונים לציבור הרחב — ולאף אחד מהם אין פרופיל. ת"י 5568
 * (על בסיס WCAG 2.2) מצפה שההתאמות יהיו זמינות מכל עמוד כזה,
 * והסמל המוכר בצד המסך הוא המקום שבו מחפשים אותן.
 *
 * ## למה לא בתוך המערכת
 *
 * למשתמש מחובר יש את אותם מתגים בעמוד הפרופיל, שמורים בחשבון
 * ומלווים אותו לכל מכשיר. כפתור צף בפינת כל מסך עבודה הוא בדיוק
 * מה שמפריע למתווך שעובד במערכת כל היום, ומי שצריך את ההגדרות
 * מגדיר אותן פעם אחת ולא חוזר אליהן (החלטת בעל המוצר).
 *
 * הרכיב עצמו מורכב בכל מסך (הוא ב-layout), כי מה שהוא **מחיל** —
 * ההעדפות מהמטמון ומהשרת, וקו הקריאה — נדרש בכל מקום. רק הכפתור
 * והפאנל תלויים בנתיב. שני המקומות כותבים דרך `commitA11y`
 * ומאזינים לאותו אירוע, ולכן לעולם אינם מציגים שני מצבים שונים.
 *
 * ## איפה הוא יושב
 *
 * בקצה השמאלי, באמצע הגובה — במסכים הציבוריים אין לשונית תמיכה
 * ואין פס סופטפון, ולכן אין עם מה להתנגש.
 *
 * ## הפאנל הוא דיאלוג אמיתי
 *
 * ‎`role="dialog"` עם כותרת, הפוקוס נכנס אליו בפתיחה, Tab נשאר
 * בתוכו, Esc ולחיצה מחוץ לו סוגרים, והפוקוס חוזר לכפתור. פאנל
 * נגישות שמלכודת המקלדת שלו שבורה הוא הבדיחה הכי ישנה בתחום —
 * ולכן זה החלק היחיד כאן שאין בו פשרות.
 */
export function AccessibilityRuntime() {
  const pathname = usePathname();
  const [prefs, setPrefs] = useState<A11yPrefs | null>(null);

  useEffect(() => {
    // המטמון מוחל מיד כדי שלא יהיה הבהוב, והשרת גובר עליו כשהוא עונה
    const cached = loadA11y();
    commitA11y(cached);
    setPrefs(cached);

    // הרכיב הזה מורכב בכל מסך, ולכן זו הנקודה הנכונה למשוך את
    // ההעדפות של המשתמש — לא עמוד הפרופיל, שאליו כמעט לא נכנסים
    void syncA11yFromServer().then((next) => {
      if (next) setPrefs(next);
    });

    // הפרופיל והפאנל משדרים כל שינוי — כך המצב אחיד בלי רענון
    function onChange(event: Event): void {
      const detail = (event as CustomEvent<A11yPrefs>).detail;
      if (detail) setPrefs(detail);
    }
    window.addEventListener(A11Y_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(A11Y_CHANGE_EVENT, onChange);
  }, []);

  /*
   * שינוי מהפאנל: מוחל, נשמר במכשיר, משודר — ונשלח לשרת. הסדר
   * חשוב: המסך מגיב מיד, והשרת מקבל את מה שכבר מוצג.
   */
  const update = useCallback(
    (patch: Partial<A11yPrefs>) => {
      const base = prefs ?? loadA11y();
      const next = commitA11y({ ...base, ...patch });
      setPrefs(next);
      persistA11yToServer(next);
    },
    [prefs],
  );

  const reset = useCallback(() => {
    const next = resetA11y();
    setPrefs(next);
    persistA11yToServer(next);
  }, []);

  // עד הקריאה מהמטמון אין מה לצייר — מונע אי-התאמה בין השרת ללקוח
  if (prefs === null) return null;

  return (
    <>
      {isPublicPath(pathname) ? (
        <AccessibilityMenu prefs={prefs} onUpdate={update} onReset={reset} />
      ) : null}
      {prefs.readingGuide ? <ReadingGuide /> : null}
    </>
  );
}

function AccessibilityMenu({
  prefs,
  onUpdate,
  onReset,
}: {
  prefs: A11yPrefs;
  onUpdate: (patch: Partial<A11yPrefs>) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const scaleId = useId();
  const active = activeA11yCount(prefs);

  const close = useCallback(() => {
    setOpen(false);
    // הפוקוס חוזר למקום שממנו יצא — אחרת קורא מסך נזרק לראש העמוד
    buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();

    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      /*
       * מלכודת פוקוס: Tab בקצה חוזר להתחלה, Shift+Tab בהתחלה קופץ
       * לסוף. בלי זה המקלדת יוצאת אל העמוד שמאחורי הדיאלוג, בזמן
       * שהעכבר עדיין רואה דיאלוג פתוח.
       */
      if (event.key !== "Tab" || panelRef.current === null) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) return;
      /*
       * הפאנל עצמו הוא נקודת ההתחלה: הפוקוס יושב עליו מיד עם
       * הפתיחה, ו-Shift+Tab משם היה יוצא אל הכפתור שמאחורי
       * הדיאלוג — בדיוק מה ש-`aria-modal` מבטיח שלא יקרה
       * (ביקורת Codex). Tab ממנו מגיע לפקד הראשון ממילא.
       */
      const active = document.activeElement;
      const atStart = active === first || active === panelRef.current;
      if (event.shiftKey && atStart) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    // לחיצה מחוץ לפאנל סוגרת — אבל לא לחיצה על הכפתור עצמו, שסוגר בעצמו
    function onPointer(event: MouseEvent): void {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open, close]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="mv-a11y-tab"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={active > 0 ? `התאמות נגישות — ${active} פעילות` : "התאמות נגישות"}
        title="התאמות נגישות"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <IconAccessibility s={20} />
        <span className="mv-a11y-tab-label" aria-hidden="true">
          נגישות
        </span>
        {active > 0 ? (
          <span className="mv-a11y-tab-count" aria-hidden="true">
            {active}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
          tabIndex={-1}
          className="mv-a11y-panel"
        >
          <div className="mb-3 flex items-center gap-2">
            <h2 id={headingId} className="m-0 grow" style={{ fontSize: "calc(17 / 16 * 1rem)", fontWeight: 800 }}>
              התאמות נגישות
            </h2>
            <button type="button" className="mv-btn-plain" aria-label="סגירה" onClick={close}>
              <IconX s={14} />
            </button>
          </div>

          <p className="m-0 mb-4 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
            כל התאמה חלה מיד ונשמרת במכשיר הזה. משתמשי המערכת מוצאים את אותן
            התאמות בעמוד „הפרופיל שלי”, שמורות בחשבון.
          </p>

          <div className="mb-4">
            <p id={scaleId} className="m-0 mb-1.5 text-sm font-semibold">
              גודל טקסט:{" "}
              <span aria-live="polite" aria-atomic="true">
                {prefs.fontScale}%
              </span>
            </p>
            <div className="flex gap-2" role="group" aria-labelledby={scaleId}>
              <button
                type="button"
                className="mv-btn-plain min-h-11 grow"
                disabled={prefs.fontScale <= A11Y_MIN_SCALE}
                onClick={() => onUpdate({ fontScale: clampFontScale(prefs.fontScale - 10) })}
              >
                <span aria-hidden="true">A−</span>
                <span className="mv-visually-hidden">הקטן טקסט</span>
              </button>
              <button
                type="button"
                className="mv-btn-plain min-h-11 grow"
                disabled={prefs.fontScale === 100}
                onClick={() => onUpdate({ fontScale: 100 })}
              >
                רגיל
              </button>
              <button
                type="button"
                className="mv-btn-plain min-h-11 grow"
                disabled={prefs.fontScale >= A11Y_MAX_SCALE}
                onClick={() => onUpdate({ fontScale: clampFontScale(prefs.fontScale + 10) })}
              >
                <span aria-hidden="true">A+</span>
                <span className="mv-visually-hidden">הגדל טקסט</span>
              </button>
            </div>
          </div>

          <ul className="m-0 mb-4 flex list-none flex-col gap-2 p-0">
            {A11Y_TOGGLES.map((toggle) => (
              <li key={toggle.key}>
                <button
                  type="button"
                  aria-pressed={prefs[toggle.key]}
                  onClick={() => onUpdate({ [toggle.key]: !prefs[toggle.key] })}
                  className="mv-a11y-toggle"
                >
                  <span className="text-start">
                    <span className="block font-bold">{toggle.label}</span>
                    <span className="block text-sm" style={{ opacity: 0.85 }}>
                      {toggle.hint}
                    </span>
                  </span>
                  <span aria-hidden="true">{prefs[toggle.key] ? "✓" : ""}</span>
                </button>
              </li>
            ))}
          </ul>

          {/*
            ערכת הנושא היא הגדרת **מכשיר**, לא חשבון: היא נשמרת
            ב-localStorage ואינה נספרת בהתאמות. מי שרוצה כהה בנייד
            ובהיר במשרד — רוצה בדיוק את זה. ההבדל נאמר במפורש, כדי
            שאיש לא יצפה שהיא תנדוד למכשיר הבא כמו שאר המתגים.
          */}
          <div className="mb-4">
            <ThemeToggle />
            <p className="m-0 mt-1.5 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
              ערכת הנושא נשמרת במכשיר הזה בלבד.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="mv-btn-plain" onClick={onReset} disabled={active === 0}>
              איפוס כל ההתאמות
            </button>
            <Link
              href="/accessibility"
              className="ms-auto text-[length:var(--type-caption)] underline"
              style={{ color: "var(--color-text-muted)" }}
            >
              הצהרת נגישות
            </Link>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** קו קריאה שעוקב אחרי הסמן — עוזר למשתמשים עם קשיי מיקוד קריאה. */
function ReadingGuide() {
  const [y, setY] = useState(0);
  useEffect(() => {
    function onMove(event: MouseEvent): void {
      setY(event.clientY);
    }
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);
  return <div aria-hidden="true" className="mv-reading-guide" style={{ top: `${y}px` }} />;
}
