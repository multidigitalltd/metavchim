/**
 * ‎**„מה בדיוק רואים המשרדים האחרים.”**
 *
 * ## מה זה פותר
 *
 * השאלה שעוצרת מתווך לפני „פרסום לרשת” אינה כמה זה עולה — היא „מה
 * יוצא מכאן”. עד כה התשובה הייתה משפט אחד בגוף הפסקה („הכתובת
 * המדויקת ופרטי הבעלים לא נחשפים”), ומשפט הוא דבר שסורקים ולא
 * קוראים. מי שמהסס צריך **רשימה**: זה נשלח, זה נשמר ואינו נשלח, זה
 * נשאר.
 *
 * ## ‎**שלוש קבוצות ולא שתיים — וזה תיקון לגרסה הראשונה שלי**
 *
 * הגרסה הראשונה הכירה „נחשף” ו„מוסתר”, ובנתה את הראשון מעמודות
 * הטבלה המשותפת. זה היה שגוי בכיוון שלא ציפיתי לו: `latitude`
 * ו-`longitude` **נשמרים** ב-`SharedListing` ואינם ב-`SharedListingDto`
 * — כלומר משרד אחר לעולם אינו מקבל אותם, והצ'יפ הירוק שהבטיח „מיקום”
 * הבטיח חשיפה שאינה קורית (ביקורת Codex).
 *
 * ‎**גבול החשיפה הוא ה-DTO ולא הטבלה.** הטבלה היא אחסון; ה-DTO הוא
 * מה שיוצא בתשובה. שני הדברים אינם זהים, ובדיוק בפער ביניהם ישבה
 * הטענה השגויה.
 *
 * ‎**ולמה `storedOnly` אינו פשוט „מוסתר”.** הקואורדינטות המעוגלות
 * מזינות את מנוע ההתאמות, וההסבר שהמנוע מייצר — „1.2 ק״מ מהאזור
 * המבוקש” — **כן** נשלח לצד השני בתוך `myMatches`. כלומר משרד אחר
 * אינו מקבל את הנקודה, אבל כן לומד מרחק ממנה. „מוסתר” היה שקר
 * בכיוון השני, וזו הסיבה שיש כאן קבוצה שלישית ולא מחיקה.
 *
 * ## למה זה יושב בלוגיקה המשותפת ולא ב-JSX
 *
 * זו אינה קופי. זו **הצהרה על מה שחוצה את גבול הדייר** — הדבר
 * היחיד במערכת שיוצא ממנה אל משרד אחר. הצהרה כזו צריכה להיבדק מול
 * הקוד ולא מול הזיכרון של מי שכתב אותה, ובדיקה כזו אינה יכולה לרוץ
 * על JSX.
 *
 * ## ‎**מה מחזיק את זה נכון — והחלק החשוב בקובץ**
 *
 * ‎`snapshot()` ב-`listings.service.ts` מחזיר
 * ‎`Omit<Prisma.SharedListingUncheckedCreateInput, …>` — טיפוס שכל
 * שדותיו אופציונליים, ולכן **עמודה חדשה לא תפיל אותו**. אותו דבר
 * בדיוק נכון ל-DTO: שדה חדש ב-`SharedListingDto` מתווסף בלי שאיש
 * ישאל אם הוא נחשף.
 *
 * לכן הבדיקה ב-`apps/api` קוראת **גם** את `schema.prisma` **וגם** את
 * שתי הגדרות ה-DTO, ודורשת כיסוי מלא בשני הכיוונים בשתיהן. עמודה
 * חדשה או שדה חדש מפילים אותה עד שמישהו יאמר עליהם אם הם נשלחים.
 *
 * ## ‎**הגבול של הבדיקה, במפורש**
 *
 * היא בודקת **שמות** — עמודות ושדות — ולא את הערך שנכתב לתוכם. שדה
 * מקור שזורם לעמודה משותפת קיימת אינו נראה לה, וזה בדיוק מה שקרה
 * כאן: ‎`publishBulk` מעתיק את `marketingDescription` לתוך `notes`,
 * והרשימה הבטיחה במקביל ש„תיאור השיווק המלא” נשאר אצלכם. הבדיקה
 * הייתה ירוקה וההבטחה הייתה שקרית.
 *
 * זה נכתב כאן ולא מושתק: שדה `hidden` חדש מחייב קריאה במסלולי
 * הכתיבה ולא רק בסכימה. גבול ידוע עדיף על ביטחון שגוי.
 */

/** צ'יפ אחד ברשימה, והשמות שהוא מדבר עליהם. */
export interface DisclosureChip {
  label: string;
  /**
   * הסתייגות שנקראת בתוך הצ'יפ עצמו — „מעוגל”, „מקורב”.
   *
   * ‎**לא הערת שוליים.** תקציב שמתפרסם מעוגל ל-100 אלף הוא בדיוק
   * ההבדל בין „נחשף” ל„נחשף במידה”, ומתווך שקורא „תקציב” לבדו מקבל
   * תשובה שגויה לשאלה ששאל.
   */
  qualifier?: string;
  /**
   * עמודות בטבלה המשותפת (או בטבלת המקור, ב-`hidden`).
   *
   * יכול להיות ריק: „שם המשרד שלכם” נשלח לצד השני ואינו עמודה
   * ב-`SharedListing` — הוא נגזר מהדייר בזמן הבנייה.
   */
  columns: readonly string[];
  /** השדות ב-DTO שמשרד אחר מקבל בפועל. ריק = נשמר ואינו נשלח. */
  dtoFields: readonly string[];
}

export interface NetworkDisclosure {
  /** הטבלה שנקראת חוצה-דיירים. */
  sharedTable: string;
  /** הטבלה שממנה מועתק המידע. */
  originTable: string;
  /** הקובץ וההגדרה של התשובה שמשרד אחר מקבל — גבול החשיפה עצמו. */
  dtoFile: string;
  dtoName: string;
  /** מה שנשלח למשרד אחר. */
  shown: readonly DisclosureChip[];
  /** נשמר בטבלה המשותפת ואינו נשלח — ראו ההערה בראש הקובץ. */
  storedOnly: readonly DisclosureChip[];
  /** מה שנשאר, ועמודותיו הן של טבלת המקור. */
  hidden: readonly DisclosureChip[];
  /**
   * עמודות בטבלה המשותפת שאינן עובדה על הכרטיס.
   *
   * שתי משפחות, ובמכוון באותה רשימה: תשתית (מזהים, סטטוס, חותמת
   * עדכון) ותנאי עמלה. תנאי העמלה **כן** נראים לצד השני, ולכן אינם
   * „מוסתרים” — אבל הם גם אינם עובדה על הנכס או על הקונה, והמסך
   * מציג אותם בלשוניות העמלה שמעל. צ'יפ „עמלה” בתוך רשימת החשיפה
   * היה אומר את אותו דבר פעמיים במקומות שאינם מסכימים.
   */
  nonFactColumns: readonly string[];
  /**
   * שדות ב-DTO שאינם מידע שלכם.
   *
   * שלוש משפחות: תשתית ותנאים כמו למעלה; מצב של **הצופה** ולא שלכם
   * (‎`mine`, `canManage`, `interestSent`); ו-`myMatches`, שהוא
   * הקונים של הצופה שחושבו אצלו — לא דבר שיצא מכם.
   */
  nonFactDtoFields: readonly string[];
}

/**
 * ‎**נכס.**
 *
 * הרשימה נכתבה מ-`SharedListingDto` ומ-`snapshot()` שרצים בפועל, ולא
 * מהאפיון: האפיון נוקב בארבעה („עיר · חדרים · סוג · טווח מחיר”)
 * ובפועל נשלחים גם שטח, קומה, מצב, מועד כניסה, מאפיינים, כותרת
 * שיווקית, **תמונות**, שם המשרד ומועד הפרסום. ארבעה צ'יפים היו
 * מרגיעים מתווך בטענה שאינה נכונה — וזה בדיוק סוג ההרגעה שהורסת
 * אמון ברגע שהוא מגלה את השאר.
 */
export const PROPERTY_DISCLOSURE: NetworkDisclosure = {
  sharedTable: "SharedListing",
  originTable: "Property",
  dtoFile: "modules/collaboration/listings.service.ts",
  dtoName: "SharedListingDto",
  shown: [
    { label: "עיר", columns: ["city"], dtoFields: ["city"] },
    { label: "שכונה", columns: ["neighborhood"], dtoFields: ["neighborhood"] },
    { label: "סוג נכס", columns: ["propertyType"], dtoFields: ["propertyType"] },
    { label: "סוג עסקה", columns: ["dealType"], dtoFields: ["dealType"] },
    { label: "חדרים", columns: ["rooms"], dtoFields: ["rooms"] },
    { label: "שטח", columns: ["areaSqm"], dtoFields: ["areaSqm"] },
    {
      label: "קומה",
      columns: ["floor", "totalFloors"],
      dtoFields: ["floor", "totalFloors"],
    },
    { label: "מצב הנכס", columns: ["condition"], dtoFields: ["condition"] },
    { label: "מחיר", qualifier: "מדויק", columns: ["priceAgorot"], dtoFields: ["priceAgorot"] },
    {
      label: "מועד כניסה",
      columns: ["entryType", "entryDate"],
      dtoFields: ["entryType", "entryDate"],
    },
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
      dtoFields: ["features"],
    },
    { label: "כותרת שיווקית", columns: ["title"], dtoFields: ["title"] },
    {
      label: "התיאור",
      /*
       * ‎**ובפרסום מרוכז זה לא מה שכתבתם.** `publishBulk` שואב את
       * ‎`marketingDescription` של הנכס וחותך ל-300 תווים — כלומר
       * מי שסימן עשרה נכסים ולחץ פעם אחת שולח לרשת טקסט שכתב פעם,
       * בהקשר אחר, בלי לראות אותו כאן.
       */
      qualifier: "בפרסום מרוכז — תיאור השיווק של הנכס",
      columns: ["notes"],
      dtoFields: ["notes"],
    },
    { label: "תמונות", columns: ["photoKeys"], dtoFields: ["photos"] },
    {
      label: "שם המשרד שלכם והלוגו",
      /*
       * אינם עמודה: נגזרים מהדייר בזמן בניית התשובה. זו הסיבה
       * ש-`columns` יכול להיות ריק — גבול החשיפה הוא ה-DTO.
       */
      columns: [],
      dtoFields: ["officeName", "officeLogoUrl"],
    },
    { label: "מתי פורסם", columns: ["createdAt"], dtoFields: ["createdAt"] },
  ],
  storedOnly: [
    {
      label: "מיקום מעוגל",
      /*
       * ‎**נשמר, אינו נשלח — ובכל זאת נשמע.** הקואורדינטות מזינות את
       * מנוע ההתאמות, וההסבר שהוא מייצר („1.2 ק״מ מהאזור המבוקש”)
       * נשלח לצד השני בתוך `myMatches`. „מוסתר” היה שקר, „נחשף” היה
       * שקר, וזו הניסוח היחיד שנכון.
       */
      qualifier: "משמש להתאמה — הצד השני מקבל מרחק, לא נקודה",
      columns: ["latitude", "longitude"],
      dtoFields: [],
    },
  ],
  hidden: [
    { label: "רחוב ומספר בית", columns: ["street", "houseNumber"], dtoFields: [] },
    { label: "בעל הנכס וטלפון", columns: ["ownerContactId"], dtoFields: [] },
    { label: "מי גר בנכס", columns: ["occupantContactId"], dtoFields: [] },
    { label: "הערות פנימיות", columns: ["internalNotes"], dtoFields: [] },
  ],
  nonFactColumns: [
    "id",
    "tenantId",
    "originPropertyId",
    "status",
    "createdBy",
    "updatedAt",
    "commissionSplit",
    "buyerSplit",
    "buyerSplitNote",
    "sellerSplit",
    "sellerSplitNote",
  ],
  nonFactDtoFields: [
    "id",
    "status",
    "commissionSplit",
    "terms",
    /* מצב של הצופה, לא שלכם */
    "mine",
    "canManage",
    "interestSent",
    /* נשלח רק כשהפרסום שלכם — ראו `toDto` */
    "originPropertyId",
    /* הקונים של הצופה, שחושבו אצלו */
    "myMatches",
  ],
};

/**
 * ‎**קונה.**
 *
 * ההבדל המהותי מהנכס הוא התקציב: מחיר מבוקש הוא מה שהמוכר מפרסם
 * ממילא, ותקציב הוא מידע פרטי של אדם — ולכן הוא מתפרסם מעוגל
 * ל-100 אלף ‎₪. ההסתייגות הזו יושבת בצ'יפ ולא בהערה מתחתיו.
 *
 * ואין כאן `storedOnly`: בביקוש כל מה שנשמר גם נשלח, כולל אזורי
 * החיפוש על המפה. זה **לא** במקרה סימטרי לנכס, וזו הסיבה ששתי
 * הרשימות נכתבות בנפרד ולא נגזרות זו מזו.
 */
export const BUYER_DISCLOSURE: NetworkDisclosure = {
  sharedTable: "SharedDemand",
  originTable: "Buyer",
  dtoFile: "modules/collaboration/collaboration.service.ts",
  dtoName: "SharedDemandDto",
  shown: [
    { label: "ערים", columns: ["cities"], dtoFields: ["cities"] },
    { label: "שכונות", columns: ["neighborhoods"], dtoFields: ["neighborhoods"] },
    { label: "סוג עסקה", columns: ["dealType"], dtoFields: ["dealType"] },
    { label: "סוגי נכס", columns: ["propertyTypes"], dtoFields: ["propertyTypes"] },
    { label: "שטח מינימלי", columns: ["areaSqmMin"], dtoFields: ["areaSqmMin"] },
    {
      label: "תקציב",
      qualifier: "מעוגל ל-100 אלף ₪",
      columns: ["budgetMinAgorot", "budgetMaxAgorot"],
      dtoFields: ["budgetMinAgorot", "budgetMaxAgorot"],
    },
    { label: "חדרים", columns: ["roomsMin", "roomsMax"], dtoFields: ["roomsMin", "roomsMax"] },
    {
      label: "מועד כניסה",
      columns: ["entryType", "entryBy"],
      dtoFields: ["entryType", "entryBy"],
    },
    { label: "מצב מימון", columns: ["financing"], dtoFields: ["financing"] },
    { label: "בשלות", columns: ["maturity"], dtoFields: ["maturity"] },
    {
      label: "אזורי חיפוש",
      /*
       * ‎**כאן הם כן נשלחים**, בשונה מהמיקום בנכס: נקודה, רדיוס
       * ותווית, כפי שסומנו על המפה. „איפה הוא מחפש לקנות” ולא
       * „איפה הוא גר” — ההבחנה כתובה בסכימה, והיא בדיוק מה שמתווך
       * חושש מהיפוכו.
       */
      qualifier: "נקודה, רדיוס ותווית — איפה הוא מחפש, לא איפה הוא גר",
      columns: ["searchAreas"],
      dtoFields: ["searchAreas"],
    },
    { label: "מאפיינים נדרשים", columns: ["mustFeatures"], dtoFields: ["mustFeatures"] },
    { label: "מאפיינים מועדפים", columns: ["niceFeatures"], dtoFields: ["niceFeatures"] },
    { label: "התיאור שכתבתם", columns: ["notes"], dtoFields: ["notes"] },
    { label: "שם המשרד שלכם והלוגו", columns: [], dtoFields: ["officeName", "officeLogoUrl"] },
    { label: "מתי פורסם", columns: ["createdAt"], dtoFields: ["createdAt"] },
  ],
  storedOnly: [],
  hidden: [
    { label: "שם, טלפון ואימייל", columns: ["contactId"], dtoFields: [] },
    { label: "הערות הסוכן", columns: ["agentNotes"], dtoFields: [] },
    { label: "סיכומי שיחות", columns: ["aiNotes"], dtoFields: [] },
    { label: "הסוכן המטפל", columns: ["ownerUserId"], dtoFields: [] },
  ],
  nonFactColumns: [
    "id",
    "tenantId",
    "originBuyerId",
    "source",
    "externalId",
    "status",
    "updatedAt",
    "commissionSplit",
    "buyerSplit",
    "buyerSplitNote",
    "sellerSplit",
    "sellerSplitNote",
  ],
  nonFactDtoFields: [
    "id",
    "status",
    "commissionSplit",
    "terms",
    "mine",
    "canManage",
    "originBuyerId",
    "myMatches",
    /* מאיפה הביקוש הגיע לפיד, ומה יעלה לענות עליו — לא מידע שלכם */
    "source",
    "sourceLabel",
    "creditsCost",
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

/** כל שדות ה-DTO שצ'יפ אחד או יותר מדבר עליהם. */
export function disclosureDtoFields(chips: readonly DisclosureChip[]): string[] {
  return chips.flatMap((chip) => [...chip.dtoFields]);
}
