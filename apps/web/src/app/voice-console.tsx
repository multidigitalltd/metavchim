"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { DictationControls } from "./dictation-field";
import { IconMic } from "./icons";

/**
 * הסוכן בדשבורד — שורת פתיחה לצ'אט, לא סוכן שני.
 *
 * ## מה ירד מכאן, ולמה
 *
 * הגרסה הקודמת החזיקה כאן מסלול שלם: interpret, כרטיס הצעה, אישור
 * ותוצאה — הצורה הישנה של הסוכן, שהמסך המלא כבר עזב לטובת צ'אט.
 * שני מסלולים לאותו סוכן הם בדיוק הכפילות שמפרידה את החוויות
 * (הנחיית בעל המוצר): הדשבורד עוד שאל „לאשר?” כשהצ'אט כבר עונה.
 *
 * עכשיו השורה עושה דבר אחד: לוקחת את המשפט ופותחת איתו את הצ'אט
 * (`/voice?q=…`), ששם הוא רץ כתור ראשון — עם הזיכרון, הכפתורים
 * וההמשכיות של השיחה האמיתית. גם הדוגמאות ירדו (בקשת בעל המוצר) —
 * הן קיימות בבועת הפתיחה של הצ'אט, פעם אחת.
 */
export function VoiceConsole(): React.JSX.Element | null {
  const router = useRouter();
  const [text, setText] = useState("");
  /** טקסט הבסיס להכתבה — כדי שהקלטה שנייה תתווסף ולא תדרוס. */
  const [base, setBase] = useState("");

  function open(): void {
    const trimmed = text.trim();
    if (trimmed.length < 2) return;
    router.push(`/voice?q=${encodeURIComponent(trimmed)}`);
  }

  return (
    /*
     * mv-agent ולא mv-card: המשתמש ביקש שהאזור יהיה תחום, צבעוני
     * ומזמין — כרטיס לבן בין כרטיסים לבנים אינו אף אחד מהשלושה.
     */
    <section className="mv-agent mb-4" aria-labelledby="agent-console-title">
      <div className="mv-agent-head">
        <span className="mv-agent-badge" aria-hidden="true">
          <IconMic s={21} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="agent-console-title" className="mv-agent-title">
            מה עכשיו?
          </h2>
          <p className="mv-agent-sub">
            דברו או כתבו — נמשיך בצ'אט עם הסוכן.
          </p>
        </div>
        <Link href="/voice" className="mv-agent-link">
          {/* שברון ולא חץ — „a text link with a chevron” (§17).
              ‎`dir="ltr"` כי U+2039 הוא תו מראה, וב-RTL היה מתהפך. */}
          למסך הסוכן <span aria-hidden="true" dir="ltr">‹</span>
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="mv-field mv-agent-field"
          style={{ flex: "1 1 260px" }}
          value={text}
          placeholder='למשל: "תוסיף קונה משה כהן, 4 חדרים בבני ברק עד 2.3 מיליון"'
          aria-label="מה לעשות?"
          onChange={(e) => {
            setText(e.target.value);
            setBase(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) open();
          }}
        />
        {/*
          `onIdle` מאפס את טקסט הבסיס בסוף סבב ההקלטה. בלעדיו הקלטה
          שנייה באותו שדה נכתבת על הראשונה במקום להתווסף אחריה.
        */}
        {/*
          ‎`browserOnly` — „מהיר” בלבד: כאן מדברים פקודה קצרה ורוצים
          לראות אותה זוחלת על המסך תוך כדי.
        */}
        <DictationControls
          browserOnly
          onAppend={(spoken) => setText(base === "" ? spoken : `${base} ${spoken}`)}
          onIdle={() => setBase(text)}
        />
        {/* מנוטרל עד שיש מה לשלוח — לחיצה ריקה שחוזרת בשקט נראית שבורה */}
        <button
          type="button"
          className="mv-btn-action"
          disabled={text.trim().length < 2}
          onClick={open}
        >
          קדימה
        </button>
      </div>
    </section>
  );
}
