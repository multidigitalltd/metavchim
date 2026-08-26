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
 * בשדות שחוסמים בפועל — ראו `matchGateMissing` — ולא באלה שהאפיון
 * ניחש.
 *
 * זו אינה סטייה מהעיצוב אלא ההפך: העיצוב ביקש לומר למתווך מה עוצר
 * אותו, וזה מה שבאמת עוצר אותו.
 */

/**
 * השדות שבלעדיהם **אף קונה אינו יכול להתאים** — לא „פחות התאמות”.
 *
 * שניים ממקורות שונים, ובכוונה יחד: המסך שואל „מה עוצר אותי”, ולא
 * „באיזו שכבה זה נחסם”.
 *
 * - ‎**עיר · מחיר · סוג עסקה** — `MatchingService.recompute` יוצא
 *   מוקדם בלעדיהם ואינו מחשב כלל.
 * - ‎**סוג הנכס** — החישוב כן רץ, אבל `property_type` הוא קריטריון
 *   חובה (`MANDATORY_MATCH_CRITERIA`), וכשהוא חסר בנכס הוא לעולם
 *   אינו נבחן — ולכן **כל** קונה מקבל ציון 0. התוצאה זהה: רשימה
 *   ריקה (ביקורת Codex).
 *
 * בלעדיו המסך הציע „הוסיפו קונה” — פעולה שאינה יכולה לפתור את מה
 * שהיא נקראה בשבילו, וזו בדיוק ההבטחה שהמסך הזה נועד לא לתת.
 */
export function matchGateMissing(property: {
  city?: string;
  priceAgorot?: number;
  dealType?: string;
  propertyType?: string;
}): string[] {
  const missing: string[] = [];
  if (property.city === undefined || property.city.trim() === "") missing.push("עיר");
  if (property.priceAgorot === undefined) missing.push("מחיר");
  if (property.dealType === undefined || property.dealType.trim() === "") {
    missing.push("סוג עסקה");
  }
  if (property.propertyType === undefined || property.propertyType.trim() === "") {
    missing.push("סוג הנכס");
  }
  return missing;
}

export function MatchesEmptyState({
  blocking,
  propertyId,
}: {
  blocking: string[];
  propertyId: string;
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
          {/*
            ‎`?edit=1` לא היה קיים: העמוד אינו קורא פרמטר כזה,
            והעריכה יושבת במסלול משלה. כלומר קישור שמבטיח פעולה
            ואינו עושה דבר — בדיוק מה שהמסך הזה נועד למנוע (ביקורת
            Codex). זה המסלול שכל שאר העמוד כבר משתמש בו.
          */}
          <Link
            href={`/properties/${propertyId}/edit`}
            className="underline"
            style={{ color: "inherit" }}
          >
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
