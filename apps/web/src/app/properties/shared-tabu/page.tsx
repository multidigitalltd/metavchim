"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@metavchim/ui";
import { SHARED_TABU_NETWORK_LABEL } from "@metavchim/shared";
import { apiGet, apiPatch } from "@/lib/api";
import { formatPrice, PROPERTY_TYPE_LABELS } from "@/lib/format";
import { can, useRequireAuth } from "@/lib/use-auth";

/**
 * ‎**רישום משותף — המעבר החד-פעמי על מה שטרם נבדק.**
 *
 * ## ‏למה המסך הזה קיים
 *
 * ‏מנוע ההתאמות **פוסל** נכס בטאבו משותף מקונה שסימן שאינו מוכן
 * ‏לכך. נכס שבאמת רשום במשותף ואיש לא סימן אותו נקרא „לא משותף”,
 * ‏ולכן הוא מוצע דווקא למי שסירב — הבטחה בלי כיסוי מול הקונה,
 * ‏וחשיפה מול בעלים שלא חתם.
 *
 * ## ‏ולמה זה מסך ולא „מצב שלישי” בעמודה
 *
 * ‎`NULL` בדגל עצמו היה או לא משנה דבר (אם הוא נקרא כ„לא”), או
 * ‏עוצר את **כל** המאגר הקיים מלהיות מוצע עד שמישהו יעבור עליו.
 * ‏שתי התוצאות גרועות. לכן הדגל וההתאמות לא השתנו כלל, והחסר —
 * ‏„מי כבר נשאל” — קיבל מקום משלו. הרשימה כאן היא עבודה שנגמרת:
 * ‏היא מתקצרת בכל תשובה, ובסוף היא ריקה.
 */

interface ReviewRow {
  id: string;
  city?: string;
  street?: string;
  houseNumber?: string;
  propertyType?: string;
  priceAgorot?: number;
  /** ‏הערך כפי שהמנוע קורא אותו היום — הדגל או הסוג הישן. */
  sharedTabu: boolean;
  updatedAt: string;
}

function addressOf(row: ReviewRow): string {
  const line = [row.street, row.houseNumber].filter(Boolean).join(" ");
  return [line, row.city].filter(Boolean).join(", ") || "בלי כתובת";
}

export default function SharedTabuReviewPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** ‏השורה שהתשובה עליה בדרך — שני הכפתורים שלה ננעלים */
  const [answering, setAnswering] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await apiGet<{ items: ReviewRow[]; remaining: number }>(
      "/properties/shared-tabu-review?limit=50",
    );
    setRows(Array.isArray(data.items) ? data.items : []);
    setRemaining(data.remaining);
  }, []);

  useEffect(() => {
    void load().catch(() => setError("טעינת הרשימה נכשלה. רעננו ונסו שוב."));
  }, [load]);

  if (authLoading || !user) return null;
  const mayAnswer = can(user, "properties.edit");

  /**
   * ‎**התשובה מורידה את השורה מיד.**
   *
   * ‏זו רשימת עבודה: מי שענה על שורה רוצה לראות את הבאה, לא את
   * ‏אותה שורה עם סימון חדש. הרשימה נטענת מחדש רק כשהעמוד נגמר.
   */
  async function answer(id: string, sharedTabu: boolean): Promise<void> {
    setError(null);
    setAnswering(id);
    try {
      const res = await apiPatch<{ remaining: number }>(
        `/properties/${id}/shared-tabu`,
        { sharedTabu },
      );
      setRemaining(res.remaining);
      setRows((prev) => (prev ?? []).filter((row) => row.id !== id));
    } catch {
      setError("השמירה נכשלה — נסו שוב.");
    } finally {
      setAnswering(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-5">
        <h1 className="text-2xl font-bold">{SHARED_TABU_NETWORK_LABEL} — מה שטרם נבדק</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          נכס שרשום במשותף ולא סומן ככזה מוצע גם לקונים שסימנו שאינם מוכנים לרישום משותף.
          עברו על הרשימה פעם אחת — היא מתקצרת בכל תשובה, ולא תחזור.
        </p>
      </header>

      {error ? (
        <p role="alert" className="mb-4 rounded-md bg-[var(--color-danger-soft)] p-3 text-sm">
          {error}
        </p>
      ) : null}

      {rows === null ? (
        <p className="text-sm text-[var(--color-text-muted)]">טוען…</p>
      ) : rows.length === 0 ? (
        <div className="mv-card p-6 text-center">
          <p className="font-semibold">
            {remaining === 0 ? "הכול נבדק" : "העמוד הזה נגמר"}
          </p>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {remaining === 0 ? (
              <>
                כל נכס במאגר נשאל על רישום משותף, וההתאמות מדויקות בהתאם.{" "}
                <Link href="/properties" className="underline underline-offset-2">
                  חזרה לנכסים
                </Link>
              </>
            ) : (
              <>
                נשארו עוד {remaining}.{" "}
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={() => void load().catch(() => setError("הטעינה נכשלה."))}
                >
                  טענו את הבאים
                </button>
              </>
            )}
          </p>
        </div>
      ) : (
        <>
          <p className="mb-3 text-sm text-[var(--color-text-muted)]">
            נשארו {remaining} נכסים לבדיקה.
          </p>
          <div className="mv-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="mv-table w-full text-sm">
                <thead>
                  <tr className="text-right text-sm text-[var(--color-text-muted)]">
                    <th className="p-3">נכס</th>
                    <th className="p-3">פרטים</th>
                    <th className="p-3">מסומן היום</th>
                    <th className="p-3">התשובה</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-t border-[var(--color-border)]">
                      <td className="p-3">
                        <Link
                          href={`/properties/${row.id}`}
                          className="font-semibold underline-offset-2 hover:underline"
                        >
                          {addressOf(row)}
                        </Link>
                      </td>
                      <td className="p-3 text-[var(--color-text-muted)]">
                        {[
                          row.propertyType
                            ? PROPERTY_TYPE_LABELS[
                                row.propertyType as keyof typeof PROPERTY_TYPE_LABELS
                              ]
                            : null,
                          row.priceAgorot ? formatPrice(row.priceAgorot) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </td>
                      {/*
                        ‏מה שהמנוע קורא היום — כדי שהתשובה תהיה מודעת
                        למה שכבר קורה, ולא תיראה כשאלה על דף ריק.
                      */}
                      <td className="p-3">
                        {row.sharedTabu ? "משותף" : "לא משותף"}
                      </td>
                      <td className="p-3">
                        {mayAnswer ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={answering === row.id}
                              onClick={() => void answer(row.id, true)}
                            >
                              משותף
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={answering === row.id}
                              onClick={() => void answer(row.id, false)}
                            >
                              לא משותף
                            </Button>
                          </div>
                        ) : (
                          <span className="text-sm text-[var(--color-text-muted)]">
                            נדרשת הרשאת עריכה
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
