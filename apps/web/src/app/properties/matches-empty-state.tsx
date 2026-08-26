import Link from "next/link";
import {
  MANDATORY_MATCH_CRITERIA,
  MATCH_CRITERION_LABELS,
  type MatchCriterion,
} from "@metavchim/shared";

/**
 * ‎**המצב הריק של לשונית ההתאמות (SPEC-4a §1).**
 *
 * ## האזהרה, ולמה היא מנוסחת כך ולא כפי שהאפיון ביקש
 *
 * האפיון מבקש הודעת ענבר כשחסרים **מחיר או שטח**, שאומרת שהנכס
 * אינו נכנס לחישוב ההתאמות עד שימולאו. בדקתי את שני החצאים, ואף
 * אחד מהם אינו נכון כפי שנוסח:
 *
 * - ‎**שטח אינו חוסם כלל.** הוא שוקל `0.05`, והמנוע אומר במפורש
 *   שהיעדרו אינו גורע מהציון.
 * - ‎**מחיר חוסם רק כיוון אחד.** הנכס אינו מחשב מצדו, אבל קונה
 *   בלי תקציב מתאים לו מצוין — ולכן „לא ייכנס לחישוב” הוא שקר.
 *
 * הודעה שאומרת „מלאו שטח כדי שיהיו התאמות” הייתה שולחת את המתווך
 * למלא שדה שלא ישנה דבר; הודעה שאומרת „הנכס מחוץ למשחק” על נכס
 * שהתאמות כן נוצרות עליו גרועה מכך — היא גם שקרית וגם מסתירה את
 * רצועת הרשת, שהיא הפעולה המועילה שם.
 *
 * לכן **שתי** הודעות בשני טונים: חוסם אמיתי, ומגבלה של כיוון אחד.
 * העיצוב ביקש לומר למתווך מה עוצר אותו — וזה מה שבאמת עוצר, בדיוק
 * במידה שבה הוא עוצר.
 */

/**
 * ‎**מה שבאמת מונע כל התאמה — ומה שרק מונע אותה מצד הנכס.**
 *
 * ## הטעות שהייתה כאן
 *
 * הרשימה נבנתה מהיציאה המוקדמת ב-`MatchingService.recomputeForProperty`,
 * שיוצאת בלי **עיר, מחיר או סוג עסקה**. קראתי אותה כ„הנכס אינו
 * נכנס לחישוב”, והיא אומרת דבר צר יותר: „לא מחשבים **כאן**”.
 *
 * יש כיוון שני. `recomputeForBuyer` בוחר מועמדים דרך תיבה תוחמת
 * סביב אזורי החיפוש של הקונה, ולכן **נכס עם קואורדינטות ובלי עיר
 * נבחר ומנוקד** — `scoreMatch` בוחן אותו במסלול המפה. וקונה בלי
 * תקציב אינו מוסיף תנאי מחיר כלל, ולכן **נכס בלי מחיר מתאים לו**
 * וסף הכיסוי נעבר בלי קריטריון התקציב (ביקורת Codex).
 *
 * כלומר האזהרה טענה שהנכס מחוץ למשחק, בזמן שהתאמות אמיתיות כן
 * נוצרות עליו — והיא גם הסתירה את רצועת הרשת, שהיא בדיוק הפעולה
 * המועילה במצב הזה.
 *
 * ‎**וזה כתוב בקוד שממנו בניתי את הרשימה**, שתי פסקאות מעל היציאה:
 * „‎‏„אי אפשר לחשב כאן” אינו „אין מיקום”. שתי שאלות נפרדות”. קראתי
 * את התנאי ולא את האזהרה שמעליו.
 *
 * ## ולכן שתי רשימות, ולא אחת
 */

/**
 * חוסמים **אמיתיים** — בלעדיהם אף התאמה אינה יכולה להיווצר, משום
 * כיוון.
 *
 * ‎**החלק הגדול נגזר ואינו נכתב ביד.** קריטריון חובה שהנכס אינו
 * מסוגל לו פירושו ציון 0 לכל קונה, ולכן ההתאמה אינה נשמרת — משני
 * הכיוונים. `propertyEvaluableCriteria` עונה על „מסוגל”, ו-
 * ‎`MANDATORY_MATCH_CRITERIA` על „חובה”; שניהם מהמנוע.
 *
 * זה מחליף שתיים מארבע השורות שהיו כאן ביד, וסוגר את הפער שהיה
 * מפורש ב-PR: רשימה שלישית שמסכימה עם אחרות בקריאה בלבד.
 *
 * ‎**סוג העסקה נשאר ידני, ואומר למה.** הוא אינו קריטריון ניקוד
 * אלא תנאי בחירה — שתי השאילתות מסננות לפיו, ולכן נכס בלעדיו לא
 * ייבחר כמועמד בשום כיוון. אין לו ביטוי במנוע שאפשר לגזור ממנו.
 */
export function matchGateMissing(
  property: { dealType?: string },
  evaluable: ReadonlySet<MatchCriterion>,
): string[] {
  const missing = MANDATORY_MATCH_CRITERIA.filter((c) => !evaluable.has(c)).map(
    (c) => MATCH_CRITERION_LABELS[c],
  );
  if (property.dealType === undefined || property.dealType.trim() === "") {
    missing.push("סוג עסקה");
  }
  return missing;
}

/**
 * ‎**מגבלה של כיוון אחד** — הנכס אינו מחשב התאמות מצדו, אך התאמות
 * כן ייווצרו כשקונה מתאים ייכנס למאגר.
 *
 * זה אינו „חסר” ואינו אזהרה אדומה. זו עובדה על **מתי** ההתאמות
 * יופיעו, והניסוח נבדל מזה של החוסמים בכוונה: מתווך שמקבל את שתי
 * ההודעות באותו טון יתייחס לשתיהן כאל אותה דחיפות, ואינן.
 *
 * העיר נספרת כאן רק כשיש קואורדינטות — בלעדיהן היעדרה הוא חוסם
 * אמיתי, והוא כבר נאמר למעלה דרך קריטריון המיקום.
 */
export function propertySideOnlyMissing(property: {
  city?: string;
  latitude?: number;
  priceAgorot?: number;
}): string[] {
  const missing: string[] = [];
  if (
    (property.city === undefined || property.city.trim() === "") &&
    property.latitude !== undefined
  ) {
    missing.push("עיר");
  }
  if (property.priceAgorot === undefined) missing.push("מחיר");
  return missing;
}

export function MatchesEmptyState({
  blocking,
  oneSided,
  propertyId,
}: {
  /** חוסמים אמיתיים — בלעדיהם אף התאמה אינה נוצרת. */
  blocking: string[];
  /** חסר רק לחישוב מצד הנכס; התאמות עדיין ייווצרו מצד הקונה. */
  oneSided: string[];
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
          <Link
            href={`/properties/${propertyId}/edit`}
            className="underline"
            style={{ color: "inherit" }}
          >
            להשלמת הפרטים
          </Link>
        </div>
      ) : null}

      {/*
        ‎**טון אחר, כי זו אמירה אחרת.** אפור ולא ענבר: לא נעשה כאן
        דבר שגוי, ואין דחיפות. ההודעה אומרת **מתי** יופיעו התאמות,
        לא שהן חסומות — ומתווך שיקבל את שתיהן באותו צבע יתייחס
        לשתיהן כאל אותה דחיפות.
      */}
      {oneSided.length > 0 ? (
        <div
          className="mb-3 rounded-xl px-3.5 py-2.5 text-[length:var(--type-body-sm)]"
          style={{ background: "#F1F3EF", border: "1px solid #DCE1D8", color: "#5E6860" }}
        >
          <b>{oneSided.join(" · ")}</b> — בלעדיהם הנכס אינו מחפש קונים מיוזמתו, אבל
          התאמה עדיין תיווצר כשקונה מתאים ייכנס למאגר.{" "}
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
