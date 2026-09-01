"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiDelete, apiGet, apiList, apiPost } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { LoadError } from "../load-error";

/**
 * חיבור המספר העסקי של המשרד לוואטסאפ (docs/12).
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
  signup: { appId: string; configId: string } | null;
  botIncluded: boolean;
}

/** מה שהמשרד מרוויח. נוסח בלשון תועלת, לא בלשון תכונה. */
const BENEFITS = [
  "כל פנייה בוואטסאפ נכנסת כליד עם שם, מספר וההודעה המקורית — בלי העתקה ידנית",
  "ציר זמן מלא בכרטיס הלקוח, כולל מה שעניתם ידנית מהטלפון",
  "אפשר לייבא עד חצי שנה של שיחות קיימות ביום החיבור",
  "אתם ממשיכים לעבוד באפליקציה בטלפון בדיוק כמו היום — אותו מספר, אותן שיחות",
  "הלקוחות רואים את המספר שלכם, לא מספר של המערכת",
];

/** מה שנכבה או אינו נתמך. מוצג לפני הלחיצה, לא אחריה. */
const LIMITATIONS = [
  "הודעות נעלמות, „צפייה חד-פעמית” ושיתוף מיקום חי — נכבות בשיחות אישיות",
  "רשימות תפוצה קיימות הופכות לקריאה בלבד; אי אפשר ליצור חדשות",
  "קבוצות, שיחות קול ווידאו, סטטוסים וקטלוג — ממשיכים לעבוד באפליקציה, אך אינם נכנסים למערכת",
  "‏WhatsApp for Windows ושעון חכם אינם נתמכים; מכשירים מקושרים אחרים ינותקו וניתן לקשר אותם מחדש",
  "המספר צריך להיות פעיל באפליקציית WhatsApp Business לפחות שבוע (מומלץ חודש)",
  "סנכרון ההיסטוריה חייב להסתיים תוך 24 שעות מהחיבור, אחרת יש לחבר מחדש",
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
function InfoPanel({ botIncluded }: { botIncluded: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <div
        className="rounded-xl border p-4"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <p className="mb-2 font-medium">מה זה נותן לכם</p>
        <Bullets items={BENEFITS} marker="✓" />
      </div>

      <div
        className="rounded-xl border p-4"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <p className="mb-2 font-medium">מה משתנה או מוגבל</p>
        <p className="mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
          אלה מגבלות של Meta על מספר שמחובר גם לאפליקציה וגם למערכת — לא בחירה
          שלנו. הן מתבטלות אם תנתקו.
        </p>
        <Bullets items={LIMITATIONS} marker="•" />
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
              הלידים, ציר הזמן וסנכרון ההיסטוריה פתוחים בכל מסלול.
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
        if (!code || !assets) {
          /*
           * אין קוד = המתווך סגר את החלון. אין assets = הוא עבר את
           * ההתחברות אך לא סיים את בחירת המספר. שתי הודעות שונות
           * במכוון: הן מובילות לפעולה שונה.
           */
          setError(
            code
              ? "החיבור לא הושלם — לא נבחר מספר. התחילו שוב וסיימו את כל שלבי החלון"
              : "החיבור בוטל לפני שהושלם. אפשר לנסות שוב מתי שנוח",
          );
          setBusy(false);
          return;
        }
        apiPost<{ connection: Connection }>("/whatsapp/connections", { code, ...assets })
          .then(() => {
            setNotice("המספר חובר. סנכרון ההיסטוריה עשוי להימשך עד 24 שעות");
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
        extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", version: "v3" },
      },
    );
  }, [data, ensureSdk, load]);

  const disconnect = useCallback(
    (id: string) => {
      setError(null);
      setNotice(null);
      setBusy(true);
      apiDelete(`/whatsapp/connections/${id}`)
        .then(() => {
          setNotice("המספר נותק. הוא ממשיך לעבוד באפליקציה בטלפון כרגיל");
          load();
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : "הניתוק נכשל. נסו שוב");
        })
        .finally(() => setBusy(false));
    },
    [load],
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
        זמן מלא — בזמן שאתם ממשיכים לענות מהאפליקציה בטלפון כרגיל.
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
                <button
                  type="button"
                  className="mv-button mv-button--secondary mt-3"
                  disabled={busy}
                  onClick={() => disconnect(connection.id)}
                >
                  ניתוק המספר
                </button>
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
          <InfoPanel botIncluded={data.botIncluded} />
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
