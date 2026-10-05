import { NextResponse, type NextRequest } from "next/server";
import { mapCspOrigins, unescapedSlashPath } from "@metavchim/shared";

/**
 * מדיניות אבטחת תוכן (CSP) — **שכבת ההגנה שנשארת כשמשהו אחר נכשל.**
 *
 * המערכת מציגה טקסט חופשי שמשתמשים הקלידו: כותרות שיווק, הערות
 * פנימיות, שמות לקוחות. React מסמן (escape) הכל כברירת מחדל, ולכן
 * אין כאן XSS ידוע — אבל "אין XSS ידוע" הוא מצב, לא הגנה. `<img
 * src=x onerror=...>` שנשמר במסד מחכה לרכיב אחד עתידי שיציג אותו
 * כ-HTML, ו-CSP הוא מה שיעצור אותו גם אז.
 *
 * ## למה Nonce ולא 'unsafe-inline'
 *
 * `script-src 'unsafe-inline'` מבטל את עיקר התועלת של CSP — הוא
 * מתיר בדיוק את מה שתוקף מזריק. לכן כל בקשה מקבלת Nonce אקראי,
 * Next מחתים בו את הסקריפטים שלו, ו-`layout.tsx` מעביר אותו
 * לסקריפט ערכת הנושא. סקריפט בלי החתימה הזו לא ירוץ.
 *
 * ## מה שאי אפשר לצרוב מראש
 *
 * כתובת אריחי המפה ונקודת הקצה של האחסון נקבעות בהתקנה ולא בקוד
 * (הגדרת פלטפורמה ומשתני סביבה). CSP סטטי בקובץ התצורה היה שובר
 * את המפה בכל התקנה שבחרה ספק אחר, ולכן המדיניות נבנית כאן, בזמן
 * ריצה, מתוך משתני הסביבה.
 */

/** מקורות נוספים להתקנה — פסיקים. ריק = רק המקור של האפליקציה. */
function extra(name: string): string[] {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/**
 * ‎**הנתיבים היחידים שמותר להטמיע באתר אחר** — טפסי האתר של המשרד
 * (`/w/…`, „כמה שווה הדירה שלי”, docs/18).
 *
 * כל שאר המערכת נשארת `frame-ancestors 'none'`: מסך של מתווך מחובר
 * בתוך iframe זר הוא בדיוק מה ש-clickjacking מנצל. הטפסים האלה
 * שונים מהותית — אין בהם פעולה בשם משתמש מחובר, רק מבקר שמזין את
 * הנתונים של עצמו — ולכן הם פתוחים להטמעה באתר HTTPS כלשהו. אותו
 * כלל ב-`next.config.ts` עבור `X-Frame-Options`.
 */
const EMBEDDABLE_PREFIX = "/w/";

function buildCsp(nonce: string, dev: boolean, embeddable = false): string {
  /*
   * ה-API יושב על מקור אחר בפיתוח (`localhost:3001`) ומאחורי אותו
   * דומיין בפרודקשן (Caddy). `'self'` לבדו היה חוסם כל קריאה בפיתוח
   * — ולכן המקור המוצהר נכנס למדיניות מאותו משתנה שהקוד קורא ממנו.
   */
  /*
   * ‎**אותה ברירת מחדל כמו ב-`lib/api.ts`, ולא ריק.** הקוד שקורא
   * ל-API נופל ל-`http://localhost:3001` כשהמשתנה אינו מוגדר —
   * וכך בדיוק נראה `pnpm dev` מהשורש: Next קורא רק את `.env` של
   * `apps/web`, לא את זה של ה-Monorepo. עם ברירת מחדל ריקה כאן
   * המדיניות אמרה `'self'` בלבד, הדפדפן חסם כל קריאה ל-3001 —
   * וההתחברות נכשלה בשקט (43 חסימות CSP במסך אחד, בבדיקת QA).
   * בפרודקשן המשתנה מוגדר במפורש כריק (Dockerfile) ולכן `??`
   * אינו מופעל, וה-API נשאר תחת `'self'`.
   */
  const apiOrigin = [
    safeOrigin(process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"),
  ].filter((o): o is string => o !== null);

  /*
   * אחסון המדיה. תמונות הנכסים נמסרות בקישורים חתומים מנקודת הקצה
   * של S3, שהיא הגדרת התקנה — MinIO מקומי, S3 של ספק, או CDN.
   */
  const media = [safeOrigin(process.env["NEXT_PUBLIC_MEDIA_URL"] ?? "")].filter(
    (o): o is string => o !== null,
  );

  /*
   * מארח אריחי המפה. ברירת המחדל מגיעה מ-packages/shared — אותו
   * קבוע שה-API מחזיר לאפליקציה — כך שהתקנה שלא נגעה בכלום עובדת.
   * התקנה שהחליפה ספק מפות במסך הפלטפורמה מצהירה עליו כאן;
   * `MAP_STYLE_URL` נועד בדיוק לזה.
   */
  const mapOrigins = mapCspOrigins(process.env["MAP_STYLE_URL"]);

  /*
   * בפיתוח Next משתמש ב-eval עבור React Refresh, וב-WebSocket
   * לרענון החם. הרפיה הזו קיימת אך ורק כאן — הבנייה לפרודקשן
   * מקבלת את המדיניות המלאה.
   */
  const scriptDev = dev ? ["'unsafe-eval'"] : [];
  const connectDev = dev ? ["ws:", "wss:"] : [];

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    "frame-ancestors": embeddable ? ["https:"] : ["'none'"],
    "form-action": ["'self'"],
    /*
     * ‎`wasm-unsafe-eval`‎ — **בשביל התוויות בעברית על המפה.**
     *
     * תוסף הטקסט הדו-כיווני של MapLibre הוא מודול WebAssembly, ו-
     * `WebAssembly.instantiate` נחסם תחת `script-src` שאין בו היתר
     * מפורש. בלי ההיתר הזה התוסף נכשל, וכשהוא נכשל MapLibre
     * **משמיטה את התוויות העבריות לגמרי** — לא מציגה אותן הפוך אלא
     * לא מציגה כלל.
     *
     * ‎`wasm-unsafe-eval`‎ ולא `unsafe-eval`: הוא מתיר הידור של
     * WebAssembly בלבד, ואינו מתיר `eval()` על מחרוזת. זו ההבחנה
     * שקיימת בתקן כדי לא לשלם על WASM במטבע של הרצת קוד שרירותי.
     *
     * נבדק בדפדפן מול ה-CSP הזה: בלי ההיתר `getRTLTextPluginStatus()`
     * מחזיר `error`, ואיתו `loaded`.
     */
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      "'wasm-unsafe-eval'",
      ...scriptDev,
    ],
    /*
     * `unsafe-inline` בסגנונות בלבד, ובמודע: הרכיבים כותבים
     * `style={{...}}` בכל המערכת, וב-SSR זה הופך לתכונת `style`
     * בתוך ה-HTML. סגנון אינו מריץ קוד, והחלופה היא שכתוב של כל
     * המסכים — עלות שאינה מוצדקת מול הסיכון.
     */
    "style-src": ["'self'", "'unsafe-inline'"],
    /*
     * `apiOrigin` נדרש גם כאן ולא רק ב-connect-src: תמונות הרשת
     * (מודעה, הצעה, לוגו) מוזרמות מה-API, ובפיתוח הוא יושב על
     * מקור אחר — 3001 מול 3000. בלעדיו הדפדפן חוסם כל תמונה כזו
     * עוד לפני הבקשה (ביקורת Codex). בפרודקשן זו רשימה ריקה,
     * כי ה-API הוא באותו מקור וכבר מכוסה ב-'self'.
     */
    "img-src": [
      "'self'",
      "data:",
      "blob:",
      ...apiOrigin,
      ...media,
      ...mapOrigins,
      ...extra("CSP_IMG_SRC"),
    ],
    "font-src": ["'self'", "data:"],
    /* MapLibre מייצר Web Worker מ-blob: */
    "worker-src": ["'self'", "blob:"],
    "connect-src": ["'self'", ...apiOrigin, ...media, ...mapOrigins, ...connectDev, ...extra("CSP_CONNECT_SRC")],
    "media-src": ["'self'", "blob:", ...extra("CSP_MEDIA_SRC")],
    "manifest-src": ["'self'"],
    "upgrade-insecure-requests": [],
  };
  if (dev) delete directives["upgrade-insecure-requests"];

  return Object.entries(directives)
    .map(([key, values]) => (values.length === 0 ? key : `${key} ${values.join(" ")}`))
    .join("; ");
}

/** מחזיר Origin תקין בלבד — ערך סביבה פגום לא יהפוך למדיניות פגומה. */
function safeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function proxy(request: NextRequest): NextResponse {
  /*
   * ‎**לוכסן מקודד — כפתור „פתח במערכת” שנחת על „העמוד לא נמצא”.**
   *
   * ‏הכתובת `…/settings%2Fintegrations` היא קטע נתיב אחד בעיני השרת,
   * ‏ולכן 404 — בעוד `…/settings/integrations` מחזיר את המסך (נמדד מול
   * ‏השרת החי). הפניה קבועה לנתיב האמיתי; כתובת תקינה אינה נוגעת כאן.
   * ‏ההסבר המלא ב-`unescapedSlashPath`.
   */
  const unescaped = unescapedSlashPath(request.nextUrl.pathname);
  if (unescaped !== null) {
    const url = request.nextUrl.clone();
    url.pathname = unescaped;
    return NextResponse.redirect(url, 308);
  }

  const dev = process.env.NODE_ENV !== "production";
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set(
    "Content-Security-Policy",
    buildCsp(nonce, dev, request.nextUrl.pathname.startsWith(EMBEDDABLE_PREFIX)),
  );

  /*
   * HSTS. Caddy מספק HTTPS אבל אינו מוסיף את הכותרת מעצמו, וכותרת
   * שקיימת ב-API ולא באתר שמגיש את האפליקציה היא הגנה חלקית:
   * הבקשה הראשונה, זו שנכתבת בשורת הכתובת, היא בדיוק זו שנחשפת.
   *
   * לא נשלחת ב-HTTP: דפדפן מתעלם ממנה ממילא, וסביבת פיתוח מקומית
   * שננעלת ל-HTTPS למשך שנה היא תקלה שקשה לאבחן.
   */
  if (request.nextUrl.protocol === "https:") {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return response;
}

export const config = {
  /*
   * הכל חוץ מנכסים סטטיים: הם אינם מריצים סקריפטים, והרצת
   * ה-proxy על כל אריח ותמונה היא עלות בלי תמורה.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|guides/|fonts/|.*\\.(?:png|jpg|jpeg|svg|webp|ico|webmanifest|woff|woff2)$).*)"],
};
