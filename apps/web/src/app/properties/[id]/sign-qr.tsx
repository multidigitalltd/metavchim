"use client";

import { useRef, useState } from "react";
import { QRCodeCanvas, QRCodeSVG } from "qrcode.react";

/**
 * ‏QR לשלט — קוד שמוביל לדף הנחיתה של הנכס.
 *
 * ‏השלט על המרפסת הוא הפרסום הכי ממוקד שיש: מי שסורק עומד מול
 * ‏הבניין ורוצה את הדירה הזאת. עד היום השלט נשא טלפון, והשיחה
 * ‏הגיעה בלי הקשר. הקוד מוביל לדף הנחיתה, וטופס הפנייה שם פותח
 * ‏ליד **על הנכס** — עם הכתובת, בלי „באיזה נכס מדובר”.
 *
 * ‏אותו טוקן של דף הנחיתה: ביטול הדף מבטל גם את הקוד, ואין קוד
 * ‏שממשיך לעבוד אחרי שהנכס ירד משיווק.
 *
 * ‏ה-PNG נוצר מקנבס נסתר ברזולוציה של הדפסה (1024px): SVG בגודל
 * ‏מסך נראה טוב בכרטיס ומטושטש על שלט של מטר.
 */
const PRINT_SIZE = 1024;

export function SignQr({ url, label }: { url: string; label: string }) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [saved, setSaved] = useState(false);

  function download(): void {
    const canvas = canvasRef.current?.querySelector("canvas");
    if (!canvas) return;
    /* ‏Blob ולא data-URL: הדפדפן מכבד את שם הקובץ רק על כתובת blob */
    canvas.toBlob((blob) => {
      if (!blob) return;
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `qr-${label.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "property"}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
      setSaved(true);
    }, "image/png");
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-4" data-testid="sign-qr">
      <span className="rounded-xl border p-2" style={{ borderColor: "var(--color-border)", background: "#fff" }}>
        <QRCodeSVG value={url} size={148} level="M" marginSize={1} aria-label={`קוד QR לדף הנחיתה של ${label}`} />
      </span>
      {/* ‏עותק ההדפסה — מחוץ למסך, לא מוסתר ב-display:none כדי שהקנבס יצויר */}
      <div ref={canvasRef} aria-hidden="true" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0 }}>
        <QRCodeCanvas value={url} size={PRINT_SIZE} level="M" marginSize={2} />
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <p className="m-0 text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-soft)" }}>
          להדפסה על השלט: מי שסורק מגיע לדף הנחיתה של הנכס, והפנייה מהטופס נכנסת כליד על הנכס הזה.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="mv-btn-soft" onClick={download}>
            הורדת PNG להדפסה
          </button>
          {saved ? (
            <span className="text-[length:var(--type-caption)]" style={{ color: "var(--color-success)" }} aria-live="polite">
              נשמר — 1024×1024, מתאים גם לשלט גדול
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
