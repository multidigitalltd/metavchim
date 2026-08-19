"use client";

import { use, useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import { apiGet, ApiError } from "@/lib/api";
import { useRequireAuth } from "@/lib/use-auth";
import { IconPrinter } from "../../../icons";
import { Notice } from "../../../notice";

/**
 * המסמך החתום — מה שהיה חסר בכרטיס הלקוח.
 *
 * עד כה החתימה נשמרה ולא היה מה להראות: לא ללקוח שביקש עותק, לא
 * לעורך דין ולא בבית משפט. העמוד הזה הוא המסמך עצמו — הנוסח שנחתם,
 * החתימה כפי שצוירה, ודף הראיות שמתעד מי חתם, מתי ומאיפה.
 *
 * ה-PDF מיוצר בהדפסה של הדפדפן ("שמור כ-PDF"), ולא בספרייה בשרת.
 * זו לא פשרה: עברית ב-PDF דורשת אריזת גופן ובנייה מימין לשמאל ידנית,
 * והדפדפן כבר יודע לעשות את שניהם בדיוק כמו במסך.
 */

interface SignedDocument {
  id: string;
  kindLabel: string;
  officeName: string;
  body: string;
  status: string;
  signerName?: string;
  signerIdNumber?: string;
  signatureImage?: string;
  signedAt?: string;
  signedIp?: string;
  bodyHash: string;
  presentedHash?: string;
  createdAt: string;
}

function stamp(value?: string): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("he-IL");
}

export default function AgreementDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { loading } = useRequireAuth();
  const [doc, setDoc] = useState<SignedDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    apiGet<SignedDocument>(`/agreements/${id}/document`)
      .then(setDoc)
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "טעינת המסמך נכשלה");
      });
  }, [id, loading]);

  if (error) {
    return (
      <Notice tone="danger">{error}</Notice>
    );
  }
  if (!doc) return <p aria-live="polite">טוען מסמך…</p>;

  const isSigned = doc.status === "signed";

  return (
    <div className="mx-auto max-w-3xl py-6">
      {/* סרגל הפעולות אינו חלק מהמסמך — הוא נעלם בהדפסה */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <h1 className="text-xl font-bold">{doc.kindLabel}</h1>
        <Button type="button" onClick={() => window.print()}>
          <IconPrinter s={15} /> הדפסה / שמירה כ-PDF
        </Button>
      </div>

      {!isSigned ? (
        <p
          className="mb-4 rounded-lg border p-3 print:hidden"
          style={{ borderColor: "var(--color-warning)", color: "var(--color-warning)" }}
        >
          המסמך טרם נחתם — זו תצוגת הנוסח בלבד.
        </p>
      ) : null}

      <article
        className="rounded-xl border p-6 print:border-0 print:p-0"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <header className="mb-5 border-b pb-3" style={{ borderColor: "var(--color-border)" }}>
          <p className="text-lg font-semibold">{doc.officeName}</p>
          <p style={{ color: "var(--color-text-muted)" }}>{doc.kindLabel}</p>
        </header>

        <div className="whitespace-pre-wrap leading-relaxed">{doc.body}</div>

        {isSigned ? (
          <section className="mt-8 border-t pt-5" style={{ borderColor: "var(--color-border)" }}>
            <p className="mb-2 font-semibold">חתימת הלקוח</p>
            {doc.signatureImage ? (
              /*
               * ‎<img> ולא next/image: המקור הוא data URL ששמור בבסיס
               * הנתונים, ואין מה לייעל דרך שרת התמונות. הרקע לבן כי
               * ה-PNG עצמו לבן, וכך גם בהדפסה על נייר.
               */
              <img
                src={doc.signatureImage}
                alt={`חתימת ${doc.signerName ?? "הלקוח"}`}
                className="mb-3 rounded-lg border"
                style={{ borderColor: "var(--color-border)", background: "#fff", maxWidth: 320 }}
              />
            ) : (
              <p className="mb-3" style={{ color: "var(--color-text-muted)" }}>
                נחתם באישור מקוון, ללא חתימה מצוירת.
              </p>
            )}

            {/*
             * דף הראיות. אלה הפרטים שהופכים חתימה מקוונת למשהו שאפשר
             * להוכיח: מי, מתי, מאיפה, ומה בדיוק היה כתוב.
             */}
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <div>
                <dt className="inline font-medium">שם החותם: </dt>
                <dd className="inline">{doc.signerName ?? "—"}</dd>
              </div>
              <div>
                <dt className="inline font-medium">מספר זיהוי: </dt>
                <dd className="inline" dir="ltr">
                  {doc.signerIdNumber ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="inline font-medium">מועד החתימה: </dt>
                <dd className="inline">{stamp(doc.signedAt)}</dd>
              </div>
              <div>
                <dt className="inline font-medium">כתובת IP: </dt>
                <dd className="inline" dir="ltr">
                  {doc.signedIp ?? "—"}
                </dd>
              </div>
            </dl>

            <div className="mt-4 text-sm" style={{ color: "var(--color-text-muted)" }}>
              <p className="mb-1">
                אימות שלמות המסמך (SHA-256 של הנוסח החתום):{" "}
                <code dir="ltr" className="break-all">
                  {doc.bodyHash}
                </code>
              </p>
              {doc.presentedHash ? (
                <p>
                  גיבוב הנוסח שהוצג לחותם לפני החתימה:{" "}
                  <code dir="ltr" className="break-all">
                    {doc.presentedHash}
                  </code>
                </p>
              ) : null}
              <p className="mt-2">
                כל שינוי ולו בתו אחד בנוסח שלמעלה משנה את הגיבוב — כך אפשר להוכיח
                שהמסמך לא הוחלף אחרי החתימה.
              </p>
            </div>
          </section>
        ) : null}
      </article>
    </div>
  );
}
