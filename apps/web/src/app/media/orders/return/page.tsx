"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { apiGet } from "@/lib/api";
import { useRequireAuth } from "@/lib/use-auth";

/**
 * דף החזרה מקארדקום — הזמנת מדיה.
 *
 * אותו מנגנון כמו דף החזרה של המנוי: השרת מאמת מול קארדקום אם
 * הוובהוק טרם הגיע, והמסך שואל עד שיש תשובה. ההבדל היחיד הוא לאן
 * ממשיכים — להזמנות המדיה, לא למסך המנוי. הדגל `failed` בכתובת
 * אינו נאמן; ההכרעה תמיד מהשרת.
 */

const POLL_MS = 2_000;
const MAX_POLLS = 10;

function ReturnContent(): React.JSX.Element | null {
  const { loading } = useRequireAuth();
  const params = useSearchParams();
  const paymentId = params.get("payment");
  const [status, setStatus] = useState<string>("pending");
  const [reason, setReason] = useState<string | null>(null);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    if (loading || !paymentId) return;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const check = (): void => {
      attempts += 1;
      apiGet<{ status: string; failureReason: string | null }>(`/billing/payments/${paymentId}`)
        .then((res) => {
          if (stopped) return;
          setStatus(res.status);
          setReason(res.failureReason);
          // ‏`superseded` ממשיך להיבדק כמו `pending` — ראו דף החזרה של המנוי
          if (res.status === "pending" || res.status === "superseded") {
            if (attempts >= MAX_POLLS) setGaveUp(true);
            else timer = setTimeout(check, POLL_MS);
          }
        })
        .catch(() => {
          if (!stopped) setGaveUp(true);
        });
    };
    check();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [loading, paymentId]);

  if (loading) return null;

  if (!paymentId) {
    return (
      <div className="mv-page mx-auto max-w-lg py-10 text-center">
        <h1 className="mb-3 text-2xl font-bold">חסר מזהה תשלום</h1>
        <Link href="/media/orders" className="underline">
          להזמנות המדיה
        </Link>
      </div>
    );
  }

  return (
    // div ולא main — העטיפה של AppShell היא ה-main landmark היחיד
    <div className="mv-page mx-auto max-w-lg py-10 text-center">
      {status === "paid" ? (
        <>
          <h1 className="mb-2 text-2xl font-bold">התשלום התקבל ✓</h1>
          <p className="mb-5">ההזמנה הועברה למדיה. אישור נשלח גם לדוא&quot;ל של איש הקשר.</p>
          <Link href="/media/orders" className="mv-btn-primary inline-block">
            להזמנות שלנו
          </Link>
        </>
      ) : status === "failed" ? (
        <>
          <h1 className="mb-2 text-2xl font-bold">התשלום לא הושלם</h1>
          <p className="mb-2">{reason ?? "הכרטיס לא חויב. אפשר לנסות שוב או בכרטיס אחר."}</p>
          <p className="mb-5 text-sm" style={{ color: "var(--color-text-muted)" }}>
            לא בוצע חיוב, וההזמנה לא נשלחה למדיה.
          </p>
          <Link href="/media" className="mv-btn-primary inline-block">
            לנסות שוב
          </Link>
        </>
      ) : gaveUp ? (
        <>
          <h1 className="mb-2 text-2xl font-bold">התשלום עדיין בבדיקה</h1>
          {/* לא "נכשל": הכסף אולי נגבה, והוובהוק עוד יגיע — הודעת כישלון כאן גורמת לתשלום כפול */}
          <p className="mb-5">
            אישור חברת הסליקה טרם התקבל. אין צורך לשלם שוב — בדקו את רשימת ההזמנות בעוד
            מספר דקות, ואם המצב לא השתנה פנו אלינו.
          </p>
          <Link href="/media/orders" className="mv-btn-primary inline-block">
            להזמנות שלנו
          </Link>
        </>
      ) : (
        <>
          <h1 className="mb-2 text-2xl font-bold">מאשרים את התשלום…</h1>
          <p aria-live="polite">רגע אחד, בודקים מול חברת הסליקה.</p>
        </>
      )}
    </div>
  );
}

export default function MediaOrderReturnPage(): React.JSX.Element {
  // useSearchParams מחייב גבול Suspense בבנייה סטטית של Next
  return (
    <Suspense fallback={<div className="py-10 text-center">טוען…</div>}>
      <ReturnContent />
    </Suspense>
  );
}
