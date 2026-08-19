"use client";

import { useEffect, useState } from "react";
import { presentationChips } from "@metavchim/shared";
import { ApiError, apiGet, apiPatch } from "@/lib/api";
import { NetChips } from "../collaboration/net-chips";
import { IconHandshake, IconHome } from "../icons";

/**
 * העמודה השנייה בכרטיס הקונה: **נכסים מהרשת**.
 *
 * העמודה הפנימית עונה "מה יש לי במאגר בשביל הקונה הזה". זו עונה על
 * אותה שאלה מהצד השני של הרשת — נכסים שמשרדים אחרים הציעו על הביקוש
 * הזה. עד כה ההצעות נחתו רק במסך השת"פ הכללי, כלומר הסוכן שפתח את
 * כרטיס הקונה לא ראה שמחכה לו שם נכס, ושילם על זה בזמן תגובה.
 *
 * מה שמוצג הוא החשיפה המדורגת שהמשרד המציע שלח — כל מה שאינו מזהה:
 * אזור, סוג, חדרים, שטח, קומה, מצב, מחיר ומועד כניסה. בלי רחוב ובלי
 * בעלים; אלה נחשפים רק אחרי "מעוניין", וזה צעד שקשה לחזור ממנו —
 * ולכן כל השאר צריך להיות ידוע לפניו.
 */

interface NetworkPropertyOffer {
  id: string;
  presentation: {
    city?: string;
    neighborhood?: string;
    propertyType?: string;
    dealType?: string;
    rooms?: number;
    areaSqm?: number;
    floor?: number;
    totalFloors?: number;
    condition?: string;
    priceAgorot?: number;
    entryType?: string;
    entryDate?: string;
    features?: string[];
    title?: string;
  };
  commissionSplit: number;
  status: string;
  createdAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  // "sent" ולא "pending" — זה הערך שהשרת כותב בפועל
  // (`CoopOffer.status` ברירת מחדל). ההנחה השגויה הסתירה את כפתורי
  // התגובה לחלוטין: הם נבדקו מול ערך שלא קיים.
  sent: "ממתין לתגובה",
  interested: "סומן כמעניין",
  declined: "נדחה",
};

export function NetworkPropertyMatches({ buyerId }: { buyerId: string }) {
  const [data, setData] = useState<{
    shared: boolean;
    offers: NetworkPropertyOffer[];
  } | null>(null);
  /** null = אין הרשאת שת"פ; העמודה נעלמת ולא מציגה שגיאה */
  const [allowed, setAllowed] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ shared: boolean; offers: NetworkPropertyOffer[] }>(
      `/collaboration/network-matches/buyer/${buyerId}`,
    )
      .then(setData)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 403) setAllowed(false);
        else setData({ shared: false, offers: [] });
      });
  }, [buyerId]);

  async function respond(
    id: string,
    response: "interested" | "declined",
  ): Promise<void> {
    setBusy(id);
    setError(null);
    try {
      await apiPatch(`/collaboration/offers/${id}/respond`, { response });
      setData((prev) =>
        prev === null
          ? null
          : {
              ...prev,
              offers: prev.offers.map((o) =>
                o.id === id ? { ...o, status: response } : o,
              ),
            },
      );
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "העדכון נכשל");
    } finally {
      setBusy(null);
    }
  }

  if (!allowed) return null;

  return (
    <section
      className="mv-list-card px-[22px] py-[18px]"
      aria-labelledby="network-offers-heading"
    >
      <h2
        id="network-offers-heading"
        className="m-0 mb-1"
        style={{ fontSize: 16.5, fontWeight: 800 }}
      >
        <IconHome s={16} /> נכסים מהרשת
      </h2>
      <p
        className="m-0 mb-2.5 text-[14px]"
        style={{ color: "var(--color-text-muted)" }}
      >
        נכסים שמשרדים אחרים הציעו על הביקוש הזה
      </p>

      {error !== null ? (
        <p
          role="alert"
          className="m-0 mb-2 text-sm"
          style={{ color: "var(--color-danger)" }}
        >
          {error}
        </p>
      ) : null}

      {data === null ? (
        <p aria-live="polite">בודק ברשת…</p>
      ) : !data.shared ? (
        <p className="m-0 py-2" style={{ color: "var(--color-text-muted)" }}>
          הקונה אינו משותף ברשת — שיתוף פותח את הביקוש למשרדים אחרים, והנכסים
          שלהם יופיעו כאן.
        </p>
      ) : data.offers.length === 0 ? (
        <p className="m-0 py-2" style={{ color: "var(--color-text-muted)" }}>
          הביקוש פורסם; טרם התקבלו הצעות.
        </p>
      ) : (
        data.offers.map((offer) => (
          <div
            key={offer.id}
            className="flex flex-wrap items-center gap-[15px] py-[13px]"
            style={{ borderBottom: "1px solid var(--color-row-border)" }}
          >
            <div className="min-w-0 flex-1" style={{ lineHeight: 1.4 }}>
              <div className="mb-1.5 text-[15.5px] font-bold">
                {offer.presentation.title ?? "נכס ברשת"}
              </div>
              {/* כל מה שאינו מזהה — לפני אישור החיבור, לא אחריו */}
              <NetChips chips={presentationChips(offer.presentation)} />
              <div
                className="text-[14px]"
                style={{ color: "var(--color-text-muted)" }}
              >
                <IconHandshake s={13} /> העמלה שלי {100 - offer.commissionSplit}
                %
              </div>
            </div>
            <div className="ms-auto flex flex-none gap-2">
              {offer.status === "sent" ? (
                <>
                  <button
                    type="button"
                    className="mv-btn-action"
                    style={{ padding: "7px 15px", fontSize: 14.5 }}
                    disabled={busy !== null}
                    onClick={() => void respond(offer.id, "interested")}
                  >
                    מעוניין
                  </button>
                  <button
                    type="button"
                    className="mv-btn-plain"
                    style={{ fontSize: 14.5 }}
                    disabled={busy !== null}
                    onClick={() => void respond(offer.id, "declined")}
                  >
                    לא מתאים
                  </button>
                </>
              ) : (
                <span
                  className="mv-pill"
                  style={{
                    background:
                      offer.status === "interested"
                        ? "var(--color-primary-soft)"
                        : "var(--color-progress-track)",
                    color:
                      offer.status === "interested"
                        ? "var(--color-primary)"
                        : "var(--color-text-muted)",
                  }}
                >
                  {STATUS_LABELS[offer.status] ?? offer.status}
                </span>
              )}
            </div>
          </div>
        ))
      )}
    </section>
  );
}
