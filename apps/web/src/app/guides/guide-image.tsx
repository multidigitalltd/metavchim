"use client";

import { useState } from "react";

/**
 * צילום מסך של הדרכה — **נעלם בשקט אם הקובץ עוד לא קיים.**
 *
 * שער הנכסים (`verify:assets`) כבר מוודא שכל נתיב שנכתב בקוד קיים
 * ב-`public`, ולכן תמונה חסרה אינה אמורה להגיע לייצור. הנפילה
 * הרכה כאן היא בשביל הרגע השני: קובץ שנמחק, נכשל בטעינה או נחסם —
 * הדרכה שלמה עם ריבוע שבור באמצע גרועה מהדרכה בלי תמונה.
 */
export function GuideImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    // img רגיל בכוונה — קבצים סטטיים מ-public, בלי אופטימיזציית Next
    <img
      src={src}
      alt={alt}
      // צילומי המסך יושבים לאורך עמוד ההדרכה — נטענים רק כשמתקרבים אליהם
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="mb-4 w-full rounded-xl border"
      style={{
        borderColor: "var(--color-border)",
        maxHeight: 460,
        objectFit: "cover",
        objectPosition: "top",
      }}
    />
  );
}
