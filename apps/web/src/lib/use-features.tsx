"use client";

import { createContext, useContext } from "react";

/**
 * הפיצ'רים שכלולים במסלול המשרד — זמינים לכל מסך, לא רק לניווט.
 *
 * הרשימה נטענת פעם אחת ב-AppShell (יחד עם מוני הניווט) ומחולקת
 * בקונטקסט. בלי זה כל מסך היה צריך לשלוף אותה בעצמו, וזה בדיוק מה
 * שקרה: הניווט הסתיר פריטים שאינם במסלול, בעוד המסכים עצמם המשיכו
 * להציג כפתורי ייבוא וייצוא שמובילים ל-403 (ביקורת Codex).
 *
 * זו תצוגה בלבד. האכיפה היא ב-FeatureGuard בשרת, וכל כפתור שמוסתר
 * כאן היה נחסם שם ממילא.
 */

const FeaturesContext = createContext<string[] | null>(null);
const FeaturesFailedContext = createContext<boolean>(false);

export function FeaturesProvider({
  features,
  failed = false,
  children,
}: {
  /** `null` = טרם נטען. */
  features: string[] | null;
  /** האם הניסיון האחרון להביא את הרשימה נכשל. */
  failed?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <FeaturesContext.Provider value={features}>
      <FeaturesFailedContext.Provider value={failed}>{children}</FeaturesFailedContext.Provider>
    </FeaturesContext.Provider>
  );
}

/**
 * האם הפיצ'ר כלול במסלול.
 *
 * **כל עוד הרשימה לא נטענה — התשובה חיובית.** זו ההחלטה ההפוכה מזו
 * של ההרשאות (`can`), ובכוונה: הסתרה זמנית של כפתור בכל טעינת דף
 * הייתה גורמת לממשק "לקפוץ", ומשתמש שלוחץ על כפתור שאינו במסלול
 * מקבל הודעה מהשרת. שם המחיר הפוך — כפתור שנעלם ומופיע גרוע
 * מכפתור שמסביר למה הוא חסום.
 */
export function useFeature(code: string): boolean {
  const features = useContext(FeaturesContext);
  return features === null || features.includes(code);
}

/**
 * האם רשימת הפיצ'רים כבר נטענה.
 *
 * `useFeature` מחזיר "כן" כל עוד היא חסרה — נכון לכפתור שלא כדאי
 * שיקפוץ, ושגוי לבקשת רשת: מסך שנטען לפני שהרשימה הגיעה שלח את
 * הבקשה, קיבל 403, והשגיאה כבר נרשמה בקונסול גם אחרי שהרשימה
 * הגיעה ואמרה שאין פיצ'ר. פעולה שיוצאת החוצה צריכה להמתין.
 */
export function useFeaturesReady(): boolean {
  return useContext(FeaturesContext) !== null;
}

/**
 * האם הניסיון להביא את רשימת היכולות **נכשל**.
 *
 * `useFeaturesReady` לבדו אינו מבדיל בין "עוד לא הגיעה" ל"לא תגיע
 * לעולם" — בשני המקרים הרשימה `null`. כל עוד ההבדל היה רק בין כפתור
 * שמוצג לכפתור שמוסתר זה הספיק; מסך שממתין לרשימה כדי להחליט אם
 * לצאת לרשת נתקע על ההמתנה לנצח, בלי שגיאה ובלי ניסיון חוזר
 * (ביקורת Codex).
 *
 * מי שממתין לרשימה צריך את שתי השאלות: `ready` כדי לדעת שהתשובה
 * ידועה, ו-`failed` כדי לדעת שהיא לא תגיע.
 */
export function useFeaturesFailed(): boolean {
  return useContext(FeaturesFailedContext);
}
