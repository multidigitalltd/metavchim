"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ApiError, apiPost } from "@/lib/api";
import {
  ConvertSection,
  ConvertToPropertySection,
  type ConvertPrefill,
} from "../leads/convert-sections";

/**
 * ‎**„המר ללקוח” — על כל שיחה, ולא רק על זו שכבר נשא עליה ליד.**
 *
 * ‏ההמרה קיימת במערכת מזמן, אבל היא נתלתה ב-`leadId`. שיחה שלא
 * ‏נענתה ממספר לא מוכר — **בדיוק זו שממנה מתחיל לקוח חדש** — לא
 * ‏הציגה שום דרך להמיר, והמתווך נשלח לפתוח כרטיס ידנית ולהקליד
 * ‏מחדש מספר שכבר רשום על המסך שלפניו (בקשת המשתמש).
 *
 * ‏הפתרון אינו מסלול המרה שני אלא **צעד חסר**: `POST /calls/:id/lead`
 * ‏פותח ליד מהשיחה (או מחזיר את הקיים), ומכאן והלאה רצות אותן שתי
 * ‏צורות שהליד כבר משתמש בהן. שכפול היה מייצר שתי המרות שונות
 * ‏באותו שם, שאפשר לתקן אחת מהן ולשכוח את השנייה.
 *
 * ## ‏ארבעת הסוגים הם שתי צורות כפול `dealType`
 *
 * ‎`DealTypeSchema` הוא `sale | rent`, ולכן:
 *
 * | ‏הסוג | ‏מה נוצר | `dealType` |
 * |---|---|---|
 * | ‏קונה | ‏כרטיס קונה | `sale` |
 * | ‏שוכר | ‏כרטיס קונה | `rent` |
 * | ‏מוכר | ‏כרטיס נכס (טיוטה) | `sale` |
 * | ‏משכיר | ‏כרטיס נכס (טיוטה) | `rent` |
 *
 * ‏וחמישי, „ליד”, הוא הצעד הראשון לבדו — למי שעדיין לא יודע מה
 * ‏הצד השני רוצה, וזו תשובה לגיטימית אחרי שיחה שלא נענתה.
 */

type Target = "buyer_sale" | "buyer_rent" | "property_sale" | "property_rent" | "lead";

interface TargetInfo {
  key: Target;
  label: string;
  /** ‏מה באמת נוצר — נאמר למתווך לפני שהוא לוחץ, לא אחרי */
  blurb: string;
  kind: "buyer" | "property" | "lead";
  dealType?: "sale" | "rent";
}

const TARGETS: readonly TargetInfo[] = [
  {
    key: "buyer_sale",
    label: "קונה",
    blurb: "כרטיס קונה — מחפש לקנות",
    kind: "buyer",
    dealType: "sale",
  },
  {
    key: "buyer_rent",
    label: "שוכר",
    blurb: "כרטיס קונה — מחפש לשכור",
    kind: "buyer",
    dealType: "rent",
  },
  {
    key: "property_sale",
    label: "מוכר",
    blurb: "כרטיס נכס — הוא הבעלים, למכירה",
    kind: "property",
    dealType: "sale",
  },
  {
    key: "property_rent",
    label: "משכיר",
    blurb: "כרטיס נכס — הוא הבעלים, להשכרה",
    kind: "property",
    dealType: "rent",
  },
  { key: "lead", label: "ליד", blurb: "נכנס לרשימת הלידים, בלי להחליט עדיין", kind: "lead" },
];

export interface ConvertToCustomerProps {
  callId: string;
  /** ‏הליד שכבר על השיחה, אם יש — ואז אין צורך לפתוח אחד */
  leadId?: string;
  prefill: ConvertPrefill;
  contactSharedTabu: boolean;
  mayBuyer: boolean;
  mayProperty: boolean;
  /** ‏נקרא אחרי שנפתח ליד — הרשימה מציגה אותו מיד */
  onLead: () => void;
}

export function ConvertToCustomer({
  callId,
  leadId,
  prefill,
  contactSharedTabu,
  mayBuyer,
  mayProperty,
  onLead,
}: ConvertToCustomerProps): ReactNode {
  const [target, setTarget] = useState<TargetInfo | null>(null);
  const [resolvedLead, setResolvedLead] = useState<string | null>(leadId ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choices = TARGETS.filter((t) =>
    t.kind === "buyer" ? mayBuyer : t.kind === "property" ? mayProperty : true,
  );

  /*
   * ‎**פתיחת הליד קודמת לטופס, ולא במקביל אליו.**
   *
   * ‏הטפסים הקיימים מקבלים `leadId` ושולחים אליו; טופס שנפתח לפני
   * ‏שהליד קיים היה נשלח ל-`undefined` ונופל על 404 אחרי שהמתווך
   * ‏כבר מילא אותו.
   */
  async function choose(next: TargetInfo): Promise<void> {
    setError(null);
    if (resolvedLead !== null) {
      setTarget(next);
      return;
    }
    setBusy(true);
    try {
      const res = await apiPost<{ leadId: string; created: boolean }>(
        `/calls/${callId}/lead`,
        {},
      );
      setResolvedLead(res.leadId);
      setTarget(next);
      onLead();
    } catch (err) {
      setError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : "פתיחת הליד נכשלה",
      );
    } finally {
      setBusy(false);
    }
  }

  if (target !== null && resolvedLead !== null) {
    if (target.kind === "lead") {
      return (
        <div className="mt-5">
          <p className="m-0 mb-2">
            נפתח ליד מהשיחה. הוא ברשימת הלידים, ואפשר להמשיך ממנו בכל שלב.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href={`/leads/${resolvedLead}`} className="mv-btn-soft">
              פתיחת הליד ←
            </Link>
            <button type="button" className="mv-btn-plain" onClick={() => setTarget(null)}>
              המרה לסוג אחר
            </button>
          </div>
        </div>
      );
    }
    const withDeal: ConvertPrefill = {
      ...prefill,
      ...(target.dealType === undefined ? {} : { dealType: target.dealType }),
    };
    return (
      <div className="mt-5">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <strong>{target.label}</strong>
          <button type="button" className="mv-btn-plain" onClick={() => setTarget(null)}>
            החלפת סוג
          </button>
        </div>
        {target.kind === "buyer" ? (
          /*
           * ‎**המפתח נושא את מזהה השיחה** — הדרישה מסבב ביקורת קודם:
           * ‏השדות אינם מבוקרים, ומפתח קבוע השאיר על המסך את מה
           * ‏שמולא לשיחה הקודמת.
           */
          <ConvertSection
            key={`buyer-${callId}-${target.key}`}
            leadId={resolvedLead}
            prefill={withDeal}
          />
        ) : (
          <ConvertToPropertySection
            key={`property-${callId}-${target.key}`}
            leadId={resolvedLead}
            prefill={withDeal}
            contactSharedTabu={contactSharedTabu}
          />
        )}
      </div>
    );
  }

  return (
    <div className="mt-5">
      <p className="m-0 mb-2" style={{ color: "var(--color-text-muted)" }}>
        מה הצד השני בשיחה הזו?
      </p>
      <div className="flex flex-wrap gap-2">
        {choices.map((t) => (
          <button
            key={t.key}
            type="button"
            className="mv-btn-soft"
            disabled={busy}
            title={t.blurb}
            onClick={() => void choose(t)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {busy ? (
        <p className="m-0 mt-2" style={{ color: "var(--color-text-muted)" }}>
          פותח ליד מהשיחה…
        </p>
      ) : null}
      {error === null ? null : (
        <p role="alert" className="m-0 mt-2" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
