import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * ‎**מקום נוסף הוא מנוי חודשי — ומנוי הוא מה שאפשר להפסיק לשלם.**
 *
 * ההכרעה של בעל המוצר. היא נשמעת כמו פרט תמחור והיא בעצם כל
 * המבנה: תשלום חד-פעמי היה שורה אחת בטבלה, ומנוי דורש חידוש,
 * ביטול, כשל חיוב — **ובעיקר את מה שקורה כשהתשלום נפסק.**
 *
 * הבדיקות כאן נכתבו על הנקודות שנשברות בשקט: מקום שהסתיים ואיש לא
 * נותק, חיוב שנכשל וסוכן נותק באמצע יום, ותשלום שנתפס בלי שירות.
 * הן קוראות את הקוד ולא מריצות סליקה — אותה גישה כמו בשערים
 * המבניים האחרים, שם ההרצה דורשת סולק, מסד וכרטיס.
 */

const read = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

const SERVICE = read("./whatsapp-seat.service.ts");
const RENEWAL = read("./whatsapp-seat-renewal.service.ts");
const BILLING = read("./billing.service.ts");
const MIGRATION = read(
  "../../../prisma/migrations/20260830100000_whatsapp_seats/migration.sql",
);

describe("מקום נוסף לסוכן הוואטסאפ — מנוי חודשי", () => {
  /*
   * ‎**ההפעלה בתוך הטרנזקציה שתפסה את התשלום.**
   *
   * זה מה שהופך אותה לאידמפוטנטית: קארדקום שולח את ההודעה יותר
   * מפעם אחת, ורק מי שהעביר `pending ⟵ paid` מאריך תקופה. הפעלה
   * מחוץ לטרנזקציה הייתה מאריכה חודשיים על תשלום אחד.
   */
  it("ההפעלה רצה בטרנזקציה של תפיסת התשלום", () => {
    expect(BILLING).toContain('payment.purpose === "whatsapp_seat"');
    expect(BILLING).toMatch(/whatsappSeats\.activateWithin\(tx, payment\.seatId, now\)/u);
  });

  /*
   * תשלום שנתפס בלי מקום חי הוא כסף בלי שירות. שתיקה כאן היא
   * בדיוק המקרה שבו לקוח מחויב, לא מקבל דבר, ואיש אינו יודע.
   */
  it("תשלום בלי מקום חי מדווח ואינו נבלע", () => {
    expect(BILLING).toMatch(/whatsappSeats\.reportOrphanPayment\(payment\.id, payment\.seatId\)/u);
    expect(SERVICE).toContain("async reportOrphanPayment(");
  });

  /*
   * ‎**המחיר לעולם אינו מגיע מהדפדפן.** הוא נקרא מהמסלול ונצרב על
   * השורה — סכום שמגיע מהלקוח הוא הנחה שהלקוח קובע לעצמו.
   */
  it("המחיר נקרא מהמסלול ולא מגוף הבקשה", () => {
    expect(SERVICE).toContain("whatsappSeatOffer(plan?.whatsappSeatMonthlyAgorot ?? null)");
    expect(SERVICE).toContain("monthlyAgorot: offer.monthlyAgorot");
    // גוף הבקשה של הרכישה ריק — אין מה לשלוח, ולכן אין מה לזייף
    expect(read("./whatsapp-seat.controller.ts")).toMatch(/async checkout\(\): Promise</u);
  });

  /* מסלול שאינו מוכר מקומות אינו מוכר אותם גם דרך ה-API */
  it("מסלול בלי מחיר נחסם בשרת, ולא רק במסך", () => {
    expect(SERVICE).toMatch(/offer\.kind !== "purchase"[\s\S]{0,200}BadRequestException/u);
  });

  /*
   * ‎**הסכום שנשלח לסולק הוא מה שיירד מהכרטיס.** המחירון נטו, ולכן
   * המע"מ נוסף כאן — בחיוב הראשון ובחידוש כאחד. חידוש שהיה מחייב
   * את הנטו היה גובה פחות מהחיוב הראשון על אותו מקום.
   */
  it("המע\"מ נוסף גם ברכישה וגם בחידוש", () => {
    expect(SERVICE).toContain("this.vat.charge(offer.monthlyAgorot)");
    expect(RENEWAL).toContain("this.vat.charge(seat.monthlyAgorot)");
  });

  /*
   * ‎**התפיסה לפני הפנייה לסולק.** שני עותקי API שרצים יחד — רק
   * אחד מצליח בעדכון המותנה, ולכן רק אחד מחייב.
   */
  it("החידוש תופס את התקופה לפני החיוב, ומחזיר אותה בכישלון", () => {
    /*
     * נבדקים השדות ולא החתימה כמחרוזת אחת: חתימה שנבדקת ככה
     * נשברת בכל תוספת שדה — וזה בדיוק מה שקרה כאן כשהתפיסה
     * הורחבה לכלול `past_due`, על שער שהיה ירוק רגע קודם.
     */
    const claim = RENEWAL.slice(
      RENEWAL.indexOf("const claimed = await"),
      RENEWAL.indexOf("if (claimed.count === 0)"),
    );
    expect(claim).toContain("id: seat.id");
    expect(claim).toContain("currentPeriodEnd: seat.currentPeriodEnd");
    expect(claim).toContain("data: { currentPeriodEnd: periodEnd }");
    expect(RENEWAL).toMatch(
      /where: \{ id: seat\.id, currentPeriodEnd: periodEnd \},\s*data: \{ currentPeriodEnd: seat\.currentPeriodEnd \}/u,
    );
  });

  /*
   * ‎**חיוב שנכשל אינו מנתק.** סירוב חד-פעמי או כרטיס שפג נפתרים
   * בניסיון הבא; ניתוק סוכן באמצע יום עבודה אינו.
   */
  it("כשל חיוב משאיר את המקום תופס מכסה", () => {
    expect(RENEWAL).toMatch(/data: \{ status: "past_due" \}/u);
    // `past_due` נספר במכסה — ההכרעה יושבת בבונה התנאי המשותף
    expect(read("../../core/whatsapp-seat-quota.ts")).toContain("WHATSAPP_SEAT_LIVE_STATUSES");
  });

  /*
   * ‎**מקום שהסתיים — ומישהו יורד איתו.**
   *
   * הזכאות בזמן ריצה קוראת את הדגל של המשתמש ואת המסלול, לא את
   * המכסה. בלי הניתוק המשרד ממשיך לעבוד מעל מה ששילם ללא הגבלת
   * זמן — כלומר הביטול אינו עושה דבר.
   */
  it("סגירת מקום מורידה הקצאה, ולא רק מכסה", () => {
    expect(RENEWAL).toMatch(/this\.seats\.revokeOverQuota\(seat\.tenantId/u);
    expect(SERVICE).toContain("async revokeOverQuota(");
  });

  /*
   * בעל המשרד מחזיק במקום שכלול במסלול. ניתוק שלו היה משאיר את
   * המשרד בלי אף אחד — ובלי מי שיקצה מחדש.
   */
  it("בעל המשרד לעולם אינו הקורבן", () => {
    expect(SERVICE).toMatch(/filter\(\(h\) => h\.role !== "owner"\)/u);
  });

  /* הניתוק נאמר ואינו מתגלה — אחרת זה נראה כמו תקלה */
  it("ניתוק אוטומטי מודיע לבעל המשרד", () => {
    expect(RENEWAL).toContain("private async notifyRevoked(");
    expect(RENEWAL).toMatch(/revoked > 0\) await this\.notifyRevoked/u);
  });

  /*
   * ‎**הספירה תחת נעילה.** בלעדיה שתי הקצאות מקבילות שתיהן רואות
   * מקום פנוי אחד — וזו בדיוק המכסה שנפרצת בלי שאיש יבחין.
   */
  it("ירידת המכסה נעולה, כמו ההקצאה", () => {
    expect(SERVICE).toContain("pg_advisory_xact_lock");
  });

  /*
   * ביטול משאיר את המקום עד סוף התקופה ששולמה — חלק מחודש מחויב
   * כחודש מלא, ולכן אין החזר יחסי ואין סגירה מיידית.
   */
  it("ביטול אינו סוגר מיד, אלא בתום התקופה ששולמה", () => {
    expect(SERVICE).toMatch(/data: \{ status: "cancelled", cancelledAt: new Date\(\) \}/u);
    expect(RENEWAL).toMatch(/status: "cancelled",[\s\S]{0,120}currentPeriodEnd: \{ lte: now \}/u);
  });

  /*
   * ‎**סגירה מותנית בסטטוס.** תשלום שנתפס בין השליפה לסגירה החזיר
   * את המקום ל-`active`; סגירה עיוורת הייתה מוחקת חודש ששולם.
   *
   * התנאי הוא `seat.status` ולא `"cancelled"` מאז שנוספו מקומות
   * שהוענקו: הם נסגרים בתום תקופת הניסיון בלי שאיש ביטל אותם, ותנאי
   * שנעול על „cancelled” היה מדלג עליהם בשקט — כלומר „ניסיון עד ה-30”
   * שאינו נגמר לעולם. ‎`seat.status` שומר על אותה הגנה בדיוק (הסטטוס
   * שנקרא הוא הסטטוס שנכתב) ומכסה את שני המקרים.
   */
  it("הסגירה מותנית, ולא מוחקת חודש ששולם", () => {
    expect(RENEWAL).toMatch(
      /updateMany\(\{[\s\S]{0,400}?where: \{ id: seat\.id, status: seat\.status \}/u,
    );
  });

  /*
   * ‎**מה שהוענק נסגר, ומה שהוענק אינו נגבה.**
   *
   * שני צדדים של אותה הבחנה, ושניהם חייבים להתקיים: מקום ניסיון חייב
   * ‎`currentPeriodEnd` כדי שמשהו יסגור אותו, וסורק החידושים אוסף כל
   * שורה שהתאריך שלה עבר. בלי הסינון הוא היה מנסה לחייב כרטיס על
   * מתנה; בלי ענף השחרור הניסיון לא היה נגמר לעולם.
   */
  it("מקום שהוענק אינו נכנס לגבייה", () => {
    const due = RENEWAL.slice(RENEWAL.indexOf("async renewDue("), RENEWAL.indexOf("take: BATCH"));
    expect(due).toMatch(/origin: \{ not: "granted" \}/u);
    // ושוב ברמת השורה הבודדת, ממש לפני הפנייה לסולק
    expect(RENEWAL).toContain("whatsappSeatIsBillable(seat)");
  });

  it("מקום שהוענק לתקופה נסגר בתומה", () => {
    const release = RENEWAL.slice(RENEWAL.indexOf("async releaseDue("));
    expect(release).toMatch(/origin: "granted",[\s\S]{0,200}currentPeriodEnd: \{ not: null, lte: now \}/u);
  });

  /*
   * ‎**חיוב שנכשל פעם אחת חייב להיגבות שוב.**
   *
   * הסורק בחר `active` בלבד ושום מסלול אחר לא החזיר מקום
   * מ-`past_due` — כלומר המקום עבד בלי תשלום לנצח, והמייל שהבטיח
   * „החיוב הבא יעבור” הבטיח חיוב שלא היה מגיע (ביקורת Codex).
   */
  it("מקום בכשל חיוב נגבה שוב, ולא נשכח", () => {
    const due = RENEWAL.slice(RENEWAL.indexOf("async renewDue("), RENEWAL.indexOf("take: BATCH"));
    expect(due).toContain('status: "past_due"');
    expect(due).toContain('{ status: "active" }');
  });

  /* ניסיון כל שעה על כרטיס שנדחה הוא מה שמסמן את המשרד אצל המנפיק */
  it("הניסיון החוזר יומי ולא שעתי", () => {
    expect(RENEWAL).toMatch(/RETRY_EVERY_MS = 24 \* 60 \* 60 \* 1000/u);
    expect(RENEWAL).toContain("updatedAt: { lte: new Date(now.getTime() - RETRY_EVERY_MS) }");
  });

  /*
   * ובלי גבול, „ממשיך לתפוס מכסה” נכון לנצח: כרטיס שלא יתוקן
   * לעולם הוא מקום חינם לעולם.
   */
  it("תקופת חסד מוגבלת, ואז המקום נסגר וההקצאה יורדת", () => {
    expect(RENEWAL).toMatch(/GRACE_MS = 14 \* 24 \* 60 \* 60 \* 1000/u);
    expect(RENEWAL).toContain("private async closeUnpaid(");
    const close = RENEWAL.slice(RENEWAL.indexOf("private async closeUnpaid("));
    expect(close).toContain("revokeOverQuota");
  });

  /* גבייה שהצליחה מחזירה את המקום למצב תקין */
  it("גבייה שהצליחה מוציאה את המקום מכשל", () => {
    expect(RENEWAL).toMatch(/seat\.status === "past_due"[\s\S]{0,200}status: "active"/u);
  });

  /*
   * ‎**מקום שבוטל נספר עד תום התקופה ששולמה.**
   *
   * הביטול מבטיח בדיוק את זה. ספירה של `active | past_due` בלבד
   * הורידה את המכסה ברגע הלחיצה — ובעל משרד שכיבה מחזיק כדי
   * להעביר מקום ששולם נחסם בהקצאה החוזרת (ביקורת Codex).
   */
  it("ספירת המכסה כוללת מקום שבוטל וטרם פג", () => {
    const QUOTA = read("../../core/whatsapp-seat-quota.ts");
    expect(QUOTA).toContain('status: "cancelled", currentPeriodEnd: { gt: now }');
    // וכל הסופרים עוברים דרכה — ארבעה עותקים היו נפרדים ביום שינוי
    for (const file of [SERVICE, read("../settings/settings.controller.ts"), read("../platform/platform.controller.ts")]) {
      expect(file).toContain("whatsappSeatQuotaWhere(");
    }
  });

  /*
   * ‎**המסמך מתאר את מה שנקנה.** כל תשלום שאינו קרדיטים או השכרה
   * נפל לברירת המחדל והופק כמסמך של מנוי המסלול.
   */
  it("החשבונית מתארת מקום לסוכן, ולא מנוי", () => {
    expect(read("./invoice.service.ts")).toContain('"whatsapp_seat"');
  });

  /*
   * דף שננטש נפתח שוב אחרי שינוי מסלול או מחיר: בלי הרענון החיוב
   * הראשון נגבה במחיר הנוכחי וכל החידושים במחיר הישן.
   */
  it("מחיר על שורה ממתינה שנעשה בה שימוש חוזר מתרענן", () => {
    expect(SERVICE).toMatch(
      /where: \{ id: seatId \},\s*data: \{ monthlyAgorot: offer\.monthlyAgorot \}/u,
    );
  });

  /* שורה למקום ולא מונה — ביטול בודד וחשבונית לכל חיוב דורשים שורה */
  it("הטבלה מחזיקה שורה לכל מקום, עם תקופה משלה", () => {
    expect(MIGRATION).toContain("CREATE TABLE whatsapp_seats");
    expect(MIGRATION).toContain("current_period_end");
    expect(MIGRATION).toContain("ALTER TABLE payments ADD COLUMN seat_id");
  });
});
