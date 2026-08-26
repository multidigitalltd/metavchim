import Link from "next/link";

/**
 * ‎**המצב הריק של לשונית ההתאמות (SPEC-4a §1).**
 *
 * ## האזהרה, ולמה היא מנוסחת כך ולא כפי שהאפיון ביקש
 *
 * האפיון מבקש הודעת ענבר כשחסרים **מחיר או שטח**, שאומרת שהנכס אינו
 * נכנס לחישוב ההתאמות עד שימולאו. חצי מזה נכון, ובדקתי את שני
 * החצאים בקוד:
 *
 * - ‎**מחיר — נכון.** `MatchingService.recompute` יוצא מוקדם כשחסר
 *   מחיר, ולצדו גם **עיר** ו**סוג עסקה**. שלושתם באמת חוסמים.
 * - ‎**שטח — לא נכון.** הוא שוקל `0.05`, והמנוע אומר במפורש שנכס
 *   בלי שטח אינו גורע מהציון. הוא אינו חוסם דבר.
 *
 * הודעה שאומרת „מלאו שטח כדי שיהיו התאמות” הייתה שולחת את המתווך
 * למלא שדה שלא ישנה דבר, ואז לתהות למה לא קרה כלום. לכן היא נוקבת
 * בשלושת השדות שחוסמים בפועל — ולא באלה שהאפיון ניחש.
 *
 * זו אינה סטייה מהעיצוב אלא ההפך: העיצוב ביקש לומר למתווך מה עוצר
 * אותו, וזה מה שבאמת עוצר אותו.
 */

/** שם השדה החסר, אם הוא אחד משלושת אלה שחוסמים את החישוב. */
export function matchGateMissing(property: {
  city?: string;
  priceAgorot?: number;
  dealType?: string;
}): string[] {
  const missing: string[] = [];
  if (property.city === undefined || property.city.trim() === "") missing.push("עיר");
  if (property.priceAgorot === undefined) missing.push("מחיר");
  if (property.dealType === undefined || property.dealType.trim() === "") {
    missing.push("סוג עסקה");
  }
  return missing;
}

export function MatchesEmptyState({
  blocking,
}: {
  blocking: string[];
}): React.JSX.Element {
  return (
    <div className="py-2">
      <h3
        className="m-0 mb-1.5 text-[length:var(--type-title-sm)]"
        style={{ fontWeight: 900, letterSpacing: "-0.025em" }}
      >
        אין עדיין קונים מתאימים
      </h3>
      <p
        className="m-0 mb-3 text-[length:var(--type-body-sm)]"
        style={{ color: "var(--color-text-muted)" }}
      >
        הוסיפו קונה למאגר — וההתאמות יחושבו אוטומטית, בלי לחפש ידנית.
      </p>

      {blocking.length > 0 ? (
        <div
          className="mb-3 rounded-xl px-3.5 py-2.5 text-[length:var(--type-body-sm)]"
          style={{ background: "#FDF3DE", border: "1px solid #EFD79B", color: "#79541A" }}
        >
          {/*
            הניסוח נוקב בשדות ומיד אחריהם בתוצאה, ולא להפך: מתווך
            שקורא „הנכס אינו נכנס לחישוב” ומחפש למה, כבר איבד את
            השורה.
          */}
          <b>{blocking.join(" · ")}</b> — עד שאלה מלאים הנכס אינו נכנס לחישוב ההתאמות.{" "}
          <Link href="?edit=1" className="underline" style={{ color: "inherit" }}>
            להשלמת הפרטים
          </Link>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Link href="/buyers/new" className="mv-btn-action no-underline">
          הוספת קונה
        </Link>
        <Link href="/import" className="mv-btn-plain no-underline">
          ייבוא קונים
        </Link>
      </div>
    </div>
  );
}
