"use client";

import { useEffect, useState, use, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@metavchim/ui";
import {
  MATURITY_LABELS as SHARED_MATURITY,
  MAX_REFERRAL_CITY,
  MAX_REFERRAL_NOTE,
  MAX_REFERRAL_PRICE,
  MAX_REFERRAL_REASON_DETAIL,
  MIN_REFERRAL_PRICE,
  PAYOUT_MODE_LABEL,
  REFERRAL_REASONS,
  DEFAULT_CREDIT_ECONOMY,
  referralPayout,
  dimensionRatingRejectionReason,
  referralPriceRejectionReason,
  referralReasonRejectionReason,
  settleReferral,
  shekels,
  type CreditEconomy,
  type PayoutMode,  labelOf } from "@metavchim/shared";
import { apiDelete, apiGet, apiPost, apiPatch, ApiError } from "@/lib/api";
import { formatDate, shekelsToAgorot, waMeUrl } from "@/lib/format";
import { LEAD_INTENT_LABELS, LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS } from "@/lib/lead-labels";
import { can, useRequireAuth } from "@/lib/use-auth";
import { ClickToDial } from "../../click-to-dial";
import { ContactPeople } from "../../contact-people";
import { DictateFor } from "../../dictation-field";
import { RelatedEntities } from "../../related-entities";
import { EntityTasks } from "../../entity-tasks";
import { EntityTabs, TabPanel, useEntityTab } from "../../entity-tabs";
import { SelectMenu } from "../../select-menu";
import { ReplyEmail } from "./reply-email";
import {
  ClientScoresField,
  ReferralConfirmation,
  type ReferralConfirmationValue,
} from "../../collaboration/client-rating";
import {
  IconCalendar,
  IconChat,
  IconCoins,
  IconHandshake,
  IconDoc,
  IconGear,
  IconHome,
  IconInfo,
  IconMail,
  IconPhone,
  IconRefresh,
  IconUser,
} from "../../icons";
import { Notice } from "../../notice";

interface LeadDetail {
  id: string;
  contact: { id: string; name: string; phone: string; email?: string };
  source: string;
  intent: string;
  status: string;
  requiresHuman: boolean;
  requiresHumanReason?: string;
  summary?: string;
}

/**
 * המספר שאליו הלקוח התקשר.
 *
 * `label` קיים רק כשהמספר מוגדר כמספר וירטואלי בהגדרות. בלעדיו
 * מוצג המספר עצמו — וגם זה שימושי: מספר לא מוכר שחוזר בלידים הוא
 * סימן שכדאי להגדיר אותו ולהתחיל למדוד.
 */
interface DialedNumber {
  phone: string;
  label?: string;
}

interface TimelineItem {
  id: string;
  kind: string;
  content: string;
  createdAt: string;
}

/**
 * גלולת הסטטוס — אותה שפה של גלולת הבשלות בכרטיס הקונה.
 *
 * הסטטוס הוא המידע שקובע מה עושים עם הליד עכשיו, ולכן הוא צבוע
 * ולא טקסט אפור: „חדש” שדורש מענה ו„סגור” שאינו דורש דבר לא
 * אמורים להיראות אותו דבר משלושה מטרים.
 */
const STATUS_PILL: Record<string, { fg: string; bg: string }> = {
  new: { fg: "#b0512c", bg: "#faf1ec" },
  in_progress: { fg: "#7a5c1f", bg: "#f7efdd" },
  waiting_customer: { fg: "#3F4742", bg: "#EDEFED" },
  converted: { fg: "#0C6E34", bg: "#E5FCEA" },
  closed: { fg: "#68716a", bg: "#eef1ec" },
};

/** האות הראשונה לעיגול הכותרת — כמו בכרטיס הקונה. */
function initials(name: string): string {
  return name.trim().slice(0, 1);
}

const KIND_LABELS: Record<string, ReactNode> = {
  note: <><IconDoc s={15} /> הערה</>,
  call: <><IconPhone s={15} /> שיחה</>,
  whatsapp: <><IconChat s={15} /> וואטסאפ</>,
  status_change: <><IconRefresh s={15} /> שינוי סטטוס</>,
  system: <><IconGear s={15} /> מערכת</>,
};

/**
 * המרת ליד לקונה בלי לצאת מהעמוד: דרישות מינימליות (ערים, סוג עסקה,
 * תקציב) — והאדם נכנס למנוע ההתאמות. אותו contact, ההיסטוריה נשמרת.
 */

/**
 * המרה לנכס — התאום של ההמרה לקונה.
 *
 * ליד אינו תמיד קונה: "יש לי דירה למכור" הוא בעל נכס. הטופס מבקש רק
 * את המינימום שנכס חדש דורש (עיר, סוג עסקה); כל השאר מושלם בכרטיס
 * הנכס אחר כך, ואיש הקשר של הליד הופך לבעל הנכס אוטומטית.
 */
interface MySharedLead {
  id: string;
  status: string;
  priceCredits: number;
  platformFeeCredits: number;
  payoutMode?: PayoutMode;
  payoutCredits: number;
  payoutAgorot?: number;
  mine: boolean;
  originLeadId?: string;
  /** ההצהרה שלנו על איכות הלקוח, כפי שפורסמה. */
  clientScores: Record<string, number>;
  confirmation?: ReferralConfirmationValue;
}

interface ReferralTerms {
  suggestedPriceCredits: number;
  platformFeePercent: number;
  /** הכלכלה מהשרת — לתצוגה מקדימה של שני המסלולים. */
  economy?: {
    creditBonusPercent: number;
    feeCreditsPercent: number;
    feeCashPercent: number;
    unitPriceAgorot: number;
  };
}

/**
 * הפניית הלקוח למשרד אחר — הדרך השלישית לצד המרה לקונה או לנכס.
 *
 * **עמלת הפניה, ולא סחר בלקוחות.** לקוח שאינו מתאים למשרד הזה מופנה
 * למשרד שכן יכול לשרת אותו, והמשרד המפנה מקבל עמלה על ההפניה עצמה —
 * בלי עמלה נוספת אם תיסגר עסקה, ובלי החזר אם לא. ניסוח חיובי ולא
 * שלילי: משפט שפותח ב"זו אינה מכירה" שותל דווקא את המסגור שהוא בא
 * לשלול (`FORBIDDEN_REFERRAL_WORDS` אוכף את זה).
 *
 * בלוח מופיע רק מידע אנונימי; שם וטלפון נחשפים למשרד הקולט רק
 * אחרי הקליטה.
 */
function ReferLeadSection({ leadId }: { leadId: string }) {
  const [shared, setShared] = useState<MySharedLead | null | undefined>(undefined);
  const [terms, setTerms] = useState<ReferralTerms | null>(null);
  const [price, setPrice] = useState<string>("");
  /*
   * ברירת המחדל היא קרדיטים, ולא כי היא "הראשונה": היא המסלול שבו
   * הערך נשאר במערכת ולכן גם מזכה בבונוס. מי שרוצה כסף בוחר במפורש.
   */
  const [payoutMode, setPayoutMode] = useState<PayoutMode>("credits");
  const [reason, setReason] = useState<string>("");
  const [reasonDetail, setReasonDetail] = useState("");
  /** ההצהרה על איכות הלקוח — חובה בפרסום. */
  const [scores, setScores] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // ‎leads/mine‎ — נגיש עם יכולת השיתוף בלבד, כמו המדור הזה עצמו
    apiGet<MySharedLead[]>("/collaboration/leads/mine")
      .then((rows) =>
        setShared(
          rows.find((r) => r.originLeadId === leadId && r.status !== "withdrawn") ?? null,
        ),
      )
      .catch(() => setShared(null));
    /*
     * הצעת המחיר מגיעה מהשרת ולא מחושבת כאן: התמחור לפי מקור הליד
     * הוא נתון של הפלטפורמה, ומסך שמנחש אותו יציג מספר אחר ממה
     * שהשרת מכיר.
     */
    apiGet<ReferralTerms>(`/collaboration/leads/terms/${leadId}`)
      .then((row) => {
        setTerms(row);
        setPrice((current) => current || String(row.suggestedPriceCredits));
      })
      .catch(() => undefined);
  }, [leadId]);

  const priceNumber = Number(price);
  const priceValid = Number.isInteger(priceNumber) && priceNumber >= MIN_REFERRAL_PRICE;
  /*
   * לפי האחוז שהשרת דיווח, לא לפי ברירת המחדל שבקוד.
   *
   * האחוז נקבע במסך הפלטפורמה, ומהרגע שהוא ניתן לשינוי תצוגה
   * שמחשבת לפי הקבוע הייתה מבטיחה למפנה סכום אחד ומזכה אותו באחר —
   * וזה בדיוק מה שהורס אמון בלוח ההפניות. עד שהתנאים נטענים אין
   * תצוגה מקדימה: מוטב שקט מאשר מספר שאולי שגוי.
   */
  /*
   * שני המסלולים מחושבים יחד ומוצגים זה לצד זה. הבחירה כאן היא
   * כספית וסופית — היא נצרבת על ההפניה ברגע הפרסום — ואי אפשר
   * לבחור נכון בלי לראות את שתי התוצאות באותו רגע.
   *
   * `settleReferral` היא אותה פונקציה שהשרת מריץ, עם המספרים
   * שהשרת שלח. כשהתנאים טרם נטענו אין תצוגה מקדימה: מוטב שקט
   * מאשר מספר שאולי שגוי.
   */
  const economy: CreditEconomy | null =
    terms?.economy === undefined
      ? null
      : { ...DEFAULT_CREDIT_ECONOMY, ...terms.economy, feeCreditsPercent: terms.economy.feeCreditsPercent };
  const settlement =
    priceValid && economy !== null
      ? {
          credits: settleReferral(priceNumber, "credits", economy),
          cash: settleReferral(priceNumber, "cash", economy),
        }
      : null;
  const preview =
    priceValid && terms !== null ? referralPayout(priceNumber, terms.platformFeePercent) : null;

  async function publish() {
    const reasonProblem = referralReasonRejectionReason(reason, reasonDetail);
    if (reasonProblem) {
      setError(reasonProblem);
      return;
    }
    const priceProblem = referralPriceRejectionReason(priceNumber);
    if (priceProblem) {
      setError(priceProblem);
      return;
    }
    /*
     * ההצהרה חובה, והבדיקה כאן זהה לזו שבשרת — אחרת המסך מאפשר
     * ללחוץ ומקבל 400 על משהו שהוא עצמו הציג כתקין.
     */
    const scoresProblem = dimensionRatingRejectionReason(scores);
    if (scoresProblem) {
      setError(scoresProblem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const row = await apiPost<MySharedLead>("/collaboration/leads", {
        leadId,
        priceCredits: priceNumber,
        reason,
        ...(reasonDetail.trim() ? { reasonDetail: reasonDetail.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(city.trim() ? { city: city.trim() } : {}),
        payoutMode,
        scores,
      });
      setShared(row);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "פרסום ההפניה נכשל");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (!shared) return;
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`/collaboration/leads/${shared.id}`);
      setShared(null);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "ההסרה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  if (shared === undefined) return null;

  if (shared?.status === "sold") {
    return (
      <section
        className="mv-list-card px-5 py-[18px]"
        style={{ borderColor: "var(--color-success)" }}
      >
        {/*
          הניסוח לפי המסלול שנבחר בפרסום. הודעה על "קרדיטים שנוספו"
          למי שבחר כסף שולחת אותו לחפש אותם במקום הלא נכון.
        */}
        <p className="m-0 font-medium" style={{ color: "var(--color-success)" }}>
          <IconCoins s={15} /> ההפניה נקלטה במשרד אחר —{" "}
          {shared.payoutMode === "cash" ? (
            <>
              {shekels(shared.payoutAgorot ?? 0)} ₪ נוספו ליתרה הכספית של המשרד, וניתן
              למשוך אותם ממסך שיתופי הפעולה
            </>
          ) : (
            <>
              {shared.payoutCredits} קרדיטים נוספו ליתרת המשרד
              {shared.platformFeeCredits > 0
                ? ` (${shared.priceCredits} בניכוי ${shared.platformFeeCredits} עמלת פלטפורמה)`
                : ""}
            </>
          )}
          .
        </p>
        {/* מה שהצהרנו, מה שהמשרד הקולט מצא, והפער שנכנס למוניטין */}
        <ReferralConfirmation
          sharedLeadId={shared.id}
          role="referrer"
          declared={shared.clientScores}
          confirmation={shared.confirmation}
        />
      </section>
    );
  }

  if (shared) {
    return (
      <section className="mv-list-card px-5 py-[18px]">
        <p className="mb-2 font-medium">
          <IconHandshake s={16} /> הלקוח מופנה בלוח ההפניות תמורת {shared.priceCredits} קרדיטים
          {shared.platformFeeCredits > 0
            ? ` — מתוכם ${shared.platformFeeCredits} עמלת פלטפורמה, ו${
                shared.payoutMode === "cash"
                  ? `-${shekels(shared.payoutAgorot ?? 0)} ₪ אליכם`
                  : `-${shared.payoutCredits} קרדיטים אליכם`
              }`
            : ""}
          .
        </p>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Button variant="ghost" disabled={busy} onClick={() => void withdraw()}>
          הסר מהלוח
        </Button>
      </section>
    );
  }

  return (
    /*
      פרוש ולא מקופל: כל הלשונית עוסקת בהפניה, ומשולש שצריך ללחוץ
      עליו כדי להגיע לטופס שהוא כל תוכן המסך הוא חיכוך בלי תמורה.
    */
    <section className="mv-list-card px-5 py-[18px]">
      <h2 className="m-0 mb-1" style={{ fontSize: 16.5, fontWeight: 800 }}>
        <IconHandshake s={16} /> הפניית הלקוח למשרד אחר
      </h2>
      <p className="mt-1 mb-4 text-[14.5px]" style={{ color: "var(--color-text-muted)" }}>
        לקוח שאינו מתאים לכם — לא באזור שלכם, לא בתחום שלכם או שאין לכם פנאי —
        יכול לקבל מענה במשרד אחר, ואתם מקבלים תמורה על ההפניה. בלוח יופיעו רק
        הכוונה, המקור, הסיבה והתיאור שתכתבו; שם וטלפון נחשפים למשרד הקולט רק
        אחרי הקליטה.
      </p>

      <div className="mb-3 flex flex-col gap-2">
        {/*
          הסיבה ראשונה ולא אחרונה: היא ההבדל בין הפניה מקצועית לבין
          היפטרות מלקוח, והיא גם מה שהמשרד הקולט קורא ראשון.
        */}
        <label htmlFor="referReason" className="flex flex-col gap-1 text-sm">
          <span>למה אתם מפנים את הלקוח? (חובה)</span>
          <select
            id="referReason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="rounded-lg border px-3 py-2"
            style={{ borderColor: "var(--color-border)", background: "var(--color-field)" }}
          >
            <option value="">בחרו סיבה…</option>
            {REFERRAL_REASONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {reason ? (
            <span className="text-[14px]" style={{ color: "var(--color-text-muted)" }}>
              {REFERRAL_REASONS.find((option) => option.value === reason)?.hint}
            </span>
          ) : null}
        </label>
        {reason === "other" ? (
          <label htmlFor="referReasonDetail" className="flex flex-col gap-1 text-sm">
            <span>פרטו את הסיבה</span>
            <div className="flex items-start gap-2">
              <input
                id="referReasonDetail"
                value={reasonDetail}
                onChange={(e) => setReasonDetail(e.target.value)}
                maxLength={MAX_REFERRAL_REASON_DETAIL}
                className="flex-1 rounded-lg border px-3 py-2"
                style={{ borderColor: "var(--color-border)", background: "var(--color-field)" }}
              />
              <DictateFor targetId="referReasonDetail" />
            </div>
          </label>
        ) : null}

        <label htmlFor="referPrice" className="flex flex-col gap-1 text-sm">
          <span>תמורה שאתם מבקשים (בקרדיטים)</span>
          <input
            id="referPrice"
            type="number"
            inputMode="numeric"
            min={MIN_REFERRAL_PRICE}
            max={MAX_REFERRAL_PRICE}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="rounded-lg border px-3 py-2"
            style={{ borderColor: "var(--color-border)", background: "var(--color-field)" }}
          />
          {/*
            הפירוק מוצג לפני הפרסום ולא אחרי הקליטה. עמלה שמתגלה
            בדיעבד היא בדיוק מה שהורס אמון בלוח.
          */}
          {settlement === null && preview ? (
            <span className="text-[14px]" style={{ color: "var(--color-text-muted)" }}>
              המשרד הקולט משלם {preview.priceCredits} · עמלת פלטפורמה{" "}
              {terms ? `${terms.platformFeePercent}% = ` : ""}
              {preview.platformFeeCredits} · <b>אליכם {preview.payoutCredits} קרדיטים</b>
            </span>
          ) : null}
        </label>

        {/*
          בחירת התמורה. המשרד הקולט משלם אותו דבר בשני המסלולים —
          ההפרש הוא בין מה שנשאר אצל הפלטפורמה למה שמגיע אליכם,
          ובאיזה מטבע. הבחירה נצרבת ואינה ניתנת לשינוי אחרי הפרסום.
        */}
        {settlement !== null ? (
          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-1 text-sm">התמורה שתקבלו</legend>
            <div className="flex flex-col gap-1.5 sm:flex-row">
              {(["credits", "cash"] as PayoutMode[]).map((mode) => (
                <label
                  key={mode}
                  className="flex flex-1 cursor-pointer items-start gap-2 rounded-lg border p-2.5"
                  style={{
                    borderColor:
                      payoutMode === mode ? "var(--color-primary)" : "var(--color-border)",
                    background: "var(--color-bg)",
                  }}
                >
                  <input
                    type="radio"
                    name="payoutMode"
                    checked={payoutMode === mode}
                    onChange={() => setPayoutMode(mode)}
                    className="mt-0.5"
                  />
                  <span className="text-[14px]">
                    <b>{PAYOUT_MODE_LABEL[mode]}</b>
                    <br />
                    {mode === "credits" ? (
                      <>
                        <b>{settlement.credits.payoutCredits} קרדיטים</b> ליתרה שלכם
                        {economy !== null && economy.creditBonusPercent > 0 ? (
                          <> — כולל בונוס {economy.creditBonusPercent}%</>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <b>{shekels(settlement.cash.payoutAgorot)} ₪</b> ליתרה הכספית, למשיכה
                        לחשבון הבנק
                      </>
                    )}
                  </span>
                </label>
              ))}
            </div>
            <p className="m-0 mt-1 text-[14px]" style={{ color: "var(--color-text-muted)" }}>
              המשרד הקולט משלם {priceNumber} קרדיטים בשני המסלולים. הבחירה נקבעת עכשיו
              ואי אפשר לשנותה אחרי הפרסום.
            </p>
          </fieldset>
        ) : null}

        <label className="flex flex-col gap-1 text-sm">
          <span>עיר (לתצוגה בלוח)</span>
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            maxLength={MAX_REFERRAL_CITY}
            className="rounded-lg border px-3 py-2"
            style={{ borderColor: "var(--color-border)", background: "var(--color-field)" }}
          />
        </label>
        {/*
          ההצהרה על איכות הלקוח — חובה, וזה מה שהמשרד הקולט רואה
          לפני שהוא משלם. היא מופיעה אחרי התמורה ולפני התיאור
          החופשי: אחרי שכבר ברור מה מבקשים, ולפני מלל שאפשר לדלג
          עליו.
        */}
        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-1 text-sm">מה אתם יודעים על הלקוח? (חובה)</legend>
          <ClientScoresField mode="declare" scores={scores} onChange={setScores} />
        </fieldset>

        <label htmlFor="referNote" className="flex flex-col gap-1 text-sm">
          <span>תיאור קצר למשרדים (בלי שם ובלי טלפון)</span>
          <div className="flex items-start gap-2">
            <textarea
              id="referNote"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={MAX_REFERRAL_NOTE}
              rows={2}
              className="flex-1 rounded-lg border px-3 py-2"
              style={{ borderColor: "var(--color-border)", background: "var(--color-field)" }}
            />
            <DictateFor targetId="referNote" />
          </div>
        </label>
      </div>

      <p className="mb-3 text-[14px]" style={{ color: "var(--color-text-muted)" }}>
        המשרד הקולט משלם על ההפניה ברגע הקליטה, ולא על עסקה שתיסגר. אחרי הקליטה
        הוא מאשר את ההצהרה שלכם, והפער בין השניים הוא המוניטין שמוצג לצד ההפניות
        הבאות שלכם — כלומר <b>הצהרה מדויקת שווה יותר מהצהרה גבוהה</b>.
      </p>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button disabled={busy || !reason || !priceValid} onClick={() => void publish()}>
        {busy ? "מפרסם…" : "פרסם הפניה"}
      </Button>
    </section>
  );
}

/**
 * מחיקת ליד שאינו רלוונטי — ספאם, טעות במספר, פנייה שאינה נדל"ן.
 *
 * בתחתית הכרטיס ולא ליד הכפתורים למעלה: זו הפעולה היחידה כאן שאי
 * אפשר לחזור ממנה, והמקום שלה הוא אחרי שכבר ראו את כל מה שנמחק.
 */
function DeleteLeadSection({ leadId, contactName }: { leadId: string; contactName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (
      !window.confirm(
        `למחוק את הליד של ${contactName}?\n\nציר הזמן נמחק איתו, וגם כרטיס איש הקשר — אם אין לו קונה, נכס או ליד אחר במשרד. הפעולה אינה הפיכה.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`/leads/${leadId}`);
      router.push("/leads");
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "המחיקה נכשלה");
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="delete-lead-heading"
      className="mt-8 rounded-xl border p-4"
      style={{ borderColor: "var(--color-danger)" }}
    >
      <h2 id="delete-lead-heading" className="mb-1 font-semibold" style={{ color: "var(--color-danger)" }}>
        מחיקת הליד
      </h2>
      <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        פנייה שאינה רלוונטית בכלל — ספאם, טעות במספר או משהו שאינו נדל"ן.
        מחיקה מוציאה אותה מהמאגר; פגישות ושיחות מוקלטות שכבר נרשמו נשארות.
      </p>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button variant="ghost" disabled={busy} onClick={() => void remove()}>
        {busy ? "מוחק…" : "מחק ליד"}
      </Button>
    </section>
  );
}

function ConvertToPropertySection({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ id: string }>(`/properties/from-lead/${leadId}`, {
        city: String(f.get("city") ?? "").trim(),
        dealType: String(f.get("dealType") ?? "sale"),
        propertyType: String(f.get("propertyType") ?? "apartment"),
        ...(String(f.get("street") ?? "").trim() !== ""
          ? { street: String(f.get("street") ?? "").trim() }
          : {}),
        ...(String(f.get("price") ?? "").trim() !== ""
          ? { priceAgorot: Math.round(Number(f.get("price")) * 100) }
          : {}),
        ...(String(f.get("rooms") ?? "").trim() !== "" ? { rooms: Number(f.get("rooms")) } : {}),
      });
      router.push(`/properties/${res.id}`);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "ההמרה נכשלה");
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="mb-4">
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <IconHome s={15} /> המר לנכס (בעל נכס)
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="mb-4 rounded-xl border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <p className="m-0 mb-3 font-bold">המרה לנכס — איש הקשר יהפוך לבעל הנכס</p>
      {error ? (
        <Notice tone="danger">{error}</Notice>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="cp-city" className="mb-1 block text-sm">עיר</label>
          <input id="cp-city" name="city" required className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--color-border)", background: "var(--color-field)" }} />
        </div>
        <div>
          <label htmlFor="cp-address" className="mb-1 block text-sm">רחוב ומספר (לא חובה)</label>
          <input id="cp-address" name="street" className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--color-border)", background: "var(--color-field)" }} />
        </div>
        <div>
          <label htmlFor="cp-deal" className="mb-1 block text-sm">עסקה</label>
          <select id="cp-deal" name="dealType" className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--color-border)", background: "var(--color-field)" }}>
            <option value="sale">מכירה</option>
            <option value="rent">השכרה</option>
          </select>
        </div>
        <div>
          <label htmlFor="cp-type" className="mb-1 block text-sm">סוג נכס</label>
          <select id="cp-type" name="propertyType" className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--color-border)", background: "var(--color-field)" }}>
            <option value="apartment">דירה</option>
            <option value="garden_apartment">דירת גן</option>
            <option value="penthouse">פנטהאוז</option>
            <option value="private_house">בית פרטי</option>
            <option value="duplex">דופלקס</option>
            <option value="plot">מגרש</option>
            <option value="commercial">מסחרי</option>
          </select>
        </div>
        <div>
          <label htmlFor="cp-price" className="mb-1 block text-sm">מחיר בש"ח (לא חובה)</label>
          <input id="cp-price" name="price" type="number" min={0} className="w-32 rounded-lg border px-3 py-2" style={{ borderColor: "var(--color-border)", background: "var(--color-field)" }} />
        </div>
        <div>
          <label htmlFor="cp-rooms" className="mb-1 block text-sm">חדרים (לא חובה)</label>
          <input id="cp-rooms" name="rooms" type="number" min={1} max={20} step={0.5} className="w-24 rounded-lg border px-3 py-2" style={{ borderColor: "var(--color-border)", background: "var(--color-field)" }} />
        </div>
        <Button type="submit" disabled={busy}>{busy ? "ממיר…" : "צור נכס"}</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>ביטול</Button>
      </div>
    </form>
  );
}

function ConvertSection({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onConvert(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const f = new FormData(event.currentTarget);
    // ריק = לא נמסר; `Number("")` הוא 0, וזה בדיוק מה שאסור לשלוח
    const budgetRaw = String(f.get("budgetMax") ?? "").trim();
    const budget = budgetRaw === "" ? undefined : Number(budgetRaw);
    try {
      const buyer = await apiPost<{ id: string }>(`/leads/${leadId}/convert`, {
        maturity: String(f.get("maturity")),
        requirements: {
          cities: String(f.get("cities"))
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean),
          dealType: String(f.get("dealType")),
          ...(budget === undefined || !Number.isFinite(budget)
            ? {}
            : { budgetMaxAgorot: shekelsToAgorot(budget) }),
        },
      });
      router.push(`/buyers/${buyer.id}`);
    } catch (err: unknown) {
      setError(
        err instanceof ApiError && err.status === 409
          ? "הליד כבר הומר, או שכבר קיים קונה פעיל לאיש קשר זה"
          : "ההמרה נכשלה — בדקו את הפרטים ונסו שוב",
      );
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="mb-4">
        <Button onClick={() => setOpen(true)}><IconUser s={15} /> המר לקונה</Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => void onConvert(event)}
      className="mb-6 rounded-xl border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <h2 className="mb-3 text-lg font-semibold">המרה לקונה</h2>
      <div className="mb-3 flex flex-wrap gap-3">
        <div>
          <label htmlFor="cv-cities" className="mb-1 block text-sm font-medium">
            ערים (מופרדות בפסיק)
          </label>
          <input
            id="cv-cities"
            name="cities"
            required
            placeholder="תל אביב, גבעתיים"
            className="rounded-lg border px-3 py-2"
            style={{ borderColor: "var(--color-border)", background: "var(--color-field)" }}
          />
        </div>
        <div>
          <label htmlFor="cv-deal" className="mb-1 block text-sm font-medium">סוג עסקה</label>
          <select
            id="cv-deal"
            name="dealType"
            className="rounded-lg border px-3 py-2"
            style={{ borderColor: "var(--color-border)", background: "var(--color-field)" }}
          >
            <option value="sale">קנייה</option>
            <option value="rent">שכירות</option>
          </select>
        </div>
        <div>
          <label htmlFor="cv-budget" className="mb-1 block text-sm font-medium">
            תקציב מקסימלי (₪){" "}
            <span className="font-normal" style={{ color: "var(--color-text-muted)" }}>
              — בלי תקציב ההתאמות מדויקות פחות
            </span>
          </label>
          <input
            id="cv-budget"
            name="budgetMax"
            type="number"
            min={1}
            className="rounded-lg border px-3 py-2"
            style={{ borderColor: "var(--color-border)", background: "var(--color-field)" }}
            dir="ltr"
          />
        </div>
        <div>
          <label htmlFor="cv-maturity" className="mb-1 block text-sm font-medium">בשלות</label>
          <select
            id="cv-maturity"
            name="maturity"
            defaultValue="interested"
            className="rounded-lg border px-3 py-2"
            style={{ borderColor: "var(--color-border)", background: "var(--color-field)" }}
          >
            {Object.entries(SHARED_MATURITY).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      </div>
      {error ? (
        <Notice tone="danger">{error}</Notice>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{busy ? "ממיר…" : "המר לקונה"}</Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>ביטול</Button>
      </div>
    </form>
  );
}

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user, loading: authLoading } = useRequireAuth();
  // אותה יכולת שמגינה על "המר לקונה" למטה — הרשאת עריכת לקוח
  const canEditPeople = can(user, "buyers.edit");
  // הגעה מטופס "ליד חדש" כשכבר היה ליד פתוח — השרת מיזג את הפנייה לכאן
  const merged = useSearchParams().get("merged") === "1";
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [dialed, setDialed] = useState<DialedNumber | null>(null);
  const [error, setError] = useState<string | null>(null);
  /*
   * אותה תבנית בדיוק כמו בכרטיס הקונה ובכרטיס הנכס. כרטיס הליד
   * נשאר האחרון שהיה גלילה אחת ארוכה — שבע-עשרה קופסאות בטור,
   * שבהן הדבר הדחוף ביותר ("דורש טיפול אנושי") ישב מתחת לקיפול.
   */
  const [tab, selectTab] = useEntityTab(["overview", "next", "timeline"], "overview");

  useEffect(() => {
    if (authLoading) return;
    apiGet<{ lead: LeadDetail; timeline: TimelineItem[]; dialedNumber?: DialedNumber }>(
      `/leads/${id}`,
    )
      .then((res) => {
        setLead(res.lead);
        setTimeline(res.timeline);
        setDialed(res.dialedNumber ?? null);
      })
      .catch(() => setError("הליד לא נמצא"));
  }, [authLoading, id]);

  async function changeStatus(status: string) {
    await apiPatch(`/leads/${id}/status`, { status });
    setLead((prev) => (prev ? { ...prev, status, requiresHuman: false } : prev));
    setTimeline((prev) => [
      { id: `local-${status}`, kind: "status_change", content: status, createdAt: new Date().toISOString() },
      ...prev,
    ]);
  }

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const content = String(new FormData(form).get("note") ?? "").trim();
    if (!content) return;
    const created = await apiPost<TimelineItem>(`/leads/${id}/notes`, { content });
    setTimeline((prev) => [created, ...prev]);
    form.reset();
  }

  if (error) {
    return (
      <Notice tone="danger">{error} — <Link href="/leads" className="underline">חזרה לרשימה</Link></Notice>
    );
  }
  if (!lead) return <p aria-live="polite">טוען…</p>;

  const pill = STATUS_PILL[lead.status] ?? STATUS_PILL["new"]!;

  return (
    <>
      <Link
        href="/leads"
        className="mb-3.5 inline-block text-[15px] font-bold no-underline hover:underline"
        style={{ color: "var(--color-primary)" }}
      >
        → חזרה לרשימת הלידים
      </Link>

      {/*
        ---- כותרת ----

        אותה כותרת בדיוק כמו בכרטיס הקונה, ומאותה סיבה: היא עונה על
        שתי שאלות — מי זה, ומה עושים איתו עכשיו — וכל השאר יורד
        ללשוניות. עד כאן היא הייתה שורת טקסט עם ארבעה קישורים
        מקווקוים ותיבת סטטוס שצפה מתחתיה, וזה מה שהפך את המסך
        למבולגן: אין בו היררכיה, ולכן העין לא יודעת איפה להתחיל.
      */}
      <div
        className="mv-list-card mb-3 flex flex-wrap items-center gap-4 px-6 py-5"
        style={{ overflow: "visible" }}
      >
        <span
          aria-hidden="true"
          className="grid flex-none place-items-center rounded-full"
          style={{
            width: 48,
            height: 48,
            background: "var(--color-primary-soft)",
            color: "var(--color-primary)",
            fontWeight: 800,
            fontSize: 19,
          }}
        >
          {initials(lead.contact.name)}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="m-0" style={{ fontSize: 21, fontWeight: 800 }}>
              {lead.contact.name}
            </h1>
            {/* הכוונה צמודה לשם: "קונה" ו"מוכר" הן שתי שיחות שונות */}
            <span
              className="mv-pill"
              style={{
                background: "var(--color-primary-soft)",
                color: "var(--color-primary)",
                fontWeight: 700,
              }}
            >
              {labelOf(LEAD_INTENT_LABELS, lead.intent) ?? lead.intent}
            </span>
            {/*
              רשימה מעוצבת ולא `select` נייטיב — אותו תיקון שכבר
              נעשה בכרטיס הקונה: הגלולה נראתה נכון סגורה, ובפתיחה
              נפתחה רשימת מערכת עם הדגשה כחולה שאינה שייכת לכאן.
            */}
            <SelectMenu
              value={lead.status}
              onChange={(next) => void changeStatus(next)}
              options={Object.entries(LEAD_STATUS_LABELS).map(
                ([value, label]) => ({ value, label }),
              )}
              label="עדכון סטטוס"
              minWidth={132}
              tone={{ fg: pill.fg, bg: pill.bg }}
            />
          </div>
          <p
            className="m-0 mt-1 text-[14.5px]"
            style={{ color: "var(--color-text-muted)" }}
          >
            <span dir="ltr">{lead.contact.phone}</span> · מקור:{" "}
            {labelOf(LEAD_SOURCE_LABELS, lead.source) ?? lead.source}
            {/*
              המספר שאליו הלקוח התקשר — רזולוציה שהמקור לבדו אינו
              נותן. משרד שמריץ שלוש מודעות באותו ערוץ רואה שלוש
              שורות עם אותו מקור; המספר הוא מה שמפריד ביניהן.
            */}
            {dialed !== null ? (
              <>
                {" · התקשר אל: "}
                <span style={{ color: "var(--color-text)" }}>
                  {dialed.label ?? "מספר לא מוגדר"}
                </span>{" "}
                <span dir="ltr">({dialed.phone})</span>
              </>
            ) : null}
          </p>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <a
            href={waMeUrl(lead.contact.phone)}
            target="_blank"
            rel="noreferrer"
            className="mv-btn-plain"
            style={{ minHeight: 36, paddingInline: 13, fontSize: 14.5 }}
          >
            <IconChat s={14} /> וואטסאפ
          </a>
          <a
            href={`tel:${lead.contact.phone}`}
            className="mv-btn-plain"
            style={{ minHeight: 36, paddingInline: 13, fontSize: 14.5 }}
          >
            <IconPhone s={14} /> חייג
          </a>
          <ClickToDial
            contactId={lead.contact.id}
            phone={lead.contact.phone}
            label="מהמרכזייה"
          />
          {lead.contact.email ? (
            <a
              href={`mailto:${lead.contact.email}`}
              className="mv-btn-plain"
              style={{ minHeight: 36, paddingInline: 13, fontSize: 14.5 }}
            >
              <IconMail s={14} /> אימייל
            </a>
          ) : null}
          <Link
            href={`/calendar/new?leadId=${lead.id}`}
            className="mv-btn-plain"
            style={{ minHeight: 36, paddingInline: 13, fontSize: 14.5 }}
          >
            <IconCalendar s={14} /> קבע פגישה
          </Link>
        </div>
      </div>

      {/*
        **הדחוף קודם.** ההתראה ישבה קודם במקום העשירי, מתחת לשש
        קופסאות — כלומר הדבר היחיד במסך שדורש פעולה מיידית היה
        הדבר שהכי קשה לראות.
      */}
      {lead.requiresHuman ? (
        <Notice tone="danger">
          ● דורש טיפול אנושי
          {lead.requiresHumanReason ? `: ${lead.requiresHumanReason}` : ""}
        </Notice>
      ) : null}

      {merged ? (
        <Notice tone="info">
          <IconInfo s={15} /> לאיש הקשר כבר יש ליד פתוח — הפנייה החדשה נוספה
          לציר הזמן שלו במקום לפתוח ליד כפול.
        </Notice>
      ) : null}

      {/* ---- לשוניות ---- */}
      <div
        className="mv-list-card mb-[18px] px-4"
        style={{ overflow: "visible" }}
      >
        <EntityTabs
          label="לשוניות כרטיס הליד"
          active={tab}
          onSelect={selectTab}
          tabs={[
            { key: "overview", label: "סקירה" },
            { key: "next", label: "המשך טיפול" },
            { key: "referral", label: "הפניות" },
            { key: "timeline", label: "ציר זמן", count: timeline.length },
          ]}
        />
      </div>

      {/* ============================================================
          סקירה — מה שסוכן קורא לפני שהוא מרים טלפון
          ============================================================ */}
      <TabPanel tab="overview" active={tab}>
        {/*
          שתי עמודות ולא טור אחד ארוך, כמו בכרטיס הקונה.

          בעמודה הצדדית יושב מה ש**קוראים** — תוכן הפנייה והקשרים
          האחרים של אותו אדם; ברחבה יושב מה ש**עושים** — תשובה
          במייל, משימות ואנשי קשר. טור אחד הכריח לגלול דרך טופס
          תשובה שלם כדי להגיע לרשימת המשימות.
        */}
        <div className="grid items-start gap-[18px] lg:[grid-template-columns:340px_1fr]">
          <div className="grid gap-[18px]">
            {/*
              ---- תוכן הפנייה ----
              הדבר הראשון שהמתווך צריך לדעת ("מה הוא רצה?") היה עד
              לא מזמן הדבר האחרון שהוא ראה. כאן הוא ראשון, ובצבע
              שמפריד אותו משאר הכרטיס.
            */}
            {lead.summary ? (
              <section
                aria-labelledby="lead-summary-heading"
                className="rounded-xl border px-5 py-[18px]"
                style={{
                  borderColor: "var(--color-primary)",
                  background: "var(--color-primary-soft)",
                }}
              >
                <h2
                  id="lead-summary-heading"
                  className="m-0 mb-1.5"
                  style={{
                    fontSize: 14.5,
                    fontWeight: 800,
                    color: "var(--color-primary)",
                  }}
                >
                  תוכן הפנייה
                </h2>
                {/* whitespace-pre-line: שורות ההודעה נשמרות כפי שנשלחו */}
                <p
                  className="m-0 whitespace-pre-line"
                  style={{ fontSize: 15.5, lineHeight: 1.5 }}
                >
                  {lead.summary}
                </p>
              </section>
            ) : (
              <section
                className="mv-list-card px-5 py-[18px]"
                aria-labelledby="lead-summary-heading"
              >
                <h2
                  id="lead-summary-heading"
                  className="m-0 mb-1.5"
                  style={{ fontSize: 16.5, fontWeight: 800 }}
                >
                  תוכן הפנייה
                </h2>
                {/*
                  מצב ריק שאומר מה לעשות ולא רק שאין כלום: ליד
                  ממרכזייה מגיע בלי טקסט, וההערה בציר הזמן היא
                  המקום שבו הסוכן רושם מה נאמר בשיחה.
                */}
                <p
                  className="m-0 text-[14.5px]"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  הפנייה הגיעה בלי תוכן כתוב. מה שנאמר בשיחה נרשם
                  כהערה בציר הזמן.
                </p>
              </section>
            )}

            {/* הכובעים האחרים של אותו אדם — קונה קיים, נכס שהוא מוכר */}
            <RelatedEntities
              contactId={lead.contact.id}
              exclude={{ kind: "lead", id: lead.id }}
            />
          </div>

          <div className="grid gap-[18px]">
            {/* קראת מה הוא רצה — עכשיו תענה לו */}
            <ReplyEmail
              contactId={lead.contact.id}
              leadId={lead.id}
              contactName={lead.contact.name}
              {...(lead.contact.email !== undefined
                ? { contactEmail: lead.contact.email }
                : {})}
            />

            <EntityTasks entityType="lead" entityId={id} />

            <ContactPeople
              contactId={lead.contact.id}
              canEdit={canEditPeople}
              canErase={can(user, "contacts.delete")}
            />
          </div>
        </div>
      </TabPanel>

      {/* ============================================================
          המשך טיפול — שתי הדרכים שבהן ליד הופך לכרטיס אצלנו
          ============================================================ */}
      <TabPanel tab="next" active={tab}>
        {lead.status === "converted" ? (
          <p
            className="mv-list-card px-5 py-[18px]"
            style={{ color: "var(--color-text-muted)" }}
          >
            הליד כבר הומר — אין המשך טיפול נוסף.
          </p>
        ) : null}

        {lead.status !== "converted" ? (
          <div className="grid gap-[18px] lg:grid-cols-2">
            {can(user, "buyers.edit") ? (
              <section className="mv-list-card px-5 py-[18px]">
                <h2 className="m-0 mb-1" style={{ fontSize: 16.5, fontWeight: 800 }}>
                  <IconUser s={16} /> המרה לקונה
                </h2>
                <p
                  className="m-0 mb-3 text-[14.5px]"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  הלקוח מחפש נכס — הכרטיס נכנס למנוע ההתאמות. איש
                  הקשר וההיסטוריה נשמרים.
                </p>
                <ConvertSection leadId={lead.id} />
              </section>
            ) : null}

            {/* ליד אינו תמיד קונה — "יש לי דירה למכור" הוא בעל נכס */}
            {can(user, "properties.create") ? (
              <section className="mv-list-card px-5 py-[18px]">
                <h2 className="m-0 mb-1" style={{ fontSize: 16.5, fontWeight: 800 }}>
                  <IconHome s={16} /> המרה לנכס
                </h2>
                <p
                  className="m-0 mb-3 text-[14.5px]"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  הלקוח מוכר או משכיר — איש הקשר של הליד הופך לבעל
                  הנכס אוטומטית.
                </p>
                <ConvertToPropertySection leadId={lead.id} />
              </section>
            ) : null}
          </div>
        ) : null}

        {/* ליד שהומר כבר יצר כרטיס — מוחקים את הכרטיס, לא את המקור */}
        {lead.status !== "converted" && can(user, "leads.delete") ? (
          <div className="mt-[18px]">
            <DeleteLeadSection leadId={lead.id} contactName={lead.contact.name} />
          </div>
        ) : null}
      </TabPanel>

      {/* ============================================================
          הפניות — הדרך השלישית: לקוח שאינו לנו, למשרד שכן ישרת אותו
          ============================================================ */}
      <TabPanel tab="referral" active={tab}>
        {/*
          לשונית משלה, ולא אקורדיון בתחתית „המשך טיפול”.

          הפניה היא החלטה עסקית עם טופס בן שישה שדות — סיבה, תמורה,
          מסלול תשלום, עיר, הצהרת איכות ותיאור — והיא ישבה מקופלת
          מתחת לשתי המרות, כלומר במקום שאיש לא פתח. מסך שמסתיר
          מנגנון שלם מאחורי משולש קטן הוא מסך שהמנגנון הזה לא קיים
          בו בפועל (בקשת המשתמש).
        */}
        {lead.status === "converted" ? (
          <p
            className="mv-list-card px-5 py-[18px]"
            style={{ color: "var(--color-text-muted)" }}
          >
            הליד כבר הומר לכרטיס אצלנו — אין מה להפנות.
          </p>
        ) : can(user, "collaboration.share") ? (
          <ReferLeadSection leadId={lead.id} />
        ) : (
          <p
            className="mv-list-card px-5 py-[18px]"
            style={{ color: "var(--color-text-muted)" }}
          >
            הפניית לקוחות דורשת את הרשאת שיתופי הפעולה. מנהל המשרד
            יכול להעניק אותה במסך ההרשאות.
          </p>
        )}
      </TabPanel>

      {/* ============================================================
          ציר זמן — כל מה שקרה, והמקום לרשום מה נאמר עכשיו
          ============================================================ */}
      <TabPanel tab="timeline" active={tab}>
        <section
          className="mv-list-card px-5 py-[18px]"
          aria-labelledby="timeline-heading"
        >
          <h2
            id="timeline-heading"
            className="m-0 mb-3"
            style={{ fontSize: 16.5, fontWeight: 800 }}
          >
            ציר זמן
          </h2>

          <form
            onSubmit={(event) => void addNote(event)}
            className="mb-2 flex flex-wrap items-start gap-2"
          >
            <label htmlFor="note" className="mv-visually-hidden">
              הוספת הערה
            </label>
            <input
              id="note"
              name="note"
              placeholder="מה נאמר בשיחה?"
              className="min-w-0 flex-1 rounded-lg border px-3 py-2.5"
              style={{
                borderColor: "var(--color-border)",
                background: "var(--color-field)",
              }}
            />
            {/* הערה אחרי שיחה היא הטקסט שהכי כדאי להכתיב — המתווך
                עדיין עם הטלפון ביד ולא ליד המקלדת */}
            <DictateFor targetId="note" />
            <Button type="submit" variant="secondary">
              הוסף
            </Button>
          </form>

          {timeline.length === 0 ? (
            <p
              className="m-0 mt-3 text-[14.5px]"
              style={{ color: "var(--color-text-muted)" }}
            >
              אין עדיין פעילות בליד.
            </p>
          ) : (
            /*
              קו רציף לאורך הרשימה, ונקודה לכל אירוע. הרשימה הקודמת
              הייתה קופסאות מסוגרות זו מעל זו — נכון מבחינת המידע,
              אבל לא נקרא כרצף שקרה בזמן.
            */
            <ol
              className="m-0 mt-3 flex list-none flex-col gap-3 p-0 ps-4"
              style={{
                borderInlineStart: "2px solid var(--color-border)",
              }}
            >
              {timeline.map((item) => (
                <li key={item.id} className="relative">
                  <span
                    aria-hidden="true"
                    className="absolute rounded-full"
                    style={{
                      insetInlineStart: -21,
                      top: 7,
                      width: 8,
                      height: 8,
                      background: "var(--color-primary)",
                    }}
                  />
                  <p
                    className="m-0 mb-0.5 text-[14px]"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    {KIND_LABELS[item.kind] ?? item.kind} ·{" "}
                    {formatDate(item.createdAt)}
                  </p>
                  <p className="m-0 whitespace-pre-line text-[15.5px]">
                    {item.kind === "status_change"
                      ? `הסטטוס שונה ל: ${labelOf(LEAD_STATUS_LABELS, item.content) ?? item.content}`
                      : item.content}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </TabPanel>
    </>
  );
}
