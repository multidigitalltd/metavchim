"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  describeCycle,
  describeOfferPrice,
  featureLabel,
  VAT_EXCLUDED_NOTE,
  VAT_EXCLUDED_SUFFIX,
  withLoginReturn,
  type BillingCycle,
} from "@metavchim/shared";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { clearSessionCache, fetchMe } from "@/lib/session-cache";
import type { AuthUser } from "@/lib/use-auth";
import { formatDate, formatNumber } from "@/lib/format";
import { Notice } from "../../notice";

/**
 * דף הצעה בלינק — הלקוח קיבל לינק אחרי שיחת מכירה, לוחץ, רואה מה
 * הוא מקבל וכמה זה עולה, ומשלם. התשלום פותח את דף קארדקום; שום
 * פרט אשראי לא עובר כאן.
 *
 * הדף דורש התחברות (ההצעה שייכת למשרד), אבל **לא דרך
 * `useRequireAuth`**: ההפניה שלו ל-/login מאבדת את הלינק, והלקוח
 * שהתחבר היה נוחת בדשבורד בלי ההצעה — בדיוק המכירה שהלינק נועד
 * לסגור. כאן ההפניה נושאת `next` וההתחברות חוזרת הנה.
 *
 * כל המספרים מהשרת: הסכום שמוצג הוא הסכום שחושב שם, מאותה פונקציה
 * שפתיחת התשלום משתמשת בה.
 */

interface OfferLineItem {
  label: string;
  amountAgorot: number;
}

interface OfferView {
  valid: boolean;
  message?: string;
  offer?: {
    kind: string;
    planCode: string;
    planName: string;
    planDescription: string;
    billingCycle: BillingCycle;
    amountAgorot: number;
    lineItems: OfferLineItem[];
    note: string;
    planFeatures: string[];
    extraFeatures: string[];
    expiresAt: string | null;
  };
  checkoutAvailable?: boolean;
  mayManage?: boolean;
}

export default function SubscribeOfferPage(): React.JSX.Element | null {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const router = useRouter();
  const [me, setMe] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [view, setView] = useState<OfferView | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then((user) => {
        if (cancelled) return;
        if (user.mustChangePassword) {
          // ההחלפה היא תחנה, לא יעד — אחריה חוזרים לכאן
          router.replace(withLoginReturn("/change-password", `/subscribe/${token}`));
          return;
        }
        setMe(user);
        setAuthLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          clearSessionCache();
          // ההתחברות חוזרת לכאן — הלינק הוא כל הסיבה שהלקוח הגיע
          router.replace(withLoginReturn("/login", `/subscribe/${token}`));
          return;
        }
        setAuthLoading(false);
        setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [router, token]);

  useEffect(() => {
    if (authLoading || me === null) return;
    apiGet<OfferView>(`/billing/offers/${encodeURIComponent(token)}`)
      .then(setView)
      .catch(() => setLoadFailed(true));
  }, [authLoading, me, token]);

  async function pay(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ url: string }>(
        `/billing/offers/${encodeURIComponent(token)}/checkout`,
        {},
      );
      // יציאה לדף של קארדקום; "אחורה" משם מחזיר להצעה
      window.location.assign(res.url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "פתיחת התשלום נכשלה");
      setBusy(false);
    }
  }

  if (authLoading) return <p aria-live="polite">טוען…</p>;

  if (loadFailed) {
    return (
      <div className="mx-auto max-w-lg py-10">
        <Notice tone="danger">טעינת ההצעה נכשלה. רעננו את העמוד או פנו אלינו.</Notice>
      </div>
    );
  }

  if (view === null) return <p aria-live="polite">טוען…</p>;

  if (!view.valid || view.offer === undefined) {
    return (
      <div className="mx-auto max-w-lg py-10">
        <h1 className="mb-3 text-2xl font-bold">ההצעה אינה זמינה</h1>
        <Notice tone="danger">{view.message ?? "הלינק אינו תקף"}</Notice>
        <Link href="/settings/billing" className="underline">
          למסך המנוי הרגיל
        </Link>
      </div>
    );
  }

  const offer = view.offer;
  const featureCodes = [...offer.planFeatures, ...offer.extraFeatures];

  return (
    <div className="mx-auto max-w-lg py-8">
      <h1 className="mb-1 text-2xl font-bold">
        {offer.kind === "custom" ? "הצעה אישית למשרד שלכם" : `הצטרפות למסלול ${offer.planName}`}
      </h1>
      <p className="mb-5 text-sm" style={{ color: "var(--color-text-muted)" }}>
        פרטי האשראי מוקלדים בדף המאובטח של חברת הסליקה ואינם נשמרים במערכת.
      </p>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      <section
        aria-labelledby="offer-heading"
        className="mb-5 rounded-xl border p-4"
        style={{ borderColor: "var(--color-primary)", background: "var(--color-surface)" }}
      >
        <h2 id="offer-heading" className="m-0 text-lg font-bold">
          {offer.planName}
        </h2>
        {offer.planDescription ? (
          <p className="m-0 mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
            {offer.planDescription}
          </p>
        ) : null}

        {offer.note ? <p className="m-0 mb-3 text-sm">{offer.note}</p> : null}

        {featureCodes.length > 0 ? (
          <ul className="m-0 mb-3 list-none p-0 text-sm">
            {featureCodes.map((code) => (
              <li key={code}>
                ✓ {featureLabel(code)}
                {offer.extraFeatures.includes(code) ? (
                  <span style={{ color: "var(--color-primary)" }}> · תוספת מעבר למסלול</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {offer.lineItems.length > 0 ? (
          <>
            <h3 className="m-0 mb-1 text-sm font-semibold">מה כלול בהצעה</h3>
            <ul className="m-0 mb-3 list-none p-0 text-sm">
              {offer.lineItems.map((item, index) => (
                <li key={index} className="flex justify-between gap-3">
                  <span>{item.label}</span>
                  <span style={{ color: "var(--color-text-muted)" }}>
                    {item.amountAgorot === 0
                      ? "כלול במחיר"
                      : `${formatNumber(item.amountAgorot / 100)} ₪ ${VAT_EXCLUDED_SUFFIX}`}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <p className="m-0 text-xl font-bold">
          {describeOfferPrice(offer.amountAgorot, offer.billingCycle)}
        </p>
        {/*
          הדף שממנו לוחצים „לתשלום” הוא המקום שבו הפער בין המחיר
          המוצג לסכום שיירד מהכרטיס הופך להפתעה — ולכן הסייג כאן
          במפורש, ולא רק כסיומת ליד המספר.
        */}
        <p className="m-0 mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
          {VAT_EXCLUDED_NOTE} החיוב בפועל כולל מע&quot;מ כחוק. המנוי מתחדש אוטומטית
          בחיוב {describeCycle(offer.billingCycle)} באותו סכום, וניתן לביטול בכל עת
          ממסך המנוי.
        </p>
        {offer.expiresAt ? (
          <p className="m-0 mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
            ההצעה בתוקף עד {formatDate(offer.expiresAt)}
          </p>
        ) : null}
      </section>

      {view.mayManage === false ? (
        <Notice tone="danger">
          התשלום נעשה על ידי בעל/ת המשרד — העבירו להם את הלינק הזה.
        </Notice>
      ) : view.checkoutAvailable === false ? (
        <Notice tone="danger">התשלום המקוון טרם הופעל במערכת. פנו אלינו כדי להסדיר את המנוי.</Notice>
      ) : (
        <button
          type="button"
          className="mv-btn-primary w-full"
          onClick={() => void pay()}
          disabled={busy}
        >
          {busy ? "פותח תשלום…" : "לתשלום והפעלת המנוי"}
        </button>
      )}

      <p className="mt-4 text-center text-sm">
        <Link href="/settings/billing" className="underline">
          למסך המנוי הרגיל
        </Link>
      </p>
    </div>
  );
}
