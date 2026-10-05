/**
 * ‎**מחיר למ״ר — נגזר, ולא נשמר.**
 *
 * ## ‏למה כלל משותף ולא חישוב במסך
 *
 * ‏החלוקה עצמה טריוויאלית; מה שאינו טריוויאלי הוא **מתי אין מה
 * ‏להציג**. נכס בלי מחיר, נכס בלי שטח, שטח שנרשם 0 בטעות — כל אחד
 * ‏מהם מייצר תשובה אחרת ושגויה אם לא נשאלים עליו: „אינסוף ₪ למ״ר”,
 * ‏„0 ₪ למ״ר”, או קריסה. שלוש השאלות האלה נשאלות בכל מקום שבו
 * ‏המספר מוצג — כרטיס הנכס, הרשימה, הבוט — ושלוש תשובות נפרדות
 * ‏מסכימות רק ביום שנכתבו.
 *
 * ## ‏למה לא עמודה בסכימה
 *
 * ‏הוא נגזר משני שדות שכבר נשמרים, ולכן עמודה שלישית הייתה יכולה
 * ‏לסתור אותם: מחיר שמתעדכן ושדה שנשאר מאחור הוא בדיוק הצורה שכבר
 * ‏תוקנה כאן פעם אחת בשדות אחרים. חישוב בקריאה אינו יכול להתיישן.
 */

/**
 * ‎**המחיר למ״ר באגורות, או `null` כשאין מה לחשב.**
 *
 * ‎`null` ולא 0: אפס הוא מספר, והמסך היה מציג „0 ₪ למ״ר” על נכס
 * ‏שפשוט לא מילא שטח.
 *
 * ‏העיגול לאגורה שלמה — כסף נשמר תמיד כמספר שלם באגורות, ושבר
 * ‏אגורה אינו ניתן להצגה ממילא.
 */
export function pricePerSqmAgorot(
  priceAgorot: number | null | undefined,
  areaSqm: number | null | undefined,
): number | null {
  if (priceAgorot === null || priceAgorot === undefined || priceAgorot <= 0) return null;
  /*
   * ‎**`<= 0` ולא `=== 0`.** שטח שלילי אינו אמור להתקיים, אבל הוא
   * ‏מגיע מייבוא Excel ומקלט חופשי — ותוצאה שלילית כאן הייתה נראית
   * ‏על המסך כמחיר, לא כתקלה.
   */
  if (areaSqm === null || areaSqm === undefined || areaSqm <= 0) return null;
  if (!Number.isFinite(priceAgorot) || !Number.isFinite(areaSqm)) return null;
  return Math.round(priceAgorot / areaSqm);
}

/* ============ השוואה לשכונה ולעיר ============ */

/**
 * ‎**כמה נכסים צריך כדי לקרוא לזה „ממוצע”.**
 *
 * ‏ממוצע של נכס אחד הוא **המחיר של אותו נכס**, לא אמת מידה — והוא
 * ‏גם מציג אותו ככזה למי שלא שאל עליו. שניים אינם טובים בהרבה:
 * ‏נכס אחד חריג מזיז את התוצאה בעשרות אחוזים, והמתווך מתמחר לפיה.
 *
 * ‏שלושה אינם מדגם סטטיסטי, וזו בדיוק הסיבה שהמספר הזה מוחזר תמיד
 * ‏לצד הכמות: הקורא רואה על מה הממוצע נשען ומחליט בעצמו.
 */
export const PRICE_BENCHMARK_MIN_SAMPLE = 3;

/**
 * ‎**אילו נכסים נספרים בממוצע.**
 *
 * ‏טיוטה היא נכס שטרם הושלם — מחיר שנרשם בה עשוי להיות מציין
 * ‏זמני. ארכיון הוא נכס שהוצא מהמחזור, ולרוב מסיבה שמשפיעה על
 * ‏המחיר. מה שנשאר: מה שמוצע היום ומה שנסגר בפועל, ושניהם הם מה
 * ‏שמתווך מתכוון אליו כששואל „כמה זה בשכונה”.
 */
export const PRICE_BENCHMARK_STATUSES = ["active", "on_hold", "sold", "rented"] as const;

/** ‏שורה אחת כפי שהממוצע צריך אותה — מחיר ושטח, ותו לא. */
export interface PricedArea {
  priceAgorot?: number | null;
  areaSqm?: number | null;
}

export interface PerSqmBenchmark {
  /** ‏הממוצע באגורות למ״ר. */
  avgPerSqmAgorot: number;
  /** ‏על כמה נכסים הוא נשען — נמסר תמיד, ולא רק כשהוא קטן. */
  count: number;
}

/**
 * ‎**ממוצע המחיר למ״ר של אוסף נכסים, או `null` כשאין על מה להישען.**
 *
 * ‎**ממוצע של המחירים למ״ר, ולא סך המחירים חלקי סך השטח.** השני
 * ‏נשמע זהה ואינו: הוא משקלל נכס של 300 מ״ר פי שלושה מנכס של 100,
 * ‏כלומר עונה על „כמה עולה מ״ר בשכונה” לפי הנכסים הגדולים בלבד.
 * ‏„ממוצע למ״ר” בעברית הוא הראשון, וזה גם מה שמתווך מצפה לו.
 *
 * ‏שורות שאין להן מחיר או שטח **אינן נספרות** — לא כאפס ולא
 * ‏כמדגם. זו אותה הכרעה של `pricePerSqmAgorot`, ובאמצעותה בדיוק,
 * ‏כדי ששתי התשובות לא ייפרדו.
 */
export function averagePerSqmAgorot(rows: readonly PricedArea[]): PerSqmBenchmark | null {
  const values: number[] = [];
  for (const row of rows) {
    const value = pricePerSqmAgorot(row.priceAgorot, row.areaSqm);
    if (value !== null) values.push(value);
  }
  if (values.length < PRICE_BENCHMARK_MIN_SAMPLE) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return { avgPerSqmAgorot: Math.round(sum / values.length), count: values.length };
}

/**
 * ‎**בכמה אחוזים הנכס יקר או זול מהממוצע** — או `null` כשאין מה
 * ‏להשוות.
 *
 * ‏המספר עצמו אינו מספיק: „26,500 מול 24,900” מחייב את הקורא
 * ‏לחשב בראש, וזה בדיוק מה שהוא ביקש שהמערכת תעשה במקומו.
 *
 * ‏חיובי = יקר מהממוצע.
 */
export function perSqmGapPercent(
  perSqmAgorot: number | null,
  benchmark: PerSqmBenchmark | null,
): number | null {
  if (perSqmAgorot === null || benchmark === null) return null;
  if (benchmark.avgPerSqmAgorot <= 0) return null;
  return Math.round(((perSqmAgorot - benchmark.avgPerSqmAgorot) / benchmark.avgPerSqmAgorot) * 100);
}
