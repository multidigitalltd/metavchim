"use client";

import { useEffect, useState } from "react";
import { apiGet, ApiError, mediaSrc } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { IconDoc, IconDownload } from "../../icons";

/**
 * קובץ המודעה — הדף שנציג המדיה פותח מהמייל.
 *
 * דף ציבורי (ב-`PUBLIC_PREFIXES`): לנציג אין חשבון, והאסימון שבכתובת
 * הוא ההרשאה. הדף אומר מה הקובץ ולאיזה מוצר, מציג אותו, ונותן להוריד.
 * בלי פרטי המשרד — אלה כבר במייל, והדף הזה עשוי להישלח הלאה למעצב.
 *
 * אסימון שהוחלף (המשרד העלה קובץ חדש) מחזיר 404, והדף אומר לבדוק את
 * המייל האחרון — כדי שהמגזין לא ידפיס טיוטה.
 */

interface CreativeView {
  outletName: string;
  productName: string;
  quantity: number;
  creativeName: string;
  creativeMime: string;
  uploadedAt: string;
  brief: string;
}

export default function AdCreativePage({ params }: { params: Promise<{ token: string }> }): React.JSX.Element {
  const [token, setToken] = useState<string | null>(null);
  const [view, setView] = useState<CreativeView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    params
      .then(({ token: t }) => {
        if (cancelled) return;
        setToken(t);
        return apiGet<CreativeView>(`/public/media/creatives/${t}`).then((res) => {
          if (!cancelled) setView(res);
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError && err.status === 404
            ? "הקישור אינו בתוקף — ייתכן שהמשרד החליף את הקובץ. בדקו את המייל האחרון שקיבלתם."
            : "לא הצלחנו לטעון את הקובץ. נסו שוב בעוד רגע.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [params]);

  const fileUrl = token === null ? null : mediaSrc(`public/media/creatives/${token}/file`);

  return (
    // div ולא main — העטיפה של AppShell היא ה-main landmark היחיד
    <div className="mv-page mx-auto max-w-3xl">
      <header className="mv-hero mb-5">
        <span className="mv-hero-icon" aria-hidden="true">
          <IconDoc s={26} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-2xl font-extrabold">קובץ המודעה</h1>
          <p className="m-0 mt-1" style={{ color: "var(--color-text-muted)" }}>
            {view ? `${view.outletName} — ${view.productName}${view.quantity > 1 ? ` ×${view.quantity}` : ""}` : "מערכת מתווכים · רכש מדיה"}
          </p>
        </div>
      </header>

      {error ? (
        <div className="mv-card mv-card--pad" role="alert">
          <p className="m-0 font-bold">{error}</p>
        </div>
      ) : view === null || fileUrl === null ? (
        <p aria-live="polite">טוען…</p>
      ) : (
        <>
          <section className="mv-card mv-card--pad" aria-labelledby="ad-file-heading">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <h2 id="ad-file-heading" className="m-0 text-[length:var(--type-row-title)] font-extrabold" dir="auto">
                  {view.creativeName}
                </h2>
                <p className="m-0 mt-1 text-[length:var(--type-body-sm)]" style={{ color: "var(--color-text-muted)" }}>
                  {view.creativeMime === "application/pdf" ? "PDF" : view.creativeMime === "image/png" ? "PNG" : "JPEG"} · הועלה{" "}
                  {formatDateTime(view.uploadedAt)}
                </p>
              </div>
              <a className="mv-btn-action" href={fileUrl} download={view.creativeName}>
                <IconDownload s={15} /> הורדת הקובץ
              </a>
            </div>
            {view.brief ? (
              <p className="m-0 mt-3 whitespace-pre-line text-[length:var(--type-body-sm)]">
                <span className="font-bold">הערות המשרד: </span>
                {view.brief}
              </p>
            ) : null}
          </section>

          <section className="mv-card mt-4 overflow-hidden" aria-label="תצוגה מקדימה של המודעה">
            {view.creativeMime === "application/pdf" ? (
              <iframe
                title={`תצוגה מקדימה — ${view.creativeName}`}
                src={fileUrl}
                className="block w-full border-0"
                style={{ height: "min(80vh, 1000px)", background: "var(--color-surface)" }}
              />
            ) : (
              <img src={fileUrl} alt={`המודעה — ${view.creativeName}`} className="block h-auto w-full" />
            )}
          </section>
        </>
      )}
    </div>
  );
}
