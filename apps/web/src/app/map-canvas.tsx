"use client";

import { useEffect, useRef, useState } from "react";
import {
  Map as MapLibreMap,
  NavigationControl,
  setRTLTextPlugin,
  setWorkerUrl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { apiGet } from "@/lib/api";

/**
 * מפה — הרקע שעליו מסמנים אזורים ונכסים.
 *
 * **MapLibre ולא ה-SDK של הספק, בכוונה.** הספרייה פתוחה ואינה קשורה
 * לאף ספק אריחים; מה שקושר הוא כתובת הסגנון בלבד, והיא מגיעה מהשרת.
 * מעבר מספק אחד לאחר — למשל למפ"י — הוא שינוי הגדרה, לא שכתוב מסך.
 *
 * **מה המפה כאן אינה עושה:** היא לא מבקשת מהספק לפענח כתובות ולא
 * שומרת שום נתון שלו. אריחים בלבד — תמונה שמציירים עליה. זו הסיבה
 * שאפשר להפעיל אותה כבר עכשיו, בלי להמתין להכרעה על תנאי השימוש
 * בפענוח כתובות.
 *
 * בלי טוקן מוגדר הרכיב אינו נשבר ואינו מסתיר את עצמו בשקט — הוא
 * אומר מה חסר ומי יכול לתקן.
 */

interface MapConfig {
  configured: boolean;
  token?: string;
  styleUrl?: string;
}

export interface MapCanvasProps {
  /** מרכז ההתחלה [אורך, רוחב]. ברירת המחדל — מרכז הארץ. */
  center?: [number, number];
  zoom?: number;
  className?: string;
  /** גובה המפה; מחרוזת CSS כדי שכל מסך יקבע לעצמו. */
  height?: string;
  /** נקרא פעם אחת כשהמפה מוכנה — נקודת החיבור לציור ולסימון. */
  onReady?: (map: MapLibreMap) => void;
}

/**
 * ה-Worker מוגש מהאתר עצמו, ולא מהכתובת שהספרייה מנחשת.
 *
 * מגרסה 6 MapLibre טוענת את ה-Worker מקובץ נפרד, ומחשבת את כתובתו
 * בזמן ריצה מתוך `import.meta.url`. webpack אינו יכול לנתח את זה
 * סטטית ולכן **אינו פולט את הקובץ** — הדפדפן מבקש כתובת ריקה,
 * ה-Worker לא עולה, ואף אריח אינו מפוענח.
 *
 * כך נראתה התקלה: ריבוע לבן *עם* פקדי זום ועם קרדיט הספק. סגנון
 * המפה נטען (הוא נקרא בתהליך הראשי) והציור פשוט לא קרה — כלומר לא
 * הייתה שום שגיאה שהמשתמש יכול היה להבין, והמפה "לא עובדת".
 *
 * הקובץ מועתק ל-`public/maplibre` בכל בנייה ובכל הרצת פיתוח
 * (`scripts/copy-maplibre-worker.mjs`), ולכן הוא תמיד תואם לגרסה
 * המותקנת ומוגש מאותו מקור — מה שגם מסתדר עם `worker-src 'self'`
 * שב-CSP, בלי להתיר blob חוצה-מקורות.
 *
 * הקריאה בזמן טעינת המודול ולא בתוך האפקט: הספרייה קוראת את הערך
 * כשהיא יוצרת את מאגר ה-Workers, וזה קורה כבר במפה הראשונה.
 */
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

/**
 * טקסט דו-כיווני — בלעדיו העברית על המפה יוצאת הפוכה.
 *
 * MapLibre מציירת תוויות לפי סדר האותיות במחרוזת. עברית נשמרת בסדר
 * לוגי, ולכן בלי סידור דו-כיווני "מנחם בגין" מצויר מהכיוון הלא נכון
 * ונראה על המסך כמו כתב מראה. הכיתוב הלטיני באותה מפה נראה תקין,
 * וזה בדיוק הרמז שזו אינה בעיית עיצוב אלא היעדר התוסף.
 *
 * `lazy: false` — נטען מראש ולא בפעם הראשונה שמופיעה עברית. במפה של
 * מערכת בעברית *כל* מפה תכיל עברית, וטעינה עצלה רק הייתה מבטיחה
 * שהתוויות יצוירו פעם אחת שגוי ויתוקנו אחריה.
 *
 * מוגש מ-`public` כמו ה-Worker: ה-CSP אינו מתיר CDN, והתוסף נטען
 * בתוך ה-Worker ולכן חל עליו `script-src 'self'`.
 *
 * ## שני תנאים, ושניהם הכרחיים
 *
 * 1. **סיומת `.mjs`.** ה-Worker בוחר איך לטעון לפי הסיומת: `.mjs`
 *    עובר ב-`import()`, וכל השאר ב-`globalThis.eval` — שה-CSP חוסם.
 * 2. **`wasm-unsafe-eval` ב-`script-src`.** התוסף הוא WebAssembly,
 *    ו-`WebAssembly.instantiate` נחסם בלי היתר מפורש. ראו
 *    `middleware.ts`.
 *
 * גרסה קודמת תיקנה רק את הראשון, וזה **החמיר**: התוסף עבר מ-
 * `unavailable` (תוויות מצוירות, הפוך) ל-`error` (תוויות נעלמות
 * לגמרי), כי MapLibre מציירת טקסט רק בשני המצבים הקיצוניים. אין
 * דרך לחזור מ-`error` — `clearRTLTextPlugin` אינו מיוצא.
 *
 * שני התנאים נבדקו בדפדפן מול ה-CSP של הייצור.
 */
void setRTLTextPlugin("/maplibre/mapbox-gl-rtl-text.mjs", false).catch(
  (error: unknown) => {
    /*
     * כישלון **נרשם** ולא נבלע.
     *
     * הקריאה הזו נדחית גם במצב תקין לגמרי — Fast Refresh מריץ את
     * המודול שוב, והספרייה אוסרת קריאה שנייה. לכן היא הייתה עטופה
     * ב-catch ריק, וזה בדיוק מה שהסתיר תקלת CSP אמיתית במשך גרסה
     * שלמה: המפה הציגה עברית הפוכה בלי שורה אחת בקונסולה.
     *
     * ההודעה על קריאה כפולה מסוננת, וכל השאר מגיע לקונסולה.
     */
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("multiple times")) return;
    console.error("טעינת תוסף הטקסט הדו-כיווני נכשלה — המפה תציג עברית הפוך", error);
  },
);

/** מרכז הארץ — נקודת פתיחה סבירה כשאין מה למרכז עליו. */
const DEFAULT_CENTER: [number, number] = [34.85, 31.95];

export function MapCanvas({
  center = DEFAULT_CENTER,
  zoom = 12,
  className,
  height = "320px",
  onReady,
}: MapCanvasProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [config, setConfig] = useState<MapConfig | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    apiGet<MapConfig>("/maps/config")
      .then(setConfig)
      .catch(() => setConfig({ configured: false }));
  }, []);

  useEffect(() => {
    if (
      config?.configured !== true ||
      container.current === null ||
      map.current !== null
    )
      return;
    const { styleUrl } = config;
    if (styleUrl === undefined) return;

    /*
     * הכתובת נלקחת כפי שהיא. קודם הורכבה כאן כתובת של Mapbox מהטוקן,
     * ו-MapLibre אינה יודעת לפענח את הפרוטוקול `mapbox://` שהסגנון
     * מפנה אליו פנימית — הסגנון נטען והמפה נשארה ריקה. הסגנון הוא
     * הגדרה, והתנאי היחיד הוא שיהיה תקן MapLibre.
     */
    const style = styleUrl;

    try {
      const instance = new MapLibreMap({
        container: container.current,
        style,
        center,
        zoom,
        // תוויות בעברית כשהסגנון תומך; אחרת נשאר כפי שהוא
        attributionControl: { compact: true },
      });
      instance.addControl(
        new NavigationControl({ showCompass: false }),
        "top-left",
      );
      instance.on("error", () => setFailed(true));
      instance.on("load", () => onReady?.(instance));
      map.current = instance;
    } catch {
      setFailed(true);
    }

    return () => {
      map.current?.remove();
      map.current = null;
    };
    /*
     * התלות היא בתצורה בלבד, במכוון: המפה נבנית פעם אחת: מרכז, זום
     * ו-onReady נקראים ביצירה, ובנייה מחדש בכל שינוי שלהם הייתה
     * מאפסת למשתמש את התצוגה באמצע עבודה.
     */
  }, [config]);

  if (config === null) {
    return (
      <div
        className={className}
        style={{
          height,
          display: "grid",
          placeItems: "center",
          color: "var(--color-text-muted)",
        }}
      >
        טוען מפה…
      </div>
    );
  }

  if (!config.configured || failed) {
    return (
      <div
        className={`rounded-xl border ${className ?? ""}`}
        style={{
          height,
          borderColor: "var(--color-border)",
          background: "var(--color-surface)",
          display: "grid",
          placeItems: "center",
          padding: 16,
          textAlign: "center",
        }}
      >
        <div>
          <p className="m-0 text-sm font-semibold">המפה אינה מוגדרת</p>
          <p
            className="m-0 mt-1 text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            {failed
              ? "טעינת המפה נכשלה — ייתכן שהטוקן אינו תקף."
              : "בעל הפלטפורמה מגדיר טוקן אריחים במסך הפלטפורמה, וכל המפות במערכת נדלקות."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={container}
      className={className}
      style={{ height, borderRadius: 12 }}
    />
  );
}
