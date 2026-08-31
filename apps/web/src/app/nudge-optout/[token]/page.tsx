"use client";

import { use, useState } from "react";
import { Button } from "@metavchim/ui";
import { apiPost } from "@/lib/api";
import { Notice } from "../../notice";

/**
 * דף ההסרה מתזכורות ההפעלה — היעד של הקישור שבתחתית כל תזכורת
 * (חוק התקשורת §30א).
 *
 * ‎**דף אישור ולא הסרה מיידית.** קישור במייל נפתח גם בידי סורקי
 * אבטחה של ארגונים, ו-`GET` שמסיר היה מסיר אנשים שמעולם לא לחצו.
 * ההסרה עצמה היא `POST` מהכפתור — אותה הכרעה בדיוק כמו בהסרה
 * מהצעות הנכסים.
 *
 * ‎**וההסרה אינה נוגעת בחשבון.** זה ההבדל שחייב להיאמר כאן: מי
 * שלוחץ מבקש שנפסיק להזכיר, לא לוותר על המשרד שלו. הנתונים
 * נשארים, ומסך המנוי פתוח בכל רגע.
 */
export default function NudgeOptOutPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [state, setState] = useState<"idle" | "submitting" | "done" | "error">("idle");

  async function optOut() {
    setState("submitting");
    try {
      await apiPost(`/public/nudge/${token}/optout`, {});
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
      <h1 className="text-xl font-bold">הפסקת תזכורות ההפעלה</h1>
      {state === "done" ? (
        <Notice tone="success">
          לא נשלח אליכם עוד תזכורות בנושא הפעלת החשבון. הנתונים שלכם נשארים
          במקומם, ואפשר להפעיל את החשבון בכל עת ממסך המנוי.
        </Notice>
      ) : state === "error" ? (
        <Notice tone="danger">ההסרה נכשלה — נסו שוב, או השיבו למייל שקיבלתם.</Notice>
      ) : (
        <>
          <p style={{ color: "var(--color-text-muted)" }}>
            לחיצה על הכפתור תפסיק את התזכורות על הפעלת החשבון. זה לא סוגר את
            החשבון ולא מוחק דבר — הנכסים, הקונים וההתאמות שלכם נשארים כפי
            שהם.
          </p>
          <Button onClick={() => void optOut()} disabled={state === "submitting"}>
            {state === "submitting" ? "מסירים…" : "הפסיקו לשלוח לי תזכורות"}
          </Button>
        </>
      )}
    </main>
  );
}
