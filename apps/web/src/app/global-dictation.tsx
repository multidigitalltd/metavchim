"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DictationControls } from "./dictation-field";

/**
 * מיקרופון בכל שדה טקסט — בלי לגעת באף טופס.
 *
 * רכיב אחד שמורכב פעם אחת ב-layout: כשמתמקדים בשדה טקסט חופשי
 * (input טקסט/חיפוש או textarea), פקדי ההכתבה צצים צמוד מתחתיו.
 * כך כל שדה במערכת — כולל אלה שעוד לא נכתבו — מקבל הכתבה, במקום
 * להדביק פקדים ידנית בעשרות טפסים.
 *
 * מה לא מקבל מיקרופון בכוונה: סיסמאות, אימייל, מספרים ותאריכים
 * (הכתבה חופשית רק מלכלכת אותם), ושדות שכבר יש להם פקדי הכתבה
 * קבועים משלהם (התיאור השיווקי וכד') — כפל פקדים מבלבל.
 *
 * הכתיבה עוברת דרך ה-setter המקורי של הדפדפן ואירוע input, כדי
 * ששדות מבוקרים של React (חיפוש, טפסים עם state) יראו את הטקסט
 * ולא רק ה-DOM.
 */

type TextField = HTMLInputElement | HTMLTextAreaElement;

function eligible(node: EventTarget | null): node is TextField {
  if (node instanceof HTMLTextAreaElement) return !node.readOnly && !node.disabled;
  if (!(node instanceof HTMLInputElement)) return false;
  if (node.readOnly || node.disabled) return false;
  return node.type === "text" || node.type === "search";
}

/** עד כמה לטפס בחיפוש פקדים קיימים — ראו `hasOwnControls`. */
const OWN_CONTROLS_DEPTH = 4;

/**
 * לשדה יש כבר פקדי הכתבה משלו (DictateFor וכו') — לא מכפילים.
 *
 * ## למה טיפוס ולא `parentElement` בלבד
 *
 * הבדיקה הקודמת הסתכלה על ההורה הישיר בלבד, וזה תפס רק את הצורה
 * ‎`<div><input/><DictateFor/></div>`‎. בטפסים שבהם השדה עטוף
 * בתווית — ‎`<label><textarea/></label>`‎ והפקדים אחריה — היא
 * החזירה `false`, והמיקרופון הגלובלי נפתח **בנוסף** לפקדים
 * הקיימים.
 *
 * שני זוגות כפתורי מיקרופון זהים זה ליד זה על אותו שדה הם לא רק
 * בלבול חזותי: שני מנועי זיהוי נפרדים, ומי שמפעיל את שניהם מקבל
 * את מה שאמר **פעמיים** בשדה.
 *
 * הטיפוס נעצר ברגע שנתקל בשדה טקסט אחר: פקדים שנמצאים אחרי שדה
 * שכן, שייכים לו ולא לנו.
 */
function hasOwnControls(el: TextField): boolean {
  let node: HTMLElement | null = el.parentElement;
  for (let depth = 0; node !== null && depth < OWN_CONTROLS_DEPTH; depth += 1) {
    if (node.querySelector(".mv-dictate")) return true;
    // שדה אחר באותה רמה ⇒ מכאן ומעלה הפקדים אינם בהכרח שלנו
    if ([...node.querySelectorAll("input, textarea")].some((other) => other !== el)) return false;
    node = node.parentElement;
  }
  return false;
}

/** כתיבה שגם React רואה — דרך ה-setter של הדפדפן + אירוע input. */
function setFieldValue(el: TextField, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export function GlobalDictation() {
  const [field, setField] = useState<TextField | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const fieldRef = useRef<TextField | null>(null);
  fieldRef.current = field;
  const busyRef = useRef(false);
  const baseRef = useRef<string | null>(null);

  useEffect(() => {
    function place(el: TextField): void {
      const r = el.getBoundingClientRect();
      setPos({ top: r.bottom + window.scrollY + 4, left: r.left + window.scrollX });
    }
    function onFocusIn(event: FocusEvent): void {
      const target = event.target;
      // באמצע הקלטה לא קופצים לשדה אחר — הטקסט שייך לשדה שהתחיל
      if (busyRef.current) return;
      if (target instanceof Node && boxRef.current?.contains(target)) return;
      if (eligible(target) && !hasOwnControls(target)) {
        baseRef.current = null;
        setField(target);
        place(target);
      }
    }
    function onPointerDown(event: MouseEvent): void {
      if (busyRef.current) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (boxRef.current?.contains(target) || target === fieldRef.current) return;
      // לחיצה בכל מקום אחר מקפלת את הפקדים
      if (!eligible(target)) setField(null);
    }
    function onReposition(): void {
      const el = fieldRef.current;
      if (!el) return;
      if (!document.contains(el)) {
        setField(null);
        return;
      }
      place(el);
    }
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
    };
  }, []);

  if (field === null || pos === null) return null;

  function append(text: string): void {
    const el = fieldRef.current;
    if (!el || !document.contains(el)) return;
    baseRef.current ??= el.value;
    const base = baseRef.current;
    setFieldValue(el, base.trim() === "" ? text : `${base.trimEnd()} ${text}`);
  }

  return createPortal(
    <div
      ref={boxRef}
      className="rounded-lg border px-2 py-1 shadow-md"
      style={{
        position: "absolute",
        top: pos.top,
        left: pos.left,
        zIndex: 70,
        background: "var(--color-surface)",
        borderColor: "var(--color-border)",
      }}
    >
      <DictationControls
        onAppend={append}
        onIdle={() => (baseRef.current = null)}
        onBusyChange={(busy) => (busyRef.current = busy)}
      />
    </div>,
    document.body,
  );
}
