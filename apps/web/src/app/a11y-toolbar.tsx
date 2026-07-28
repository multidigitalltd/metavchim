"use client";

import { useEffect, useRef, useState } from "react";

/**
 * סרגל נגישות לפי ת"י 5568 (מסמך התקן המצורף): הגדלת/הקטנת טקסט,
 * ניגודיות גבוהה, גווני אפור, הדגשת קישורים/כותרות, פונט קריא,
 * עצירת אנימציות וקו קריאה. ההעדפות נשמרות ב-localStorage ומיושמות
 * דרך data-attributes על <html> (ה-CSS ב-globals.css).
 *
 * הסרגל עצמו נגיש: כפתור הפעלה עם aria-expanded, מלכודת פוקוס בפאנל,
 * סגירת ESC, ומצבי לחצנים עם aria-pressed.
 */

interface A11yPrefs {
  fontScale: number; // 100 = רגיל
  contrast: boolean;
  grayscale: boolean;
  underlineLinks: boolean;
  highlightHeadings: boolean;
  readableFont: boolean;
  stopAnimations: boolean;
  readingGuide: boolean;
}

const DEFAULTS: A11yPrefs = {
  fontScale: 100,
  contrast: false,
  grayscale: false,
  underlineLinks: false,
  highlightHeadings: false,
  readableFont: false,
  stopAnimations: false,
  readingGuide: false,
};

const STORAGE_KEY = "mv-a11y";

function apply(prefs: A11yPrefs): void {
  const root = document.documentElement;
  root.style.setProperty("--a11y-font-scale", String(prefs.fontScale / 100));
  const flags: [keyof A11yPrefs, string][] = [
    ["contrast", "a11yContrast"],
    ["grayscale", "a11yGrayscale"],
    ["underlineLinks", "a11yUnderline"],
    ["highlightHeadings", "a11yHeadings"],
    ["readableFont", "a11yReadable"],
    ["stopAnimations", "a11yNoMotion"],
  ];
  for (const [key, dataAttr] of flags) {
    if (prefs[key]) root.dataset[dataAttr] = "on";
    else delete root.dataset[dataAttr];
  }
}

export function AccessibilityToolbar() {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<A11yPrefs>(DEFAULTS);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // טעינה מ-localStorage בעלייה
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const loaded = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<A11yPrefs>) };
        setPrefs(loaded);
        apply(loaded);
      }
    } catch {
      /* localStorage חסום — נופל בחן לברירות המחדל */
    }
  }, []);

  function update(patch: Partial<A11yPrefs>): void {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    apply(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  function reset(): void {
    setPrefs(DEFAULTS);
    apply(DEFAULTS);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  // דיאלוג נגיש: העברת פוקוס פנימה בפתיחה, מלכודת Tab, ESC לסגירה
  // והחזרת פוקוס למפעיל (ביקורת Codex, PR #8).
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const focusables = (): HTMLElement[] =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button, [href], input, select, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute("disabled"));

    // פוקוס לאלמנט הראשון בפאנל
    focusables()[0]?.focus();

    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panelRef.current?.contains(active))) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const toggles: { key: keyof A11yPrefs; label: string }[] = [
    { key: "contrast", label: "ניגודיות גבוהה" },
    { key: "grayscale", label: "גווני אפור" },
    { key: "underlineLinks", label: "הדגשת קישורים" },
    { key: "highlightHeadings", label: "הדגשת כותרות" },
    { key: "readableFont", label: "פונט קריא" },
    { key: "stopAnimations", label: "עצירת אנימציות" },
    { key: "readingGuide", label: "קו קריאה" },
  ];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="a11y-panel"
        className="mv-a11y-trigger"
        title="הגדרות נגישות"
      >
        <span aria-hidden="true">♿</span>
        <span className="mv-visually-hidden">הגדרות נגישות</span>
      </button>

      {open ? (
        <div
          ref={panelRef}
          id="a11y-panel"
          role="dialog"
          aria-label="הגדרות נגישות"
          className="mv-a11y-panel"
        >
          <h2 className="mb-3 text-lg font-bold">נגישות</h2>

          <div className="mb-4">
            <p id="fontsize-label" className="mb-1 font-medium">
              גודל טקסט: {prefs.fontScale}%
            </p>
            <div className="flex gap-2" role="group" aria-labelledby="fontsize-label">
              <button
                type="button"
                className="mv-button mv-button--secondary"
                onClick={() => update({ fontScale: Math.max(90, prefs.fontScale - 10) })}
              >
                <span aria-hidden="true">A−</span>
                <span className="mv-visually-hidden">הקטן טקסט</span>
              </button>
              <button
                type="button"
                className="mv-button mv-button--secondary"
                onClick={() => update({ fontScale: 100 })}
              >
                איפוס
              </button>
              <button
                type="button"
                className="mv-button mv-button--secondary"
                onClick={() => update({ fontScale: Math.min(200, prefs.fontScale + 10) })}
              >
                <span aria-hidden="true">A+</span>
                <span className="mv-visually-hidden">הגדל טקסט</span>
              </button>
            </div>
          </div>

          <ul className="mb-4 flex flex-col gap-2">
            {toggles.map((toggle) => (
              <li key={toggle.key}>
                <button
                  type="button"
                  aria-pressed={Boolean(prefs[toggle.key])}
                  onClick={() => update({ [toggle.key]: !prefs[toggle.key] } as Partial<A11yPrefs>)}
                  className="mv-a11y-toggle"
                >
                  <span>{toggle.label}</span>
                  <span aria-hidden="true">{prefs[toggle.key] ? "✓" : ""}</span>
                </button>
              </li>
            ))}
          </ul>

          <button type="button" className="mv-button mv-button--ghost" onClick={reset}>
            אפס הכל
          </button>
        </div>
      ) : null}

      {prefs.readingGuide ? <ReadingGuide /> : null}
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
