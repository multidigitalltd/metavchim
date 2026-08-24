"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * לוח חתימה — קישקוש ביד, לא תיבת סימון.
 *
 * תיבת סימון מוכיחה שמישהו לחץ; מסמך שמוצג אחר כך ללקוח, לעורך דין
 * או לבית משפט צריך להיראות כמו מסמך חתום. שני הדברים חיים זה לצד זה:
 * ההצהרה נשארת, והחתימה מצטרפת אליה.
 *
 * `pointerdown/move/up` ולא `mouse` ו-`touch` בנפרד — רוב הלקוחות
 * חותמים בטלפון, ובאצבע. `touch-action: none` הוא מה שמונע מהדפדפן
 * לגלול את העמוד במקום לצייר.
 */

/** גודל לוגי. הקנבס עצמו גדול פי DPR כדי שהקו לא ייראה מרוח. */
const WIDTH = 600;
const HEIGHT = 200;

export function SignaturePad({
  onChange,
  disabled,
}: {
  /** ‎null כשהלוח ריק — כך הטופס יודע שאין עדיין חתימה */
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  /*
   * ההקשר נבנה פעם אחת עם רקע לבן מפורש.
   *
   * קנבס ריק הוא שקוף, ו-PNG שקוף שמוצג על רקע כהה נעלם לגמרי —
   * החתימה הייתה נשמרת ולא נראית.
   */
  const prepare = useCallback((): CanvasRenderingContext2D | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111827";
    return ctx;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = WIDTH * dpr;
    canvas.height = HEIGHT * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }, []);

  /** מיקום לוגי מתוך אירוע המצביע — הקנבס נמתח ב-CSS ברוחב המסך. */
  function point(event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * HEIGHT,
    };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>): void {
    if (disabled) return;
    const ctx = prepare();
    if (!ctx) return;
    // לכידת המצביע: יציאה מגבולות הלוח באמצע קו לא אמורה לנתק אותו
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const { x, y } = point(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
    // נקודה בודדת היא חתימה תקפה (למשל נקודה בסוף שם) — מציירים מיד
    ctx.lineTo(x + 0.01, y);
    ctx.stroke();
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>): void {
    if (!drawing.current) return;
    const ctx = prepare();
    if (!ctx) return;
    const { x, y } = point(event);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function end(): void {
    if (!drawing.current) return;
    drawing.current = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    setHasInk(true);
    onChange(canvas.toDataURL("image/png"));
  }

  function clear(): void {
    const canvas = canvasRef.current;
    const ctx = prepare();
    if (!canvas || !ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    setHasInk(false);
    onChange(null);
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-medium">חתימה בכתב יד</span>
        <button
          type="button"
          onClick={clear}
          disabled={!hasInk || disabled}
          className="rounded-lg border px-3 py-1 text-sm disabled:opacity-50"
          style={{ borderColor: "var(--color-input-border)" }}
        >
          נקה
        </button>
      </div>
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        aria-label="שטח לחתימה בכתב יד"
        className="w-full cursor-crosshair rounded-lg border"
        style={{
          borderColor: "var(--color-input-border)",
          background: "#ffffff",
          aspectRatio: `${WIDTH} / ${HEIGHT}`,
          // בלי זה הדפדפן גולל את העמוד במקום לצייר, בטלפון
          touchAction: "none",
        }}
      />
      <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
        {hasInk ? "אפשר לנקות ולחתום שוב" : "חתמו כאן באצבע או בעכבר"}
      </p>
    </div>
  );
}
