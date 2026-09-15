import { permanentRedirect } from "next/navigation";
import { GUIDES } from "@/lib/guide-content";

/**
 * מדריך בודד — הפניה קבועה לעמוד הנושא בתיעוד הציבורי.
 *
 * הנימוק המלא נמצא ב-`../page.tsx`. מה שנוסף כאן הוא **הבדיקה
 * מול הרשימה**: מזהה שאינו נושא קיים מופנה לאינדקס ולא לכתובת
 * ‎`/docs/<מה שהוקלד>` שתחזיר 404. אותה בדיקה גם מוודאת שהמזהה
 * שנכנס להפניה הוא אחד מרשימה סגורה, ולא קלט שהגיע מבחוץ.
 */
export default async function GuideTopicRedirect({
  params,
}: {
  params: Promise<{ topic: string }>;
}): Promise<never> {
  const { topic } = await params;
  const known = GUIDES.some((guide) => guide.id === topic);
  permanentRedirect(known ? `/docs/${topic}` : "/docs");
}
