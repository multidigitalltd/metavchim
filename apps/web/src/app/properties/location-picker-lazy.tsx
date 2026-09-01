"use client";

import dynamic from "next/dynamic";

/*
 * הגבול העצל של המפה.
 *
 * ‏MapLibre שוקל ‎~240KB gz, ו-`location-picker` (שגורר אותו) יובא
 * סטטית בארבעה מסכי טפסים — כלומר המפה שולמה בטעינה הראשונה גם
 * כשהיא יושבת מתחת לקפל. הייבוא מכאן טוען את הטופס מיד ואת המפה
 * ברקע, אחרי שהמסך כבר אינטראקטיבי.
 *
 * ‏`ssr: false` כי הרכיב ממילא חי רק בדפדפן (canvas + WebGL), וייצוא
 * הטיפוס נמחק בקומפילציה — הוא אינו מחזיר את התלות הסטטית.
 */
export type { LocationValue } from "./location-picker";

export const LocationPicker = dynamic(
  () => import("./location-picker").then((m) => m.LocationPicker),
  {
    ssr: false,
    loading: () => (
      <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
        המפה נטענת…
      </p>
    ),
  },
);
