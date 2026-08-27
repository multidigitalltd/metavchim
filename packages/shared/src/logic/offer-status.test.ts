import { describe, expect, it } from "vitest";
import {
  OFFER_BUCKETS,
  OFFER_BUCKET_IDS,
  OFFER_STATUSES,
  offerStatusLabel,
} from "./offer-status.js";

/**
 * ‎**הבדיקה שהקובץ הזה קיים בשבילה: שהספירה מסתדרת.**
 *
 * הקבוצות והמצבים היו שתי רשימות שנכתבו בנפרד, ושתיהן החסירו את
 * המצבים שנוספו עם ההצעות האוטומטיות. התוצאה בסוכן הייתה „10 הצעות”
 * עם פירוט שאינו מסתכם ל-10 — ובמקרה של תקלת ספק, פירוט ריק לגמרי.
 */

const allBucketStatuses = OFFER_BUCKET_IDS.flatMap((id) => [...OFFER_BUCKETS[id].statuses]);

describe("כיסוי הקבוצות", () => {
  it("כל מצב משובץ לקבוצה", () => {
    const missing = OFFER_STATUSES.filter((status) => !allBucketStatuses.includes(status));
    expect(missing).toEqual([]);
  });

  /*
   * הכיוון ההפוך: מצב שנשאר בקבוצה אחרי שהוסר מהעמודה הוא שורה מתה
   * שנראית כמו כיסוי.
   */
  it("אין בקבוצות מצב שאינו ברשימה", () => {
    const unknown = allBucketStatuses.filter((s) => !OFFER_STATUSES.includes(s));
    expect(unknown).toEqual([]);
  });

  /*
   * ‎**קבוצה אחת בדיוק.** מצב בשתי קבוצות נספר פעמיים, והסכום היה
   * גדול מהסך הכול — אותה תקלה בכיוון ההפוך.
   */
  it("אין מצב בשתי קבוצות", () => {
    expect(allBucketStatuses).toEqual([...new Set(allBucketStatuses)]);
  });

  it("לכל קבוצה יש תווית, ואין שתי תוויות זהות", () => {
    const labels = OFFER_BUCKET_IDS.map((id) => OFFER_BUCKETS[id].label);
    for (const label of labels) expect(label.trim()).not.toBe("");
    expect(labels).toEqual([...new Set(labels)]);
  });
});

describe("offerStatusLabel", () => {
  /*
   * ‎**המזהה הגולמי אינו מגיע למסך.** „pending_email” אינו אומר דבר
   * למתווך, והוא גם מסגיר שם עמודה במקום לתאר מצב.
   */
  it("מתרגם מצב לתווית של הקבוצה", () => {
    expect(offerStatusLabel("pending_email")).toBe("ממתינות לשליחה");
    expect(offerStatusLabel("opened")).toBe("נפתחו ולא נענו");
    expect(offerStatusLabel("email_failed")).toBe("השליחה נכשלה");
  });

  it("מצב לא מוכר מקבל „אחר” ולא את המזהה", () => {
    expect(offerStatusLabel("something_new")).toBe("אחר");
  });

  /*
   * שער על השלמות: כל מצב ברשימה חייב תווית אמיתית. „אחר” על מצב
   * מוכר פירושו שהוא נשמט מהקבוצות.
   */
  it("אף מצב מוכר אינו נופל ל„אחר”", () => {
    for (const status of OFFER_STATUSES) {
      expect(offerStatusLabel(status), status).not.toBe("אחר");
    }
  });
});
