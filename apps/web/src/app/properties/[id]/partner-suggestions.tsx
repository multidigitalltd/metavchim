"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import { formatPrice } from "@/lib/format";

/**
 * ‎**שותפויות אפשריות — שני קונים על נכס אחד.**
 *
 * ‏נכס בטאבו משותף כבר רשום כחלקים בלתי מסוימים, ולכן שני קונים
 * ‏יכולים לקחת בו חלקים בלי לפצל דבר. זו עסקה שמתווך מנוסה בונה
 * ‏בראש כשהוא רואה שני לקוחות שאינם מגיעים לבד — והמערכת לא ידעה
 * ‏להציע אותה, כי מנוע ההתאמות שואל תמיד „קונה אחד מול נכס אחד”.
 *
 * ‏הרשימה כאן **זרה לרשימת ההתאמות**: מי שמגיע לבד מופיע שם ולא
 * ‏כאן. אין כפילות, ואין „אותו קונה בשתי המלצות סותרות”.
 *
 * ‏שני השותפים מוצגים בשמם — אחרת ההצעה חסרת משמעות. לכן השרת
 * ‏מסנן לפי בעלות **בשאילתה**: סוכן רואה שותפויות בין הלקוחות שלו
 * ‏בלבד, ומנהל רואה גם צמד שחוצה שני סוכנים. זו בדיוק ההצעה
 * ‏שהמנהל היחיד יכול לעשות.
 */

interface PartnerShare {
  buyerId: string;
  buyerName: string;
  budgetMaxAgorot: number;
  shareAgorot: number;
  score: number;
}

interface PartnerPair {
  score: number;
  explanation: string;
  combinedBudgetAgorot: number;
  headroomAgorot: number;
  partners: PartnerShare[];
}

export function PartnerSuggestions({ propertyId }: { propertyId: string }) {
  const [pairs, setPairs] = useState<PartnerPair[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    apiGet<PartnerPair[]>(`/matches/property/${propertyId}/partners`)
      .then((rows) => {
        if (live) setPairs(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [propertyId]);

  /*
   * ‎**טעינה אינה „אין”, וכישלון אינו „אין”.**
   *
   * ‏שלושת המצבים נאמרים במפורש: בזמן הטעינה אין כותרת בכלל (מקטע
   * ‏ריק שמופיע ונעלם הוא קפיצה במסך), כישלון נאמר במילים, ורשימה
   * ‏ריקה אומרת מה חסר כדי שתתמלא — כי „אין שותפויות” בלי הסבר
   * ‏נקרא כתקלה.
   */
  if (pairs === null && !failed) return null;

  return (
    <section className="mv-card mv-card--pad" aria-labelledby="partners-heading">
      <div className="mv-card-head">
        <h2 id="partners-heading" className="mv-card-head__title">
          שותפויות אפשריות
        </h2>
        {failed || pairs === null ? null : (
          <span className="mv-pill ms-auto" style={{ fontWeight: 800 }}>
            {pairs.length}
          </span>
        )}
      </div>

      {failed ? (
        <p className="m-0" style={{ fontSize: "var(--type-body-sm)", color: "var(--color-danger)" }}>
          טעינת השותפויות נכשלה — רעננו את העמוד.
        </p>
      ) : pairs!.length === 0 ? (
        <p className="m-0" style={{ fontSize: "var(--type-body-sm)", color: "var(--color-muted)" }}>
          אין כרגע שני לקוחות שיחד מגיעים למחיר. נכנסים לכאן רק מי שסימנתם שהוא
          מוכן לטאבו משותף, שיש לו תקציב מוצהר, ושהנכס מתאים לו בשאר הדרישות.
        </p>
      ) : (
        <ul className="m-0 list-none p-0" style={{ display: "grid", gap: "0.75rem" }}>
          {pairs!.map((pair) => (
            <li
              key={pair.partners.map((p) => p.buyerId).join("+")}
              className="rounded-xl border p-3"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="mv-pill" style={{ fontWeight: 800 }}>
                  {pair.score}%
                </span>
                <span style={{ fontSize: "var(--type-body-sm)", color: "var(--color-muted)" }}>
                  יחד {formatPrice(pair.combinedBudgetAgorot)}
                </span>
              </div>
              <div style={{ display: "grid", gap: "0.4rem" }}>
                {pair.partners.map((partner) => (
                  <div
                    key={partner.buyerId}
                    className="flex flex-wrap items-baseline justify-between gap-2"
                  >
                    <Link href={`/buyers/${partner.buyerId}`} style={{ fontWeight: 700 }}>
                      {partner.buyerName}
                    </Link>
                    {/*
                      ‏החלק שלו ותקציבו זה לצד זה, ובכוונה: המספר
                      ‏הראשון הוא מה שמבקשים ממנו, השני הוא מה שהוא
                      ‏אמר שיש לו, וההפרש ביניהם הוא כל השיחה.
                    */}
                    <span style={{ fontSize: "var(--type-body-sm)" }}>
                      חלקו {formatPrice(partner.shareAgorot)}
                      <span style={{ color: "var(--color-muted)" }}>
                        {" "}
                        · מתוך תקציב {formatPrice(partner.budgetMaxAgorot)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
              <p
                className="mb-0 mt-2"
                style={{ fontSize: "var(--type-body-sm)", color: "var(--color-muted)" }}
              >
                {pair.explanation}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
