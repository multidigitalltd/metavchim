"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiDelete, apiGet, apiList, apiPost } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { LoadError } from "../load-error";
import { WhatsAppBotPanel } from "./whatsapp-bot-panel";

/**
 * חיבור המספר העסקי **של הסוכן** לוואטסאפ (docs/12).
 *
 * הקו הוא אישי: כל סוכן מחבר את המספר שלו, והלידים מהלקוחות שכותבים
 * אליו נוחתים אצלו ולא במאגר המשרד. לכן המסך מציג את הקו של המשתמש
 * המחובר בלבד — המספר הפרטי של עמית אינו נתון שסוכן צריך לראות.
 *
 * המתווך לוחץ „חבר”, נפתח פופאפ של Meta, הוא מאשר בטלפון — ומאותו
 * רגע הודעות הלקוחות שלו נכנסות למערכת **בלי שהוא מוותר על
 * אפליקציית WhatsApp Business במכשיר**. זה נקרא דו-קיום, וזו הסיבה
 * שרשימת „מה משתנה” למטה מוצגת *לפני* הלחיצה ולא אחריה: חלק
 * מהיכולות באפליקציה נכבות, ומתווך שמגלה זאת בדיעבד פותח קריאה
 * לתמיכה — בצדק.
 */

interface Connection {
  id: string;
  /** בעל הקו — הסוכן שחיבר אותו */
  userId: string;
  displayPhone: string;
  verifiedName: string | null;
  status: string;
  historyShared: boolean;
  qualityRating: string | null;
  connectedAt: string;
  disconnectedAt: string | null;
  disconnectReason: string | null;
}

interface ConnectionsResponse {
  connections: Connection[];
  /**
   * ‎`featureType` מגיע מהשרת ולא מקובע כאן: הוא בוחר *איזו* זרימה
   * Meta פותחת, וזרימת הדו-קיום פתוחה רק לאפליקציה שאושרה
   * ל-Coexistence. אפליקציה שלא אושרה מקבלת במקומה את דיאלוג
   * ההתחברות הרגיל ("להמשיך בתור…"), בלי בחירת מספר.
   */
  signup: { appId: string; configId: string; featureType: string } | null;
  botIncluded: boolean;
}

/**
 * ‎**שני מסלולים, שני נוסחים — ואי אפשר להשתמש באחד לשני.**
 *
 * בדו-קיום המספר ממשיך לחיות באפליקציה שבטלפון; ב-Embedded Signup
 * הרגיל הוא **עובר** לניהול המערכת ומפסיק לעבוד באפליקציה. זה לא
 * הבדל בניסוח אלא בעובדות, והמסך הזה הוא מה שהסוכן מסכים על בסיסו
 * לפני שהוא לוחץ. הצגת נוסח הדו-קיום למי שמריץ את המסלול הרגיל היא
 * הסכמה שניתנה על סמך מידע שגוי (ביקורת Codex) — ולכן שתי רשימות,
 * והבחירה ביניהן לפי מה שהשרת אומר שייפתח בפועל.
 *
 * ‎**רק מה שעובד היום.** „ייבוא היסטוריה” הופיע כאן קודם, אבל קליטת
 * שדה ה-`history` טרם נבנתה (docs/12 §8, שלב 2) — והבטחה במסך
 * שאינה מתממשת ביום החיבור היא בדיוק מה שמייצר קריאת תמיכה.
 */
const BENEFITS_COEXISTENCE = [
  "כל פנייה בוואטסאפ נכנסת כליד עם שם, מספר וההודעה המקורית — בלי העתקה ידנית",
  "הליד נוחת אצלך, לא במאגר המשרד — הלקוח כתב למספר שלך",
  "ציר זמן מלא בכרטיס הלקוח, כולל מה שענית ידנית מהטלפון",
  "אתה ממשיך לעבוד באפליקציה בטלפון בדיוק כמו היום — אותו מספר, אותן שיחות",
  "הלקוחות רואים את המספר שלך, לא מספר של המערכת",
];

const BENEFITS_STANDARD = [
  "כל פנייה בוואטסאפ נכנסת כליד עם שם, מספר וההודעה המקורית — בלי העתקה ידנית",
  "הליד נוחת אצלך, לא במאגר המשרד — הלקוח כתב למספר שלך",
  "ציר זמן מלא בכרטיס הלקוח, כולל כל מה שנשלח מהמערכת",
  "הלקוחות רואים את המספר שלך, לא מספר של המערכת",
];

/** מה שנכבה או אינו נתמך. מוצג לפני הלחיצה, לא אחריה. */
const LIMITATIONS_COEXISTENCE = [
  "הודעות נעלמות, „צפייה חד-פעמית” ושיתוף מיקום חי — נכבות בשיחות אישיות",
  "רשימות תפוצה קיימות הופכות לקריאה בלבד; אי אפשר ליצור חדשות",
  "קבוצות, שיחות קול ווידאו, סטטוסים וקטלוג — ממשיכים לעבוד באפליקציה, אך אינם נכנסים למערכת",
  "‏WhatsApp for Windows ושעון חכם אינם נתמכים; מכשירים מקושרים אחרים ינותקו וניתן לקשר אותם מחדש",
  "המספר צריך להיות פעיל באפליקציית WhatsApp Business לפחות שבוע (מומלץ חודש)",
  "סנכרון ההיסטוריה חייב להסתיים תוך 24 שעות מהחיבור, אחרת יש לחבר מחדש",
];

/**
 * המסלול הרגיל. השורה הראשונה היא **העיקר**, ולכן היא ראשונה: המספר
 * עוזב את הטלפון. מתווך שיחבר כאן את המספר שבכיסו יגלה שהוואטסאפ
 * שלו הפסיק לעבוד — וזה בדיוק מה שהמסך הזה נועד למנוע.
 */
const LIMITATIONS_STANDARD = [
  "המספר עובר לניהול המערכת ומפסיק לעבוד באפליקציית WhatsApp / WhatsApp Business בטלפון",
  "מספר שכבר פעיל באפליקציה חייב להימחק ממנה לפני החיבור, אחרת Meta תדחה אותו",
  "כל השיחות מתנהלות מהמערכת בלבד — אין מענה מהטלפון",
  "היסטוריית השיחות שבאפליקציה אינה עוברת למערכת",
  "קבוצות, שיחות קול ווידאו, סטטוסים וקטלוג אינם נתמכים בקו כזה",
  "מומלץ לחבר מספר עסקי ייעודי, ולא את המספר האישי שלכם",
];

const STATUS_LABELS: Record<string, { text: string; tone: "ok" | "warn" | "bad" }> = {
  connected: { text: "מחובר ופעיל", tone: "ok" },
  pending_history: { text: "מחובר — ההיסטוריה מסתנכרנת", tone: "warn" },
  payment_required: { text: "דרוש אמצעי תשלום ב-Meta", tone: "warn" },
  disconnected: { text: "מנותק", tone: "bad" },
  error: { text: "החיבור לא הושלם", tone: "bad" },
};

/**
 * מה ש-Meta מחזירה מהפופאפ. הטיפוס מוצהר כאן ולא נשלף מ-SDK: אנחנו
 * טוענים סקריפט חיצוני, ולקומפיילר אין ממנו שום ידיעה.
 */
interface FacebookSdk {
  init: (options: { appId: string; cookie: boolean; xfbml: boolean; version: string }) => void;
  login: (
    callback: (response: { authResponse?: { code?: string } }) => void,
    options: Record<string, unknown>,
  ) => void;
}

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

/**
 * ערך ה-`featureType` של זרימת הדו-קיום, כפי שהשרת מחזיר אותו. כאן
 * הוא משמש להשוואה בלבד — מה שנשלח ל-Meta מגיע מהשרת ולא מכאן.
 */
const COEXISTENCE_FEATURE = "whatsapp_business_app_onboarding";

const FB_SDK_URL = "https://connect.facebook.net/en_US/sdk.js";
const GRAPH_VERSION = "v23.0";

function Bullets({ items, marker }: { items: readonly string[]; marker: string }) {
  return (
    <ul className="flex flex-col gap-1.5 text-sm">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2">
          <span aria-hidden="true">{marker}</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * ‎**כל מה שצריך לדעת לפני שמחברים — במקום אחד.**
 *
 * ‏שלושה חלקים, ובכוונה בסדר הזה: מה מרוויחים, מה מוותרים, ומה זה
 * עולה. הסדר ההפוך (מחיר ראשון) מוכר בלי להסביר, וההשמטה של החלק
 * האמצעי הופכת כל מגבלה שתתגלה בשימוש לתחושת הטעיה.
 *
 * ‎**החלק על העלות מפריד בין שני כיסים** — מה שמשולם ל-Meta ומה
 * שמשולם לנו. מתווך שרואה „בתשלום” בלי ההפרדה מניח שהכול אצלנו,
 * ואז מגלה חיוב נפרד מ-Meta ופותח קריאה. ההפרדה כאן זולה בהרבה
 * מהשיחה הזו.
 */
function InfoPanel({
  botIncluded,
  coexistence,
}: {
  botIncluded: boolean;
  coexistence: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div
        className="rounded-xl border p-4"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <p className="mb-2 font-medium">מה זה נותן לכם</p>
        <Bullets items={coexistence ? BENEFITS_COEXISTENCE : BENEFITS_STANDARD} marker="✓" />
      </div>

      <div
        className="rounded-xl border p-4"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <p className="mb-2 font-medium">מה משתנה או מוגבל</p>
        <p className="mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
          {coexistence
            ? "אלה מגבלות של Meta על מספר שמחובר גם לאפליקציה וגם למערכת — לא בחירה שלנו. הן מתבטלות אם תנתקו."
            : "המסלול הזה מעביר את המספר לניהול המערכת. אלה כללים של Meta לקו כזה — לא בחירה שלנו — וניתוק אינו מחזיר את המספר לאפליקציה מאליו."}
        </p>
        <Bullets items={coexistence ? LIMITATIONS_COEXISTENCE : LIMITATIONS_STANDARD} marker="•" />
      </div>

      <div
        className="rounded-xl border p-4"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <p className="mb-2 font-medium">מה זה עולה</p>
        <dl className="flex flex-col gap-3 text-sm">
          <div>
            <dt className="font-medium">חיבור המספר וקליטת פניות — כלול במסלול</dt>
            <dd style={{ color: "var(--color-text-muted)" }}>
              הודעות שנכנסות אליכם אינן עולות דבר, לא לכם ולא לנו. לכן החיבור,
              הלידים וציר הזמן{coexistence ? " וסנכרון ההיסטוריה" : ""} פתוחים בכל
              מסלול.
            </dd>
          </div>
          <div>
            <dt className="font-medium">
              בוט מענה ללקוחות —{" "}
              {botIncluded ? (
                <span style={{ color: "var(--color-success)" }}>כלול במסלול שלכם</span>
              ) : (
                "תוסף בתשלום"
              )}
            </dt>
            <dd style={{ color: "var(--color-text-muted)" }}>
              {botIncluded
                ? "הבוט עונה ללקוחות שלכם, מאפיין את הפנייה ומעביר אליכם. אפשר לכבות אותו בכל רגע."
                : "כל תשובה של הבוט היא ניתוח שפה שאנחנו משלמים עליו, ולכן זה תוסף נפרד. בלעדיו החיבור עובד במלואו — פשוט בלי מענה אוטומטי."}
            </dd>
          </div>
          <div>
            <dt className="font-medium">הודעות יזומות — משולם על ידכם ל-Meta</dt>
            <dd style={{ color: "var(--color-text-muted)" }}>
              תשובה ללקוח תוך 24 שעות מפנייתו היא חינם. הודעה יזומה מחוץ לחלון
              הזה (למשל „יש נכס חדש שמתאים לך”) מחויבת על ידי Meta ישירות
              בחשבון שלכם — נדרש אמצעי תשלום ב-WhatsApp Manager. הכסף הזה אינו
              עובר דרכנו.
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

export function WhatsAppBusinessSection() {
  const [data, setData] = useState<ConnectionsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * מזהי ה-WABA והקו מגיעים באירוע `message` מהפופאפ, וה-`code`
   * מגיע ב-callback נפרד של ה-SDK. שניהם דרושים יחד — ולכן האירוע
   * נשמר ב-ref עד שה-callback מגיע.
   */
  const signupAssets = useRef<{ wabaId: string; phoneNumberId: string } | null>(null);

  /*
   * ‎**המסלול שייפתח בפועל — ומעליו כל הנוסח במסך.**
   *
   * ‏מוגדר כאן ולא לפני ה-`return`, כי גם `connect` וגם `disconnect`
   * מנסחים לפיו את ההודעה שהם מציגים. כשהחיבור טרם הוגדר בפלטפורמה
   * אין מה לפתוח והכפתור מוסתר ממילא, ולכן ברירת המחדל היא זו של
   * המוצר — דו-קיום.
   */
  const coexistence = (data?.signup?.featureType ?? COEXISTENCE_FEATURE) === COEXISTENCE_FEATURE;

  const load = useCallback(() => {
    setFailed(false);
    apiGet<ConnectionsResponse>("/whatsapp/connections")
      .then((res) => {
        // רשימה חסרה היא כשל טעינה, לא „אין חיבורים”
        apiList(res.connections, "connections");
        setData(res);
      })
      .catch(() => setFailed(true));
  }, []);

  useEffect(load, [load]);

  /*
   * ‏Meta מדווחת על שלבי הזרימה באירוע `message` מהפופאפ. האזנה
   * גלובלית ולא חד-פעמית: המתווך יכול לסגור ולפתוח מחדש, והמאזין
   * חייב לשרוד את זה.
   */
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== "https://www.facebook.com" && event.origin !== "https://web.facebook.com") {
        return;
      }
      try {
        const parsed: unknown = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          (parsed as { type?: unknown }).type !== "WA_EMBEDDED_SIGNUP"
        ) {
          return;
        }
        const payload = parsed as {
          event?: string;
          data?: { waba_id?: string; phone_number_id?: string };
        };
        if (payload.data?.waba_id && payload.data.phone_number_id) {
          signupAssets.current = {
            wabaId: payload.data.waba_id,
            phoneNumberId: payload.data.phone_number_id,
          };
        }
        if (payload.event === "CANCEL") {
          setError("החיבור בוטל לפני שהושלם. אפשר לנסות שוב מתי שנוח");
          setBusy(false);
        }
      } catch {
        // מטען שאינו JSON אינו שלנו — מדולג בשקט
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  /** טעינת ה-SDK של פייסבוק פעם אחת, רק כשיש מה לפתוח איתו. */
  const ensureSdk = useCallback(async (appId: string): Promise<FacebookSdk | null> => {
    if (window.FB) return window.FB;
    return new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = FB_SDK_URL;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.onload = () => {
        window.FB?.init({ appId, cookie: true, xfbml: false, version: GRAPH_VERSION });
        resolve(window.FB ?? null);
      };
      script.onerror = () => resolve(null);
      document.body.appendChild(script);
    });
  }, []);

  const connect = useCallback(async () => {
    if (!data?.signup) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    signupAssets.current = null;

    const sdk = await ensureSdk(data.signup.appId);
    if (!sdk) {
      setError("לא הצלחנו לטעון את חלון החיבור של Meta. בדקו חוסם פרסומות ונסו שוב");
      setBusy(false);
      return;
    }

    sdk.login(
      (response) => {
        const code = response.authResponse?.code;
        const assets = signupAssets.current;
        if (!code) {
          // אין קוד = המתווך סגר את החלון בלי לאשר דבר
          setError("החיבור בוטל לפני שהושלם. אפשר לנסות שוב מתי שנוח");
          setBusy(false);
          return;
        }
        /*
         * ‎**קוד בלי מזהים אינו כשל.**
         *
         * מתווך שכבר חיבר בעבר מקבל מ-Meta את מסך „להמשיך עם ההגדרות
         * הקודמות?”, ומסלול ההמשך מדלג על בחירת המספר — כלומר קוד
         * חוזר בלי אירוע `message`. חוסם `postMessage` בין מקורות
         * עושה את אותו דבר. כאן זה נענה בשקיעה שקטה ובהודעת „לא נבחר
         * מספר” שאין ממנה מוצא; עכשיו השרת שואל את Meta מי הקו,
         * ומסרב לנחש רק כשיש באמת יותר מאחד.
         */
        apiPost<{ connection: Connection }>("/whatsapp/connections", { code, ...(assets ?? {}) })
          .then(() => {
            setNotice(
              coexistence
                ? "המספר חובר. סנכרון ההיסטוריה עשוי להימשך עד 24 שעות"
                : "המספר חובר. מכאן הפניות נכנסות למערכת",
            );
            load();
          })
          .catch((err: unknown) => {
            setError(err instanceof Error ? err.message : "החיבור נכשל. נסו שוב");
          })
          .finally(() => setBusy(false));
      },
      {
        config_id: data.signup.configId,
        response_type: "code",
        override_default_response_type: true,
        /*
         * ‎**שמות השדות הם חוזה עם Meta, לא סגנון.**
         *
         * ‏`sessionInfoVersion: "3"` הוא מה שמבקש את גרסת ה-session
         * info שממנה מגיעים `waba_id` ו-`phone_number_id`. כאן ישב
         * ‎`version: "v3"` — מפתח שאינו קיים אצל Meta, ולכן נבלע
         * בשקט והזרימה חזרה לגרסה ישנה. `featureType` מהשרת, כי
         * זרימת הדו-קיום דורשת אפליקציה מאושרת.
         */
        extras: {
          setup: {},
          featureType: data.signup.featureType,
          sessionInfoVersion: "3",
        },
      },
    );
  }, [coexistence, data, ensureSdk, load]);

  const disconnect = useCallback(
    (id: string) => {
      setError(null);
      setNotice(null);
      setBusy(true);
      apiDelete(`/whatsapp/connections/${id}`)
        .then(() => {
          setNotice(
            coexistence
              ? "המספר נותק. הוא ממשיך לעבוד באפליקציה בטלפון כרגיל"
              : "המספר נותק ופניות אינן נכנסות יותר. החזרתו לאפליקציה שבטלפון נעשית מול Meta",
          );
          load();
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : "הניתוק נכשל. נסו שוב");
        })
        .finally(() => setBusy(false));
    },
    [coexistence, load],
  );

  if (failed) {
    return (
      <section aria-labelledby="wa-biz-heading" className="mv-list-card px-5 py-[17px]">
        <h2 id="wa-biz-heading" className="m-0 mb-3" style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}>
          וואטסאפ ביזנס
        </h2>
        <LoadError message="לא הצלחנו לטעון את מצב החיבור" onRetry={load} />
      </section>
    );
  }
  if (!data) return null;

  const active = data.connections.filter((c) => c.disconnectedAt === null);

  return (
    <section aria-labelledby="wa-biz-heading" className="mv-list-card px-5 py-[17px]">
      <h2 id="wa-biz-heading" className="m-0 mb-1" style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}>
        וואטסאפ ביזנס — המספר שלכם
      </h2>
      <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        חברו את המספר העסקי שלכם, ופניות של לקוחות ייכנסו למערכת כלידים עם ציר
        זמן מלא{" "}
        {coexistence
          ? "— בזמן שאתם ממשיכים לענות מהאפליקציה בטלפון כרגיל."
          : "— והמענה עובר להתנהל מהמערכת. קראו למטה מה זה משנה במספר לפני שאתם מחברים."}
      </p>

      {error ? (
        <p role="alert" className="mb-3 text-sm" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mb-3 text-sm" style={{ color: "var(--color-success)" }}>
          {notice}
        </p>
      ) : null}

      {active.length > 0 ? (
        <ul className="mb-4 flex flex-col gap-3">
          {active.map((connection) => {
            const label = STATUS_LABELS[connection.status] ?? {
              text: connection.status,
              tone: "warn" as const,
            };
            return (
              <li
                key={connection.id}
                className="rounded-xl border p-4"
                style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium" dir="ltr">
                    +{connection.displayPhone}
                  </span>
                  <span
                    className="text-sm"
                    style={{
                      color:
                        label.tone === "ok"
                          ? "var(--color-success)"
                          : label.tone === "bad"
                            ? "var(--color-danger)"
                            : "var(--color-text-muted)",
                    }}
                  >
                    {label.text}
                  </span>
                </div>
                {connection.verifiedName ? (
                  <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
                    השם שהלקוחות רואים: {connection.verifiedName}
                  </p>
                ) : null}
                <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
                  חובר ב-{formatDateTime(connection.connectedAt)}
                  {connection.qualityRating ? ` · דירוג איכות: ${connection.qualityRating}` : ""}
                </p>
                {connection.status === "payment_required" ? (
                  <p className="mt-2 text-sm">
                    הודעות בתשלום נחסמות עד שיוגדר אמצעי תשלום בחשבון ה-Meta שלכם.
                    קליטת פניות ומענה בתוך 24 שעות ממשיכים לעבוד.
                  </p>
                ) : null}
                {/*
                  ‏„החיבור לא הושלם” היה מטעה כאן: החיבור הושלם ועבד
                  חודשיים, וההרשאה שנתתם ל-Meta היא זו שפגה. ההסבר
                  אומר גם מה **לא** נשבר — הוואטסאפ בטלפון — כי זו
                  השאלה הראשונה שמתווך שואל כשהוא רואה אדום.
                */}
                {connection.disconnectReason === "token_expired" ? (
                  <p className="mt-2 text-sm">
                    ההרשאה שנתתם למערכת על המספר הזה פגה, ולידים מהוואטסאפ אינם
                    נכנסים כרגע. חיבור מחדש למטה מחזיר הכול
                    {coexistence
                      ? " — השיחות עצמן ממשיכות לעבוד באפליקציה בטלפון כרגיל."
                      : "; עד אז לא נכנסות פניות מהמספר הזה."}
                  </p>
                ) : null}
                <button
                  type="button"
                  className="mv-button mv-button--secondary mt-3"
                  disabled={busy}
                  onClick={() => disconnect(connection.id)}
                >
                  ניתוק המספר
                </button>

                {/*
                  הגדרות הבוט יושבות בתוך כרטיס הקו ולא בסעיף נפרד:
                  הבוט עונה **על הקו הזה**, וסוכן עם שני קווים צריך
                  לדעת לאיזה מהם ההגדרה שייכת.
                */}
                <WhatsAppBotPanel connectionId={connection.id} included={data.botIncluded} />
              </li>
            );
          })}
        </ul>
      ) : null}

      {data.signup === null ? (
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          חיבור עצמאי של מספרים טרם הופעל בפלטפורמה — פנו לתמיכה.
        </p>
      ) : (
        <>
          <InfoPanel botIncluded={data.botIncluded} coexistence={coexistence} />
          <button
            type="button"
            className="mv-button mv-button--primary mt-3"
            disabled={busy}
            onClick={() => void connect()}
          >
            {busy ? "מחברים…" : active.length > 0 ? "חיבור מספר נוסף" : "חבר וואטסאפ ביזנס"}
          </button>
        </>
      )}
    </section>
  );
}
