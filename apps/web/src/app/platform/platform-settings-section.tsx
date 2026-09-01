"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@metavchim/ui";
import { API_BASE, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import {
  MAX_PLATFORM_FEE_PERCENT,
  PLATFORM_REFERRAL_FEE_PERCENT,
  referralPayout,
} from "@metavchim/shared";
import { IconCard, IconChat, IconCoins, IconDoc, IconKey, IconLock, IconMail, IconPhone, IconPin } from "../icons";
import { Notice } from "../notice";

/**
 * הגדרות הפלטפורמה — מפתחות הספקים (Postmark, WhatsApp) והפעלת אימות
 * הכניסה, ישירות מהמסך במקום SSH. הערכים נשמרים מוצפנים ולעולם לא
 * מוחזרים לדפדפן — מוצג רק "מוגדר / לא מוגדר".
 */

const inputStyle = { borderColor: "var(--color-input-border)", background: "var(--color-field)" } as const;

/**
 * כתובת ה-Webhook המלאה להדבקה אצל הספק.
 *
 * הסוד הוא **חלק מהנתיב**, ולכן "‎…/inbound/<הסוד>" אינו הוראה אלא
 * חידה: מי שהגיע לכאן צריך להדביק כתובת בפוסטמרק, ואין לו מאיפה
 * להרכיב אותה. הסוד עצמו אינו חוזר מהשרת (וטוב שכך), ולכן הכתובת
 * נבנית כאן מ**מה שהוקלד עכשיו** — הרגע היחיד שבו הוא ידוע לדפדפן.
 *
 * מי שכבר שמר סוד ואינו זוכר אותו מקבל את האמת: המערכת אינה מציגה
 * אותו שוב, והדרך לכתובת היא להקליד אותו כאן. עדיף מאשר להשאיר אותו
 * מול שורת מציין-מיקום שנראית כמו כתובת ואינה עובדת.
 */
function WebhookUrl({
  path,
  secret,
  alreadySet,
}: {
  /** הנתיב מתחת ל-`API_BASE`, כולל הלוכסן הסוגר. */
  path: string;
  /** מה שהוקלד בשדה הסוד ברגע זה. */
  secret: string;
  /** האם סוד כלשהו כבר שמור בשרת. */
  alreadySet: boolean;
}) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");

  // אחרי ההרכבה בלבד: ‎window‎ אינו קיים ברינדור בשרת
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const trimmed = secret.trim();
  /*
   * הבסיס הוא `API_BASE` ולא מקור העמוד: הנתיבים האלה חיים על שרת
   * ה-API, ו-`NEXT_PUBLIC_API_URL` יכול להצביע על מארח אחר לגמרי —
   * בפיתוח הוא ‎localhost:3001‎ בעוד המסך רץ על ‎3000‎, וכתובת שנבנתה
   * ממקור העמוד הייתה מחזירה 404 אצל הספק (ביקורת Codex).
   *
   * ‎`API_BASE` יחסי (`/api/v1`) הוא **מצב הפרודקשן**: התמונה נבנית
   * עם `NEXT_PUBLIC_API_URL` ריק בכוונה כדי שהדפדפן יפנה same-origin
   * דרך ה-Proxy. כתובת יחסית אי אפשר להדביק בפוסטמרק, ולכן דווקא שם
   * מוסיפים את מקור העמוד — שהוא באמת המארח הנכון.
   */
  const relative = API_BASE.startsWith("/");
  // בסיס יחסי ממתין ל-`origin`; בסיס מוחלט מוכן כבר ברינדור הראשון
  const ready = trimmed !== "" && (!relative || origin !== "");
  const base = relative ? `${origin}${API_BASE}` : API_BASE;
  const url = ready ? `${base}${path}${encodeURIComponent(trimmed)}` : "";

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setCopied("copied");
    } catch {
      // כישלון מדווח ככישלון: "הועתק" על לוח ריק גרוע מהודעת שגיאה
      setCopied("failed");
    }
  }

  if (url === "") {
    return (
      <p className="mt-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
        {alreadySet
          ? "כתובת ה-Webhook מכילה את הסוד, והמערכת אינה מציגה סודות שמורים. הקלידו אותו בשדה שלמעלה כדי לראות את הכתובת המלאה להדבקה."
          : "מלאו סוד (16 תווים לפחות) — כתובת ה-Webhook המלאה תופיע כאן להעתקה."}
      </p>
    );
  }

  return (
    <div className="mt-2 text-sm">
      <div className="mb-1" style={{ color: "var(--color-text-muted)" }}>
        כתובת ה-Webhook להדבקה בפוסטמרק:
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <code
          dir="ltr"
          className="min-w-0 flex-1 overflow-x-auto rounded-lg border px-3 py-2"
          style={{ borderColor: "var(--color-input-border)", background: "var(--color-field)" }}
        >
          {url}
        </code>
        <button
          type="button"
          className="mv-chip"
          aria-label="העתקת כתובת ה-Webhook"
          onClick={() => {
            void copy();
          }}
        >
          העתקה
        </button>
      </div>
      {copied === "idle" ? null : (
        <p className="mt-1" role="status" style={{ color: "var(--color-text-muted)" }}>
          {copied === "copied" ? "✓ הועתק" : "ההעתקה נכשלה — סמנו את הכתובת והעתיקו ידנית"}
        </p>
      )}
    </div>
  );
}

interface PlatformSettings {
  postmark: {
    configured: boolean;
    source: "db" | "env" | "none";
    emailFrom?: string;
    /** טוקן ה-Account מוגדר — משרדים יכולים לחבר דומיין משלהם */
    officeDomains: boolean;
    /** תיבת הדואר הפנימית — כתובת ה-Inbound; ריק = לא הוגדרה */
    inboundAddress: string;
    inboundSecretSet: boolean;
    /** תיבת התמיכה של הפלטפורמה — שרת Inbound נפרד. */
    supportInboundAddress: string;
    supportInboundSecretSet: boolean;
    supportServerTokenSet: boolean;
  };
  whatsapp: {
    configured: boolean;
    source: "db" | "env" | "none";
    webhookUrl: string;
    /** מספר הבוט לתצוגה — גיבוי לשליפה מ-Meta. הערך עצמו. */
    botNumber?: string;
    assistant: {
      configured: boolean;
      source: "db" | "env" | "none";
      prospectReply: string;
      /** תבנית ההתראה המאושרת ב-Meta; ריק = דחיפה רק בתוך חלון 24 השעות */
      notifyTemplate?: string;
      notifyTemplateLang?: string;
      /** התבנית נרשמה עם כפתור בכתובת דינמית; חסר = בלי כפתור */
      notifyTemplateButton?: boolean;
      intakeTemplate?: string;
      intakeTemplateLang?: string;
      intakeTemplateButton?: boolean;
      viewingReminderTemplate?: string;
      viewingReminderTemplateLang?: string;
      /** התבנית נושאת חמישה שדות; חסר = נוסח אחד */
      viewingReminderTemplateFields?: boolean;
      viewingReminderTemplateButtons?: boolean;
      emailReplyTemplate?: string;
      emailReplyTemplateLang?: string;
    };
  };
  google: {
    configured: boolean;
    source: "db" | "env" | "none";
    redirectUri: string;
    redirectUris: { label: string; url: string }[];
  };
  /** אופציונלי — שרת ישן עוד לא מחזיר אותו, והמסך לא נופל על זה */
  gemini?: {
    configured: boolean;
    source: "db" | "env" | "none";
    /** המודל בתוקף */
    model: string;
    /** הערך השמור; ריק = ברירת המחדל שבקוד */
    modelOverride?: string;
  };
  cardcom: { configured: boolean; source: "db" | "env" | "none"; webhookUrl: string };
  /** לינט — הפקת חשבוניות מס קבלה על כל תשלום שנגבה. */
  linet: {
    configured: boolean;
    loginId: string;
    companyId: string;
    keySet: boolean;
    baseUrl: string;
    docType: string;
    vatCatTaxable: string;
    paymentType: string;
    itemId: string;
    vatPercent: number;
    missing: string[];
  };
  loginOtpEnabled: boolean;
  /** אחוז עמלת ההפניות — ערך ולא סטטוס; שרת ישן לא מחזיר אותו. */
  referralFeePercent?: number;
  maps?: { configured: boolean };
  geocoding?: { provider: string; forward: boolean; reverse: boolean };
  /** כתובת התמיכה — הערך עצמו. אופציונלי לשמרנות מול שרת שטרם עודכן. */
  supportEmail?: string;
  /**
   * קוד מסלול השותפים, ולצדו מה הוא פותר לו עכשיו בקטלוג.
   * ‎`partnerPlan: null` = הקוד ריק או שאינו קיים; הקוד שלצדו מבחין.
   */
  partnerPlanCode?: string;
  partnerPlan?: { name: string; isFree: boolean } | null;
  /** קטלוג המסלולים לבחירה; שרת ישן לא מחזיר אותו, ואז אין מה לבחור. */
  partnerPlanOptions?: { code: string; name: string; isFree: boolean }[];
  /** השכרת מספרים מ-015 — הערכים העסקיים; הסיסמה רק "מוגדרת/לא". */
  numberRental?: {
    configured: boolean;
    username: string;
    passwordSet: boolean;
    ingroup: string;
    monthlyAgorot: number | null;
  };
}

function StatusBadge({ configured, source }: { configured: boolean; source: string }) {
  return (
    <span
      className="rounded-full px-3 py-0.5 text-sm font-medium"
      style={{
        background: configured ? "var(--color-primary-soft)" : "var(--color-hover-soft)",
        color: configured ? "var(--color-primary)" : "var(--color-text-muted)",
      }}
    >
      {configured ? (source === "env" ? "✓ מוגדר (משרת)" : "✓ מוגדר") : "לא מוגדר"}
    </span>
  );
}

/**
 * `onReferralFeeChange` — עמלת ההפניה נערכת כאן אבל מוצגת גם
 * ב-`CreditEconomySection` (היא `feeCreditsPercent` שלה). שמירה כאן
 * חייבת לרענן גם שם, אחרת האזהרה על תמחור מפסיד מציגה את המצב
 * הקודם בדיוק ברגע שנוצר ההפסד.
 */
export function PlatformSettingsSection({
  onReferralFeeChange,
}: {
  onReferralFeeChange?: () => void;
} = {}) {
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /*
   * הבדיקות רצות 10–30 שניות (קריאות אמת לספק), והתוצאה מוצגת בראש
   * המסך — רחוק מהכפתור. בלי חיווי על הכפתור עצמו ובלי גלילה אל
   * התוצאה, הלחיצה נראית כאילו לא עשתה כלום (דיווח המשתמש:
   * "הכפתור לא מגיב").
   */
  const [probing, setProbing] = useState<"gemini" | "cardcom" | "whatsapp" | "linet" | null>(null);
  /*
   * שני סודות ה-Webhook נשמרים גם בזיכרון המסך, ולא רק ב-DOM: הכתובת
   * המלאה נבנית מהם, וזה הרגע היחיד שבו הדפדפן יודע אותם. הם אינם
   * נשלחים לשום מקום מלבד אותה שמירה שהמשתמש ביקש.
   */
  const [officeInboundSecret, setOfficeInboundSecret] = useState("");
  const [supportSecret, setSupportSecret] = useState("");
  const noticeRef = useRef<HTMLDivElement | null>(null);
  const showProbeResult = (): void => {
    // אחרי הרינדור של ההודעה — אחרת גוללים אל תיבה שעוד לא קיימת
    requestAnimationFrame(() => {
      noticeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  function load() {
    apiGet<PlatformSettings>("/platform/settings")
      .then(setSettings)
      .catch(() => undefined);
  }

  useEffect(load, []);

  /**
   * תיבת התמיכה — הכתובת שהפניות **נכנסות** אליה.
   *
   * טופס נפרד מכתובת ההתראה שמעליו, ובכוונה: אחת אומרת "לאן להודיע
   * לי", והשנייה "מאיפה לקרוא ולענות". הסוד נשלח רק כשהוקלד, כמו כל
   * סוד אחר במסך הזה.
   */
  async function saveSupportInbox(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    const form = event.currentTarget;
    const f = new FormData(form);
    const secret = String(f.get("supportInboundSecret") ?? "").trim();
    const serverToken = String(f.get("supportServerToken") ?? "").trim();
    try {
      await apiPatch("/platform/settings", {
        supportInboundAddress: String(f.get("supportInboundAddress") ?? "").trim(),
        ...(secret !== "" ? { supportInboundSecret: secret } : {}),
        ...(serverToken !== "" ? { supportServerToken: serverToken } : {}),
      });
      /*
       * ‏`reset` אינו מנקה את שדה הסוד — הוא מבוקר (controlled), וזה
       * במכוון: כתובת ה-Webhook נבנית ממנו, והצורך בה מגיע דווקא
       * **אחרי** השמירה, כשהולכים להדביק אותה בפוסטמרק. ניקוי היה
       * מחזיר בדיוק את המבוי הסתום שהשדה הזה בא לפתור.
       */
      form.reset();
      setMessage("✓ תיבת התמיכה נשמרה — העתיקו את כתובת ה-Webhook שמתחת");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function saveEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    const form = event.currentTarget;
    const f = new FormData(form);
    try {
      const token = String(f.get("postmarkServerToken")).trim();
      const accountToken = String(f.get("postmarkAccountToken")).trim();
      const inboundSecret = String(f.get("emailInboundSecret")).trim();
      await apiPatch("/platform/settings", {
        ...(token !== "" ? { postmarkServerToken: token } : {}),
        ...(accountToken !== "" ? { postmarkAccountToken: accountToken } : {}),
        emailFrom: String(f.get("emailFrom")).trim(),
        emailInboundAddress: String(f.get("emailInboundAddress")).trim(),
        ...(inboundSecret !== "" ? { emailInboundSecret: inboundSecret } : {}),
      });
      // הסוד נשאר בשדה בכוונה — ראו ההסבר ב-saveSupportInbox
      form.reset();
      setMessage("✓ הגדרות האימייל נשמרו");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  /**
   * חשבון 015 להשכרת מספרים. שם המשתמש והקבוצה נשלחים כמו שהם
   * (ריק = מחיקה); הסיסמה נשלחת רק כשהוקלדה — ריק = ללא שינוי,
   * כמו בכל הסודות. המחיר בשקלים במסך ובאגורות בשרת.
   */
  async function saveNumberRental(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    const f = new FormData(event.currentTarget);
    try {
      const password = String(f.get("pbx015AuthPassword") ?? "").trim();
      const shekels = String(f.get("rentalMonthly") ?? "").trim();
      const monthly = Number(shekels);
      await apiPatch("/platform/settings", {
        pbx015AuthUsername: String(f.get("pbx015AuthUsername") ?? "").trim(),
        ...(password !== "" ? { pbx015AuthPassword: password } : {}),
        pbx015Ingroup: String(f.get("pbx015Ingroup") ?? "").trim(),
        virtualNumberMonthlyAgorot:
          shekels !== "" && Number.isFinite(monthly) && monthly > 0
            ? Math.round(monthly * 100)
            : "",
      });
      setMessage("✓ הגדרות השכרת המספרים נשמרו");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function saveWhatsApp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    const form = event.currentTarget;
    const f = new FormData(form);
    try {
      const secret = String(f.get("whatsappAppSecret")).trim();
      const verify = String(f.get("whatsappVerifyToken")).trim();
      const accessToken = String(f.get("whatsappAccessToken") ?? "").trim();
      const phoneNumberId = String(f.get("whatsappPhoneNumberId") ?? "").trim();
      const appId = String(f.get("whatsappAppId") ?? "").trim();
      const signupConfigId = String(f.get("whatsappSignupConfigId") ?? "").trim();
      const botNumber = String(f.get("whatsappBotNumber") ?? "").trim();
      const prospectReply = String(f.get("whatsappProspectReply") ?? "").trim();
      const notifyTemplate = String(f.get("whatsappNotifyTemplate") ?? "").trim();
      const notifyTemplateLang = String(f.get("whatsappNotifyTemplateLang") ?? "").trim();
      const intakeTemplate = String(f.get("whatsappIntakeTemplate") ?? "").trim();
      const intakeTemplateLang = String(f.get("whatsappIntakeTemplateLang") ?? "").trim();
      // תיבת סימון שאינה מסומנת אינה מופיעה ב-FormData כלל — היעדר הוא "כבוי"
      const notifyTemplateButton = f.get("whatsappNotifyTemplateButton") !== null;
      const intakeTemplateButton = f.get("whatsappIntakeTemplateButton") !== null;
      const reminderTemplateFields = f.get("whatsappViewingReminderTemplateFields") !== null;
      const reminderTemplateButtons = f.get("whatsappViewingReminderTemplateButtons") !== null;
      const reminderTemplate = String(f.get("whatsappViewingReminderTemplate") ?? "").trim();
      const reminderTemplateLang = String(
        f.get("whatsappViewingReminderTemplateLang") ?? "",
      ).trim();
      const emailReplyTemplate = String(f.get("whatsappEmailReplyTemplate") ?? "").trim();
      const emailReplyTemplateLang = String(
        f.get("whatsappEmailReplyTemplateLang") ?? "",
      ).trim();
      await apiPatch("/platform/settings", {
        ...(secret !== "" ? { whatsappAppSecret: secret } : {}),
        ...(verify !== "" ? { whatsappVerifyToken: verify } : {}),
        ...(accessToken !== "" ? { whatsappAccessToken: accessToken } : {}),
        ...(phoneNumberId !== "" ? { whatsappPhoneNumberId: phoneNumberId } : {}),
        ...(appId !== "" ? { whatsappAppId: appId } : {}),
        ...(signupConfigId !== "" ? { whatsappSignupConfigId: signupConfigId } : {}),
        // ‎`botNumber` נשלח תמיד, גם ריק: הוא גיבוי שמכוון למחוק אותו
        // ברגע ש-Meta מתחילה לענות, וריק כאן פירושו „חזרו להסתמך על
        // Meta בלבד” ולא „בלי שינוי”
        whatsappBotNumber: botNumber,
        // נשלח תמיד, גם ריק: זה שדה ערך (כמו המסמכים המשפטיים),
        // וריקון מכוון הוא חזרה לנוסח המובנה — לא "בלי שינוי"
        whatsappProspectReply: prospectReply,
        // גם אלה שדות ערך: ריקון פירושו „אין תבנית”, כלומר דחיפה
        // רק בתוך חלון 24 השעות — מצב תקין ולא היעדר שינוי
        whatsappNotifyTemplate: notifyTemplate,
        whatsappNotifyTemplateLang: notifyTemplateLang,
        whatsappNotifyTemplateButton: notifyTemplateButton,
        whatsappIntakeTemplate: intakeTemplate,
        whatsappIntakeTemplateLang: intakeTemplateLang,
        whatsappIntakeTemplateButton: intakeTemplateButton,
        whatsappViewingReminderTemplate: reminderTemplate,
        whatsappViewingReminderTemplateLang: reminderTemplateLang,
        whatsappViewingReminderTemplateFields: reminderTemplateFields,
        whatsappViewingReminderTemplateButtons: reminderTemplateButtons,
        whatsappEmailReplyTemplate: emailReplyTemplate,
        whatsappEmailReplyTemplateLang: emailReplyTemplateLang,
      });
      form.reset();
      setMessage("✓ הגדרות הוואטסאפ נשמרו");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function saveGoogle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    const form = event.currentTarget;
    const f = new FormData(form);
    try {
      const clientId = String(f.get("googleClientId")).trim();
      const clientSecret = String(f.get("googleClientSecret")).trim();
      const geminiKey = String(f.get("geminiApiKey") ?? "").trim();
      const geminiModel = String(f.get("geminiModel") ?? "").trim();
      await apiPatch("/platform/settings", {
        ...(clientId !== "" ? { googleClientId: clientId } : {}),
        ...(clientSecret !== "" ? { googleClientSecret: clientSecret } : {}),
        ...(geminiKey !== "" ? { geminiApiKey: geminiKey } : {}),
        // שדה ערך ולא סוד: ריקון פירושו "חזרה לברירת המחדל שבקוד"
        geminiModel,
      });
      form.reset();
      setMessage("✓ הגדרות Google נשמרו — כפתור ההתחברות יופיע במסך הכניסה");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  /**
   * בדיקת חיבור אמיתית מול קארדקום.
   *
   * שדה מלא אינו אישור תקין: ספרה שהוקלדה לא נכון במספר המסוף, או שם
   * API של סביבת בדיקות, מתגלים אחרת רק בעסקה הראשונה של לקוח משלם.
   * הבדיקה פותחת דף תשלום ואינה גובה דבר — הכתובת פשוט לא נפתחת.
   */
  async function testCardcom(): Promise<void> {
    setBusy(true);
    setProbing("cardcom");
    setMessage(null);
    setError(null);
    try {
      const res = await apiPost<{ ok: boolean; terminalNumber: number; message: string }>(
        "/platform/settings/test-cardcom",
        {},
      );
      if (res.ok) setMessage(`✓ החיבור לקארדקום תקין (מסוף ${res.terminalNumber})`);
      else setError(`קארדקום דחה את הבקשה: ${res.message}`);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "בדיקת החיבור נכשלה");
    } finally {
      setBusy(false);
      setProbing(null);
      showProbeResult();
    }
  }

  /**
   * בדיקת חיבור אמיתית למנוע ההבנה החכמה.
   *
   * "זיהוי בסיסי" בכל פקודה קולית כשמפתח מוגדר הוא כשל שקט — הסיבה
   * חיה רק ביומן השרת. הבדיקה מריצה שתי קריאות אמת (פינג + פענוח
   * מלא בסכימה האמיתית) ומציגה את התשובה המדויקת של Google: מפתח
   * פסול, שם מודל שגוי, חסימת רשת או סכימה שנדחתה — כל אחד מהם
   * נראה כאן אחרת.
   */
  async function testGemini(): Promise<void> {
    setBusy(true);
    setProbing("gemini");
    setMessage(null);
    setError(null);
    try {
      const res = await apiPost<{
        model: string;
        ping: { ok: boolean; latencyMs: number; error?: string };
        interpret: { ok: boolean; latencyMs: number; error?: string; action?: string };
        lastFailure: { at: string; detail: string } | null;
      }>("/platform/settings/test-gemini", {});
      if (res.ping.ok && res.interpret.ok) {
        setMessage(
          `✓ מנוע ההבנה תקין (${res.model}): פינג ${res.ping.latencyMs}ms, פענוח מלא ${res.interpret.latencyMs}ms` +
            (res.interpret.action ? ` — זוהתה הפעולה "${res.interpret.action}"` : ""),
        );
      } else if (!res.ping.ok) {
        setError(`מנוע ההבנה לא מגיב (${res.model}): ${res.ping.error ?? "ללא פירוט"}`);
      } else {
        setError(
          `הפינג תקין אבל קריאת הפענוח המלאה נכשלת (${res.model}): ${res.interpret.error ?? "ללא פירוט"}`,
        );
      }
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "בדיקת החיבור נכשלה");
    } finally {
      setBusy(false);
      setProbing(null);
      showProbeResult();
    }
  }

  /**
   * בדיקת חיבור הסוכן האישי בוואטסאפ — קריאת אמת אל Meta על המספר.
   * טוקן שפג (הזמני חי 24 שעות) או מזהה שגוי מתגלים כאן, לא אצל
   * המתווך הראשון שכותב לסוכן.
   */
  async function testWhatsApp(): Promise<void> {
    setBusy(true);
    setProbing("whatsapp");
    setMessage(null);
    setError(null);
    try {
      const res = await apiPost<{ ok: boolean; message: string }>(
        "/platform/settings/test-whatsapp",
        {},
      );
      if (res.ok) setMessage(`✓ ${res.message}`);
      else setError(res.message);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "בדיקת החיבור נכשלה");
    } finally {
      setBusy(false);
      setProbing(null);
      showProbeResult();
    }
  }

  async function testLinet(): Promise<void> {
    setBusy(true);
    setProbing("linet");
    setMessage(null);
    setError(null);
    try {
      const res = await apiPost<{ ok: boolean; message: string }>(
        "/platform/settings/test-linet",
        {},
      );
      if (res.ok) setMessage(`✓ ${res.message}`);
      else setError(res.message);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "בדיקת החיבור נכשלה");
    } finally {
      setBusy(false);
      setProbing(null);
      showProbeResult();
    }
  }

  /*
   * שדה ריק = בלי שינוי, כמו בשאר הכרטיסים. זה מה שמאפשר לתקן קוד
   * אחד בלי להקליד מחדש את המפתח.
   */
  async function saveLinet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    const form = event.currentTarget;
    const f = new FormData(form);
    const patch: Record<string, string> = {};
    for (const key of [
      "linetLoginId",
      "linetKey",
      "linetCompanyId",
      "linetBaseUrl",
      "linetDocType",
      "linetVatCatTaxable",
      "linetPaymentType",
      "linetItemId",
      "vatPercent",
    ]) {
      const value = String(f.get(key) ?? "").trim();
      if (value !== "") patch[key] = value;
    }
    try {
      await apiPatch("/platform/settings", patch);
      form.reset();
      setMessage("✓ הגדרות לינט נשמרו");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function saveCardcom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    const form = event.currentTarget;
    const f = new FormData(form);
    try {
      const terminal = String(f.get("cardcomTerminalNumber")).trim();
      const apiName = String(f.get("cardcomApiName")).trim();
      const apiPassword = String(f.get("cardcomApiPassword")).trim();
      await apiPatch("/platform/settings", {
        ...(terminal !== "" ? { cardcomTerminalNumber: terminal } : {}),
        ...(apiName !== "" ? { cardcomApiName: apiName } : {}),
        ...(apiPassword !== "" ? { cardcomApiPassword: apiPassword } : {}),
      });
      form.reset();
      setMessage("✓ פרטי הסליקה נשמרו — כפתור הרכישה יופיע במסך המנוי של כל משרד");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  /** בחירת ספק פענוח הכתובות. */
  async function saveProvider(provider: string) {
    setBusy(true);
    setError(null);
    try {
      await apiPatch("/platform/settings", { geocodingProvider: provider });
      await load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שמירת הספק נכשלה");
    } finally {
      setBusy(false);
    }
  }

  /** שמירת הגדרת טקסט בודדת; ריק מוחק ומחזיר לברירת המחדל. */
  async function saveSetting(key: string, raw: FormDataEntryValue | null) {
    setBusy(true);
    setError(null);
    try {
      await apiPatch("/platform/settings", { [key]: String(raw ?? "").trim() });
      await load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  /**
   * שמירת אחוז העמלה.
   *
   * ריק נשלח כריק ולא כאפס: אפס הוא "לא גובים", וריק הוא "חזרה
   * לברירת המחדל". השרת מבחין ביניהם, והמסך לא אמור להחליט במקומו.
   */
  async function saveReferralFee(raw: FormDataEntryValue | null) {
    const text = String(raw ?? "").trim();
    setBusy(true);
    setError(null);
    try {
      await apiPatch("/platform/settings", {
        referralFeePercent: text === "" ? "" : Number(text),
      });
      await load();
      /*
       * העמלה הזו היא `feeCreditsPercent` של כלכלת הרשת, שמוצגת
       * בסקציה אחרת. בלי ההודעה הזו האזהרה שם נשארת על המצב הישן
       * עד רענון הדף.
       */
      onReferralFeeChange?.();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שמירת העמלה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function toggleOtp(enabled: boolean) {
    setError(null);
    setMessage(null);
    try {
      await apiPatch("/platform/settings", { loginOtpEnabled: enabled });
      setMessage(
        enabled
          ? "✓ אימות הכניסה בקוד הופעל — בכניסה הבאה יישלח קוד למייל"
          : "✓ אימות הכניסה בקוד כובה",
      );
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "העדכון נכשל");
    }
  }

  async function sendTest() {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const { sentTo } = await apiPost<{ sentTo: string }>("/platform/settings/test-email", {});
      setMessage(`✓ מייל בדיקה נשלח אל ${sentTo} — בדקו את התיבה (וגם בספאם)`);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שליחת מייל הבדיקה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  if (!settings) return null;

  return (
    <section aria-labelledby="platform-settings-heading" className="mb-8">
      <h2 id="platform-settings-heading" className="mb-1 text-lg font-semibold">
        חיבורי המערכת
      </h2>
      <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        מפתחות הספקים משותפים לכל המשרדים בפלטפורמה. הם נשמרים מוצפנים ולא מוצגים
        שוב אחרי השמירה.
      </p>

      <div ref={noticeRef}>
        {message ? (
          <Notice tone="success">{message}</Notice>
        ) : null}
        {error ? (
          <Notice tone="danger">{error}</Notice>
        ) : null}
      </div>

      {/* ---------- אימייל ---------- */}
      <div className="mb-4 rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold"><IconMail s={16} /> אימייל (Postmark)</h3>
          <StatusBadge configured={settings.postmark.configured} source={settings.postmark.source} />
        </div>
        <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
          נדרש לאיפוס סיסמה ולאימות כניסה. הטוקן: Postmark ⟵ Servers ⟵ API Tokens.
          כתובת השולח חייבת להיות מאומתת ב-Postmark (Sender Signature או דומיין).
        </p>
        <form method="post" autoComplete="off" onSubmit={(e) => void saveEmail(e)} className="flex flex-wrap items-end gap-3">
          <div className="flex-1" style={{ minWidth: "220px" }}>
            <label htmlFor="postmarkServerToken" className="mb-1 block font-medium">
              Server Token {settings.postmark.configured ? <span className="font-normal">(ריק = ללא שינוי)</span> : null}
            </label>
            <input
              id="postmarkServerToken"
              name="postmarkServerToken"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              placeholder={settings.postmark.configured ? "••••••••" : ""}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div className="flex-1" style={{ minWidth: "220px" }}>
            <label htmlFor="emailFrom" className="mb-1 block font-medium">כתובת השולח</label>
            <input
              id="emailFrom"
              name="emailFrom"
              type="email"
              dir="ltr"
              required
              defaultValue={settings.postmark.emailFrom ?? ""}
              placeholder="no-reply@metavchim.co.il"
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          {/*
            טוקן ה-Account — נפרד מטוקן השרת ובעל הרשאות רחבות ממנו:
            הוא מה שמאפשר למשרדים לחבר דומיין משלהם (רישום הדומיין,
            הנפקת רשומות DKIM/Return-Path ואימותן). בלעדיו המסך של
            המשרד יציג "טרם הופעל"; השליחה הרגילה אינה תלויה בו.
          */}
          <div className="flex-1" style={{ minWidth: "220px" }}>
            <label htmlFor="postmarkAccountToken" className="mb-1 block font-medium">
              Account Token{" "}
              <span className="font-normal">
                {settings.postmark.officeDomains
                  ? "(ריק = ללא שינוי)"
                  : "(לדומיינים של משרדים)"}
              </span>
            </label>
            <input
              id="postmarkAccountToken"
              name="postmarkAccountToken"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              placeholder={settings.postmark.officeDomains ? "••••••••" : ""}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          {/*
            תיבת הדואר הפנימית: כתובת ה-Inbound של שרת Postmark, והסוד
            שסוגר את נתיב ה-Webhook. עם שניהם — מיילים ללקוחות נושאים
            Reply-To ייחודי ותשובות נכנסות לתיבה; בלעדיהם הכל ממשיך
            כרגיל. כתובת ה-Webhook המלאה מוצגת מתחת לטופס ברגע שהסוד מוקלד.
          */}
          <div className="flex-1" style={{ minWidth: "220px" }}>
            <label htmlFor="emailInboundAddress" className="mb-1 block font-medium">
              כתובת Inbound{" "}
              <span className="font-normal">(תיבת המייל הפנימית — תשובות לקוחות)</span>
            </label>
            <input
              id="emailInboundAddress"
              name="emailInboundAddress"
              type="email"
              dir="ltr"
              placeholder="abc123@inbound.postmarkapp.com"
              defaultValue={settings.postmark.inboundAddress}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div className="flex-1" style={{ minWidth: "220px" }}>
            <label htmlFor="emailInboundSecret" className="mb-1 block font-medium">
              סוד ה-Webhook הנכנס{" "}
              <span className="font-normal">
                {settings.postmark.inboundSecretSet ? "(ריק = ללא שינוי)" : "(16 תווים לפחות)"}
              </span>
            </label>
            <input
              id="emailInboundSecret"
              name="emailInboundSecret"
              value={officeInboundSecret}
              onChange={(e) => {
                setOfficeInboundSecret(e.target.value);
              }}
              type="password"
              dir="ltr"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              placeholder={settings.postmark.inboundSecretSet ? "••••••••" : ""}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <Button type="submit" disabled={busy}>שמור</Button>
          {settings.postmark.configured ? (
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void sendTest()}>
              שלח מייל בדיקה
            </Button>
          ) : null}
        </form>
        <WebhookUrl
          path="/public/email/inbound/"
          secret={officeInboundSecret}
          alreadySet={settings.postmark.inboundSecretSet}
        />
        <p className="mt-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
          Account Token (Postmark ⟵ Account ⟵ API Tokens) מפעיל למשרדים חיבור
          דומיין משלהם לשליחה — {settings.postmark.officeDomains ? "מוגדר ופעיל." : "טרם הוגדר."}
        </p>
      </div>

      {/* ---------- כתובת התמיכה ---------- */}
      {/*
        כרטיס משלה, ומיד אחרי Postmark.
        קודם היא ישבה בתוך כרטיס "מפות", בין סגנון האריחים לפענוח
        הכתובות — הנימוק היה "זו הגדרת ספק", והוא הצדיק את המסך הזה
        ולא את המקום הזה. אף אחד לא מחפש כתובת מייל מתחת למפה, ובפועל
        היא לא נמצאה. שדה שאי אפשר למצוא שווה לשדה שלא קיים.
      */}
      <div
        id="support-email"
        className="mb-4 rounded-xl border p-4"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <h3 className="mb-1 font-semibold">
          <IconMail s={16} /> כתובת התמיכה
        </h3>
        <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
          לשם נשלחת התראה על כל פנייה חדשה מכפתור „תמיכה” שבצד כל מסך.{" "}
          <b>ריק = בלי התראה, לא בלי תמיכה</b> — הפניות נשמרות ומופיעות בתור „פניות
          לתמיכה” שבראש המסך הזה בכל מקרה. ההתראה רק מקצרת את זמן התגובה, ודורשת
          שגם Postmark יהיה מחובר למעלה.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void saveSetting("supportEmail", new FormData(e.currentTarget).get("supportEmail"));
          }}
          className="mb-4 flex flex-wrap items-end gap-2"
        >
          <label className="grow">
            <span className="mb-1 block text-sm font-semibold">
              כתובת דוא&quot;ל לקבלת פניות
            </span>
            <input
              name="supportEmail"
              type="email"
              dir="ltr"
              /*
                הערך השמור מוצג. בלי זה השדה חזר ריק אחרי כל שמירה,
                והמסך נראה כאילו הכפתור אינו עובד — בעוד שהשורה
                נכתבה במסד בהצלחה.
              */
              defaultValue={settings.supportEmail ?? ""}
              key={settings.supportEmail ?? ""}
              placeholder="service@example.co.il"
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </label>
          <Button type="submit" disabled={busy}>שמור</Button>
        </form>

        {/*
          תיבת התמיכה — הכתובת שהפניות **נכנסות** אליה, ולא זו שאליה
          נשלחת התראה. שדה נפרד ובכוונה: אחת היא "לאן להודיע לי", והשנייה
          היא "מאיפה לקרוא ולענות", ואיחודן היה מחייב שהתיבה הפרטית של
          המפעיל תהיה גם תיבת המערכת.
        */}
        <h4 className="mb-1 mt-4 font-semibold">תיבת התמיכה — קליטה ומענה מתוך המערכת</h4>
        <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
          שרת Inbound <b>נפרד</b> מזה של תשובות הלקוחות למשרדים: שני זרמים עם
          כללי זיהוי שונים. עם שני השדות האלה — פנייה שנשלחת לכתובת התמיכה
          נפתחת כשרשור במסך „תיבת התמיכה”, והמענה יוצא מכתובת המערכת.
        </p>
        <form
          method="post"
          autoComplete="off"
          onSubmit={(e) => void saveSupportInbox(e)}
          className="flex flex-wrap items-end gap-3"
        >
          <div className="flex-1" style={{ minWidth: "220px" }}>
            <label htmlFor="supportInboundAddress" className="mb-1 block font-medium">
              כתובת Inbound של התמיכה
            </label>
            <input
              id="supportInboundAddress"
              name="supportInboundAddress"
              type="email"
              dir="ltr"
              placeholder="abc123@inbound.postmarkapp.com"
              defaultValue={settings.postmark.supportInboundAddress}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div className="flex-1" style={{ minWidth: "220px" }}>
            <label htmlFor="supportInboundSecret" className="mb-1 block font-medium">
              סוד ה-Webhook{" "}
              <span className="font-normal">
                {settings.postmark.supportInboundSecretSet
                  ? "(ריק = ללא שינוי)"
                  : "(16 תווים לפחות)"}
              </span>
            </label>
            <input
              id="supportInboundSecret"
              name="supportInboundSecret"
              value={supportSecret}
              onChange={(e) => {
                setSupportSecret(e.target.value);
              }}
              type="password"
              dir="ltr"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              placeholder={settings.postmark.supportInboundSecretSet ? "••••••••" : ""}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div className="flex-1" style={{ minWidth: "220px" }}>
            <label htmlFor="supportServerToken" className="mb-1 block font-medium">
              Server Token של שרת התמיכה{" "}
              <span className="font-normal">
                {settings.postmark.supportServerTokenSet ? "(ריק = ללא שינוי)" : "(לא חובה)"}
              </span>
            </label>
            <input
              id="supportServerToken"
              name="supportServerToken"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              placeholder={settings.postmark.supportServerTokenSet ? "••••••••" : ""}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <Button type="submit" disabled={busy}>שמור</Button>
        </form>
        <p className="mt-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
          התשובות יוצאות מכתובת ה-Inbound שלמעלה. בלי Server Token הן נשלחות דרך
          השרת הכללי — עדיין מכתובת התמיכה, רק לא בזרם נפרד.
        </p>
        <WebhookUrl
          path="/public/support/inbound/"
          secret={supportSecret}
          alreadySet={settings.postmark.supportInboundSecretSet}
        />
      </div>

      {/*
        ‎**מסלול השותפים — השדה שלא היה.**

        התזכורות למי שלא הפעיל חשבון מבטיחות „מה שנשאר פתוח הוא מסלול
        השותפים”, והשולח מעביר את המשרד לשם. אבל הקוד היה קריא וכתיב
        ב-API בלבד: במסך לא היה שדה, ולכן ההגדרה נשארה ריקה לנצח —
        התזכורות יצאו, אף משרד לא עבר, ואיש לא ראה למה.
      */}
      <div
        id="partner-plan"
        className="mb-4 rounded-xl border p-4"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <h3 className="mb-1 font-semibold">מסלול השותפים</h3>
        <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
          לשם יורד משרד שסיים ניסיון בלי להפעיל כרטיס אשראי, במקום להינעל.{" "}
          <b>המסלול חייב להיות חינמי</b> — מסלול בתשלום פוקע בדיוק כמו הניסיון,
          והמשרד היה ננעל בכל מקרה. ריק = אין הורדה, והתזכורת אומרת „החשבון ננעל”
          בלי להמציא מסלול.
        </p>
        {/*
          ‎**בחירה מהקטלוג ולא הקלדת קוד.**

          קוד שמוקלד ביד יכול להיות שגוי — ואז אין העברה, אין שגיאה,
          ואיש אינו יודע עד שמישהו קורא את היומן. רשימה סוגרת את זה
          במקור: אי אפשר לבחור מסלול שאינו קיים.

          מסלולים בתשלום מוצגים מנוטרלים ולא נעלמים: „למה המסלול שלי
          לא ברשימה” היא שאלה שאין לה תשובה במסך, ו„בתשלום — לא
          מתאים” היא תשובה.
        */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void saveSetting(
              "partnerPlanCode",
              new FormData(e.currentTarget).get("partnerPlanCode"),
            );
          }}
          className="flex flex-wrap items-end gap-2"
        >
          <label className="grow">
            <span className="mb-1 block text-sm font-semibold">המסלול</span>
            <select
              name="partnerPlanCode"
              defaultValue={settings.partnerPlanCode ?? ""}
              key={settings.partnerPlanCode ?? ""}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            >
              <option value="">— אין. החשבון ננעל בתום הניסיון —</option>
              {(settings.partnerPlanOptions ?? []).map((plan) => (
                <option key={plan.code} value={plan.code} disabled={!plan.isFree}>
                  {plan.name}
                  {plan.isFree ? "" : " — בתשלום, לא מתאים"}
                </option>
              ))}
              {/*
                המסלול השמור נמחק מהקטלוג? הוא עדיין הערך הנוכחי, ובלי
                האפשרות הזאת ה-`select` היה מציג „אין” — כלומר משקר על
                מה ששמור, ושמירה אחת בטעות הייתה מוחקת אותו.
              */}
              {(settings.partnerPlanCode ?? "") !== "" &&
              !(settings.partnerPlanOptions ?? []).some(
                (plan) => plan.code === settings.partnerPlanCode,
              ) ? (
                <option value={settings.partnerPlanCode}>
                  {settings.partnerPlanCode} — אינו בקטלוג
                </option>
              ) : null}
            </select>
          </label>
          <Button type="submit" disabled={busy}>שמור</Button>
        </form>
        {/*
          ‎**מה הקוד פותר לו עכשיו** — לא רק מה נשמר. קוד שגוי אינו
          נכשל בשמירה: הוא נכשל חודש אחר כך, בשקט, ביומן.
        */}
        <p className="m-0 mt-2 text-sm">
          {(settings.partnerPlanCode ?? "") === "" ? (
            <span style={{ color: "var(--color-text-muted)" }}>
              לא הוגדר — התזכורות ייצאו בלי הצעת מסלול.
            </span>
          ) : settings.partnerPlan === null || settings.partnerPlan === undefined ? (
            <span style={{ color: "var(--color-danger)" }}>
              ✗ הקוד אינו בקטלוג המסלולים — לא תתבצע אף העברה.
            </span>
          ) : settings.partnerPlan.isFree ? (
            <span style={{ color: "var(--color-success)" }}>
              ✓ „{settings.partnerPlan.name}” — מסלול חינמי, ההעברה תעבוד.
            </span>
          ) : (
            <span style={{ color: "var(--color-danger)" }}>
              ✗ „{settings.partnerPlan.name}” אינו חינמי — משרד שיועבר אליו ייחסם
              בכל מקרה, ולכן אין העברה.
            </span>
          )}
        </p>
      </div>

      {/* ---------- חיבורי Google ---------- */}
      <div className="mb-4 rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {/*
            השם היה "התחברות עם Google" בלבד, ולכן מי שחיפש איפה
            מחברים את יומן Google או את Gmail הסיק שאין לזה מקום —
            בעוד ששלושתם קוראים בדיוק את אותם שני ערכים.
          */}
          {/*
            מזהה משלו: הקיצור בראש העמוד מכוון לכאן ולא לכותרת
            הכללית של "חיבורי המערכת" — קפיצה לשם הנחיתה את הקורא
            לפני כרטיס Postmark, וכרטיס Google נשאר מתחת למסך
            (ביקורת Codex).
          */}
          <h3 id="google-connections" className="font-semibold">
            <IconKey s={16} /> חיבורי Google — התחברות, יומן ו-Gmail
          </h3>
          <StatusBadge configured={settings.google.configured} source={settings.google.source} />
        </div>
        <p className="mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
          מ-Google Cloud Console ⟵ APIs &amp; Services ⟵ Credentials ⟵ OAuth client ID
          (סוג: Web application). <strong>אותם שני ערכים משרתים את שלושת החיבורים</strong> —
          אין צורך ליצור אפליקציה נפרדת ליומן או ל-Gmail. ההתחברות פותחת חשבונות
          קיימים בלבד — משתמש שלא הוזמן למשרד לא ייכנס.
        </p>
        <div className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
          <p className="mb-1">
            כתובות החזרה שיש להזין ב-Google (Authorized redirect URIs) —{" "}
            <strong>כל השלוש</strong>, אחרת החיבור החסר ייפול על
            <code dir="ltr" className="mx-1">redirect_uri_mismatch</code>:
          </p>
          <ul className="m-0 list-none p-0">
            {settings.google.redirectUris.map((entry) => (
              <li key={entry.url} className="flex flex-wrap items-center gap-2 py-0.5">
                <span style={{ minWidth: 130 }}>{entry.label}</span>
                <code dir="ltr" className="rounded px-1" style={{ background: "var(--color-bg)" }}>
                  {entry.url}
                </code>
              </li>
            ))}
          </ul>
        </div>
        {/*
          שכבות ההגנה מפני מילוי אוטומטי אינן קישוט: Chrome התעלם
          מ-‎autocomplete="off"‎ בשדה סיסמה ומילא לתוך Client Secret את
          הסיסמה השמורה של המשתמש — הערך נשמר, ו-Google החזיר
          invalid_client על כל ההתחברות. ‎new-password‎ עוצר את הדפדפן,
          ו-data-1p-ignore/data-lpignore את מנהלי הסיסמאות החיצוניים.
        */}
        <form method="post" autoComplete="off" onSubmit={(e) => void saveGoogle(e)} className="flex flex-wrap items-end gap-3">
          <div className="flex-1" style={{ minWidth: "220px" }}>
            <label htmlFor="googleClientId" className="mb-1 block font-medium">
              Client ID {settings.google.configured ? <span className="font-normal">(ריק = ללא שינוי)</span> : null}
            </label>
            <input
              id="googleClientId"
              name="googleClientId"
              type="text"
              dir="ltr"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              placeholder={settings.google.configured ? "••••••••" : "…apps.googleusercontent.com"}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div className="flex-1" style={{ minWidth: "220px" }}>
            <label htmlFor="googleClientSecret" className="mb-1 block font-medium">
              Client Secret {settings.google.configured ? <span className="font-normal">(ריק = ללא שינוי)</span> : null}
            </label>
            <input
              id="googleClientSecret"
              name="googleClientSecret"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              placeholder={settings.google.configured ? "••••••••" : ""}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          {/*
            מפתח Gemini באותו טופס: שני מפתחות Google, מסך אחד.
            "מוגדר" מציג גם את המודל שרץ בפועל — אחרת אין דרך לדעת.

            ‎**התווית אמרה „פקודות קוליות” בלבד, וזה היה מטעה.**
            אותו מפתח מפעיל גם את הבנת השיחות: הסיכום שנכתב אחרי
            תמלול, וההפרדה בין המתווך ללקוח. מנהל שאינו משתמש
            בפקודות קוליות דילג על השדה בהיגיון מלא — ואיבד את
            שניהם בלי שאיש אמר לו. ההשבתה שקטה לגמרי: השיחה
            מתומללת, הסיכום נופל לחילוץ דטרמיניסטי, ואין שגיאה.
          */}
          <div className="flex-1" style={{ minWidth: "220px" }}>
            <label htmlFor="geminiApiKey" className="mb-1 block font-medium">
              Gemini API Key{" "}
              <span className="font-normal">(פקודות קוליות + סיכומי שיחות)</span>{" "}
              {settings.gemini?.configured ? (
                <span className="font-normal">
                  ✓ מוגדר · {settings.gemini.model} (ריק = ללא שינוי)
                </span>
              ) : null}
            </label>
            <input
              id="geminiApiKey"
              name="geminiApiKey"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              placeholder={settings.gemini?.configured ? "••••••••" : "מ-Google AI Studio"}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
            {settings.gemini?.configured ? null : (
              <p className="mt-1 text-sm" style={{ color: "var(--color-warning)" }}>
                ⚠️ בלי המפתח הזה שיחות עדיין מתומללות, אבל <strong>הסיכום נכתב
                בחילוץ אוטומטי פשוט</strong> („הביע עניין · 4 חדרים”) ו<strong>אין
                הפרדה בין המתווך ללקוח</strong> בתמלול. אין שגיאה ואין התראה —
                זה פשוט נראה כאילו זו איכות המערכת.
              </p>
            )}
          </div>
          <div className="flex-1" style={{ minWidth: "220px" }}>
            <label htmlFor="geminiModel" className="mb-1 block font-medium">
              מודל Gemini <span className="font-normal">(ריק = ברירת המחדל שבקוד)</span>
            </label>
            <input
              id="geminiModel"
              name="geminiModel"
              dir="ltr"
              key={settings.gemini?.modelOverride ?? ""}
              defaultValue={settings.gemini?.modelOverride ?? ""}
              placeholder={settings.gemini?.model ?? ""}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
            <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
              ספקים מוציאים מודלים משימוש. השדה כאן מאפשר לעבור למודל אחר בלי
              גרסה חדשה — בדיוק במצב שבו הפקודות הקוליות מפסיקות לעבוד.
            </p>
          </div>
          <Button type="submit" disabled={busy}>שמור</Button>
          {/*
            בדיקה אמיתית ולא בדיקת שדה: "מוגדר" מכסה גם על מפתח פסול,
            שם מודל שכבר לא קיים, או שרת שחסום ליציאה אל Google — וכולם
            נראים למשתמש כ"זיהוי בסיסי" בכל פקודה, בלי שום הסבר.
          */}
          {settings.gemini?.configured ? (
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void testGemini()}>
              {probing === "gemini" ? "בודק מול Google… עד חצי דקה" : "בדיקת מנוע ההבנה"}
            </Button>
          ) : null}
        </form>
      </div>

      {/* ---------- סליקה (קארדקום) ---------- */}
      <div className="mb-4 rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold"><IconCard s={16} /> סליקה (קארדקום)</h3>
          <StatusBadge configured={settings.cardcom.configured} source={settings.cardcom.source} />
        </div>
        <p className="mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
          מספר המסוף ופרטי ה-API מאזור הניהול של קארדקום ⟵ הגדרות ⟵ משתמשי API.
          בלעדיהם מסך המנוי מציג &quot;התשלום המקוון טרם הופעל&quot; ואין כפתור רכישה.
        </p>
        <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
          פרטי כרטיס האשראי מוקלדים בדף של קארדקום ואינם עוברים במערכת בשום שלב.
        </p>
        {/*
          נאמר במפורש ולא מוסתר: בדיקת החיבור מאמתת מסוף ושם API בלבד,
          כי לקארדקום אין קריאה שמאמתת סיסמה בלי לזכות משהו. "✓ החיבור
          תקין" שהיה מכסה גם על סיסמה שגויה היה מתגלה בזיכוי הראשון.
        */}
        <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
          <strong>סיסמת ה-API נדרשת לזיכויים.</strong> בדיקת החיבור מאמתת את מספר המסוף
          ואת שם ה-API; הסיסמה נבדקת רק בזיכוי הראשון בפועל.
        </p>
        <div className="mb-3">
          <p className="mb-1 text-sm font-medium">כתובת ה-Webhook להזנה בקארדקום:</p>
          <p
            className="overflow-x-auto rounded-lg border p-2 font-mono text-sm"
            dir="ltr"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
          >
            {settings.cardcom.webhookUrl}
          </p>
        </div>
        <form method="post" autoComplete="off" onSubmit={(e) => void saveCardcom(e)} className="flex flex-wrap items-end gap-3">
          <div style={{ minWidth: "140px" }}>
            <label htmlFor="cardcomTerminalNumber" className="mb-1 block font-medium">
              מספר מסוף {settings.cardcom.configured ? <span className="font-normal">(ריק = ללא שינוי)</span> : null}
            </label>
            <input
              id="cardcomTerminalNumber"
              name="cardcomTerminalNumber"
              type="text"
              inputMode="numeric"
              dir="ltr"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              placeholder={settings.cardcom.configured ? "••••" : "1000"}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div className="flex-1" style={{ minWidth: "180px" }}>
            <label htmlFor="cardcomApiName" className="mb-1 block font-medium">
              שם משתמש API {settings.cardcom.configured ? <span className="font-normal">(ריק = ללא שינוי)</span> : null}
            </label>
            <input
              id="cardcomApiName"
              name="cardcomApiName"
              type="text"
              dir="ltr"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              placeholder={settings.cardcom.configured ? "••••••••" : ""}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div className="flex-1" style={{ minWidth: "180px" }}>
            <label htmlFor="cardcomApiPassword" className="mb-1 block font-medium">
              סיסמת API {settings.cardcom.configured ? <span className="font-normal">(ריק = ללא שינוי)</span> : null}
            </label>
            <input
              id="cardcomApiPassword"
              name="cardcomApiPassword"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              placeholder={settings.cardcom.configured ? "••••••••" : ""}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <Button type="submit" disabled={busy}>שמור</Button>
          {settings.cardcom.configured ? (
            <Button type="button" variant="ghost" disabled={busy} onClick={() => void testCardcom()}>
              {probing === "cardcom" ? "בודק…" : "בדוק חיבור"}
            </Button>
          ) : null}
        </form>
      </div>

      {/* ---------- חשבוניות (לינט) ---------- */}
      <div className="mb-4 rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold"><IconDoc s={16} /> חשבוניות מס קבלה (לינט)</h3>
          <StatusBadge configured={settings.linet.configured} source={settings.linet.configured ? "db" : "none"} />
        </div>
        <p className="mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
          על כל תשלום שנגבה מופקת בלינט חשבונית מס קבלה, והיא נשלחת ללקוח במייל.
          בלי ההגדרות כאן הגבייה עובדת כרגיל — פשוט בלי מסמך, והתשלומים
          שממתינים למסמך מוצגים למטה בסעיף החשבוניות.
        </p>
        <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
          ההזדהות בלינט היא <b>שלישייה</b>: מזהה API, מפתח ומזהה חברה — נוצרים
          בלינט מתוך המשתמש המחובר. הקודים שאחריהם הם של החשבון שלכם ונראים
          במסכי ההגדרות של לינט.
        </p>
        {settings.linet.missing.length > 0 ? (
          <p className="mb-3 text-sm" style={{ color: "var(--color-danger)" }}>
            חסר להפקה: {settings.linet.missing.join(", ")}
          </p>
        ) : null}
        <form method="post" autoComplete="off" onSubmit={(e) => void saveLinet(e)} className="flex flex-wrap items-end gap-3">
          <div className="flex-1" style={{ minWidth: "160px" }}>
            <label htmlFor="linetLoginId" className="mb-1 block font-medium">
              מזהה API {settings.linet.loginId !== "" ? <span className="font-normal">(ריק = ללא שינוי)</span> : null}
            </label>
            <input
              id="linetLoginId"
              name="linetLoginId"
              type="text"
              dir="ltr"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              placeholder={settings.linet.loginId || ""}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div className="flex-1" style={{ minWidth: "160px" }}>
            <label htmlFor="linetKey" className="mb-1 block font-medium">
              מפתח API {settings.linet.keySet ? <span className="font-normal">(ריק = ללא שינוי)</span> : null}
            </label>
            <input
              id="linetKey"
              name="linetKey"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              placeholder={settings.linet.keySet ? "••••••••" : ""}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div style={{ minWidth: "120px" }}>
            <label htmlFor="linetCompanyId" className="mb-1 block font-medium">
              מזהה חברה
            </label>
            <input
              id="linetCompanyId"
              name="linetCompanyId"
              type="text"
              dir="ltr"
              autoComplete="off"
              placeholder={settings.linet.companyId || ""}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div style={{ minWidth: "120px" }}>
            <label htmlFor="linetDocType" className="mb-1 block font-medium">
              קוד סוג מסמך
            </label>
            <input
              id="linetDocType"
              name="linetDocType"
              type="text"
              dir="ltr"
              autoComplete="off"
              placeholder={settings.linet.docType || "חשבונית מס קבלה"}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div style={{ minWidth: "120px" }}>
            <label htmlFor="linetVatCatTaxable" className="mb-1 block font-medium">
              קוד מע&quot;מ חייב
            </label>
            <input
              id="linetVatCatTaxable"
              name="linetVatCatTaxable"
              type="text"
              dir="ltr"
              autoComplete="off"
              placeholder={settings.linet.vatCatTaxable || ""}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div style={{ minWidth: "120px" }}>
            <label htmlFor="linetPaymentType" className="mb-1 block font-medium">
              קוד אמצעי תשלום
            </label>
            <input
              id="linetPaymentType"
              name="linetPaymentType"
              type="text"
              dir="ltr"
              autoComplete="off"
              placeholder={settings.linet.paymentType || "אשראי"}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div style={{ minWidth: "100px" }}>
            <label htmlFor="linetItemId" className="mb-1 block font-medium">
              קוד פריט
            </label>
            <input
              id="linetItemId"
              name="linetItemId"
              type="text"
              dir="ltr"
              autoComplete="off"
              placeholder={settings.linet.itemId || "1"}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div style={{ minWidth: "100px" }}>
            <label htmlFor="vatPercent" className="mb-1 block font-medium">
              מע&quot;מ (%)
            </label>
            <input
              id="vatPercent"
              name="vatPercent"
              type="text"
              inputMode="numeric"
              dir="ltr"
              autoComplete="off"
              placeholder={String(settings.linet.vatPercent)}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <Button type="submit" disabled={busy}>שמור</Button>
          {settings.linet.loginId !== "" && settings.linet.keySet ? (
            <Button type="button" variant="ghost" disabled={busy} onClick={() => void testLinet()}>
              {probing === "linet" ? "בודק…" : "בדוק חיבור"}
            </Button>
          ) : null}
        </form>
      </div>

      {/* ---------- השכרת מספרים (015) ---------- */}
      {settings.numberRental !== undefined ? (
        <div className="mb-4 rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold"><IconPhone s={16} /> השכרת מספרים וירטואליים (015)</h3>
            <StatusBadge
              configured={settings.numberRental.configured}
              source={settings.numberRental.configured ? "db" : "none"}
            />
          </div>
          <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
            חשבון ה-015 <strong>של הפלטפורמה</strong> — ממנו נקנים המספרים שמושכרים
            למשרדים. משרד ששוכר משלם חודש מראש, המספר נתפס אוטומטית, ותקבלו מייל על
            כל רכישה — הניתוב הסופי אצל 015 נשאר ידני. חלק מחודש מחויב כחודש מלא.
          </p>
          <form method="post" autoComplete="off" onSubmit={(e) => void saveNumberRental(e)} className="flex flex-wrap items-end gap-3">
            <div className="flex-1" style={{ minWidth: "160px" }}>
              <label htmlFor="pbx015AuthUsername" className="mb-1 block font-medium">
                שם משתמש ב-015
              </label>
              <input
                id="pbx015AuthUsername"
                name="pbx015AuthUsername"
                type="text"
                dir="ltr"
                autoComplete="new-password"
                data-1p-ignore
                data-lpignore="true"
                defaultValue={settings.numberRental.username}
                key={`u-${settings.numberRental.username}`}
                className="w-full rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
            </div>
            <div className="flex-1" style={{ minWidth: "160px" }}>
              <label htmlFor="pbx015AuthPassword" className="mb-1 block font-medium">
                סיסמה {settings.numberRental.passwordSet ? <span className="font-normal">(ריק = ללא שינוי)</span> : null}
              </label>
              <input
                id="pbx015AuthPassword"
                name="pbx015AuthPassword"
                type="password"
                dir="ltr"
                autoComplete="new-password"
                data-1p-ignore
                data-lpignore="true"
                placeholder={settings.numberRental.passwordSet ? "••••••••" : ""}
                className="w-full rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
            </div>
            <div style={{ minWidth: "130px" }}>
              <label htmlFor="pbx015Ingroup" className="mb-1 block font-medium">
                קבוצת נכנסות (ingroup)
              </label>
              <input
                id="pbx015Ingroup"
                name="pbx015Ingroup"
                type="text"
                inputMode="numeric"
                dir="ltr"
                defaultValue={settings.numberRental.ingroup}
                key={`g-${settings.numberRental.ingroup}`}
                className="w-full rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
            </div>
            <div style={{ minWidth: "150px" }}>
              <label htmlFor="rentalMonthly" className="mb-1 block font-medium">
                מחיר חודשי (₪, לפני מע&quot;מ)
              </label>
              <input
                id="rentalMonthly"
                name="rentalMonthly"
                type="number"
                min={0.01}
                step="0.01"
                dir="ltr"
                defaultValue={
                  settings.numberRental.monthlyAgorot === null
                    ? ""
                    : String(settings.numberRental.monthlyAgorot / 100)
                }
                key={`p-${settings.numberRental.monthlyAgorot ?? ""}`}
                className="w-full rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
            </div>
            <Button type="submit" disabled={busy}>שמור</Button>
          </form>
        </div>
      ) : null}

      {/* ---------- וואטסאפ ---------- */}
      <div className="mb-4 rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold"><IconChat s={16} /> וואטסאפ (Meta Cloud API)</h3>
          <StatusBadge configured={settings.whatsapp.configured} source={settings.whatsapp.source} />
        </div>
        <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
          מפתחות האפליקציה ב-Meta for Developers. כל משרד מזין אחר כך את המספר
          העסקי שלו בהגדרות שלו, וההודעות מנותבות אליו אוטומטית.
        </p>
        {/* הכתובת שמוזנת ב-Meta for Developers. היא ישבה קודם בהגדרות
            המשרד, שם מנהל משרד ראה פרט תפעולי של הפלטפורמה שאין לו שום
            דרך לפעול עליו — אין לו אפליקציית Meta. */}
        <div className="mb-3">
          <p className="mb-1 text-sm font-medium">כתובת ה-Webhook להזנה במטא:</p>
          <p
            className="overflow-x-auto rounded-lg border p-2 font-mono text-sm"
            dir="ltr"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
          >
            {settings.whatsapp.webhookUrl}
          </p>
        </div>
        <form method="post" autoComplete="off" onSubmit={(e) => void saveWhatsApp(e)} className="flex flex-wrap items-end gap-3">
          <div className="flex-1" style={{ minWidth: "220px" }}>
            <label htmlFor="whatsappAppSecret" className="mb-1 block font-medium">
              App Secret {settings.whatsapp.configured ? <span className="font-normal">(ריק = ללא שינוי)</span> : null}
            </label>
            <input
              id="whatsappAppSecret"
              name="whatsappAppSecret"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              placeholder={settings.whatsapp.configured ? "••••••••" : ""}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div className="flex-1" style={{ minWidth: "220px" }}>
            <label htmlFor="whatsappVerifyToken" className="mb-1 block font-medium">
              Verify Token <span className="font-normal">(אתם ממציאים אותו)</span>
            </label>
            <input
              id="whatsappVerifyToken"
              name="whatsappVerifyToken"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              placeholder={settings.whatsapp.configured ? "••••••••" : ""}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>

          {/* הסוכן האישי — הצד היוצא. בלעדיו המערכת קולטת ואינה עונה. */}
          <div className="w-full border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">הסוכן האישי — שליחת תשובות</p>
              <StatusBadge
                configured={settings.whatsapp.assistant.configured}
                source={settings.whatsapp.assistant.source}
              />
            </div>
            <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
              מתווך ששולח הודעה למספר הזה מקבל עוזרת אישית: היא מזהה אותו לפי
              הטלפון שבפרופיל שלו, מבינה, ומבצעת אחרי אישור. ה-Access Token חייב
              להיות טוקן קבוע של System User (הטוקן הזמני ממסך הפיתוח פג אחרי 24
              שעות); ה-Phone Number ID מופיע במסך WhatsApp ‏← API Setup, מתחת למספר.
            </p>
          </div>
          <div className="flex-1" style={{ minWidth: "220px" }}>
            <label htmlFor="whatsappAccessToken" className="mb-1 block font-medium">
              Access Token{" "}
              {settings.whatsapp.assistant.configured ? (
                <span className="font-normal">(ריק = ללא שינוי)</span>
              ) : null}
            </label>
            <input
              id="whatsappAccessToken"
              name="whatsappAccessToken"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              placeholder={settings.whatsapp.assistant.configured ? "••••••••" : ""}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div className="flex-1" style={{ minWidth: "220px" }}>
            <label htmlFor="whatsappPhoneNumberId" className="mb-1 block font-medium">
              Phone Number ID <span className="font-normal">(ספרות בלבד)</span>
            </label>
            <input
              id="whatsappPhoneNumberId"
              name="whatsappPhoneNumberId"
              type="text"
              dir="ltr"
              inputMode="numeric"
              autoComplete="off"
              placeholder={settings.whatsapp.assistant.configured ? "מוגדר" : ""}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          {/*
            ‎**המספר שהמשתמש רואה — לא זה ש-Meta מזהה לפיו.**

            ‎`Phone Number ID` הוא מזהה פנימי ואי אפשר לחייג אליו.
            המספר עצמו נשלף מ-Meta אוטומטית, והשדה הזה נכנס רק כשהיא
            אינה עונה — או כשהצד היוצא כלל אינו מוגדר. בלעדיו מסך
            חיבור המכשיר מציג קוד ואומר „שלחו ידנית” בלי לומר למי.
          */}
          <div className="flex-1" style={{ minWidth: "220px" }}>
            <label htmlFor="whatsappBotNumber" className="mb-1 block font-medium">
              מספר הבוט לתצוגה{" "}
              <span className="font-normal">(ריק = נשלף מ-Meta)</span>
            </label>
            <input
              id="whatsappBotNumber"
              name="whatsappBotNumber"
              type="tel"
              dir="ltr"
              autoComplete="off"
              key={settings.whatsapp.botNumber ?? ""}
              defaultValue={settings.whatsapp.botNumber ?? ""}
              placeholder="0553142235"
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>

          {/*
            חיבור עצמאי של מספרי המשרדים (docs/12). שני מזהים ציבוריים
            של Meta ולא סודות — הם נשלחים לדפדפן כדי לפתוח את פופאפ
            החיבור. בלעדיהם הכפתור אצל המשרדים פשוט אינו מוצג.
          */}
          <div className="w-full border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
            <p className="mb-2 font-medium">חיבור עצמאי של מספרי המשרדים</p>
            <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
              מה שמאפשר לכל משרד לחבר את המספר שלו בעצמו, בלי לוותר על אפליקציית
              WhatsApp Business בטלפון. ה-App ID מופיע בלוח הבקרה של האפליקציה
              ב-Meta; ה-Configuration ID נוצר תחת Facebook Login for Business ←
              Configurations. ריקים = כפתור החיבור מוסתר במסך ההגדרות של המשרדים.
            </p>
          </div>
          <div className="flex-1" style={{ minWidth: "220px" }}>
            <label htmlFor="whatsappAppId" className="mb-1 block font-medium">
              App ID <span className="font-normal">(ספרות בלבד)</span>
            </label>
            <input
              id="whatsappAppId"
              name="whatsappAppId"
              type="text"
              dir="ltr"
              inputMode="numeric"
              autoComplete="off"
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div className="flex-1" style={{ minWidth: "220px" }}>
            <label htmlFor="whatsappSignupConfigId" className="mb-1 block font-medium">
              Embedded Signup Configuration ID{" "}
              <span className="font-normal">(ספרות בלבד)</span>
            </label>
            <input
              id="whatsappSignupConfigId"
              name="whatsappSignupConfigId"
              type="text"
              dir="ltr"
              inputMode="numeric"
              autoComplete="off"
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div className="w-full">
            <label htmlFor="whatsappProspectReply" className="mb-1 block font-medium">
              מענה למספר לא רשום{" "}
              <span className="font-normal">(ריק = הנוסח המובנה עם קישור ההרשמה)</span>
            </label>
            <p className="mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
              נשלח למי שכותב לסוכן ואינו משתמש במערכת — הזדמנות מכירה, לא הודעת
              שגיאה. נשלח לכל היותר פעם בשבוע לכל מספר. אפשר ‎*הדגשה*‎ בכוכביות,
              כמקובל בוואטסאפ.
            </p>
            <textarea
              id="whatsappProspectReply"
              name="whatsappProspectReply"
              key={settings.whatsapp.assistant.prospectReply}
              defaultValue={settings.whatsapp.assistant.prospectReply}
              rows={5}
              maxLength={2000}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          {/*
            תבנית ההתראה — הדבר היחיד שמאפשר לדחוף התראה למתווך
            שלא כתב לסוכן ב-24 השעות האחרונות. Meta מתירה הודעה
            יזומה רק דרך תבנית מאושרת, ולכן בלי השדה הזה העדכונים
            יוצאים רק אל מי שהשיחה איתו פתוחה.
          */}
          <div className="w-full">
            <label htmlFor="whatsappNotifyTemplate" className="mb-1 block font-medium">
              תבנית התראות מאושרת{" "}
              <span className="font-normal">(ריק = דחיפה רק בתוך 24 שעות מהודעת המתווך)</span>
            </label>
            <p className="mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
              שם תבנית מסוג Utility שאושרה ב-WhatsApp Manager, עם שני משתנים
              בגוף — ‎{"{{update_title}}"}‎ ו-‎{"{{update_details}}"}‎. Meta
              דורשת <b>משתנים בעלי שם</b> ודוחה ‎{"{{1}}"}‎, והשמות חייבים
              להיות בדיוק אלה. אותיות קטנות, ספרות וקו תחתון בלבד.
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                id="whatsappNotifyTemplate"
                name="whatsappNotifyTemplate"
                dir="ltr"
                key={settings.whatsapp.assistant.notifyTemplate ?? ""}
                defaultValue={settings.whatsapp.assistant.notifyTemplate ?? ""}
                placeholder="metavchim_update"
                className="min-w-[220px] flex-1 rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
              <input
                id="whatsappNotifyTemplateLang"
                name="whatsappNotifyTemplateLang"
                dir="ltr"
                aria-label="שפת התבנית"
                key={`lang-${settings.whatsapp.assistant.notifyTemplateLang ?? "he"}`}
                defaultValue={settings.whatsapp.assistant.notifyTemplateLang ?? "he"}
                placeholder="he"
                className="w-24 rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
            </div>
            {/*
              תיבה ולא ניחוש: Meta דוחה כפתור לתבנית שאין בה כפתור,
              וגם תבנית שיש בה כפתור שלא קיבל ערך. אי-התאמה משביתה
              את כל ההתראות בשקט, ומכאן היא מתוקנת בלי גרסה חדשה.
            */}
            <label className="mt-2 flex items-center gap-2">
              <input
                id="whatsappNotifyTemplateButton"
                name="whatsappNotifyTemplateButton"
                type="checkbox"
                key={`nbtn-${String(settings.whatsapp.assistant.notifyTemplateButton)}`}
                defaultChecked={settings.whatsapp.assistant.notifyTemplateButton ?? false}
              />
              <span>
                לתבנית יש כפתור „פתח במערכת” בכתובת דינמית{" "}
                <span className="font-normal">
                  (כתובת הבסיס של המערכת ואחריה ‎{"{{1}}"}‎ — הלחיצה נוחתת על
                  הכרטיס עצמו ולא על דף הבית)
                </span>
              </span>
            </label>
          </div>

          <div className="mb-3">
            <label htmlFor="whatsappIntakeTemplate" className="mb-1 block font-medium">
              תבנית „מה אתם מחפשים?” אחרי שיחה שלא נענתה{" "}
              <span className="font-normal">(ריק = הקישור לא נשלח אוטומטית)</span>
            </label>
            <p className="mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
              נשלחת ל<b>לקוח</b> שהתקשר ולא נענה, ולכן היא מחוץ לחלון 24 השעות
              של Meta ודורשת תבנית מסוג Utility עם <b>שני משתנים</b> בגוף,
              בסדר הזה: ‎{"{{office_name}}"}‎ ואחריו ‎{"{{form_link}}"}‎. שם
              המשרד אינו קישוט — ההודעה מגיעה ללקוח ממספר שאינו מוכר לו, והוא
              צריך לדעת למי הוא עונה. בלי תבנית מוגדרת
              הקישור אינו נשלח, וההודעה המוכנה חוזרת בגוף ההתראה כדי שהסוכן
              ישלח אותה בעצמו.
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                id="whatsappIntakeTemplate"
                name="whatsappIntakeTemplate"
                dir="ltr"
                key={settings.whatsapp.assistant.intakeTemplate ?? ""}
                defaultValue={settings.whatsapp.assistant.intakeTemplate ?? ""}
                placeholder="metavchim_intake_link"
                className="min-w-[220px] flex-1 rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
              <input
                id="whatsappIntakeTemplateLang"
                name="whatsappIntakeTemplateLang"
                dir="ltr"
                aria-label="שפת תבנית טופס הדרישות"
                key={`ilang-${settings.whatsapp.assistant.intakeTemplateLang ?? "he"}`}
                defaultValue={settings.whatsapp.assistant.intakeTemplateLang ?? "he"}
                placeholder="he"
                className="w-24 rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
            </div>
            <label className="mt-2 flex items-center gap-2">
              <input
                id="whatsappIntakeTemplateButton"
                name="whatsappIntakeTemplateButton"
                type="checkbox"
                key={`ibtn-${String(settings.whatsapp.assistant.intakeTemplateButton)}`}
                defaultChecked={settings.whatsapp.assistant.intakeTemplateButton ?? false}
              />
              <span>
                לתבנית יש כפתור „מילוי הפרטים” בכתובת דינמית{" "}
                <span className="font-normal">
                  (אותו קישור, בלחיצה במקום בהדבקה)
                </span>
              </span>
            </label>
          </div>

          <div className="mb-3">
            <label
              htmlFor="whatsappViewingReminderTemplate"
              className="mb-1 block font-medium"
            >
              תבנית תזכורת לפני סיור{" "}
              <span className="font-normal">(ריק = התזכורת יוצאת במייל בלבד)</span>
            </label>
            <p className="mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
              הלקוח לא כתב לנו, ולכן הוא מחוץ לחלון 24 השעות שבו טקסט חופשי
              מותר. נדרשת תבנית מסוג Utility, ויש לה <b>שתי צורות</b> — סמנו
              למטה איזו מהן נרשמה בפועל, אחרת ההודעה תידחה אצל Meta בשקט.
              בלי תבנית מוגדרת מי שאין לו מייל מגיע כמשימה לסוכן.{" "}
              <b>בלי כפתור</b>: הנמען הוא לקוח, ואין לו מה לפתוח במערכת.
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                id="whatsappViewingReminderTemplate"
                name="whatsappViewingReminderTemplate"
                dir="ltr"
                key={settings.whatsapp.assistant.viewingReminderTemplate ?? ""}
                defaultValue={settings.whatsapp.assistant.viewingReminderTemplate ?? ""}
                placeholder="metavchim_viewing_reminder"
                className="min-w-[220px] flex-1 rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
              <input
                id="whatsappViewingReminderTemplateLang"
                name="whatsappViewingReminderTemplateLang"
                dir="ltr"
                aria-label="שפת תבנית התזכורת"
                key={`rlang-${settings.whatsapp.assistant.viewingReminderTemplateLang ?? "he"}`}
                defaultValue={settings.whatsapp.assistant.viewingReminderTemplateLang ?? "he"}
                placeholder="he"
                className="w-24 rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
            </div>
            {/*
              ‎**איזו צורה נרשמה — הגדרה ולא ניחוש.**

              מאחורי השם השמור עומדת תבנית שאושרה עם חוזה מסוים.
              מעבר שקט לשדות היה שולח חמישה שמות לתבנית שיש בה אחד,
              ‎Meta הייתה דוחה, ובערוץ „שניהם” המייל מצליח — ולכן גם
              לא נפתחת משימה, והתזכורת בוואטסאפ נעלמת בלי סימן.
            */}
            <label className="mt-2 flex items-start gap-2">
              <input
                id="whatsappViewingReminderTemplateFields"
                name="whatsappViewingReminderTemplateFields"
                type="checkbox"
                className="mt-1"
                key={`rfields-${String(settings.whatsapp.assistant.viewingReminderTemplateFields)}`}
                defaultChecked={
                  settings.whatsapp.assistant.viewingReminderTemplateFields ?? false
                }
              />
              <span>
                התבנית נושאת <b>חמישה שדות</b> ולא נוסח אחד{" "}
                <span className="font-normal">
                  (‎{"{{customer_name}}"}‎, ‎{"{{visit_date}}"}‎,
                  ‎{"{{visit_time}}"}‎, ‎{"{{visit_address}}"}‎,
                  ‎{"{{office_name}}"}‎ — מומלץ: Meta מסווגת כ-Marketing תבנית
                  שגופה משתנה יחיד, כי היא אינה יכולה לקרוא אותה. הנוסח
                  שניסחתם באוטומציות ממשיך לצאת <b>במייל</b> כלשונו.)
                </span>
                <br />
                <span className="font-normal">
                  לא מסומן = נוסח אחד ‎{"{{reminder_text}}"}‎ — הצורה שנרשמה עד
                  היום.
                </span>
              </span>
            </label>
            {/*
              ‎**כפתורי התשובה — והסדר שהוא חלק מהחוזה.**

              המטען נשלח לפי אינדקס: מה שנשלח לכפתור הראשון חוזר
              כשנלחץ הכפתור הראשון שנרשם. רישום בסדר הפוך מחזיר
              „אישר” על לחיצה ב„צריך לשנות מועד” — היפוך שקט של
              המשמעות, ואין דרך שהקוד יאמת אותו. לכן הסדר כתוב כאן.
            */}
            <label className="mt-2 flex items-start gap-2">
              <input
                id="whatsappViewingReminderTemplateButtons"
                name="whatsappViewingReminderTemplateButtons"
                type="checkbox"
                className="mt-1"
                key={`rbtns-${String(settings.whatsapp.assistant.viewingReminderTemplateButtons)}`}
                defaultChecked={
                  settings.whatsapp.assistant.viewingReminderTemplateButtons ?? false
                }
              />
              <span>
                התבנית נושאת <b>שני כפתורי תשובה מהירה</b>{" "}
                <span className="font-normal">
                  (הלקוח מאשר או מבקש מועד אחר בלחיצה, בלי לצאת מוואטסאפ ובלי
                  חשבון במערכת. התשובה נרשמת על הסיור והסוכן מקבל התראה;
                  „צריך לשנות מועד” פותח גם משימה.)
                </span>
                <br />
                <span className="font-normal">
                  <b>הסדר ברישום ב-Meta קובע</b>: ראשון „קיבלתי, תודה”, שני
                  „צריך לשנות מועד”. רישום בסדר הפוך יירשם כאישור על לחיצה
                  בבקשה לשנות — ואין דרך לזהות זאת מכאן.
                </span>
                <br />
                <span className="font-normal">
                  לא מסומן = בלי כפתורים. תבנית שנרשמה בלעדיהם ומקבלת רכיבי
                  כפתור נדחית אצל Meta, ואז לא נשלחת תזכורת כלל.
                </span>
              </span>
            </label>
          </div>
          <div className="mb-3">
            <label htmlFor="whatsappEmailReplyTemplate" className="mb-1 block font-medium">
              תבנית „לקוח ענה במייל” לסוכן{" "}
              <span className="font-normal">(ריק = התראה במערכת ובדחיפה בלבד)</span>
            </label>
            <p className="mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
              היחידה כאן שנשלחת ל<b>סוכן</b> ולא ללקוח, ורק כשהוא מחוץ לחלון 24
              השעות. תבנית עם <b>משתנה אחד</b> בשם ‎{"{{customer_name}}"}‎ —
              שם הלקוח שהשיב. בלי תבנית ההתראה עדיין מגיעה במערכת ובדחיפה,
              רק לא בוואטסאפ. כפתור כאן הוא <b>קבוע</b> ל-‎/inbox‎, ולכן אין
              לו תיבת סימון.
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                id="whatsappEmailReplyTemplate"
                name="whatsappEmailReplyTemplate"
                dir="ltr"
                key={settings.whatsapp.assistant.emailReplyTemplate ?? ""}
                defaultValue={settings.whatsapp.assistant.emailReplyTemplate ?? ""}
                placeholder="metavchim_email_reply"
                className="min-w-[220px] flex-1 rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
              <input
                id="whatsappEmailReplyTemplateLang"
                name="whatsappEmailReplyTemplateLang"
                dir="ltr"
                aria-label="שפת תבנית התראת המייל"
                key={`elang-${settings.whatsapp.assistant.emailReplyTemplateLang ?? "he"}`}
                defaultValue={settings.whatsapp.assistant.emailReplyTemplateLang ?? "he"}
                placeholder="he"
                className="w-24 rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
            </div>
          </div>
          <Button type="submit" disabled={busy}>שמור</Button>
          {settings.whatsapp.assistant.configured ? (
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void testWhatsApp()}>
              {probing === "whatsapp" ? "בודק מול Meta…" : "בדוק חיבור"}
            </Button>
          ) : null}
        </form>
      </div>

      {/* ---------- מפות ---------- */}
      <div className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold"><IconPin s={16} /> מפות</h3>
          <StatusBadge
            configured={settings.maps?.configured ?? false}
            source={settings.maps?.configured ? "db" : "none"}
          />
        </div>
        <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
          <b>המפה עובדת כברירת מחדל ובלי מפתח.</b> השדה כאן נועד להחליף את מקור
          האריחים — למשל למפ&quot;י — ואפשר להשאיר אותו ריק. הסגנון חייב להיות תקן
          MapLibre, כלומר כל הכתובות בתוכו ‎https‎ רגיל; סגנון של Mapbox מפנה פנימית
          ל-‎mapbox://‎ שהספרייה אינה מפענחת, והמפה נטענת ריקה.
          <br />
          <b>אריחים בלבד</b> — המערכת אינה שולחת לספק האריחים כתובות של לקוחות. זה
          קורה רק בפענוח כתובות, למטה.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void saveSetting("mapStyleUrl", new FormData(e.currentTarget).get("mapStyleUrl"));
          }}
          className="flex flex-wrap items-end gap-2"
        >
          <label className="grow">
            <span className="mb-1 block text-sm font-semibold">
              כתובת סגנון אריחים (ריק = הסגנון הפתוח שברירת המחדל)
            </span>
            <input
              name="mapStyleUrl"
              dir="ltr"
              placeholder="https://tiles.openfreemap.org/styles/liberty"
              className="w-full rounded-lg border px-2.5 py-2"
              style={inputStyle}
            />
          </label>
          <Button type="submit" disabled={busy}>שמור</Button>
        </form>

        {/* פענוח כתובות — החלטה נפרדת מהאריחים, ובכוונה */}
        <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
          <h4 className="mb-1 text-sm font-semibold">פענוח כתובות</h4>
          <p className="mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
            הופך כתובת שהוקלדה לנקודה על המפה, ובכיוון ההפוך — סיכה שנגררה לכתובת.
            <b> זה הכיוון שבו כתובות של לקוחות נשלחות לשירות חיצוני</b>, ולכן זו החלטה
            נפרדת מהאריחים. &quot;ללא&quot; = לא פונים לאיש, והסוכן מסמן ידנית.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveSetting("mapboxToken", new FormData(e.currentTarget).get("mapboxToken"));
            }}
            className="mb-2 flex flex-wrap items-end gap-2"
          >
            <label className="grow">
              <span className="mb-1 block text-sm font-semibold">
                טוקן Mapbox לפענוח כתובות (ריק = כבוי)
              </span>
              <input
                name="mapboxToken"
                dir="ltr"
                placeholder="pk...."
                className="w-full rounded-lg border px-2.5 py-2"
                style={inputStyle}
              />
            </label>
            <Button type="submit" disabled={busy}>שמור</Button>
          </form>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={settings.geocoding?.provider ?? "none"}
              onChange={(e) => void saveProvider(e.target.value)}
              disabled={busy}
              className="rounded-lg border px-2.5 py-2"
              style={inputStyle}
            >
              <option value="none">ללא — סימון ידני בלבד</option>
              <option value="govmap">מפ&quot;י / GovMap — כתובת ← מפה</option>
              <option value="mapbox">Mapbox — שני הכיוונים (דורש טוקן)</option>
            </select>
            {settings.geocoding && settings.geocoding.provider !== "none" ? (
              <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                {settings.geocoding.forward ? "כתובת ← מפה ✓" : ""}
                {settings.geocoding.reverse
                  ? " · מפה ← כתובת ✓"
                  : settings.geocoding.forward
                    ? " · מפה ← כתובת אינו נתמך אצל ספק זה"
                    : ""}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* ---------- עמלת הפניות ---------- */}
      <div className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <h3 className="mb-1 font-semibold"><IconCoins s={16} /> עמלת הפלטפורמה על הפניית לקוח</h3>
        <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
          כשמשרד מפנה לקוח למשרד אחר, זהו האחוז שיורד מהתמורה לטובת הפלטפורמה.
          השאר נכנס ליתרת הקרדיטים של המשרד המפנה. האחוז מוצג לשני הצדדים לפני כל
          החלטה, ומשפיע על הפניות שיפורסמו מכאן ואילך — לא על מה שכבר פורסם.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void saveReferralFee(new FormData(e.currentTarget).get("referralFeePercent"));
          }}
          className="flex flex-wrap items-end gap-2"
        >
          <label>
            <span className="mb-1 block text-sm font-semibold">אחוז מהתמורה</span>
            <input
              name="referralFeePercent"
              type="number"
              min={0}
              max={MAX_PLATFORM_FEE_PERCENT}
              step={1}
              defaultValue={settings.referralFeePercent ?? PLATFORM_REFERRAL_FEE_PERCENT}
              className="w-28 rounded-lg border px-2.5 py-2"
              style={inputStyle}
            />
          </label>
          <Button type="submit" disabled={busy}>שמור</Button>
          <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
            {/* דוגמה מספרית — מסך שמראה רק אחוז מחייב את הקורא לחשב בראש */}
            לדוגמה: תמורה של 20 קרדיטים ⇐ {referralPayout(20, settings.referralFeePercent ?? PLATFORM_REFERRAL_FEE_PERCENT).platformFeeCredits} לפלטפורמה,{" "}
            {referralPayout(20, settings.referralFeePercent ?? PLATFORM_REFERRAL_FEE_PERCENT).payoutCredits} למשרד המפנה
          </span>
        </form>
      </div>

      {/* ---------- אימות כניסה ---------- */}
      <div className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold"><IconLock s={16} /> אימות כניסה בקוד למייל</h3>
          <Button
            variant={settings.loginOtpEnabled ? "danger" : "primary"}
            disabled={!settings.postmark.configured}
            onClick={() => void toggleOtp(!settings.loginOtpEnabled)}
          >
            {settings.loginOtpEnabled ? "כבה אימות" : "הפעל אימות"}
          </Button>
        </div>
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          {settings.postmark.configured
            ? "כשמופעל, כל כניסה למערכת תדרוש קוד בן 6 ספרות שנשלח למייל של המשתמש."
            : "יש להגדיר אימייל תחילה — בלי ספק אימייל פעיל, הפעלת האימות הייתה נועלת את כולם בחוץ."}
        </p>
      </div>
    </section>
  );
}
