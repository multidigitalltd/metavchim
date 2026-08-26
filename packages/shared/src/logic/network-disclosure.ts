/**
 * ‎**„מה בדיוק רואים המשרדים האחרים.”**
 *
 * ## מה זה פותר
 *
 * השאלה שעוצרת מתווך לפני „פרסום לרשת” אינה כמה זה עולה — היא „מה
 * יוצא מכאן”. עד כה התשובה הייתה משפט אחד בגוף הפסקה („הכתובת
 * המדויקת ופרטי הבעלים לא נחשפים”), ומשפט הוא דבר שסורקים ולא
 * קוראים. מי שמהסס צריך **רשימה**: זה נחשף, זה נשאר.
 *
 * ## למה זה יושב בלוגיקה המשותפת ולא ב-JSX
 *
 * זו אינה קופי. זו **הצהרה על מה שחוצה את גבול הדייר** — הדבר
 * היחיד במערכת שיוצא ממנה אל משרד אחר. הצהרה כזו צריכה להיבדק מול
 * הסכימה ולא מול הזיכרון של מי שכתב אותה, ובדיקה כזו אינה יכולה
 * לרוץ על JSX.
 *
 * ## ‎**מה מחזיק את זה נכון — והחלק החשוב בקובץ**
 *
 * ‎`snapshot()` ב-`listings.service.ts` מחזיר
 * ‎`Omit<Prisma.SharedListingUncheckedCreateInput, …>` — טיפוס שכל
 * שדותיו אופציונליים, ולכן **עמודה חדשה לא תפיל אותו**. כלומר אפשר
 * להוסיף שדה לטבלה המשותפת, לפרסם אותו לרשת, והמסך ימשיך להציג את
 * אותם צ'יפים בדיוק. פאנל שמבטיח „זה מה שנחשף” והוא אינו יודע על
 * שדה חדש הוא גרוע ממסך בלי פאנל בכלל.
 *
 * לכן `nonFactColumns` קיים: הבדיקה ב-`apps/api` קוראת את
 * ‎`schema.prisma`, ודורשת ש**כל** עמודה בטבלה המשותפת תופיע או
 * בצ'יפ ירוק או ברשימת התשתית — בשני הכיוונים. עמודה חדשה מפילה את
 * הבדיקה עד שמישהו יאמר עליה אם היא נחשפת.
 *
 * ובכיוון השני: עמודות `hidden` נבדקות שהן **קיימות** בטבלת המקור
 * ו**אינן קיימות** בטבלה המשותפת. הבטחה „הכתובת נשארת אצלכם” שווה
 * בדיוק כמה שהיא נבדקת.
 *
 * ## ‎**הגבול של הבדיקה, במפורש**
 *
 * היא בודקת **עמודות**, לא את הערך שנכתב לתוכן. שדה מקור שזורם
 * לעמודה משותפת קיימת אינו נראה לה — וזה בדיוק מה שקרה כאן בגרסה
 * הראשונה: ‎`publishBulk` מעתיק את `marketingDescription` לתוך
 * ‎`notes`, והרשימה הבטיחה במקביל ש„תיאור השיווק המלא” נשאר אצלכם.
 * הבדיקה הייתה ירוקה וההבטחה הייתה שקרית.
 *
 * זה נכתב כאן ולא מושתק: שדה `hidden` חדש מחייב קריאה במסלולי
 * הכתיבה ולא רק בסכימה. גבול ידוע עדיף על ביטחון שגוי.
 */

/** צ'יפ אחד ברשימה, והעמודות שהוא מדבר עליהן. */
export interface DisclosureChip {
  label: string;
  /**
   * הסתייגות שנקראת בתוך הצ'יפ עצמו — „מעוגל”, „מקורב”.
   *
   * ‎**לא הערת שוליים.** תקציב שמתפרסם מעוגל ל-100 אלף ומיקום
   * שמתפרסם מעוגל הם בדיוק ההבדל בין „נחשף” ל„נחשף במידה”, ומתווך
   * שקורא „תקציב” לבדו מקבל תשובה שגויה לשאלה ששאל.
   */
  qualifier?: string;
  /** העמודות שהצ'יפ מייצג — המפתח לבדיקה מול הסכימה. */
  columns: readonly string[];
}

export interface NetworkDisclosure {
  /** הטבלה שנקראת חוצה-דיירים. */
  sharedTable: string;
  /** הטבלה שממנה מועתק המידע. */
  originTable: string;
  /** מה שמשרד אחר רואה. */
  shown: readonly DisclosureChip[];
  /** מה שנשאר, ועמודותיו הן של טבלת המקור. */
  hidden: readonly DisclosureChip[];
  /**
   * עמודות בטבלה המשותפת שאינן עובדה על הכרטיס.
   *
   * שתי משפחות, ובמכוון באותה רשימה: תשתית (מזהים, סטטוס, חותמות)
   * ותנאי עמלה. תנאי העמלה **כן** נראים לצד השני, ולכן אינם
   * „מוסתרים” — אבל הם גם אינם עובדה על הנכס או על הקונה, והמסך
   * מציג אותם בלשוניות העמלה שמעל. צ'יפ „עמלה” בתוך רשימת החשיפה
   * היה אומר את אותו דבר פעמיים במקומות שאינם מסכימים.
   */
  nonFactColumns: readonly string[];
}

/**
 * ‎**נכס.**
 *
 * הרשימה נכתבה מה-`snapshot()` שרץ בפועל ומ-`SharedListing`, ולא
 * מהאפיון: האפיון נוקב בארבעה („עיר · חדרים · סוג · טווח מחיר”)
 * ובפועל מתפרסמים גם שטח, קומה, מצב, מועד כניסה, מאפיינים, כותרת
 * שיווקית, **תמונות** ומיקום מקורב. ארבעה צ'יפים היו מרגיעים מתווך
 * בטענה שאינה נכונה — וזה בדיוק סוג ההרגעה שהורסת אמון ברגע שהוא
 * מגלה את השאר.
 */
export const PROPERTY_DISCLOSURE: NetworkDisclosure = {
  sharedTable: "SharedListing",
  originTable: "Property",
  shown: [
    { label: "עיר", columns: ["city"] },
    { label: "שכונה", columns: ["neighborhood"] },
    { label: "סוג נכס", columns: ["propertyType"] },
    { label: "סוג עסקה", columns: ["dealType"] },
    { label: "חדרים", columns: ["rooms"] },
    { label: "שטח", columns: ["areaSqm"] },
    { label: "קומה", columns: ["floor", "totalFloors"] },
    { label: "מצב הנכס", columns: ["condition"] },
    { label: "מחיר", qualifier: "מדויק", columns: ["priceAgorot"] },
    { label: "מועד כניסה", columns: ["entryType", "entryDate"] },
    {
      label: "מאפיינים",
      /*
       * ‎`snapshot()` מצרף גם מאפיינים שהמשרד הגדיר בעצמו
       * (‎`custom:`) — כלומר טקסט חופשי שמישהו במשרד כתב, ושהוא
       * היחיד שיודע מה שם בו. זה שדה שיכול לשאת שם או כתובת בלי
       * שאיש התכוון, ולכן הוא נאמר ולא נבלע בתוך „מאפיינים”.
       */
      qualifier: "כולל מאפיינים שהמשרד הגדיר",
      columns: ["features"],
    },
    { label: "כותרת שיווקית", columns: ["title"] },
    {
      label: "התיאור",
      /*
       * ‎**ובפרסום מרוכז זה לא מה שכתבתם.** `publishBulk` שואב את
       * ‎`marketingDescription` של הנכס וחותך ל-300 תווים — כלומר
       * מי שסימן עשרה נכסים ולחץ פעם אחת שולח לרשת טקסט שכתב פעם,
       * בהקשר אחר, בלי לראות אותו כאן. הגרסה הראשונה של הרשימה
       * הזו הבטיחה ש„תיאור השיווק המלא” נשאר אצלכם, וזה היה שקר
       * במסלול הזה בדיוק.
       */
      qualifier: "בפרסום מרוכז — תיאור השיווק של הנכס",
      columns: ["notes"],
    },
    { label: "תמונות", columns: ["photoKeys"] },
    {
      label: "מיקום",
      /*
       * ‎`roundCoord` מעגל לפני הכתיבה, ולכן זו אינה הכתובת. אבל
       * „מיקום” לבדו נקרא כאילו כן — והצ'יפ הזה יושב לצד צ'יפ אפור
       * שאומר „כתובת מדויקת”, כלומר ההבדל בין השניים הוא כל העניין.
       */
      qualifier: "מעוגל — לא כתובת",
      columns: ["latitude", "longitude"],
    },
  ],
  hidden: [
    { label: "רחוב ומספר בית", columns: ["street", "houseNumber"] },
    { label: "בעל הנכס וטלפון", columns: ["ownerContactId"] },
    { label: "מי גר בנכס", columns: ["occupantContactId"] },
    { label: "הערות פנימיות", columns: ["internalNotes"] },
  ],
  nonFactColumns: [
    "id",
    "tenantId",
    "originPropertyId",
    "status",
    "createdBy",
    "createdAt",
    "updatedAt",
    "commissionSplit",
    "buyerSplit",
    "buyerSplitNote",
    "sellerSplit",
    "sellerSplitNote",
  ],
};

/**
 * ‎**קונה.**
 *
 * ההבדל המהותי מהנכס הוא התקציב: מחיר מבוקש הוא מה שהמוכר מפרסם
 * ממילא, ותקציב הוא מידע פרטי של אדם — ולכן הוא מתפרסם מעוגל
 * ל-100 אלף ‎₪. ההסתייגות הזו יושבת בצ'יפ ולא בהערה מתחתיו.
 */
export const BUYER_DISCLOSURE: NetworkDisclosure = {
  sharedTable: "SharedDemand",
  originTable: "Buyer",
  shown: [
    { label: "ערים", columns: ["cities"] },
    { label: "שכונות", columns: ["neighborhoods"] },
    { label: "סוג עסקה", columns: ["dealType"] },
    { label: "סוגי נכס", columns: ["propertyTypes"] },
    { label: "שטח מינימלי", columns: ["areaSqmMin"] },
    {
      label: "תקציב",
      qualifier: "מעוגל ל-100 אלף ₪",
      columns: ["budgetMinAgorot", "budgetMaxAgorot"],
    },
    { label: "חדרים", columns: ["roomsMin", "roomsMax"] },
    { label: "מועד כניסה", columns: ["entryType", "entryBy"] },
    { label: "מצב מימון", columns: ["financing"] },
    { label: "בשלות", columns: ["maturity"] },
    {
      label: "אזורי חיפוש",
      /*
       * „איפה הוא מחפש לקנות” ולא „איפה הוא גר” — ההבחנה כתובה
       * בסכימה עצמה, והיא בדיוק מה שמתווך חושש מהיפוכו.
       */
      qualifier: "איפה הוא מחפש, לא איפה הוא גר",
      columns: ["searchAreas"],
    },
    { label: "מאפיינים נדרשים", columns: ["mustFeatures"] },
    { label: "מאפיינים מועדפים", columns: ["niceFeatures"] },
    { label: "התיאור שכתבתם", columns: ["notes"] },
  ],
  hidden: [
    { label: "שם, טלפון ואימייל", columns: ["contactId"] },
    { label: "הערות הסוכן", columns: ["agentNotes"] },
    { label: "סיכומי שיחות", columns: ["aiNotes"] },
    { label: "הסוכן המטפל", columns: ["ownerUserId"] },
  ],
  nonFactColumns: [
    "id",
    "tenantId",
    "originBuyerId",
    "source",
    "externalId",
    "status",
    "createdAt",
    "updatedAt",
    "commissionSplit",
    "buyerSplit",
    "buyerSplitNote",
    "sellerSplit",
    "sellerSplitNote",
  ],
};

export const NETWORK_DISCLOSURE = {
  property: PROPERTY_DISCLOSURE,
  buyer: BUYER_DISCLOSURE,
} as const;

export type DisclosureKind = keyof typeof NETWORK_DISCLOSURE;

/** כל העמודות שצ'יפ אחד או יותר מדבר עליהן. */
export function disclosureColumns(chips: readonly DisclosureChip[]): string[] {
  return chips.flatMap((chip) => [...chip.columns]);
}
