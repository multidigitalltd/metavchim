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
  REFERRAL_REASONS,
  referralPayout,
  referralPriceRejectionReason,
  referralReasonRejectionReason,
} from "@metavchim/shared";
import { apiDelete, apiGet, apiPost, apiPatch, ApiError } from "@/lib/api";
import { formatDate, shekelsToAgorot, waMeUrl } from "@/lib/format";
import { LEAD_INTENT_LABELS, LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS } from "@/lib/lead-labels";
import { can, useRequireAuth } from "@/lib/use-auth";
import { ContactPeople } from "../../contact-people";
import { DictateFor } from "../../dictation-field";
import { RelatedEntities } from "../../related-entities";
import { EntityTasks } from "../../entity-tasks";
import { ReplyEmail } from "./reply-email";
import { ReferralRating } from "../../collaboration/referral-rating";
import {
  IconCalendar,
  IconChat,
  IconCoins,
  IconHandshake,
  IconDoc,
  IconGear,
  IconHome,
  IconInfo,
  IconPhone,
  IconRefresh,
  IconUser,
} from "../../icons";

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

interface TimelineItem {
  id: string;
  kind: string;
  content: string;
  createdAt: string;
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
  payoutCredits: number;
  mine: boolean;
  originLeadId?: string;
  myRating?: { score: number; comment?: string };
  counterpartRating?: { score: number; comment?: string };
}

interface ReferralTerms {
  suggestedPriceCredits: number;
  platformFeePercent: number;
}

/**
 * הפניית הלקוח למשרד אחר — הדרך השלישית לצד המרה לקונה או לנכס.
 *
 * **לא "מכירת ליד".** לקוח שאינו מתאים למשרד הזה מופנה למשרד שכן
 * יכול לשרת אותו, והמשרד המפנה מקבל תמורה על ההפניה. בלוח מופיע רק
 * מידע אנונימי; שם וטלפון נחשפים למשרד הקולט רק אחרי הקליטה.
 */
function ReferLeadSection({ leadId }: { leadId: string }) {
  const [shared, setShared] = useState<MySharedLead | null | undefined>(undefined);
  const [terms, setTerms] = useState<ReferralTerms | null>(null);
  const [price, setPrice] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [reasonDetail, setReasonDetail] = useState("");
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
  const preview = priceValid ? referralPayout(priceNumber) : null;

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
      <div
        className="mb-4 rounded-xl border p-4"
        style={{ borderColor: "var(--color-success)" }}
      >
        <p className="m-0 font-medium" style={{ color: "var(--color-success)" }}>
          <IconCoins s={15} /> ההפניה נקלטה במשרד אחר — {shared.payoutCredits} קרדיטים נוספו
          ליתרת המשרד
          {shared.platformFeeCredits > 0
            ? ` (${shared.priceCredits} בניכוי ${shared.platformFeeCredits} עמלת פלטפורמה)`
            : ""}
          .
        </p>
        {/* המשרד שקלט מדרג את ההפניה, ואתם מדרגים את הלקוח שהעברתם */}
        <ReferralRating
          sharedLeadId={shared.id}
          role="given"
          mine={shared.myRating}
          counterpart={shared.counterpartRating}
        />
      </div>
    );
  }

  if (shared) {
    return (
      <div className="mb-4 rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <p className="mb-2 font-medium">
          <IconHandshake s={15} /> הלקוח מופנה בלוח ההפניות תמורת {shared.priceCredits} קרדיטים
          {shared.platformFeeCredits > 0
            ? ` — מתוכם ${shared.platformFeeCredits} עמלת פלטפורמה, ${shared.payoutCredits} אליכם`
            : ""}
          .
        </p>
        {error ? <p role="alert" className="mb-2" style={{ color: "var(--color-danger)" }}>{error}</p> : null}
        <Button variant="ghost" disabled={busy} onClick={() => void withdraw()}>
          הסר מהלוח
        </Button>
      </div>
    );
  }

  return (
    <details className="mb-4 rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
      <summary className="cursor-pointer font-medium">
        <IconHandshake s={15} /> הפנה את הלקוח למשרד אחר
      </summary>
      <p className="mt-2 mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
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
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
          >
            <option value="">בחרו סיבה…</option>
            {REFERRAL_REASONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {reason ? (
            <span className="text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
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
                style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
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
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
          />
          {/*
            הפירוק מוצג לפני הפרסום ולא אחרי הקליטה. עמלה שמתגלה
            בדיעבד היא בדיוק מה שהורס אמון בלוח.
          */}
          {preview ? (
            <span className="text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
              המשרד הקולט משלם {preview.priceCredits} · עמלת פלטפורמה{" "}
              {terms ? `${terms.platformFeePercent}% = ` : ""}
              {preview.platformFeeCredits} · <b>אליכם {preview.payoutCredits} קרדיטים</b>
            </span>
          ) : null}
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span>עיר (לתצוגה בלוח)</span>
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            maxLength={MAX_REFERRAL_CITY}
            className="rounded-lg border px-3 py-2"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
          />
        </label>
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
              style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
            />
            <DictateFor targetId="referNote" />
          </div>
        </label>
      </div>

      <p className="mb-3 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
        המשרד הקולט משלם על ההפניה ברגע הקליטה, ולא על עסקה שתיסגר. שני הצדדים
        מדרגים את ההפניה אחר כך, והדירוג מוצג לצד ההפניות הבאות שלכם.
      </p>
      {error ? <p role="alert" className="mb-2" style={{ color: "var(--color-danger)" }}>{error}</p> : null}
      <Button disabled={busy || !reason || !priceValid} onClick={() => void publish()}>
        {busy ? "מפרסם…" : "פרסם הפניה"}
      </Button>
    </details>
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
      {error ? <p role="alert" className="mb-2" style={{ color: "var(--color-danger)" }}>{error}</p> : null}
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
        <p role="alert" className="mb-2 text-sm" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="cp-city" className="mb-1 block text-sm">עיר</label>
          <input id="cp-city" name="city" required className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }} />
        </div>
        <div>
          <label htmlFor="cp-address" className="mb-1 block text-sm">רחוב ומספר (לא חובה)</label>
          <input id="cp-address" name="street" className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }} />
        </div>
        <div>
          <label htmlFor="cp-deal" className="mb-1 block text-sm">עסקה</label>
          <select id="cp-deal" name="dealType" className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}>
            <option value="sale">מכירה</option>
            <option value="rent">השכרה</option>
          </select>
        </div>
        <div>
          <label htmlFor="cp-type" className="mb-1 block text-sm">סוג נכס</label>
          <select id="cp-type" name="propertyType" className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}>
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
          <input id="cp-price" name="price" type="number" min={0} className="w-32 rounded-lg border px-3 py-2" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }} />
        </div>
        <div>
          <label htmlFor="cp-rooms" className="mb-1 block text-sm">חדרים (לא חובה)</label>
          <input id="cp-rooms" name="rooms" type="number" min={1} max={20} step={0.5} className="w-24 rounded-lg border px-3 py-2" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }} />
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
    const budget = Number(String(f.get("budgetMax") ?? "").trim());
    try {
      const buyer = await apiPost<{ id: string }>(`/leads/${leadId}/convert`, {
        maturity: String(f.get("maturity")),
        requirements: {
          cities: String(f.get("cities"))
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean),
          dealType: String(f.get("dealType")),
          budgetMaxAgorot: shekelsToAgorot(budget),
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
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
          />
        </div>
        <div>
          <label htmlFor="cv-deal" className="mb-1 block text-sm font-medium">סוג עסקה</label>
          <select
            id="cv-deal"
            name="dealType"
            className="rounded-lg border px-3 py-2"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
          >
            <option value="sale">קנייה</option>
            <option value="rent">שכירות</option>
          </select>
        </div>
        <div>
          <label htmlFor="cv-budget" className="mb-1 block text-sm font-medium">
            תקציב מקסימלי (₪)
          </label>
          <input
            id="cv-budget"
            name="budgetMax"
            type="number"
            required
            min={1}
            className="rounded-lg border px-3 py-2"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
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
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
          >
            {Object.entries(SHARED_MATURITY).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      </div>
      {error ? (
        <p role="alert" className="mb-3" style={{ color: "var(--color-danger)" }}>{error}</p>
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    apiGet<{ lead: LeadDetail; timeline: TimelineItem[] }>(`/leads/${id}`)
      .then((res) => {
        setLead(res.lead);
        setTimeline(res.timeline);
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
      <p role="alert" style={{ color: "var(--color-danger)" }}>
        {error} — <Link href="/leads" className="underline">חזרה לרשימה</Link>
      </p>
    );
  }
  if (!lead) return <p aria-live="polite">טוען…</p>;

  return (
    <>
      <nav aria-label="נתיב" className="mb-4 text-sm">
        <Link href="/leads" className="underline">לידים</Link>
        <span aria-hidden="true"> / </span>
        <span>{lead.contact.name}</span>
      </nav>

      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{lead.contact.name}</h1>
        <a href={`tel:${lead.contact.phone}`} className="underline" dir="ltr">
          {lead.contact.phone}
        </a>
        <a
          href={waMeUrl(lead.contact.phone)}
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          <IconChat s={15} /> וואטסאפ
        </a>
        {/* האימייל ליד הטלפון — ליד שנפתח מתיבת הדואר מביא איתו את
            כתובת השולח, והיא הדרך הטבעית להשיב לו */}
        {lead.contact.email ? (
          <a href={`mailto:${lead.contact.email}`} className="underline" dir="ltr">
            {lead.contact.email}
          </a>
        ) : null}
      </div>
      <p className="mb-4" style={{ color: "var(--color-text-muted)" }}>
        {LEAD_INTENT_LABELS[lead.intent] ?? lead.intent} · מקור: {LEAD_SOURCE_LABELS[lead.source] ?? lead.source}
      </p>

      {/*
        תוכן הפנייה בראש הכרטיס.
        הוא נשמר מאז ומתמיד בשדה summary, אבל הוצג רק כהערה בציר
        הזמן בתחתית העמוד — כלומר הדבר הראשון שהמתווך צריך לדעת
        ("מה הוא רצה?") היה הדבר האחרון שהוא ראה.
      */}
      {lead.summary ? (
        <section
          aria-labelledby="lead-summary-heading"
          className="mb-4 rounded-xl border p-4"
          style={{ borderColor: "var(--color-primary)", background: "var(--color-primary-soft)" }}
        >
          <h2
            id="lead-summary-heading"
            className="m-0 mb-1.5"
            style={{ fontSize: 13, fontWeight: 800, color: "var(--color-primary)" }}
          >
            תוכן הפנייה
          </h2>
          {/* whitespace-pre-line: שורות ההודעה נשמרות כפי שנשלחו */}
          <p className="m-0 whitespace-pre-line" style={{ fontSize: 14.5, lineHeight: 1.5 }}>
            {lead.summary}
          </p>
        </section>
      ) : null}

      {/* מיד אחרי תוכן הפנייה: קראת מה הוא רצה — עכשיו תענה לו */}
      <ReplyEmail
        contactId={lead.contact.id}
        leadId={lead.id}
        contactName={lead.contact.name}
        {...(lead.contact.email !== undefined ? { contactEmail: lead.contact.email } : {})}
      />

      <RelatedEntities contactId={lead.contact.id} exclude={{ kind: "lead", id: lead.id }} />

      <EntityTasks entityType="lead" entityId={id} />

      <ContactPeople contactId={lead.contact.id} canEdit={canEditPeople} />

      {merged ? (
        <p role="status" className="mb-4 rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
          <IconInfo s={15} /> לאיש הקשר כבר יש ליד פתוח — הפנייה החדשה נוספה לציר הזמן שלו במקום לפתוח ליד כפול.
        </p>
      ) : null}

      {lead.requiresHuman ? (
        <p role="alert" className="mb-4 rounded-xl border p-4 font-medium" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
          ● דורש טיפול אנושי{lead.requiresHumanReason ? `: ${lead.requiresHumanReason}` : ""}
        </p>
      ) : null}

      <div className="mb-4">
        <Link href={`/calendar/new?leadId=${lead.id}`}>
          <Button variant="secondary"><IconCalendar s={15} /> קבע פגישה</Button>
        </Link>
      </div>

      {lead.status !== "converted" && can(user, "buyers.edit") ? (
        <ConvertSection leadId={lead.id} />
      ) : null}

      {/* ליד אינו תמיד קונה — "יש לי דירה למכור" הוא בעל נכס */}
      {lead.status !== "converted" && can(user, "properties.create") ? (
        <ConvertToPropertySection leadId={lead.id} />
      ) : null}

      {/* הדרך השלישית: לקוח שלא מטפלים בו מופנה למשרד שכן ישרת אותו */}
      {lead.status !== "converted" && can(user, "collaboration.share") ? (
        <ReferLeadSection leadId={lead.id} />
      ) : null}

      <div className="mb-8">
        <label htmlFor="status" className="mb-1 block font-medium">סטטוס</label>
        <select
          id="status"
          value={lead.status}
          onChange={(event) => void changeStatus(event.target.value)}
          className="rounded-lg border px-3 py-2.5"
          style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
        >
          {Object.entries(LEAD_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      <section aria-labelledby="timeline-heading">
        <h2 id="timeline-heading" className="mb-3 text-lg font-semibold">ציר זמן</h2>

        <form onSubmit={(event) => void addNote(event)} className="mb-4 flex gap-2">
          <label htmlFor="note" className="mv-visually-hidden">הוספת הערה</label>
          <input
            id="note"
            name="note"
            placeholder="הוסף הערה…"
            className="flex-1 rounded-lg border px-3 py-2.5"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
          />
          <Button type="submit" variant="secondary">הוסף</Button>
        </form>
        {/* הערה אחרי שיחה היא הטקסט שהכי כדאי להכתיב — המתווך עדיין
            עם הטלפון ביד ולא ליד המקלדת */}
        <div className="mb-4">
          <DictateFor targetId="note" />
        </div>

        {timeline.length === 0 ? (
          <p style={{ color: "var(--color-text-muted)" }}>אין עדיין פעילות בליד.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {timeline.map((item) => (
              <li key={item.id} className="rounded-lg border p-3" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
                <p className="mb-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
                  {KIND_LABELS[item.kind] ?? item.kind} · {formatDate(item.createdAt)}
                </p>
                <p>
                  {item.kind === "status_change"
                    ? `הסטטוס שונה ל: ${LEAD_STATUS_LABELS[item.content] ?? item.content}`
                    : item.content}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* ליד שהומר כבר יצר כרטיס — מוחקים את הכרטיס, לא את המקור שלו */}
      {lead.status !== "converted" && can(user, "leads.delete") ? (
        <DeleteLeadSection leadId={lead.id} contactName={lead.contact.name} />
      ) : null}
    </>
  );
}
