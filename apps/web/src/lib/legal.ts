/**
 * פרטי המפעילה והמסמכים המשפטיים.
 *
 * הערכים כאן הם **ברירת המחדל** — מה שמוצג כל עוד לא נערך דבר במסך
 * הפלטפורמה. הם יושבים במקום אחד ולא משוכפלים בשלושת המסמכים, כי
 * מסמך משפטי שבו כתובת אחת מעודכנת ושתיים לא הוא בדיוק הבלגן שהוא
 * אמור למנוע.
 *
 * **מקור האמת בזמן ריצה הוא `fetchLegal()`**, שמושך את מה שנערך
 * ב-/platform ומחליף רק את מה שמולא בפועל. הסיבה לשתי שכבות ולא
 * אחת: נוסח משפטי משתנה אחרי בדיקה של עורך/ת דין ולא בגרסה הבאה של
 * הקוד, ומצד שני עמוד שנשען רק על ה-DB היה מוצג ריק ברגע שהשרת אינו
 * זמין — וזה בדיוק העמוד שאסור שייעלם.
 */

export interface LegalDetails {
  operator: string;
  companyId: string;
  address: string;
  privacyEmail: string;
  accessibilityEmail: string;
  supportEmail: string;
  updatedAt: string;
  productName: string;
}

export const LEGAL: LegalDetails = {
  /** שם המפעילה כפי שהוא רשום ברשם החברות. */
  operator: 'מולטי דיגיטל בע"מ',
  /** ח.פ. כפי שהוא מופיע בתעודת ההתאגדות. */
  companyId: "516171303",
  /**
   * כתובת למשלוח דואר.
   *
   * ריק ולא כתובת לדוגמה. כתובת פיקטיבית במסמך שנראה סופי גרועה
   * מכתובת חסרה: היא נראית אמינה, היא אינה נכונה, והיא נבדקת מול
   * מסמכי החברה בבקשת אימות העסק מול Meta. כל עוד השדה ריק המסמכים
   * פשוט אינם מציגים שורת כתובת. למילוי ב-/platform.
   */
  address: "",
  /** פנייה בענייני פרטיות ומימוש זכות עיון. */
  privacyEmail: "privacy@metavchim.co.il",
  /** רכז/ת נגישות. */
  accessibilityEmail: "accessibility@metavchim.co.il",
  /** תמיכה ופניות כלליות. */
  supportEmail: "support@metavchim.co.il",
  /** תאריך העדכון האחרון של המסמכים — לעדכן בכל שינוי מהותי. */
  updatedAt: "17 באוגוסט 2026",
  productName: "מתווכים",
};

/** נוסח מלא שנערך ב-/platform ודורס את המסמך שבקוד. */
export interface LegalOverrides {
  termsText: string | null;
  privacyText: string | null;
}

const API_BASE =
  (process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001") + "/api/v1";

/**
 * הפרטים והנוסחים כפי שהם כרגע.
 *
 * נקראת מרכיב שרת בזמן הבקשה, ולכן עריכה ב-/platform מופיעה בעמוד
 * בלי בנייה מחדש. `no-store` ולא קאש: מסמך משפטי שהתעדכן והמשיך
 * להיות מוצג בגרסה הישנה הוא בדיוק התקלה שאסור שתקרה כאן, ומדובר
 * בשלושה עמודים שנצפים לעיתים רחוקות.
 *
 * **כישלון אינו מפיל את העמוד** אלא נופל לברירת המחדל שבקוד. עמוד
 * תנאי שימוש שמחזיר שגיאה כשה-API למטה הוא חשיפה מיותרת; נוסח
 * ברירת המחדל תמיד תקין, גם אם אינו העדכני ביותר.
 */
export async function fetchLegal(): Promise<{
  legal: LegalDetails;
  overrides: LegalOverrides;
}> {
  const fallback = { legal: LEGAL, overrides: { termsText: null, privacyText: null } };
  try {
    const res = await fetch(`${API_BASE}/legal`, { cache: "no-store" });
    if (!res.ok) return fallback;
    const body = (await res.json()) as Partial<Record<string, string | null>>;

    /** ערך שנערך בפועל בלבד — ריק או חסר משאיר את ברירת המחדל. */
    const pick = (key: string, current: string): string => {
      const value = body[key];
      return typeof value === "string" && value.trim() !== "" ? value : current;
    };

    return {
      legal: {
        operator: pick("operator", LEGAL.operator),
        companyId: pick("companyId", LEGAL.companyId),
        address: pick("address", LEGAL.address),
        privacyEmail: pick("privacyEmail", LEGAL.privacyEmail),
        accessibilityEmail: pick("accessibilityEmail", LEGAL.accessibilityEmail),
        supportEmail: pick("supportEmail", LEGAL.supportEmail),
        updatedAt: pick("updatedAt", LEGAL.updatedAt),
        productName: LEGAL.productName,
      },
      overrides: {
        termsText: typeof body["termsText"] === "string" ? body["termsText"] : null,
        privacyText: typeof body["privacyText"] === "string" ? body["privacyText"] : null,
      },
    };
  } catch {
    return fallback;
  }
}

/**
 * ספקי המשנה שמעבדים מידע בפועל. הרשימה חייבת לשקף את המציאות
 * הטכנית ולא להיות רשימה גנרית — כל שינוי בתשתית מחייב עדכון כאן.
 */
export const SUBPROCESSORS: { name: string; purpose: string; location: string }[] = [
  {
    name: "Postmark",
    purpose: 'משלוח דוא"ל מהמערכת — קוד כניסה, איפוס סיסמה והתראות',
    location: "ארצות הברית",
  },
  {
    name: "WhatsApp Cloud API (Meta)",
    purpose: "שליחה וקבלה של הודעות וואטסאפ מול לקוחות המשרד",
    location: "האיחוד האירופי / ארצות הברית",
  },
  {
    name: "Google",
    purpose: "כניסה עם חשבון Google וסנכרון יומן — רק אם המשרד הפעיל אותם",
    location: "ארצות הברית",
  },
  {
    name: "Cloudflare R2",
    purpose: "עותק גיבוי מוצפן מחוץ לשרת",
    location: "האיחוד האירופי",
  },
  {
    name: "Cardcom",
    purpose:
      "סליקת תשלומי המנוי. פרטי כרטיס האשראי מוקלדים בדף של קארדקום ואינם עוברים במערכת בשום שלב; אצלנו נשמרים רק טוקן לחיוב חוזר, ארבע ספרות אחרונות ותוקף",
    location: "ישראל",
  },
];
