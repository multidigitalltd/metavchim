"use client";

import { useState } from "react";
import { Button } from "@metavchim/ui";
import { apiPost } from "@/lib/api";
import { Notice } from "./notice";

/**
 * ‏דף ההסרה מדיוור — **היעד של קישור ההסרה שבתחתית כל מייל שיווקי**
 * ‏(חוק התקשורת §30א).
 *
 * ## ‏למה אישור ולא הסרה מיידית
 *
 * ‏קישור במייל נפתח גם על ידי סורקי אבטחה של ארגונים, ו-GET שמסיר
 * ‏היה מוחק לקוחות שאיש לא ביקש להסיר. ההסרה עצמה היא POST
 * ‏מהכפתור.
 *
 * ## ‏למה רכיב אחד לשני הקישורים
 *
 * ‏יש שני מקורות לטוקן — הצעה אוטומטית (`Offer`) ושליחה ידנית
 * ‏מכרטיס — אבל **התוצאה זהה**: `Contact.optedOutAt`. שני דפים היו
 * ‏אומרים את אותו דבר בשתי גרסאות, ואחת מהן הייתה מתיישנת. מה
 * ‏שבאמת שונה הוא נתיב אחד ב-API, ולכן זה מה שעובר כאן כ-prop.
 */
export function EmailOptOut({ path }: { path: string }) {
  const [state, setState] = useState<"idle" | "submitting" | "done" | "error">("idle");

  async function optOut() {
    setState("submitting");
    try {
      await apiPost(path, {});
      setState("done");
    } catch {
      setState("error");
    }
  }

  return (
    <main
      dir="rtl"
      className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-4 text-center"
    >
      <h1 className="text-xl font-bold">הסרה מקבלת הצעות במייל</h1>
      {state === "done" ? (
        <Notice tone="success">
          הוסרתם מרשימת התפוצה. לא יישלחו אליכם עוד הצעות נכסים במייל — אפשר לחזור בכל עת
          בפנייה למשרד התיווך.
        </Notice>
      ) : state === "error" ? (
        <Notice tone="danger">ההסרה נכשלה — נסו שוב, או פנו למשרד התיווך.</Notice>
      ) : (
        <>
          <p style={{ color: "var(--color-text-muted)" }}>
            לחיצה על הכפתור תפסיק את שליחת הצעות הנכסים במייל מטעם משרד התיווך. אפשר
            להצטרף שוב בכל עת בפנייה למשרד.
          </p>
          <Button onClick={() => void optOut()} disabled={state === "submitting"}>
            {state === "submitting" ? "מסירים…" : "הסירו אותי מרשימת התפוצה"}
          </Button>
        </>
      )}
    </main>
  );
}
