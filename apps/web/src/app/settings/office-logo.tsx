"use client";

import { useRef, useState } from "react";
import { Button } from "@metavchim/ui";
import { API_BASE, ApiError, apiDelete } from "@/lib/api";
import { IconUpload } from "../icons";
import { Notice } from "../notice";

/**
 * הלוגו של המשרד.
 *
 * ## למה העלאה ולא כתובת
 *
 * הדרך הקצרה הייתה שדה טקסט לכתובת תמונה. היא נופלת ביום שהאתר
 * שהתמונה יושבת בו משתנה, היא מפנה את הדפדפן של כל משתמש לשרת זר
 * בכל טעינת מסך, וכתובת חיצונית בתוך `img` היא ערוץ שמדליף לצד
 * שלישי מי צופה ומתי.
 *
 * ## למה `cache` בכתובת
 *
 * הדפדפן שומר את הלוגו ב-cache לחמש דקות (הכותרת נקבעת בשרת), ולכן
 * אחרי החלפה הוא היה מציג את הישן. מספר שמשתנה בכל שמירה שובר את
 * ה-cache בדיוק ברגע שצריך, ולא מבטל אותו בשאר הזמן.
 */

export function OfficeLogo(): React.JSX.Element {
  const [version, setVersion] = useState(0);
  const [present, setPresent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const src = `${API_BASE}/settings/tenant/logo/raw?v=${version}`;

  async function upload(file: File): Promise<void> {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const form = new FormData();
      form.append("file", file);
      /*
       * `fetch` ישיר ולא `apiPost`: העוזר שולח JSON, ו-multipart
       * חייב להשאיר את ה-`Content-Type` לדפדפן — הוא זה שמוסיף את
       * ה-boundary, ובלעדיו השרת אינו מוצא את הקובץ.
       */
      const res = await fetch(`${API_BASE}/settings/tenant/logo`, {
        method: "POST",
        body: form,
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new ApiError(res.status, body.message ?? "ההעלאה נכשלה");
      }
      setVersion((v) => v + 1);
      setPresent(true);
      setDone("הלוגו נשמר");
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "ההעלאה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await apiDelete("/settings/tenant/logo");
      setPresent(false);
      setDone("הלוגו הוסר");
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "ההסרה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-3.5">
      <span className="mb-1 block text-sm font-semibold">לוגו המשרד</span>
      <div className="flex flex-wrap items-center gap-3">
        <span className="mv-logo-frame">
          {present ? (
            /*
             * `img` רגיל ולא `next/image`: הקובץ מגיע מה-API עם
             * הרשאה לפי Session, ו-next/image היה מנסה לעבד אותו
             * בשרת שאין לו את העוגייה.
             */
                    <img
              src={src}
              alt="הלוגו של המשרד"
              onError={() => setPresent(false)}
              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
            />
          ) : (
            <span style={{ color: "var(--color-text-muted)" }}>אין לוגו</span>
          )}
        </span>
        <div className="flex flex-wrap gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="mv-visually-hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              e.target.value = "";
            }}
          />
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            <IconUpload s={15} /> {present ? "החלפת לוגו" : "העלאת לוגו"}
          </Button>
          {present ? (
            <Button variant="ghost" disabled={busy} onClick={() => void remove()}>
              הסרה
            </Button>
          ) : null}
        </div>
      </div>
      {done === null ? null : (
        <Notice tone="success" onClose={() => setDone(null)}>
          {done}
        </Notice>
      )}
      {error === null ? null : (
        <Notice tone="danger" onClose={() => setError(null)}>
          {error}
        </Notice>
      )}
    </div>
  );
}
