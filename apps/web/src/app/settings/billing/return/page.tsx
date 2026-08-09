"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { apiGet } from "@/lib/api";
import { useRequireAuth } from "@/lib/use-auth";

/**
 * דף החזרה מקארדקום.
 *
 * הוא שואל את השרת מה מצב התשלום, והשרת מאמת מול קארדקום אם הוובהוק
 * טרם הגיע. זו הסיבה שהדף הזה קיים בכלל: הוובהוק יכול להתעכב, ומשרד
 * שסיים לשלם ורואה "עדיין בניסיון" מתקשר לתמיכה. שתי דקות של המתנה
 * מול מסך שמסביר מה קורה עדיפות על שיחה.
 *
 * הדגל `failed` בכתובת מגיע מקארדקום ואינו נאמן — הוא רק חוסך שאילתה
 * ראשונה מיותרת. ההכרעה תמיד מהשרת.
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
          if (res.status === "pending") {
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
      <main className="mx-auto max-w-lg py-10 text-center">
        <h1 className="mb-3 text-2xl font-bold">חסר מזהה תשלום</h1>
        <Link href="/settings/billing" className="underline">
          חזרה למסך המנוי
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg py-10 text-center">
      {status === "paid" ? (
        <>
          <h1 className="mb-2 text-2xl font-bold">התשלום התקבל ✓</h1>
          <p className="mb-5">המנוי פעיל. אפשר להמשיך לעבוד.</p>
          <Link href="/settings/billing" className="mv-btn-primary inline-block">
            למסך המנוי
          </Link>
        </>
      ) : status === "failed" ? (
        <>
          <h1 className="mb-2 text-2xl font-bold">התשלום לא הושלם</h1>
          <p className="mb-2">{reason ?? "הכרטיס לא חויב. אפשר לנסות שוב או בכרטיס אחר."}</p>
          <p className="mb-5 text-sm" style={{ color: "var(--color-text-muted)" }}>
            לא בוצע חיוב.
          </p>
          <Link href="/settings/billing" className="mv-btn-primary inline-block">
            לנסות שוב
          </Link>
        </>
      ) : gaveUp ? (
        <>
          <h1 className="mb-2 text-2xl font-bold">התשלום עדיין בבדיקה</h1>
          {/*
            לא "נכשל": הכסף אולי נגבה, והוובהוק עוד יגיע. הודעה
            שמכריזה על כישלון כאן הייתה גורמת לתשלום כפול
          */}
          <p className="mb-5">
            אישור חברת הסליקה טרם התקבל. אין צורך לשלם שוב — רעננו את מסך המנוי בעוד
            מספר דקות, ואם המצב לא השתנה פנו אלינו.
          </p>
          <Link href="/settings/billing" className="mv-btn-primary inline-block">
            למסך המנוי
          </Link>
        </>
      ) : (
        <>
          <h1 className="mb-2 text-2xl font-bold">מאשרים את התשלום…</h1>
          <p aria-live="polite">רגע אחד, בודקים מול חברת הסליקה.</p>
        </>
      )}
    </main>
  );
}

export default function BillingReturnPage(): React.JSX.Element {
  // useSearchParams מחייב גבול Suspense בבנייה סטטית של Next
  return (
    <Suspense fallback={<main className="py-10 text-center">טוען…</main>}>
      <ReturnContent />
    </Suspense>
  );
}
