"use client";

import { useCallback, useEffect, useState } from "react";
import {
  WHATSAPP_AGENT_DENIAL_TEXT,
  WHATSAPP_LINK_MAX_AGE_DAYS,
  type WhatsappAgentDenial,
  whatsappSeatOfferText,
  type WhatsappSeatOffer,
} from "@metavchim/shared";
import { ApiError, apiDelete, apiGet, apiPost } from "@/lib/api";
import { Notice } from "../notice";
import { WhatsappPairing } from "../whatsapp-pairing";
import { formatDate } from "@/lib/format";

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
  /**
   * ‎**למה אי אפשר לחבר** — כשהמסלול אינו כולל את הסוכן, או שלא
   * הופעל מנוי אישי.
   *
   * מגיע מהשרת יחד עם המצב, ולא רק כשגיאה אחרי לחיצה: המסך הציע
   * „הפקת קוד חיבור” לכל אחד, וההסבר האמיתי נבלע ל„נסו שוב” —
   * הוראה לנסות שוב על בקשה שלעולם לא תצליח (ביקורת Codex).
   */
  denial?: WhatsappAgentDenial;
  /**
   * מה אפשר לעשות עם החסימה — מחיר לרכישה, או פנייה אנושית.
   *
   * המחיר יושב **במסלול**: מסלול בסיסי יכול בכוונה לא למכור מקומות
   * נוספים, וגבוה יכול למכור בזול. „לא נמכר” אינו „טרם הוגדר”,
   * ולכן במקום כפתור בלי מחיר מוצגת פנייה.
   */
  offer?: WhatsappSeatOffer;
}

function dateText(iso: string | undefined): string {
  if (iso === undefined) return "";
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : formatDate(at);
}

export function WhatsAppLinkSection() {
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [code, setCode] = useState<string | null>(null);
  /** הקיצור שמגיע יחד עם הקוד; `null` = אין מספר עסקי, ואז רק הקוד. */
  const [link, setLink] = useState<string | null>(null);
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
    setLink(null);
    apiPost<{ code: string; link: string | null }>("/settings/whatsapp-link/code", {})
      .then((res) => {
        setCode(res.code);
        setLink(res.link);
      })
      /*
       * הודעת השרת נשמרת ואינה מוחלפת: 403 כאן נושא את הסיבה
       * המדויקת, ו„נסו שוב” במקומה שולח את המתווך ללחוץ שוב.
       */
      .catch((err: unknown) =>
        setMessage(err instanceof ApiError ? err.message : "הפקת הקוד נכשלה — נסו שוב"),
      )
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
    /*
     * ‎`id` — הסוכן בוואטסאפ שולח לכאן קישור ישיר. בלעדיו ההנחיה
     * הייתה „היכנסו למערכת ← פרופיל ← גללו”, וזה בדיוק המקום שבו
     * מי שכבר בוואטסאפ מוותר.
     */
    <section
      id="whatsapp-link"
      className="mv-list-card px-5 py-[17px] scroll-mt-24"
      aria-labelledby="wa-link-heading"
    >
      <h2 id="wa-link-heading" className="m-0 mb-1" style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}>
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
          {status.denial === undefined
            ? 'אין כרגע מכשיר מחובר. הפיקו קוד ושלחו אותו בוואטסאפ מהמכשיר שלכם.'
            : 'אין כרגע מכשיר מחובר.'}
        </p>
      )}

      {code === null ? null : <WhatsappPairing code={code} link={link} />}

      {/*
        ‎**כשאי אפשר — אומרים למה, ולא מציעים כפתור.**

        הניתוק נשאר זמין גם אז: מי שהזכאות שלו נשללה אחרי שכבר חיבר
        מכשיר חייב להיות מסוגל לנתק אותו.
      */}
      {status?.denial === undefined ? null : (
        <Notice tone="info">
          {WHATSAPP_AGENT_DENIAL_TEXT[status.denial]}
          {status.denial === "seat" && status.offer !== undefined ? (
            <span className="mt-1 block">{whatsappSeatOfferText(status.offer)}</span>
          ) : null}
        </Notice>
      )}

      <div className="flex flex-wrap gap-2">
        {status?.denial === undefined ? (
          <button type="button" className="mv-btn-primary" onClick={issue} disabled={busy}>
            {status?.linked === true ? "לחבר מכשיר אחר" : "הפקת קוד חיבור"}
          </button>
        ) : null}
        {status?.linked === true || code !== null ? (
          <button type="button" className="mv-btn-ghost" onClick={revokeLink} disabled={busy}>
            {status?.linked === true ? "לנתק את המכשיר" : "לבטל את הקוד"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
