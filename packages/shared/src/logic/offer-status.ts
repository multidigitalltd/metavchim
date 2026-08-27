/**
 * ‎**מצבי ההצעה — ומה שואלים עליהם.**
 *
 * ## שתי רשימות, ובכוונה
 *
 * ‎`OFFER_STATUSES` הוא מה שנכתב בעמודה. `OFFER_BUCKETS` הוא מה
 * שהמתווך שואל — ואלה **אינם אותו דבר**: „ממתינה” היא `sent` וגם
 * ‎`delivered`, ו„נפתחה ולא נענתה” היא `opened` בלבד, כי `interested`
 * ו-`declined` כבר יצאו ממנה.
 *
 * ## מה שנשבר בלי זה
 *
 * הקבוצות נכתבו בסוכן, והרשימה שהבקר מסנן לפיה נכתבה בנפרד. שתיהן
 * החסירו את `pending_email` ואת `email_failed` — המצבים שנוספו עם
 * ההצעות האוטומטיות — וכל אחת בדרך אחרת:
 *
 * ‎**בבקר** אי אפשר היה בכלל לסנן לפיהם, כלומר מסך ההצעות לא יכול
 * להראות „מה נכשל”.
 *
 * ‎**ובסוכן** התוצאה הייתה גרועה יותר: הספירה הכוללת נלקחה מכל
 * המצבים, והפירוט רק מהקבוצות המוכרות. משרד שכל הצעותיו תקועות
 * בתור בזמן תקלת ספק קיבל „10 הצעות — ” עם פירוט **ריק**, ושורות
 * שנשאו את המזהה הגולמי `pending_email` כתווית (ביקורת Codex).
 *
 * ‎**השלמות נאכפת בבדיקה**: כל מצב חייב להשתייך לקבוצה אחת בדיוק.
 * מצב שיתווסף ולא ישובץ יפיל אותה, במקום להיעלם מהספירה.
 */

export const OFFER_STATUSES = [
  /** נוצרה וטרם אושרה לשליחה — ברירת המחדל בעמודה. */
  "pending_approval",
  /** נוצרה בסבב האוטומטי וממתינה למייל. */
  "pending_email",
  "sent",
  "delivered",
  "opened",
  "interested",
  "declined",
  /** דחייה ודאית של הספק, פקיעת טוקן, או נכס שירד משיווק. */
  "email_failed",
] as const;

export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const OFFER_BUCKETS = {
  /*
   * ‎**הראשון ברשימה כי הוא הלקוח החם ביותר.** מי שפתח ולא הגיב
   * מתלבט, וזה הרגע שבו שיחה מכריעה.
   */
  opened_no_reply: { label: "נפתחו ולא נענו", statuses: ["opened"] },
  interested: { label: "מעוניינים", statuses: ["interested"] },
  waiting: { label: "ממתינות לתגובה", statuses: ["sent", "delivered"] },
  queued: { label: "ממתינות לשליחה", statuses: ["pending_email", "pending_approval"] },
  failed: { label: "השליחה נכשלה", statuses: ["email_failed"] },
  declined: { label: "לא רלוונטי", statuses: ["declined"] },
} as const satisfies Record<string, { label: string; statuses: readonly OfferStatus[] }>;

export type OfferBucket = keyof typeof OFFER_BUCKETS;

export const OFFER_BUCKET_IDS = Object.keys(OFFER_BUCKETS) as OfferBucket[];

/** התווית של מצב גולמי — דרך הקבוצה שלו, לעולם לא המזהה עצמו. */
export function offerStatusLabel(status: string): string {
  const bucket = OFFER_BUCKET_IDS.find((id) =>
    (OFFER_BUCKETS[id].statuses as readonly string[]).includes(status),
  );
  /*
   * מצב שאינו מוכר מקבל „אחר” ולא את המזהה. `pending_email` על המסך
   * אינו אומר דבר למתווך, והוא גם מסגיר שם עמודה במקום מצב.
   */
  return bucket === undefined ? "אחר" : OFFER_BUCKETS[bucket].label;
}
