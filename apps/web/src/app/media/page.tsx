"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { MEDIA_OUTLET_KIND_LABEL, type MediaOutletKind } from "@metavchim/shared";
import { apiGet, apiList } from "@/lib/api";
import { formatPrice } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";
import { IconGlobe, IconList } from "../icons";
import { LoadError } from "../load-error";

/**
 * רכש מדיה — הארכיון.
 *
 * כרטיס לכל מדיה: מה היא, כמה היא מגיעה, ומאיפה המחירים מתחילים.
 * הלחיצה מובילה לעמוד הפנימי, ושם ההזמנה. הארכיון עצמו אינו מוכר
 * דבר — הוא אומר מה יש, ומי שרוצה נכנס.
 *
 * הקטלוג מגיע מהשרת ונערך במסך הפלטפורמה: מדיה חדשה מופיעה כאן
 * בלי פריסה.
 */

interface OutletCard {
  id: string;
  slug: string;
  name: string;
  kind: MediaOutletKind;
  tagline: string;
  reachText: string;
  frequency: string;
  productCount: number;
  priceFromAgorot: number | null;
  hasLeadProducts: boolean;
}

export default function MediaCatalogPage(): React.JSX.Element | null {
  const { loading } = useRequireAuth();
  const [items, setItems] = useState<OutletCard[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    setItems(null);
    apiGet<{ outlets: OutletCard[] }>("/media")
      .then((res) => setItems(apiList(res.outlets, "outlets")))
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    if (loading) return;
    load();
  }, [loading, load]);

  if (loading) return null;

  return (
    // div ולא main — העטיפה של AppShell היא ה-main landmark היחיד
    <div className="mv-page">
      <header className="mv-hero mb-5">
        <span className="mv-hero-icon" aria-hidden="true">
          <IconGlobe s={26} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-2xl font-extrabold">רכש מדיה</h1>
          <p className="m-0 mt-1" style={{ color: "var(--color-text-muted)" }}>
            פרסום הנכסים והמשרד במגוון מדיות — במקום אחד, בלי לרוץ בין ספקים.
            בוחרים מדיה, רואים מה כלול ומה החשיפה, ומזמינים.
          </p>
        </div>
        <Link href="/media/orders" className="mv-btn-plain shrink-0">
          <IconList s={15} /> ההזמנות שלנו
        </Link>
      </header>

      {failed ? (
        <LoadError message="לא הצלחנו לטעון את ארכיון המדיות" onRetry={load} />
      ) : items === null ? (
        <p aria-live="polite">טוען…</p>
      ) : items.length === 0 ? (
        <div className="mv-card mv-card--pad text-center">
          <p className="m-0 font-bold">עדיין אין מדיות בארכיון</p>
          <p className="m-0 mt-1" style={{ color: "var(--color-text-muted)" }}>
            המדיות הראשונות בדרך. כשיתווספו, הן יופיעו כאן.
          </p>
        </div>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
          {items.map((outlet) => (
            <li key={outlet.id} className="mv-card mv-card--pad flex flex-col">
              <span className="mv-pill mv-domain-blue self-start">
                {MEDIA_OUTLET_KIND_LABEL[outlet.kind] ?? outlet.kind}
              </span>
              <h2 className="m-0 mt-2 text-[length:var(--type-card-title)] font-extrabold leading-snug">
                <Link href={`/media/${outlet.slug}`} className="no-underline hover:underline">
                  {outlet.name}
                </Link>
              </h2>
              {outlet.tagline ? (
                <p className="m-0 mt-1.5 text-[length:var(--type-body-sm)]" style={{ color: "var(--color-text-soft)" }}>
                  {outlet.tagline}
                </p>
              ) : null}
              <dl className="m-0 mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[length:var(--type-body-sm)]">
                {outlet.reachText ? (
                  <>
                    <dt className="m-0 font-bold">חשיפה</dt>
                    <dd className="m-0">{outlet.reachText}</dd>
                  </>
                ) : null}
                {outlet.frequency ? (
                  <>
                    <dt className="m-0 font-bold">תדירות</dt>
                    <dd className="m-0">{outlet.frequency}</dd>
                  </>
                ) : null}
                <dt className="m-0 font-bold">מוצרים</dt>
                <dd className="m-0">
                  {outlet.productCount === 0
                    ? "טרם הוגדרו"
                    : outlet.priceFromAgorot === null
                      ? `${outlet.productCount} — לפי תיאום עם הנציג`
                      : `${outlet.productCount} — החל מ-${formatPrice(outlet.priceFromAgorot)} + מע"מ`}
                </dd>
              </dl>
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
                <Link href={`/media/${outlet.slug}`} className="mv-btn-soft">
                  לפרטים ולהזמנה
                </Link>
                {outlet.hasLeadProducts ? (
                  <span className="text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>
                    כולל פנייה לנציג
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
