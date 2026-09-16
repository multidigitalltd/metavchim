"use client";

import { useCallback, useEffect, useState } from "react";
import { priceDropReofferMessage } from "@metavchim/shared";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { formatDate, formatPrice, waMeUrl } from "@/lib/format";
import { IconBanknote } from "../../icons";
import { Notice } from "../../notice";

/**
 * ‏„ירד המחיר — להציע שוב” (docs/03 — properties).
 *
 * ‏מוצג רק כשהמחיר ירד בחודש האחרון (הכרטיס מחליט לפי שדות הנכס,
 * ‏ולכן אין בקשה מיותרת בכל טעינה). הרשימה: מי שביקר ואמר „גבוה”
 * ‏ומי שדחה בגלל המחיר. „וואטסאפ” פותח הודעה מוכנה ורושם שפנו;
 * ‏השליחה עצמה נשארת בידי הסוכן.
 */

interface Candidate {
  buyerId: string;
  name: string;
  phone?: string;
  reasonLabels: string[];
  lastViewingAt: string | null;
  contactedAt: string | null;
}

interface ReofferResponse {
  drop: { fromAgorot: number; toAgorot: number; changedAt: string } | null;
  propertyLabel: string;
  candidates: Candidate[];
}

export function ReofferCard({ propertyId, canSend }: { propertyId: string; canSend: boolean }) {
  const [data, setData] = useState<ReofferResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    apiGet<ReofferResponse>(`/properties/${propertyId}/reoffer`)
      .then(setData)
      .catch(() => setFailed(true));
  }, [propertyId]);
  useEffect(load, [load]);

  if (failed) return <Notice tone="danger">רשימת הקונים להצעה חוזרת לא נטענה</Notice>;
  if (data === null || data.drop === null || data.candidates.length === 0) return null;
  const { drop, propertyLabel, candidates } = data;

  async function contacted(candidate: Candidate, openWhatsapp: boolean): Promise<void> {
    setBusy(candidate.buyerId);
    setError(null);
    /*
     * ‏החלון נפתח **לפני** הבקשה, בלחיצה עצמה — חוסם חלונות קופצים
     * ‏מתיר פתיחה רק בתוך אירוע הלחיצה (אותו דפוס כמו בשליחת הצעה).
     */
    const tab = openWhatsapp && candidate.phone !== undefined ? window.open("", "_blank") : null;
    try {
      if (tab !== null && candidate.phone !== undefined) {
        tab.location.href = waMeUrl(
          candidate.phone,
          priceDropReofferMessage({ name: candidate.name, propertyLabel, fromAgorot: drop!.fromAgorot, toAgorot: drop!.toAgorot }),
        );
      }
      const res = await apiPost<{ contactedAt: string }>(`/properties/${propertyId}/reoffer/${candidate.buyerId}`, {});
      setData((prev) =>
        prev === null
          ? prev
          : { ...prev, candidates: prev.candidates.map((c) => (c.buyerId === candidate.buyerId ? { ...c, contactedAt: res.contactedAt } : c)) },
      );
    } catch (err: unknown) {
      tab?.close();
      setError(err instanceof ApiError ? err.message : "הסימון נכשל");
    } finally {
      setBusy(null);
    }
  }

  const pending = candidates.filter((c) => c.contactedAt === null).length;

  return (
    <section className="mv-card mv-card--pad mb-4" aria-labelledby="reoffer-heading">
      <div className="mv-card-head mv-domain-green">
        <span className="mv-tile" aria-hidden="true"><IconBanknote s={19} /></span>
        <h2 id="reoffer-heading" className="mv-card-head__title m-0">ירד המחיר — להציע שוב</h2>
      </div>
      <p className="m-0 mb-3" style={{ color: "var(--color-text-soft)" }}>
        המחיר ירד מ-{formatPrice(drop.fromAgorot)} ל-{formatPrice(drop.toAgorot)} ב-{formatDate(drop.changedAt)}.{" "}
        {pending === 0
          ? "פנית לכל מי שאמר שהמחיר גבוה."
          : `${pending === 1 ? "קונה אחד" : `${pending} קונים`} שאמרו שהמחיר גבוה או דחו בגללו — הם הראשונים שכדאי לפנות אליהם.`}
      </p>
      {error !== null ? <Notice tone="danger">{error}</Notice> : null}
      <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="קונים להצעה חוזרת">
        {candidates.map((c) => (
          <li key={c.buyerId} className="flex flex-wrap items-center gap-2 rounded-xl border p-3" style={{ borderColor: "var(--color-border)" }}>
            <div className="min-w-0 flex-1">
              <p className="m-0 font-bold">{c.name}</p>
              <p className="m-0 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
                {c.reasonLabels.join(" · ")}
                {c.lastViewingAt !== null ? ` · ביקר ב-${formatDate(c.lastViewingAt)}` : ""}
              </p>
            </div>
            {c.contactedAt !== null ? (
              <span className="mv-pill mv-domain-green">פנית ב-{formatDate(c.contactedAt)}</span>
            ) : canSend ? (
              <>
                {c.phone !== undefined ? (
                  <button type="button" className="mv-btn-action" disabled={busy === c.buyerId} onClick={() => void contacted(c, true)}>
                    וואטסאפ עם הודעה מוכנה
                  </button>
                ) : null}
                <button type="button" className="mv-btn-plain" disabled={busy === c.buyerId} onClick={() => void contacted(c, false)}>
                  סמן שפניתי
                </button>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
