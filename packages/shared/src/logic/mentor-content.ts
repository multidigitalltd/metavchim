/**
 * ‎**תוכן לימודי במנטור — סרטונים ופודקאסטים.**
 *
 * ## ‏מה נשמר, ומה **לא**
 *
 * ‏נשמרת **כתובת**. לא HTML, לא `<iframe>`, ולא „קוד הטמעה”
 * ‏שמדביקים. זו ההכרעה שנושאת את כל המשקל כאן: „הטמעת סרטון”
 * ‏בניסוח הנאיבי שלה פירושה שמנהל מדביק תגית שהאתר מרנדר, וזו
 * ‏הזרקת HTML במסך של כל מתווך במערכת — גם בלי כוונה רעה, די
 * ‏בהדבקה מאתר שהחליף ספק.
 *
 * ‏הכתובת מפוענחת כאן למזהה (`ref`), והמסך בונה את הנגן מהמזהה
 * ‏ומהמקור הקבוע. כתובת שלא נקראה אינה מוצגת כלל.
 *
 * ## ‏והמקורות — רשימה אחת לשני הצדדים
 *
 * ‎`EMBED_ORIGINS` היא המקור היחיד גם למה שמותר להטמיע וגם למה
 * ‏שה-CSP מתיר ב-`frame-src`. שתי רשימות היו נפרדות ביום שבו
 * ‏מוסיפים ספק: הפענוח היה מקבל אותו, ה-CSP היה חוסם, והמתווך
 * ‏היה רואה מסגרת ריקה בלי שום הודעת שגיאה.
 */

/** ‏מה אפשר לשים באיזור התוכן. */
export const MENTOR_CONTENT_KINDS = ["youtube", "spotify", "apple", "link"] as const;
export type MentorContentKind = (typeof MENTOR_CONTENT_KINDS)[number];

export const MENTOR_CONTENT_KIND_LABELS: Record<MentorContentKind, string> = {
  youtube: "סרטון יוטיוב",
  spotify: "ספוטיפיי",
  apple: "אפל פודקאסטס",
  link: "קישור חיצוני",
};

/**
 * ‎**המקורות שמותר להטמיע — ומה שה-CSP חייב להתיר.**
 *
 * ‏כל ערך כאן הוא Origin מלא, כפי ש-`frame-src` דורש. הבדיקה
 * ‏ב-`middleware` מאמתת שכולם שם — ראו ההסבר למעלה.
 */
export const EMBED_ORIGINS: Record<Exclude<MentorContentKind, "link">, string> = {
  /*
   * ‎`youtube-nocookie` ולא `youtube.com`: אותו נגן בדיוק, בלי
   * ‏עוגיות מעקב עד שמישהו לוחץ נגן. המתווך לא ביקש להיות נמדד
   * ‏כדי לצפות בסרטון הדרכה.
   */
  youtube: "https://www.youtube-nocookie.com",
  spotify: "https://open.spotify.com",
  apple: "https://embed.podcasts.apple.com",
};

/** ‏מה שנשמר על שורת תוכן, אחרי שהכתובת נקראה. */
export interface MentorContentEmbed {
  kind: MentorContentKind;
  /**
   * ‏מה שהנגן צריך: מזהה סרטון ביוטיוב, נתיב בספוטיפיי, או
   * ‏הכתובת עצמה כשאין הטמעה (`link`).
   */
  ref: string;
}

export const CONTENT_TITLE_MAX = 120;
export const CONTENT_NOTES_MAX = 400;

/*
 * ‎`URL` הוא גלובל גם ב-Node וגם בדפדפן — אבל ה-`lib` של החבילה הוא
 * ‎`ES2023` בלבד, **במכוון**: הוא הגדר שמונע מקוד משותף להגיע
 * ‏ל-`document` או ל-`fs` ולהישבר בצד השני. הצהרה נקודתית על מה
 * ‏שנקרא כאן שומרת על הגדר במקום לפתוח את DOM לכל הקובץ — אותו
 * ‏דפוס בדיוק כמו ב-`recruitment.ts`, ומאותו נימוק.
 */
interface ParsedUrl {
  protocol: string;
  hostname: string;
  pathname: string;
  searchParams: { get(name: string): string | null };
  toString(): string;
}

declare const URL: { new (input: string): ParsedUrl };

/** ‏מזהה סרטון ביוטיוב — אחד-עשר תווים מהאלפבית של הכתובות. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/u;

/** ‏מזהה בספוטיפיי ובאפל — בסיס 62 / מספרי, באורך סביר. */
const MEDIA_ID = /^[A-Za-z0-9]{6,40}$/u;

/**
 * ‎**קריאת הכתובת שהמנהל הדביק.**
 *
 * ‎`null` = לא נקרא דבר שאפשר להציג. הקורא אומר זאת ואינו שומר
 * ‏שורה — שורה שלא תנוגן היא כרטיס ריק שמישהו ילחץ עליו לשווא.
 *
 * ‏הפענוח **אינו** מנחש: כתובת יוטיוב בלי מזהה תקין יורדת, ולא
 * ‏„מנוקה” לכתובת אחרת שאולי תעבוד.
 */
export function parseContentUrl(raw: string): MentorContentEmbed | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  let url: ParsedUrl;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  /*
   * ‎`https` בלבד. `javascript:` בשדה שהופך ל-`href` הוא הרצת קוד
   * ‏בדפדפן של כל מי שלוחץ, ו-`http` על דף מאובטח נחסם ממילא.
   */
  if (url.protocol !== "https:") return null;

  const host = url.hostname.toLowerCase().replace(/^www\./u, "");
  const parts: string[] = url.pathname.split("/").filter((p) => p !== "");

  /* ---- יוטיוב: ארבע צורות, אותו מזהה ---- */
  if (host === "youtu.be") {
    const id = parts[0] ?? "";
    return YOUTUBE_ID.test(id) ? { kind: "youtube", ref: id } : null;
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "m.youtube.com") {
    const fromQuery = url.searchParams.get("v") ?? "";
    if (YOUTUBE_ID.test(fromQuery)) return { kind: "youtube", ref: fromQuery };
    /* ‏`/embed/ID`, `/shorts/ID`, `/live/ID` — אותו מזהה בנתיב */
    if (parts.length >= 2 && ["embed", "shorts", "live"].includes(parts[0] ?? "")) {
      const id = parts[1] ?? "";
      return YOUTUBE_ID.test(id) ? { kind: "youtube", ref: id } : null;
    }
    return null;
  }

  /* ---- ספוטיפיי: פרק או תוכנית ---- */
  if (host === "open.spotify.com") {
    const type = parts[0] ?? "";
    const id = parts[1] ?? "";
    if (["episode", "show"].includes(type) && MEDIA_ID.test(id)) {
      return { kind: "spotify", ref: `${type}/${id}` };
    }
    return null;
  }

  /* ---- אפל פודקאסטס ---- */
  if (host === "podcasts.apple.com") {
    /*
     * ‏הנתיב נושא שפה ושם קריא („/il/podcast/שם/id123”), והמזהה
     * ‏היחיד שקבוע הוא זה שמתחיל ב-`id`. הפרק, כשיש, יושב בשאילתה.
     */
    const showSegment = parts.find((p) => /^id\d+$/u.test(p)) ?? "";
    if (showSegment === "") return null;
    const episode = url.searchParams.get("i") ?? "";
    const ref = /^\d+$/u.test(episode) ? `${showSegment}?i=${episode}` : showSegment;
    return { kind: "apple", ref };
  }

  /*
   * ‏כל השאר: קישור שנפתח מחוץ למערכת. זו נחיתה מודעת ולא שגיאה —
   * ‏יש פודקאסטים שאין להם נגן מוטמע, ועדיף קישור שעובד על פני
   * ‏„הכתובת אינה נתמכת” שמשאיר את התוכן בחוץ.
   */
  return { kind: "link", ref: url.toString() };
}

/**
 * ‏הכתובת שהנגן טוען בפועל.
 *
 * ‏נבנית **מהמזהה ומהמקור הקבוע**, ולא מהכתובת ששמורה. זה מה
 * ‏שהופך „כתובת שהמנהל הדביק” למשהו שאפשר לרנדר בלי לבדוק אותה
 * ‏שוב בכל תצוגה.
 */
export function embedUrl(embed: MentorContentEmbed): string {
  switch (embed.kind) {
    case "youtube":
      return `${EMBED_ORIGINS.youtube}/embed/${embed.ref}`;
    case "spotify":
      return `${EMBED_ORIGINS.spotify}/embed/${embed.ref}`;
    case "apple":
      return `${EMBED_ORIGINS.apple}/il/podcast/${embed.ref}`;
    case "link":
      return embed.ref;
  }
}

/** ‏גובה הנגן לפי סוגו — וידאו הוא מלבן, נגן שמע הוא פס. */
export function embedHeight(kind: MentorContentKind): number {
  return kind === "youtube" ? 220 : 152;
}
