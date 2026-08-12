"use client";

import { useEffect, useRef, useState } from "react";
import { Map as MapLibreMap, NavigationControl } from "maplibre-gl";
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
    if (config?.configured !== true || container.current === null || map.current !== null) return;
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
      instance.addControl(new NavigationControl({ showCompass: false }), "top-left");
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
        style={{ height, display: "grid", placeItems: "center", color: "var(--color-text-muted)" }}
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
          <p className="m-0 mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
            {failed
              ? "טעינת המפה נכשלה — ייתכן שהטוקן אינו תקף."
              : "בעל הפלטפורמה מגדיר טוקן אריחים במסך הפלטפורמה, וכל המפות במערכת נדלקות."}
          </p>
        </div>
      </div>
    );
  }

  return <div ref={container} className={className} style={{ height, borderRadius: 12 }} />;
}
