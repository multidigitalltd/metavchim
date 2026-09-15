"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { formatPrice } from "@/lib/format";

/**
 * ‎**המחיר למ״ר של הנכס, מול הממוצע בשכונה ובעיר.**
 *
 * ## ‏למה השוואה ולא רק מספר
 *
 * ‎„26,500 ₪ למ״ר” לבדו אינו תשובה: השאלה היא **„זה יקר או זול
 * ‏כאן”**, ובלי אמת מידה המתווך עונה עליה מהזיכרון. המשרד מחזיק
 * ‏את התשובה בנכסים של עצמו, והמסך פשוט לא שאל אותה.
 *
 * ## ‏למה השכונה לפני העיר
 *
 * ‏זו ההשוואה שמתווך באמת עושה. „הממוצע בתל אביב” אינו אומר דבר
 * ‏על נכס בשכונה מסוימת בה, ומי שרואה את השניים זה לצד זה קורא
 * ‏קודם את הקרוב.
 *
 * ## ‏למה „על N נכסים” נאמר תמיד
 *
 * ‏ממוצע הוא מספר שנשמע מוחלט. הכמות היא מה שהופכת אותו לניתן
 * ‏לשיפוט — ממוצע על שלושה נכסים וממוצע על ארבעים אינם אותו דבר,
 * ‏ומי שלא רואה את ההבדל מתמחר לפי שניהם באותו ביטחון. השרת כבר
 * ‏אינו מחזיר ממוצע מתחת לסף, ומה שנשאר נמסר במלואו.
 */

interface Benchmark {
  avgPerSqmAgorot: number;
  count: number;
  label: string;
  /** ‏חיובי = הנכס יקר מהממוצע. `null` = אין לנכס מחיר למ״ר. */
  gapPercent: number | null;
}

interface BenchmarkResponse {
  perSqmAgorot: number | null;
  neighborhood: Benchmark | null;
  city: Benchmark | null;
}

export function PriceBenchmark({ propertyId }: { propertyId: string }) {
  const [data, setData] = useState<BenchmarkResponse | null>(null);

  useEffect(() => {
    let live = true;
    apiGet<BenchmarkResponse>(`/properties/${propertyId}/price-benchmark`)
      .then((row) => {
        if (live) setData(row);
      })
      /*
       * ‏כישלון אינו מוצג. זו הרחבה של מספר שכבר מופיע בכותרת, ולא
       * ‏נתון שחסרונו משנה החלטה — שורת שגיאה עליו הייתה רעש.
       */
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [propertyId]);

  const rows = [data?.neighborhood, data?.city].filter(
    (row): row is Benchmark => row !== null && row !== undefined,
  );
  if (rows.length === 0) return null;

  return (
    <section
      className="mb-4 rounded-xl border p-3"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <h2 className="m-0 mb-2" style={{ fontSize: "var(--type-body-sm)", fontWeight: 700 }}>
        מחיר למ&quot;ר בהשוואה
      </h2>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {rows.map((row) => (
          <li
            key={row.label}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
            style={{ fontSize: "var(--type-body-sm)" }}
          >
            <span style={{ color: "var(--color-text-muted)" }}>{row.label}</span>
            <span dir="ltr" style={{ unicodeBidi: "isolate", fontWeight: 700 }}>
              {formatPrice(row.avgPerSqmAgorot)}
            </span>
            <span style={{ color: "var(--color-text-muted)" }}>
              ממוצע על {row.count} נכסים
            </span>
            {/*
              ‎**הפער נאמר במילים ולא רק בסימן.** „‎12%+” מחייב לדעת
              ‏מי מהשניים הבסיס; „יקר ב-12% מהממוצע” אומר זאת.
              ‏אפס אינו „יקר ב-0%” אלא „כמו הממוצע”.
            */}
            {row.gapPercent === null ? null : (
              <span
                style={{
                  color:
                    row.gapPercent === 0 ? "var(--color-text-muted)" : "var(--color-text)",
                }}
              >
                {row.gapPercent === 0
                  ? "· הנכס כמו הממוצע"
                  : `· הנכס ${row.gapPercent > 0 ? "יקר" : "זול"} ב-${Math.abs(row.gapPercent)}%`}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
