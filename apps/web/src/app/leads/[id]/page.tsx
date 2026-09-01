"use client";

import { useEffect, useState, use, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@metavchim/ui";
import {
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
import { apiDelete, apiGet, apiPost, apiPatch, ApiError, apiList } from "@/lib/api";
import { formatDate, waMeUrl } from "@/lib/format";
import { LEAD_INTENT_LABELS, LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS } from "@/lib/lead-labels";
import { can, useRequireAuth } from "@/lib/use-auth";
import { ClickToDial } from "../../click-to-dial";
import { ConfirmDialog } from "../../confirm-dialog";
import { ContactPeople } from "../../contact-people";
import { ConvertSection, ConvertToPropertySection } from "../convert-sections";
import { DeleteLeadDialog } from "../delete-lead-dialog";
import { DictateFor } from "../../dictation-field";
import { RelatedEntities } from "../../related-entities";
import { EntityTasks } from "../../entity-tasks";
import { EntityTabs, TabPanel, useEntityTab } from "../../entity-tabs";
import { LeadCalls } from "./lead-calls";
import { IntakePanel } from "../../intake-panel";
import { SelectMenu } from "../../select-menu";
import { ReplyEmail } from "./reply-email";
import {
  ClientScoresField,
  ReferralConfirmation,
  type ReferralConfirmationValue,
} from "../../collaboration/client-rating";
import {
  IconBolt,
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
  /** מתי הליד נקלט — היה בשרת מאז ומתמיד ולא הוצהר כאן */
  createdAt: string;
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
  new: { fg: "var(--color-danger)", bg: "var(--color-danger-soft)" },
  in_progress: { fg: "var(--domain-amber-fg)", bg: "var(--domain-amber-bg)" },
  waiting_customer: { fg: "var(--color-text-muted)", bg: "var(--domain-neutral-tile)" },
  converted: { fg: "var(--color-success)", bg: "var(--color-success-soft)" },
  closed: { fg: "var(--chip-neutral-fg)", bg: "var(--chip-neutral-bg)" },
};

const KIND_LABELS: Record<string, ReactNode> = {
  note: <><IconDoc s={15} /> הערה</>,
  call: <><IconPhone s={15} /> שיחה</>,
  whatsapp: <><IconChat s={15} /> וואטסאפ</>,
  status_change: <><IconRefresh s={15} /> שינוי סטטוס</>,
  /*
   * ‎**המקור נרשם בציר הזמן כי הוא ייחוס.** דוח מקורות שאי אפשר
   * ליישב מול „מי שינה ומתי” אינו דוח.
   */
  source_change: <><IconRefresh s={15} /> שינוי מקור</>,
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
      <h2 className="m-0 mb-1" style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}>
        <IconHandshake s={16} /> הפניית הלקוח למשרד אחר
      </h2>
      <p className="mt-1 mb-4 text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>
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
            style={{ borderColor: "var(--color-input-border)", background: "var(--color-field)" }}
          >
            <option value="">בחרו סיבה…</option>
            {REFERRAL_REASONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {reason ? (
            <span className="text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
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
                style={{ borderColor: "var(--color-input-border)", background: "var(--color-field)" }}
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
            style={{ borderColor: "var(--color-input-border)", background: "var(--color-field)" }}
          />
          {/*
            הפירוק מוצג לפני הפרסום ולא אחרי הקליטה. עמלה שמתגלה
            בדיעבד היא בדיוק מה שהורס אמון בלוח.
          */}
          {settlement === null && preview ? (
            <span className="text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
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
                  <span className="text-[length:var(--type-caption)]">
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
            <p className="m-0 mt-1 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
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
            style={{ borderColor: "var(--color-input-border)", background: "var(--color-field)" }}
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
              style={{ borderColor: "var(--color-input-border)", background: "var(--color-field)" }}
            />
            <DictateFor targetId="referNote" />
          </div>
        </label>
      </div>

      <p className="mb-3 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
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
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

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
        ליד כפול, פנייה שנסגרה, או ספאם וטעות במספר. בחלון אפשר לבחור
        למחוק את הליד בלבד ולהשאיר את כרטיס הלקוח — או למחוק את שניהם.
      </p>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        מחק ליד
      </Button>

      <DeleteLeadDialog
        leadId={leadId}
        contactName={contactName}
        open={open}
        onClose={() => setOpen(false)}
        onDeleted={(message) => {
          setOpen(false);
          setOutcome(message);
        }}
      />

      {/*
        התוצאה נאמרת לפני היציאה מהמסך ולא אחריה: השאלה היחידה
        שיש למוחק ברגע הזה היא "וגם הלקוח ירד?", ורשימת הלידים
        שנפתחת מיד אינה עונה עליה.
      */}
      <ConfirmDialog
        open={outcome !== null}
        title="הליד נמחק"
        confirmLabel="חזרה לרשימת הלידים"
        cancelLabel={null}
        onClose={() => router.push("/leads")}
      >
        <p className="text-[length:var(--type-body-sm)]">{outcome}</p>
      </ConfirmDialog>
    </section>
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
  /*
   * ‎`referral` היה חסר מהרשימה אף שהלשונית מוצגת — כלומר `?tab=referral`
   * נפל בחזרה לסקירה. תוקן יחד עם הוספת `calls` (ביקורת עצמית).
   */
  const [tab, selectTab] = useEntityTab(
    ["overview", "next", "calls", "referral", "timeline"],
    "overview",
  );

  useEffect(() => {
    if (authLoading) return;
    apiGet<{ lead: LeadDetail; timeline: TimelineItem[]; dialedNumber?: DialedNumber }>(
      `/leads/${id}`,
    )
      .then((res) => {
        setLead(res.lead);
        setTimeline(apiList(res.timeline, "timeline"));
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

  /*
   * ‎**תיקון מקור הליד.**
   *
   * ‏המקור נקבע בקליטה ולא תמיד נכון: שיחה למספר הכללי נרשמת
   * ‎`phone` גם כשהלקוח הגיע מהמלצה.
   *
   * ‎`editingSource` הוא הערך שבעריכה, ו-`null` הוא „לא עורכים” —
   * שני מצבים ולא דגל נפרד, כדי שלא ייווצר מצב שהתיבה פתוחה בלי
   * ערך או סגורה עם ערך שנשמר בצד.
   */
  const [editingSource, setEditingSource] = useState<string | null>(null);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [sourceFailed, setSourceFailed] = useState(false);

  async function saveSource(): Promise<void> {
    const next = (editingSource ?? "").trim();
    if (next === "" || lead === null) return;
    // שינוי לאותו ערך אינו שינוי — סוגרים בלי לפנות לשרת
    if (next === lead.source) {
      setEditingSource(null);
      return;
    }
    setSourceBusy(true);
    setSourceFailed(false);
    try {
      await apiPatch(`/leads/${id}/source`, { source: next });
      /*
       * המסך מתעדכן רק אחרי אישור השרת. עדכון אופטימי היה מציג
       * מקור חדש על ליד שמקורו לא השתנה — והמתווך היה ממשיך משם.
       */
      setLead((prev) => (prev ? { ...prev, source: next } : prev));
      setTimeline((prev) => [
        {
          id: `local-source-${next}`,
          kind: "source_change",
          content: next,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);
      setEditingSource(null);
    } catch {
      setSourceFailed(true);
    } finally {
      setSourceBusy(false);
    }
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
        className="mb-3.5 inline-block text-[length:var(--type-body-sm)] font-bold no-underline hover:underline"
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
      <div className="mv-list-card mb-3 px-6 py-5" style={{ overflow: "visible" }}>
      <div className="flex flex-wrap items-center gap-4">
        {/*
          ‎**אריח הליד ולא ראשי תיבות.**

          ליד נקלט לעיתים קרובות בלי שם — משיחה שלא נענתה, מטופס בלי
          שדה שם — וראשי תיבות של מחרוזת ריקה הם עיגול ריק. הסמל אומר
          מה זה הכרטיס הזה, וזה נכון גם כשאין למי שבו שם.
        */}
        <span className="mv-tile mv-domain-green" aria-hidden="true">
          <IconBolt s={19} />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="m-0" style={{ fontSize: "calc(21 / 16 * 1rem)", fontWeight: 800 }}>
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
            className="m-0 mt-1 text-[length:var(--type-caption-lg)]"
            style={{ color: "var(--color-text-muted)" }}
          >
            <span dir="ltr">{lead.contact.phone}</span> · מקור:{" "}
            {labelOf(LEAD_SOURCE_LABELS, lead.source) ?? lead.source}
            {/*
              ‎**תיקון המקור — ליד המקור עצמו.**

              המקור נקבע אוטומטית בקליטה ולא תמיד נכון, ועד כה לא
              הייתה שום דרך לתקן. היכולת היא `leads.edit` — אותה
              יכולת שהשרת דורש.
            */}
            {can(user, "leads.edit") && editingSource === null ? (
              <>
                {" "}
                <button
                  type="button"
                  className="underline"
                  style={{ color: "inherit" }}
                  onClick={() => {
                    setSourceFailed(false);
                    setEditingSource(lead.source);
                  }}
                >
                  שינוי
                </button>
              </>
            ) : null}
            {/*
              מתי הכרטיס נכנס למערכת. התאריך היה בנתונים מהיום הראשון
              ולא הוצג באף מסך, ולכן „מתי הליד הזה נכנס?” הייתה שאלה
              בלי תשובה — גם כשהיא ההבדל בין פנייה טרייה לבין אחת
              ששוכבת שבועיים (בקשת בעל הפלטפורמה).
            */}
            {" · נקלט: "}
            <span style={{ color: "var(--color-text)" }}>
              {formatDate(lead.createdAt)}
            </span>
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
          {/*
            ‎**רשימה של המוכרים, ולצידה טקסט חופשי.**

            המקור אינו רשימה סגורה בפועל: צינור הטלפוניה כותב
            ‎`phone`, `outbound_call`, או את תווית הקמפיין שהמשרד
            הקליד במספר הווירטואלי — טקסט חופשי עד 20 תווים. רשימה
            סגורה הייתה מציגה ליד כזה כריק, ובחירה ממנה הייתה מוחקת
            ייחוס קמפיין אמיתי בלי שאיש יבחין.

            ‎`datalist` ולא `select`: הוא מציע את המוכרים בלחיצה,
            ומאפשר להקליד ערך שאינו בהם — שני הצרכים באותו שדה.
          */}
          {editingSource !== null ? (
            <form
              className="mt-2 flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void saveSource();
              }}
            >
              <input
                autoFocus
                list="lead-source-options"
                value={editingSource}
                onChange={(event) => setEditingSource(event.target.value)}
                aria-label="מקור הליד"
                maxLength={20}
                className="rounded-lg border px-3 py-2"
                style={{
                  background: "var(--color-field)",
                  borderColor: "var(--color-input-border)",
                  minWidth: 190,
                }}
              />
              <datalist id="lead-source-options">
                {Object.entries(LEAD_SOURCE_LABELS).map(([value, label]) => (
                  <option key={value} value={value} label={label} />
                ))}
              </datalist>
              <button
                type="submit"
                className="mv-btn-action"
                disabled={sourceBusy || editingSource.trim() === ""}
              >
                שמירה
              </button>
              <button
                type="button"
                className="mv-btn-plain"
                onClick={() => {
                  setEditingSource(null);
                  setSourceFailed(false);
                }}
              >
                ביטול
              </button>
              {/*
                כישלון נאמר והתיבה נשארת פתוחה — סגירה שקטה הייתה
                מציגה את המקור הישן וקוראת כאילו נשמר.
              */}
              {sourceFailed ? (
                <span
                  className="text-[length:var(--type-caption-lg)]"
                  style={{ color: "var(--color-danger)" }}
                >
                  המקור לא נשמר. אפשר לנסות שוב.
                </span>
              ) : null}
            </form>
          ) : null}
        </div>
      </div>

      {/*
        ‎**שורת הפעולות מתחת לזהות, ולא לצידה.**

        ‎`ms-auto` דחף אותה לקצה השני של אותה שורה, ולכן ברוחב בינוני
        היא נדחסה אל השם ובצר נשברה מתחתיו בלי סדר. שורה משלה נותנת
        לכל הפעולות את אותו משקל ואותו מקום בכל רוחב.
      */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
          {/*
            ‎**„המר לקונה” ראשון, ובירוק** — זו הפעולה שכל הכרטיס
            קיים בשבילה. הטפסים עצמם נשארים בלשונית „המשך טיפול”
            ואינם משוכפלים כאן; הכפתור רק מוביל אליהם. ליד שכבר הומר
            אינו מציג אותו — אין מה להמיר.
          */}
          {lead.status !== "converted" && canEditPeople ? (
            <button
              type="button"
              className="mv-btn-action"
              onClick={() => selectTab("next")}
            >
              <IconHandshake s={15} /> המשך טיפול
            </button>
          ) : null}
          <a
            href={waMeUrl(lead.contact.phone)}
            target="_blank"
            rel="noreferrer"
            className="mv-btn-plain"
            style={{ minHeight: 36, paddingInline: 13, fontSize: "var(--type-caption-lg)" }}
          >
            <IconChat s={14} /> וואטסאפ
          </a>
          <a
            href={`tel:${lead.contact.phone}`}
            className="mv-btn-plain"
            style={{ minHeight: 36, paddingInline: 13, fontSize: "var(--type-caption-lg)" }}
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
              style={{ minHeight: 36, paddingInline: 13, fontSize: "var(--type-caption-lg)" }}
            >
              <IconMail s={14} /> אימייל
            </a>
          ) : null}
          <Link
            href={`/calendar/new?leadId=${lead.id}`}
            className="mv-btn-plain"
            style={{ minHeight: 36, paddingInline: 13, fontSize: "var(--type-caption-lg)" }}
          >
            <IconCalendar s={14} /> קבע פגישה
          </Link>
        </div>

      {/*
        **הדחוף קודם.** ההתראה ישבה קודם במקום העשירי, מתחת לשש
        קופסאות — כלומר הדבר היחיד במסך שדורש פעולה מיידית היה
        הדבר שהכי קשה לראות. עכשיו היא בתוך כרטיס הזהות עצמו,
        מתחת לפעולות: אי אפשר להתחיל לטפל בליד בלי לעבור דרכה.
      */}
      {lead.requiresHuman ? (
        <div className="mt-4">
          <Notice tone="danger">
            ● דורש טיפול אנושי
            {lead.requiresHumanReason ? `: ${lead.requiresHumanReason}` : ""}
          </Notice>
        </div>
      ) : null}
      </div>

      {merged ? (
        <Notice tone="info">
          <IconInfo s={15} /> לאיש הקשר כבר יש ליד פתוח — הפנייה החדשה נוספה
          לציר הזמן שלו במקום לפתוח ליד כפול.
        </Notice>
      ) : null}

      {/* ---- לשוניות ---- */}
      <EntityTabs
        label="לשוניות כרטיס הליד"
        active={tab}
        onSelect={selectTab}
        tabs={[
          { key: "overview", label: "סקירה" },
          { key: "next", label: "המשך טיפול" },
          { key: "calls", label: "שיחות" },
          { key: "referral", label: "הפניות" },
          { key: "timeline", label: "ציר זמן", count: timeline.length },
        ]}
      />

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
                    fontSize: "var(--type-caption-lg)",
                    fontWeight: 800,
                    color: "var(--color-primary)",
                  }}
                >
                  תוכן הפנייה
                </h2>
                {/* whitespace-pre-line: שורות ההודעה נשמרות כפי שנשלחו */}
                <p
                  className="m-0 whitespace-pre-line"
                  style={{ fontSize: "var(--type-body)", lineHeight: 1.5 }}
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
                  style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}
                >
                  תוכן הפנייה
                </h2>
                {/*
                  מצב ריק שאומר מה לעשות ולא רק שאין כלום: ליד
                  ממרכזייה מגיע בלי טקסט, וההערה בציר הזמן היא
                  המקום שבו הסוכן רושם מה נאמר בשיחה.
                */}
                <p
                  className="m-0 text-[length:var(--type-caption-lg)]"
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

            {/*
              „הלקוח ממלא בעצמו” — כאן, ולא בלשונית „המשך טיפול”.
              זו הפעולה שעושים **לפני** שמחליטים אם להמיר: מה שהלקוח
              ימלא הוא בדיוק המידע שההחלטה נשענת עליו.
            */}
            <IntakePanel subject="lead" entityId={id} canEdit={can(user, "leads.edit")} />

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
                <h2 className="m-0 mb-1" style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}>
                  <IconUser s={16} /> המרה לקונה
                </h2>
                <p
                  className="m-0 mb-3 text-[length:var(--type-caption-lg)]"
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
                <h2 className="m-0 mb-1" style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}>
                  <IconHome s={16} /> המרה לנכס
                </h2>
                <p
                  className="m-0 mb-3 text-[length:var(--type-caption-lg)]"
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
          שיחות — ההקלטה, הסיכום והתמלול בכרטיס עצמו
          ============================================================ */}
      <TabPanel tab="calls" active={tab}>
        <LeadCalls leadId={id} />
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
            style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}
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
                borderColor: "var(--color-input-border)",
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
              className="m-0 mt-3 text-[length:var(--type-caption-lg)]"
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
                    className="m-0 mb-0.5 text-[length:var(--type-caption)]"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    {KIND_LABELS[item.kind] ?? item.kind} ·{" "}
                    {formatDate(item.createdAt)}
                  </p>
                  <p className="m-0 whitespace-pre-line text-[length:var(--type-body)]">
                    {item.kind === "status_change"
                      ? `הסטטוס שונה ל: ${labelOf(LEAD_STATUS_LABELS, item.content) ?? item.content}`
                      : item.kind === "source_change"
                        ? /*
                            ‎`?? item.content` ולא תווית ריקה: מקור
                            יכול להיות תווית קמפיין חופשית שאינה
                            ברשימה, והצגתה כפי שהיא היא האמת.
                          */
                          `המקור שונה ל: ${labelOf(LEAD_SOURCE_LABELS, item.content) ?? item.content}`
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
