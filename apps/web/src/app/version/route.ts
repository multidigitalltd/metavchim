/**
 * הגרסה של קונטיינר ה-web — נשאלת **מהדפדפן**, לא מה-API.
 *
 * זו הנקודה: הדפדפן קיבל את הדף מהקונטיינר הזה, ולכן התשובה כאן היא
 * הגרסה שהמשתמש באמת רואה. שאלה שעוברת דרך ה-API הייתה מוסיפה קפיצה
 * ומצב כשל, ובעיקר — הייתה מודדת קונטיינר אחר מזה ששירת את הדף.
 *
 * `APP_VERSION` הוא משתנה **ריצה** ולא `NEXT_PUBLIC_*`: משתנה ציבורי
 * נצרב לתוך החבילה בזמן הבנייה, וכאן זה היה מחזיר את הערך שהיה בעת
 * הבנייה של החבילה — בדיוק הבלבול שהמסך הזה נועד לפתור.
 */
import { NextResponse } from "next/server";

/** ללא מטמון: תשובה שנשמרה היא הגרסה הקודמת, כלומר התשובה השגויה. */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET(): NextResponse {
  return NextResponse.json(
    { version: process.env.APP_VERSION ?? "dev" },
    { headers: { "cache-control": "no-store" } },
  );
}
