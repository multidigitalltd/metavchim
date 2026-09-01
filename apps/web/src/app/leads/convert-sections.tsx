"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@metavchim/ui";
import { MATURITY_LABELS as SHARED_MATURITY } from "@metavchim/shared";
import { ApiError, apiPost } from "@/lib/api";
import { PROPERTY_TYPE_LABELS, shekelsToAgorot } from "@/lib/format";
import { IconHome, IconUser } from "../icons";
import { Notice } from "../notice";

/**
 * ‎**שתי הדרכים שבהן ליד הופך לכרטיס אצלנו — טופס אחד לכל אחת.**
 *
 * ## למה בקובץ משלהן
 *
 * הן נכתבו בתוך כרטיס הליד, ומאז נדרשו גם במסך השיחות: מתווך
 * שסיים להאזין לשיחה יודע **בדיוק** אם מדובר במי שמחפש או במי
 * שמוכר, וזה הרגע שבו ההמרה נכונה. עותק שני של הטפסים היה נפרד
 * מהראשון ביום שמישהו יוסיף שדה — ואז שני מסכים היו יוצרים כרטיסים
 * שונים מאותו ליד.
 *
 * ## ומה זה `prefill`
 *
 * ‎**מה שכבר ידוע לא נשאל שוב.** לשיחה מתומללת יש `highlights` —
 * עיר, תקציב, חדרים, כתובת — שחולצו ממה שנאמר בפועל. טופס ריק
 * שמופיע מיד אחרי שהמערכת הציגה „4 חדרים בבני ברק, 2.4 מיליון”
 * מבקש מהמתווך להקליד מחדש את מה שהוא זה עתה קרא, וזו הסיבה
 * הנפוצה ביותר לא להמיר בכלל.
 *
 * ‎**ערך שנשען על ניחוש אינו ממולא.** `propertyType` ב-`highlights`
 * הוא כלשון הדובר („דו-משפחתי”, „יחידת דיור”) ואינו נפתר לערך
 * הסכימה בלי לנחש. סוג נכס שגוי שנשמר בשקט גרוע משדה שלא מולא.
 */
export interface ConvertPrefill {
  city?: string;
  /** בשקלים — תקציב אצל קונה, מחיר מבוקש אצל מוכר. */
  priceShekels?: number;
  /**
   * ‎**מספר אחד שנכנס לשני גבולות.** בכרטיס קונה החדרים הם טווח
   * (`roomsMin`–`roomsMax`), ובשיחה נאמר מספר אחד. ההמרה היא זו
   * שכבר נקבעה בקטלוג הפעולות של הסוכן הקולי: „4 חדרים” ⇒ גם
   * המינימום וגם המקסימום 4. אותו משפט חייב לייצר את אותו כרטיס
   * בין אם הגיע מהסוכן ובין אם מהמרה במסך.
   */
  rooms?: number;
  /** כתובת שנאמרה בשיחה — נכנסת לשדה הרחוב בהמרה לנכס. */
  street?: string;
  /** ‎`rent` כשהצד שזוהה בשיחה הוא שוכר או משכיר. */
  dealType?: "sale" | "rent";
}

/**
 * שדה מספרי שלא מולא אינו נשלח כלל.
 *
 * ‎`Number("")` הוא ‎`0`, ואפס בדרישות אינו „לא ידוע” אלא דרישה
 * ממשית — קונה בלי תקציב שנשמר עם ‎`0` נקרא במנוע ההתאמות כמי שאינו
 * יכול להרשות לעצמו דבר. אותו מלכוד בדיוק חוזר בחדרים.
 */
function optionalNumber(form: FormData, name: string): Record<string, number> {
  const raw = String(form.get(name) ?? "").trim();
  if (raw === "") return {};
  const value = Number(raw);
  return Number.isFinite(value) ? { [name]: value } : {};
}

export function ConvertSection({
  leadId,
  prefill,
}: {
  leadId: string;
  prefill?: ConvertPrefill;
}) {
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
          ...optionalNumber(f, "roomsMin"),
          ...optionalNumber(f, "roomsMax"),
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
            defaultValue={prefill?.city ?? ""}
            placeholder="תל אביב, גבעתיים"
            className="rounded-lg border px-3 py-2"
            style={{ borderColor: "var(--color-input-border)", background: "var(--color-field)" }}
          />
        </div>
        <div>
          <label htmlFor="cv-deal" className="mb-1 block text-sm font-medium">סוג עסקה</label>
          <select
            id="cv-deal"
            name="dealType"
            defaultValue={prefill?.dealType ?? "sale"}
            className="rounded-lg border px-3 py-2"
            style={{ borderColor: "var(--color-input-border)", background: "var(--color-field)" }}
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
            defaultValue={prefill?.priceShekels ?? ""}
            min={1}
            className="rounded-lg border px-3 py-2"
            style={{ borderColor: "var(--color-input-border)", background: "var(--color-field)" }}
            dir="ltr"
          />
        </div>
        {/*
          שני גבולות ולא שדה אחד — זו הצורה שכרטיס הקונה נושא, ואותה
          צורה כבר מוצגת ב„קונה חדש”, בעריכת הקונה ובטופס הפנייה
          הציבורי. שדה יחיד כאן היה נראה זהה ומייצר כרטיס אחר.
        */}
        <div>
          <label htmlFor="cv-rooms-min" className="mb-1 block text-sm font-medium">
            חדרים מ- (לא חובה)
          </label>
          <input
            id="cv-rooms-min"
            name="roomsMin"
            type="number"
            defaultValue={prefill?.rooms ?? ""}
            min={1}
            max={20}
            step={0.5}
            inputMode="decimal"
            className="w-24 rounded-lg border px-3 py-2"
            style={{ borderColor: "var(--color-input-border)", background: "var(--color-field)" }}
            dir="ltr"
          />
        </div>
        <div>
          <label htmlFor="cv-rooms-max" className="mb-1 block text-sm font-medium">עד</label>
          <input
            id="cv-rooms-max"
            name="roomsMax"
            type="number"
            defaultValue={prefill?.rooms ?? ""}
            min={1}
            max={20}
            step={0.5}
            inputMode="decimal"
            className="w-24 rounded-lg border px-3 py-2"
            style={{ borderColor: "var(--color-input-border)", background: "var(--color-field)" }}
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
            style={{ borderColor: "var(--color-input-border)", background: "var(--color-field)" }}
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

export function ConvertToPropertySection({
  leadId,
  prefill,
}: {
  leadId: string;
  prefill?: ConvertPrefill;
}) {
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
          <input id="cp-city" name="city" required defaultValue={prefill?.city ?? ""} className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--color-input-border)", background: "var(--color-field)" }} />
        </div>
        <div>
          <label htmlFor="cp-address" className="mb-1 block text-sm">רחוב ומספר (לא חובה)</label>
          <input id="cp-address" name="street" defaultValue={prefill?.street ?? ""} className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--color-input-border)", background: "var(--color-field)" }} />
        </div>
        <div>
          <label htmlFor="cp-deal" className="mb-1 block text-sm">עסקה</label>
          <select id="cp-deal" name="dealType" defaultValue={prefill?.dealType ?? "sale"} className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--color-input-border)", background: "var(--color-field)" }}>
            <option value="sale">מכירה</option>
            <option value="rent">השכרה</option>
          </select>
        </div>
        <div>
          <label htmlFor="cp-type" className="mb-1 block text-sm">סוג נכס</label>
          <select id="cp-type" name="propertyType" className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--color-input-border)", background: "var(--color-field)" }}>
            {/*
              רשימה שנכתבה ביד כאן פספסה מלכתחילה חמישה סוגים
              (דו-משפחתי, סטודיו, יחידת דיור, אחר), וכל סוג חדש היה
              נעדר ממנה בשקט. המקור הוא הטבלה המשותפת.
            */}
            {Object.entries(PROPERTY_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="cp-price" className="mb-1 block text-sm">מחיר בש"ח (לא חובה)</label>
          <input id="cp-price" name="price" type="number" min={0} defaultValue={prefill?.priceShekels ?? ""} className="w-32 rounded-lg border px-3 py-2" style={{ borderColor: "var(--color-input-border)", background: "var(--color-field)" }} />
        </div>
        <div>
          <label htmlFor="cp-rooms" className="mb-1 block text-sm">חדרים (לא חובה)</label>
          <input id="cp-rooms" name="rooms" type="number" min={1} max={20} step={0.5} defaultValue={prefill?.rooms ?? ""} className="w-24 rounded-lg border px-3 py-2" style={{ borderColor: "var(--color-input-border)", background: "var(--color-field)" }} />
        </div>
        <Button type="submit" disabled={busy}>{busy ? "ממיר…" : "צור נכס"}</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>ביטול</Button>
      </div>
    </form>
  );
}
