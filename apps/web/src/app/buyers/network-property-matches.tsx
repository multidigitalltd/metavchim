"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_COMMISSION_SPLIT,
  presentationChips,
  publisherStatedSplit,
  type CommissionTerms,
} from "@metavchim/shared";
import { ApiError, apiGet, apiList, apiPatch, apiPost } from "@/lib/api";
import { NetChips } from "../collaboration/net-chips";
import { IconHandshake, IconHome } from "../icons";
import { Notice } from "../notice";

/**
 * העמודה השנייה בכרטיס הקונה: **נכסים מהרשת**.
 *
 * העמודה הפנימית עונה "מה יש לי במאגר בשביל הקונה הזה". זו עונה על
 * אותה שאלה מהצד השני של הרשת, ובשני חלקים:
 *
 * ‎1. ‏**התאמות** — נכסים שמשרדים אחרים פרסמו ומנוע ההתאמות מצא
 * ‏   שמתאימים לקונה הזה. אלה לא היו כאן כלל: המסך הראה רק את מה
 * ‏   שמישהו אחר טרח לשלוח, בעוד שמאות נכסים מתאימים יושבים בפיד
 * ‏   ואיש אינו רואה אותם מהמקום שבו שואלים „מה יש לקונה הזה”
 * ‏   (בקשת המשתמש).
 * ‎2. ‏**הצעות שהתקבלו** — נכסים שמשרד אחר שלח יזומה על הביקוש הזה.
 *
 * ‎**ההתאמות מוצגות גם כשהקונה אינו מפורסם ברשת.** הפיד הוא קטלוג
 * ‏פתוח, וצפייה בו אינה חושפת דבר על הקונה — שום בקשה אינה יוצאת עד
 * ‏שלוחצים „מעוניין”. „הקונה אינו משותף, אין מה להראות” הסתיר בדיוק
 * ‏את מה שהיה משכנע לפרסם, ולכן במקומו יש עכשיו את הנכסים עצמם
 * ‏וכפתור פרסום לידם.
 *
 * מה שמוצג הוא החשיפה המדורגת בלבד — כל מה שאינו מזהה: אזור, סוג,
 * חדרים, שטח, קומה, מצב, מחיר ומועד כניסה. בלי רחוב ובלי בעלים;
 * אלה נחשפים רק אחרי "מעוניין", וזה צעד שקשה לחזור ממנו — ולכן כל
 * השאר צריך להיות ידוע לפניו.
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

/** ‏נכס מהרשת שהמנוע מצא מתאים לקונה הזה — שורת „התאמה”. */
interface ListingMatch {
  id: string;
  title?: string;
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
  officeName?: string;
  terms: CommissionTerms;
  commissionSplit: number;
  /** ‏רשומה אחת — הקונה שנשאל עליו. ראו `matchesForBuyer` בשרת. */
  myMatches?: { buyerId: string; name: string; score: number; explanation: string }[];
  interestSent?: boolean;
}

export function NetworkPropertyMatches({
  buyerId,
  onPublish,
}: {
  buyerId: string;
  /**
   * ‎**מעביר ללשונית הרשת, ולא מפרסם כאן.**
   *
   * ‏הפרסום דורש חלוקת עמלה לכל צד ותיאור חובה — טופס שלם שכבר חי
   * ‏ב-`NetworkShareSection`. עותק שני שלו כאן היה נפרד ממנו בעדכון
   * ‏הראשון, ואז אותה פעולה הייתה נראית אחרת בשני מקומות.
   */
  onPublish?: () => void;
}) {
  const [data, setData] = useState<{
    shared: boolean;
    offers: NetworkPropertyOffer[];
  } | null>(null);
  const [matches, setMatches] = useState<ListingMatch[] | null>(null);
  /**
   * ‏שתי הרשאות נפרדות, ולכן שני דגלים: ההצעות שהתקבלו הן תוצאה של
   * ‏פרסום הקונה (`collaboration.share`), וההתאמות הן קריאה מהפיד
   * ‏(`collaboration.offer`). דגל אחד היה מסתיר את שניהם כשחסרה
   * ‏אחת — כלומר מעלים חלק שהמשתמש דווקא רשאי לראות.
   */
  const [offersAllowed, setOffersAllowed] = useState(true);
  const [matchesAllowed, setMatchesAllowed] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ shared: boolean; offers: NetworkPropertyOffer[] }>(
      `/collaboration/network-matches/buyer/${buyerId}`,
    )
      .then((res) => setData({ shared: res.shared === true, offers: apiList(res.offers, "offers") }))
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 403) setOffersAllowed(false);
        else setData({ shared: false, offers: [] });
      });
  }, [buyerId]);

  const loadMatches = useCallback(() => {
    apiGet<ListingMatch[]>(`/collaboration/listings/buyer/${buyerId}`)
      .then((res) => setMatches(apiList(res, "listings")))
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 403) setMatchesAllowed(false);
        else setMatches([]);
      });
  }, [buyerId]);

  useEffect(loadMatches, [loadMatches]);

  /**
   * „יש לי קונה לנכס הזה” — אותה פעולה בדיוק שבפיד השת"פ.
   *
   * חלוקת העמלה נגזרת מ-`publisherStatedSplit` ולא מ-`commissionSplit`
   * שלידו: הכותרת נופלת לברירת מחדל כשהמפרסם הצהיר חלוקה נפרדת לכל
   * צד, וזה הכלל בכל שאר המסכים.
   */
  async function express(listing: ListingMatch): Promise<void> {
    setBusy(listing.id);
    setError(null);
    try {
      await apiPost(`/collaboration/listings/${listing.id}/interest`, {
        buyerId,
        commissionSplit:
          publisherStatedSplit(listing.terms, "property") ?? DEFAULT_COMMISSION_SPLIT,
      });
      setNote("✓ הפנייה נשלחה. אם המשרד השני יתעניין — תקבלו התראה.");
      loadMatches();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שליחת הפנייה נכשלה");
    } finally {
      setBusy(null);
    }
  }

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

  /*
   * ‎**`min-w-[220px]` ו-`items-start` — שניהם התגלו ברינדור, לא
   * ‏בבדיקה.**
   *
   * ‏השורה היא `flex-wrap`, והטקסט היה `min-w-0` — כלומר מוכן
   * ‏להצטמצם לכל רוחב. במסך טלפון הכפתור לקח את שלו והטקסט נדחס
   * ‏לעמודה של שלוש מילים, כך שכל שורה נשברה. רוחב מינימלי הופך את
   * ‏הגלישה לכפתור שיורד שורה מתחת — מה שהוא צריך לעשות שם ממילא.
   *
   * ‎`items-start` הוא הצד השני של אותו דבר: משהוסף ניקוד והסבר,
   * ‏השורה גבוהה משלוש שורות, ו-`items-center` השאיר את הכפתור
   * ‏תלוי באמצע בלי קשר לכותרת שהוא שייך לה.
   */
  /* ‏שתי ההרשאות חסרות — אין בעמודה הזו דבר להראות */
  if (!offersAllowed && !matchesAllowed) return null;

  return (
    <section
      className="mv-list-card px-[22px] py-[18px]"
      aria-labelledby="network-offers-heading"
    >
      <h2
        id="network-offers-heading"
        className="m-0 mb-1"
        style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}
      >
        <IconHome s={16} /> נכסים מהרשת
      </h2>
      <p
        className="m-0 mb-2.5 text-[length:var(--type-caption)]"
        style={{ color: "var(--color-text-muted)" }}
      >
        נכסים שמשרדים אחרים פרסמו ומתאימים לקונה הזה
      </p>

      {error !== null ? <Notice tone="danger">{error}</Notice> : null}
      {note !== null ? <Notice tone="success">{note}</Notice> : null}

      {/*
        ‎**ההזמנה לפרסם יושבת מעל ההתאמות, לא במקומן.**

        ‏עד כה „הקונה אינו משותף” היה כל מה שהמסך אמר, וההתאמות לא
        ‏חושבו בכלל. עכשיו הן מוצגות בכל מקרה, וההזמנה היא שורה אחת
        ‏מעליהן: מי שרואה ארבעה נכסים מתאימים ומתחתם „פרסמו את הקונה
        ‏כדי שגם הם יפנו אליכם” מקבל סיבה לפרסם, ולא רק בקשה.
      */}
      {data !== null && !data.shared && offersAllowed ? (
        <div
          className="mb-3 flex flex-wrap items-center gap-2.5 rounded-[10px] px-3 py-2.5"
          style={{ background: "var(--color-primary-soft)" }}
        >
          <span className="min-w-[220px] flex-1 text-[length:var(--type-caption-lg)]">
            הקונה אינו מפורסם ברשת. פרסום פותח את הביקוש למשרדים אחרים — ואז גם
            הם פונים אליכם עם נכסים.
          </span>
          {onPublish === undefined ? null : (
            <button
              type="button"
              className="mv-btn-action flex-none"
              style={{ padding: "7px 15px", fontSize: "var(--type-caption-lg)" }}
              onClick={onPublish}
            >
              פרסם קונה ברשת
            </button>
          )}
        </div>
      ) : null}

      {/* ‏ההתאמות — מה שיש ברשת לקונה הזה, בלי תלות בפרסום */}
      {!matchesAllowed ? null : matches === null ? (
        <p aria-live="polite">מחפש ברשת…</p>
      ) : matches.length === 0 ? (
        <p className="m-0 py-2" style={{ color: "var(--color-text-muted)" }}>
          אין כרגע נכסים ברשת שמתאימים לדרישות של הקונה.
        </p>
      ) : (
        matches.map((listing) => {
          const match = listing.myMatches?.[0];
          return (
            <div
              key={listing.id}
              className="flex flex-wrap items-start gap-[15px] py-[13px]"
              style={{ borderBottom: "1px solid var(--color-row-border)" }}
            >
              <div className="min-w-[220px] flex-1" style={{ lineHeight: 1.4 }}>
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-[length:var(--type-body)] font-bold">
                    {listing.title ?? "נכס ברשת"}
                  </span>
                  {match === undefined ? null : (
                    <span
                      className="mv-pill"
                      style={{
                        background: "var(--color-primary-soft)",
                        color: "var(--color-primary)",
                      }}
                    >
                      {match.score}% התאמה
                    </span>
                  )}
                </div>
                {/* ‏כל מה שאינו מזהה — לפני אישור החיבור, לא אחריו */}
                <NetChips chips={presentationChips(listing)} />
                <div
                  className="text-[length:var(--type-caption)]"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  <IconHandshake s={13} /> העמלה שלי{" "}
                  {100 - (publisherStatedSplit(listing.terms, "property") ?? listing.commissionSplit)}
                  %
                  {listing.officeName === undefined ? null : ` · ${listing.officeName}`}
                </div>
                {match === undefined ? null : (
                  <div
                    className="text-[length:var(--type-caption)]"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    {match.explanation}
                  </div>
                )}
              </div>
              <div className="ms-auto flex flex-none gap-2">
                {listing.interestSent === true ? (
                  <span
                    className="mv-pill"
                    style={{
                      background: "var(--color-progress-track)",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    הפנייה נשלחה
                  </span>
                ) : (
                  <button
                    type="button"
                    className="mv-btn-action"
                    style={{ padding: "7px 15px", fontSize: "var(--type-caption-lg)" }}
                    disabled={busy !== null}
                    onClick={() => void express(listing)}
                  >
                    יש לי קונה לנכס הזה
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}

      {/* ‏הצעות יזומות שמשרד אחר שלח על הביקוש הזה */}
      {!offersAllowed || data === null || !data.shared || data.offers.length === 0 ? null : (
        <>
          <h3
            className="mb-1 mt-4 text-[length:var(--type-caption-lg)]"
            style={{ fontWeight: 800 }}
          >
            הצעות שהתקבלו
          </h3>
          {
        data.offers.map((offer) => (
          <div
            key={offer.id}
            className="flex flex-wrap items-start gap-[15px] py-[13px]"
            style={{ borderBottom: "1px solid var(--color-row-border)" }}
          >
            <div className="min-w-[220px] flex-1" style={{ lineHeight: 1.4 }}>
              <div className="mb-1.5 text-[length:var(--type-body)] font-bold">
                {offer.presentation.title ?? "נכס ברשת"}
              </div>
              {/* כל מה שאינו מזהה — לפני אישור החיבור, לא אחריו */}
              <NetChips chips={presentationChips(offer.presentation)} />
              <div
                className="text-[length:var(--type-caption)]"
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
                    style={{ padding: "7px 15px", fontSize: "var(--type-caption-lg)" }}
                    disabled={busy !== null}
                    onClick={() => void respond(offer.id, "interested")}
                  >
                    מעוניין
                  </button>
                  <button
                    type="button"
                    className="mv-btn-plain"
                    style={{ fontSize: "var(--type-caption-lg)" }}
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
        ))}
        </>
      )}
    </section>
  );
}
