"use client";

import { useEffect, useRef, useState } from "react";

/*
 * חגיגה במערכת — קונפטי ובאנר כשיעד הושג או כשיש הצלחה בשמה.
 *
 * ‎**פעם אחת לכל אירוע, ולא בכל טעינה.** יעד שהושג נשאר „הושג” עד
 * סוף השבוע, ומי שפותח את המסך עשר פעמים ביום לא צריך עשרה קונפטי:
 * המפתחות של מה שכבר נחגג נשמרים בדפדפן, והחגיגה יוצאת רק על אירוע
 * שטרם נראה. הזיכרון הזה הוא נוחות של דפדפן, לא נתון — אם נמחק,
 * לכל היותר יש חגיגה חוזרת.
 *
 * ‎**נגישות:** מי שביקש פחות תנועה (`prefers-reduced-motion`) מקבל
 * את הבאנר בלי הקנבס; הבאנר עצמו מוכרז ב-`aria-live` כדי שגם מי
 * שאינו רואה את הקונפטי ישמע „היעד הושג”. הקנבס דקורטיבי בלבד
 * (`aria-hidden`) ואינו תופס לחיצות.
 */

export interface CelebrationEvent {
  /** מפתח יציב לאירוע — למשל `goal:<id>:<תחילת התקופה>` */
  key: string;
  label: string;
}

const STORAGE_KEY = "mentor-celebrated:v1";
const REMEMBERED_MAX = 200;
const BURST_MS = 1800;
const PARTICLES = 140;

function readSeen(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((k): k is string => typeof k === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

function rememberSeen(keys: readonly string[]): void {
  try {
    const seen = [...readSeen(), ...keys];
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(seen.slice(-REMEMBERED_MAX)),
    );
  } catch {
    /* דפדפן שחוסם אחסון — החגיגה תחזור, וזה הכי גרוע שיקרה */
  }
}

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** צבעי הטוקנים של המערכת — הקונפטי נראה שלנו בשני המצבים. */
function tokenColors(): string[] {
  const style = getComputedStyle(document.documentElement);
  return [
    "--color-primary",
    "--color-primary-accent",
    "--color-success",
    "--color-warning",
    "--color-primary-soft",
  ]
    .map((name) => style.getPropertyValue(name).trim())
    .filter((c) => c !== "");
}

/**
 * פרץ קונפטי אחד על קנבס מלא-מסך, ואז הקנבס נעלם. בלי ספרייה: מאה
 * וארבעים חלקיקים, כוח משיכה וסיבוב — שנייה ושמונה מאות אלפיות.
 */
function ConfettiBurst({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  /*
   * הפרץ רץ פעם אחת לכל עלייה של הקנבס. `onDone` נשמר ב-ref כדי
   * שרינדור חוזר של ההורה (שעון שמתקדם, נתונים שהגיעו) לא יתחיל את
   * הפרץ מחדש באמצע.
   */
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null) return;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    const colors = tokenColors();
    const particles = Array.from({ length: PARTICLES }, (_, i) => ({
      x: w / 2 + (Math.random() - 0.5) * w * 0.3,
      y: h * 0.35,
      vx: (Math.random() - 0.5) * 14,
      vy: -Math.random() * 12 - 4,
      size: 6 + Math.random() * 6,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: colors[i % Math.max(1, colors.length)] ?? "#0f8a43",
    }));
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = now - start;
      ctx.clearRect(0, 0, w, h);
      const fade =
        t > BURST_MS * 0.7 ? 1 - (t - BURST_MS * 0.7) / (BURST_MS * 0.3) : 1;
      ctx.globalAlpha = Math.max(0, fade);
      for (const p of particles) {
        p.vy += 0.35;
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.99;
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      if (t < BURST_MS) frame = requestAnimationFrame(tick);
      else onDoneRef.current();
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        pointerEvents: "none",
        zIndex: 60,
      }}
    />
  );
}

/**
 * חגיגה על אירועים שטרם נחגגו. מציגים אותה בכל מקום שיש בו אירועים:
 * מסך המנטור והכרטיס בדשבורד — אותו זיכרון, ולכן אותו אירוע אינו
 * נחגג פעמיים בשני מסכים.
 */
export function Celebration({
  events,
  title = "🎉 כל הכבוד",
}: {
  events: readonly CelebrationEvent[];
  title?: string;
}) {
  const [fresh, setFresh] = useState<CelebrationEvent[]>([]);
  const [burst, setBurst] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const signature = events.map((e) => e.key).join("|");
  useEffect(() => {
    if (events.length === 0) return;
    const seen = readSeen();
    const unseen = events.filter((e) => !seen.has(e.key));
    if (unseen.length === 0) return;
    rememberSeen(unseen.map((e) => e.key));
    setFresh(unseen);
    setDismissed(false);
    setBurst(!reducedMotion());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- החתימה מייצגת את הרשימה
  }, [signature]);

  if (fresh.length === 0 || dismissed) return null;
  return (
    <>
      {burst ? <ConfettiBurst onDone={() => setBurst(false)} /> : null}
      <div
        role="status"
        aria-live="polite"
        className="mv-card mv-card--pad flex flex-wrap items-center gap-3"
        style={{
          background: "var(--color-success-soft)",
          borderColor: "var(--color-success)",
        }}
      >
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[length:var(--type-row-title)] font-extrabold">
            {title}
          </p>
          <ul className="m-0 mt-1 list-none p-0">
            {fresh.map((e) => (
              <li
                key={e.key}
                className="text-[length:var(--type-body-sm)] font-bold"
              >
                {e.label}
              </li>
            ))}
          </ul>
        </div>
        <button
          type="button"
          className="mv-btn-plain"
          onClick={() => setDismissed(true)}
        >
          תודה
        </button>
      </div>
    </>
  );
}
