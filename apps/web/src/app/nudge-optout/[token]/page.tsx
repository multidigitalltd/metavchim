"use client";

import { use, useState } from "react";
import { Button } from "@metavchim/ui";
import { apiPost } from "@/lib/api";
import { Notice } from "../../notice";

/**
 * דף ההסרה מתזכורות ההפעלה ומהודעות ההמרה — היעד של הקישור שבתחתית
 * כל אחת מהן (חוק התקשורת §30א). שני המסלולים חולקים את אותה הסרה,
 * ולכן הנוסח כאן מדבר על שניהם.
 *
 * ‎**דף אישור ולא הסרה מיידית.** קישור במייל נפתח גם בידי סורקי
 * אבטחה של ארגונים, ו-`GET` שמסיר היה מסיר אנשים שמעולם לא לחצו.
 * ההסרה עצמה היא `POST` מהכפתור — אותה הכרעה בדיוק כמו בהסרה
 * מהצעות הנכסים.
 *
 * ‎**וההסרה אינה נוגעת בחשבון.** זה ההבדל שחייב להיאמר כאן: מי
 * שלוחץ מבקש שנפסיק לשווק לו, לא לוותר על המשרד שלו. הנתונים
 * נשארים, ומסך המנוי פתוח בכל רגע.
 *
 * ‎**ומה ממשיך להגיע — נאמר במפורש.** ההסרה עוצרת את הדיוור בלבד:
 * המדריכים וההודעות על פיצ'רים (מסלול ההמרה) ותזכורות סיום הניסיון.
 * הודעות חיוב והודעות תפעוליות אינן קוראות אותה כלל, ושער אוכף זאת
 * ‎(`activation-nudge-gates.test.ts`).
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
      <h1 className="text-xl font-bold">הפסקת ההודעות במייל</h1>
      {state === "done" ? (
        <Notice tone="success">
          לא נשלח אליכם עוד מדריכים, הודעות על פיצ׳רים חדשים ותזכורות על סיום
          תקופת הניסיון. הודעות חיוב והודעות תפעוליות על החשבון ימשיכו להגיע
          כרגיל.
        </Notice>
      ) : state === "error" ? (
        <Notice tone="danger">ההסרה נכשלה — נסו שוב, או השיבו למייל שקיבלתם.</Notice>
      ) : (
        <>
          <p style={{ color: "var(--color-text-muted)" }}>
            לחיצה על הכפתור תפסיק את המדריכים, ההודעות על פיצ׳רים חדשים
            ותזכורות סיום תקופת הניסיון שאנחנו שולחים. זה לא סוגר את החשבון
            ולא מונע הודעות חיוב או הודעות תפעוליות על החשבון.
          </p>
          <Button onClick={() => void optOut()} disabled={state === "submitting"}>
            {state === "submitting" ? "מסירים…" : "הסירו אותי מרשימת הדיוור"}
          </Button>
        </>
      )}
    </main>
  );
}
