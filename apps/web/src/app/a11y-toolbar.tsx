"use client";

import { useEffect, useState } from "react";
import { loadA11y, applyA11y } from "@/lib/a11y-prefs";

/**
 * מיישם את העדפות הנגישות של המשתמש בכל טעינת דף, ומרנדר את קו
 * הקריאה כשהוא דלוק. אין כאן שום ממשק — ההגדרות עצמן עברו לעמוד
 * הפרופיל (‎/profile‎), והכפתור הצף שהיה בפינה הוסר.
 */
export function AccessibilityRuntime() {
  const [guide, setGuide] = useState(false);

  useEffect(() => {
    const prefs = loadA11y();
    applyA11y(prefs);
    setGuide(prefs.readingGuide);

    // עמוד הפרופיל משדר את השינוי — כך הקו נדלק ונכבה מיד, בלי רענון
    function onChange(event: Event): void {
      const detail = (event as CustomEvent<{ readingGuide: boolean }>).detail;
      setGuide(Boolean(detail?.readingGuide));
    }
    window.addEventListener("mv-a11y-change", onChange);
    return () => window.removeEventListener("mv-a11y-change", onChange);
  }, []);

  return guide ? <ReadingGuide /> : null;
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
