"use client";

import { useCallback, useEffect, useState } from "react";
import { WHATSAPP_LINK_MAX_AGE_DAYS } from "@metavchim/shared";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { Notice } from "../notice";

/**
 * „איזה מכשיר מחובר אליי” — הזהות בערוץ הוואטסאפ.
 *
 * ## למה המסך הזה קיים
 *
 * הזהות נגזרה עד כה ממספר הטלפון בלבד: השוואת ספרות מול השדה
 * בפרטים האישיים. זה עבד, וזו גם הייתה הבעיה — איש מעולם לא **אמר**
 * שהמספר הזה שלו, ולמתווך לא הייתה דרך לראות מי מחובר ולא דרך
 * לנתק. מספר שהוחזר לשוק וניתן למישהו אחר הוא תרחיש אמיתי בישראל,
 * וכל עוד השדה לא עודכן הוא פותח מאגר שלם.
 *
 * המסך מציג את מה שיש, ונותן שתי פעולות: לקשר מכשיר, ולנתק.
 */

interface LinkStatus {
  linked: boolean;
  tail?: string;
  linkedAt?: string;
  verifiedAt?: string;
  lastSeenAt?: string;
  implicit?: boolean;
  needsReverification?: boolean;
}

function dateText(iso: string | undefined): string {
  if (iso === undefined) return "";
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : at.toLocaleDateString("he-IL");
}

export function WhatsAppLinkSection() {
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiGet<LinkStatus>("/settings/whatsapp-link")
      .then(setStatus)
      .catch(() => setMessage("לא הצלחנו לקרוא את מצב החיבור — רעננו את העמוד"));
  }, []);

  useEffect(load, [load]);

  /**
   * קוד חדש — והישן יורד מהמסך **לפני** הבקשה.
   *
   * ההנפקה מקדמת את דור החשבון, כלומר הקוד המוצג מתבטל ברגע שהשרת
   * מטפל בבקשה — גם אם התשובה אבדה בדרך חזרה. השארתו על המסך לצד
   * „ההפקה נכשלה” מציגה אישור שכבר אינו תקף, והמתווך יגלה זאת רק
   * אחרי ששלח אותו בוואטסאפ (ביקורת Codex).
   */
  function issue(): void {
    setBusy(true);
    setMessage(null);
    setCode(null);
    apiPost<{ code: string }>("/settings/whatsapp-link/code", {})
      .then((res) => setCode(res.code))
      .catch(() => setMessage("הפקת הקוד נכשלה — נסו שוב"))
      .finally(() => setBusy(false));
  }

  /**
   * ניתוק — וגם ביטול של קוד שממתין.
   *
   * שתי הפעולות הן אותה בקשה בשרת: הניתוק שורף גם את הקוד הפתוח.
   * הכפתור היה מותנה בחיבור קיים, ולכן מי שהפיק קוד ולא שלח אותו
   * נשאר בלי שום דרך לבטל אותו עד שיפוג — רבע שעה שבה קוד שנחשף
   * מעל הכתף עדיין תקף (ביקורת Codex).
   */
  function revokeLink(): void {
    const wasLinked = status?.linked === true;
    setBusy(true);
    setMessage(null);
    apiDelete("/settings/whatsapp-link")
      .then(() => {
        setCode(null);
        setMessage(wasLinked ? "✓ המכשיר נותק" : "✓ הקוד בוטל");
        load();
      })
      .catch(() => setMessage(wasLinked ? "הניתוק נכשל — נסו שוב" : "ביטול הקוד נכשל — נסו שוב"))
      .finally(() => setBusy(false));
  }

  return (
    <section className="mv-list-card px-5 py-[17px]" aria-labelledby="wa-link-heading">
      <h2 id="wa-link-heading" className="m-0 mb-1" style={{ fontSize: 16.5, fontWeight: 800 }}>
        המכשיר שמחובר לסוכן
      </h2>
      <p className="m-0 mb-3 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
        הסוכן בוואטסאפ עונה רק למכשיר שקושר לחשבון שלכם. כך מספר שהוחלף או
        שהועבר לאדם אחר אינו מגיע למאגר שלכם.
      </p>

      {message ? (
        <Notice tone={message.startsWith("✓") ? "success" : "warning"}>{message}</Notice>
      ) : null}

      {status?.needsReverification === true ? (
        <Notice tone="warning">
          עברו {WHATSAPP_LINK_MAX_AGE_DAYS} ימים מאז האימות האחרון. הפיקו קוד
          חדש ושלחו אותו מהמכשיר כדי להמשיך לעבוד בוואטסאפ.
        </Notice>
      ) : null}

      {status?.linked === true && status.implicit === true ? (
        <Notice tone="warning">
          החיבור נוצר לפי מספר הטלפון שבפרטים האישיים, בלי אישור מפורש. אימות
          בקוד הופך אותו לחיבור שאתם אישרתם.
        </Notice>
      ) : null}

      {status === null ? (
        <p className="m-0 text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>
          טוען…
        </p>
      ) : status.linked ? (
        <dl className="m-0 mb-3 grid gap-1 text-[length:var(--type-caption-lg)]" style={{ gridTemplateColumns: "auto 1fr" }}>
          <dt className="font-semibold">מספר</dt>
          <dd className="m-0">מסתיים ב־{status.tail}</dd>
          <dt className="font-semibold">קושר</dt>
          <dd className="m-0">{dateText(status.linkedAt)}</dd>
          {status.lastSeenAt === undefined ? null : (
            <>
              <dt className="font-semibold">פעילות אחרונה</dt>
              <dd className="m-0">{dateText(status.lastSeenAt)}</dd>
            </>
          )}
        </dl>
      ) : (
        <p className="m-0 mb-3 text-[length:var(--type-caption-lg)]">
          אין כרגע מכשיר מחובר. הפיקו קוד ושלחו אותו בוואטסאפ מהמכשיר שלכם.
        </p>
      )}

      {code === null ? null : (
        <div
          className="mb-3 rounded-xl px-4 py-3"
          style={{ background: "var(--color-field)", border: "1px solid var(--color-input-border)" }}
        >
          <p className="m-0 mb-1 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
            שלחו את הקוד הזה בהודעת וואטסאפ לסוכן, מהמכשיר שתרצו לחבר:
          </p>
          <p className="m-0 select-all" style={{ fontSize: 22, fontWeight: 800, letterSpacing: 2 }}>
            {code}
          </p>
          <p className="m-0 mt-1 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
            הקוד תקף לרבע שעה ולשימוש אחד. אם נמלכתם בדעתכם — אפשר לבטל אותו כאן.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="mv-btn-primary" onClick={issue} disabled={busy}>
          {status?.linked === true ? "לחבר מכשיר אחר" : "הפקת קוד חיבור"}
        </button>
        {status?.linked === true || code !== null ? (
          <button type="button" className="mv-btn-ghost" onClick={revokeLink} disabled={busy}>
            {status?.linked === true ? "לנתק את המכשיר" : "לבטל את הקוד"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
