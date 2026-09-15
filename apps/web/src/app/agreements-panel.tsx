"use client";

import { useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import { agreementRequiresProperty } from "@metavchim/shared";
import { apiGet, apiPost, ApiError, apiList } from "@/lib/api";
import { ConfirmDialog } from "./confirm-dialog";
import { IconDoc, IconEdit, IconWarning } from "./icons";
import { LoadError } from "./load-error";
import { Notice } from "./notice";
import { formatDate } from "@/lib/format";

/**
 * שליחת הסכם לחתימה ומעקב אחריו — מוצג בכרטיס הקונה (הזמנה בכתב)
 * ובכרטיס הנכס (בלעדיות מול בעל הנכס).
 *
 * המתווך משלים כאן את הפרטים שהמערכת לא יכולה לדעת — דמי התיווך,
 * מועד התשלום, ובבלעדיות גם התקופה. אלה פרטי חובה בהזמנה בכתב, ולכן
 * הם נשאלים לפני השליחה ולא נשארים ריקים במסמך.
 */

interface AgreementRow {
  id: string;
  kind: string;
  kindLabel: string;
  status: string;
  signedAt?: string;
  sentAt?: string;
  url: string;
  createdAt: string;
  canEmail: boolean;
  /* ‏חסר = ההסכם אינו נוקב בנכס. ראו `AgreementNoPropertyNote`. */
  propertyId?: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "נשלח — ממתין לחתימה",
  viewed: "הלקוח פתח — טרם חתם",
  signed: "✓ נחתם",
  declined: "הלקוח דחה",
};

const inputStyle = { borderColor: "var(--color-input-border)", background: "var(--color-field)" } as const;

/** נכס לבחירה כשההסכם נשלח ממסך שאינו מזהה נכס בעצמו (כרטיס הקונה). */
interface PropertyOption {
  id: string;
  city?: string;
  neighborhood?: string;
  street?: string;
  rooms?: number;
}

function propertyLabel(p: PropertyOption): string {
  const where = [p.street, p.neighborhood, p.city].filter(Boolean).join(", ");
  const rooms = p.rooms !== undefined ? `${p.rooms} חדרים` : "";
  return [rooms, where].filter(Boolean).join(" · ") || "נכס ללא כתובת";
}

export function AgreementsPanel({
  contactId,
  kind,
  propertyId,
  title,
}: {
  contactId: string;
  kind: "brokerage" | "exclusivity";
  propertyId?: string;
  title: string;
}) {
  const [rows, setRows] = useState<AgreementRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  /** ההסכם שנמצא כרגע בשליחה — כדי לא לנטרל את כל השורות בבת אחת */
  const [sending, setSending] = useState<string | null>(null);
  /*
   * שלושת החלונות שמקיפים כל שליחה: מה נשלח (תצוגה מקדימה), האם
   * לשלוח (אישור), ומה קרה (ביצוע). שליחת הסכם היא הפעולה היחידה
   * במערכת שיוצאת אל לקוח אמיתי בשם המשרד, ועד כה היא קרתה
   * בלחיצה אחת בלי אף אחד מהשלושה.
   */
  const [preview, setPreview] = useState<{ id: string; title: string; body: string } | null>(null);
  const [askSend, setAskSend] = useState<{ id: string; channel: "whatsapp" | "email" } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [sentNote, setSentNote] = useState<string | null>(null);
  const [unfilled, setUnfilled] = useState<string[]>([]);
  const [createdId, setCreatedId] = useState<string | null>(null);
  /*
   * ריק = "השתמש בברירת המחדל של המשרד".
   *
   * קודם ישבו כאן מחרוזות קשיחות ("2% ממחיר העסקה"), והן נשלחו
   * לשרת גם כשהמתווך לא נגע בשדה. כיוון שערכי הבקשה גוברים על
   * הגדרות המשרד, משרד שהגדיר עמלה אחרת קיבל בשקט את הקשיחה —
   * ותנאים כספיים שגויים נקפאו ונחתמו (ביקורת Codex).
   */
  const [fee, setFee] = useState("");
  const [payment, setPayment] = useState("");
  const [period, setPeriod] = useState("");
  /** הנכס שההסכם חל עליו — נבחר כאן כשהמסך לא מספק אותו */
  const [chosenProperty, setChosenProperty] = useState("");
  /*
   * ‎**שלושת הפרטים שמתארים את הנכס, כשאין נכס לקרוא מהם.**
   *
   * ‏הם פרטי חובה בתקנות (`REQUIRED_PLACEHOLDERS.brokerage`), ולכן
   * ‏הזמנה בכתב בלי נכס אינה יכולה פשוט להשאיר אותם ריקים — השרת
   * ‏דוחה מסמך לא שלם, ובצדק. עם נכס הם נגזרים ממנו ואינם נשלחים.
   */
  const [dealText, setDealText] = useState("");
  const [propertyText, setPropertyText] = useState("");
  const [priceText, setPriceText] = useState("");
  const [properties, setProperties] = useState<PropertyOption[] | null>(null);

  /*
   * „עדיין לא נשלח הסכם” נאמר גם כשהטעינה נכשלה — והמסקנה המתבקשת
   * ממנו היא לשלוח הסכם. כלומר תקלת רשת שלחה ללקוח הסכם שני על
   * אותה עסקה, ולפעמים אחרי שהראשון כבר נחתם.
   */
  const [loadFailed, setLoadFailed] = useState(false);

  function load(): void {
    setLoadFailed(false);
    apiGet<AgreementRow[]>(`/agreements/contact/${contactId}`)
      .then((all) => setRows(all.filter((row) => row.kind === kind)))
      .catch(() => setLoadFailed(true));
  }

  useEffect(load, [contactId, kind]);

  /*
   * ‎**שתי שאלות שונות, ועד כה הן היו אחת.**
   *
   * ‏`showPicker` — „האם צריך להציג בורר נכס”. מכרטיס הנכס יש נכס
   * ‏בהקשר ואין מה לבחור; מכרטיס הקונה אין, ולכן הבורר מוצג.
   *
   * ‎`requiresProperty` — „האם הסוג הזה **חייב** נכס”. זו שאלה של
   * ‏הסכם ולא של מסך, והתשובה עליה יושבת ב-`agreementRequiresProperty`
   * ‏שבחבילה המשותפת — אותה פונקציה בדיוק שהשרת אוכף בה.
   *
   * ‏עד כה המסך דרש נכס בשני הסוגים, בעוד שהשרת דורש אותו בבלעדיות
   * ‏בלבד: הזמנה בכתב היא התקשרות עם **אדם**, ואפשר לחתום עליה לפני
   * ‏שיודעים על איזה נכס מדובר. כלומר המסך חסם מסלול שהשרת מתיר,
   * ‏וזה בדיוק סוג הכפילות שכלל משותף מונע.
   */
  const showPicker = propertyId === undefined;
  const requiresProperty = agreementRequiresProperty(kind);

  useEffect(() => {
    if (!open || !showPicker || properties !== null) return;
    apiGet<{ items: PropertyOption[] }>("/properties?limit=100")
      .then((res) => setProperties(apiList(res.items, "items")))
      .catch(() => setProperties([]));
  }, [open, showPicker, properties]);

  const effectiveProperty = propertyId ?? chosenProperty;

  async function send(): Promise<void> {
    if (requiresProperty && effectiveProperty === "") {
      setError("בחרו את הנכס שההסכם חל עליו");
      return;
    }
    setBusy(true);
    setError(null);
    setLink(null);
    try {
      const res = await apiPost<{ id: string; url: string; unfilled: string[]; reused: boolean }>(
        "/agreements",
        {
          kind,
          contactId,
          // שדה ריק לא נשלח כלל: ערך בבקשה גובר על הגדרות המשרד,
          // ולכן "" היה מוחק את ברירת המחדל במקום ליפול אליה
          ...(effectiveProperty !== "" ? { propertyId: effectiveProperty } : {}),
          values: {
            ...(fee.trim() !== "" ? { דמי_תיווך: fee.trim() } : {}),
            ...(payment.trim() !== "" ? { מועד_תשלום: payment.trim() } : {}),
            /*
             * ‏רק כשאין נכס. עם נכס השרת גוזר אותם מהשורה וגובר על
             * ‏מה שנשלח — שליחה כאן הייתה רעש, לא מקור שני.
             */
            ...(effectiveProperty === ""
              ? {
                  ...(dealText.trim() !== "" ? { סוג_העסקה: dealText.trim() } : {}),
                  ...(propertyText.trim() !== "" ? { תיאור_הנכס: propertyText.trim() } : {}),
                  ...(priceText.trim() !== "" ? { מחיר_משוער: priceText.trim() } : {}),
                }
              : {}),
            ...(kind === "exclusivity" && period.trim() !== ""
              ? { תקופת_בלעדיות: period.trim() }
              : {}),
          },
        },
      );
      setLink(res.url);
      setCreatedId(res.id);
      setUnfilled(res.unfilled);
      setOpen(false);
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "יצירת ההסכם נכשלה");
    } finally {
      setBusy(false);
    }
  }

  /**
   * תצוגה מקדימה — **מה שהלקוח יראה**, לפני שהוא יראה אותו.
   *
   * הנתיב `document` הוא אותו מקור שממנו נבנה המסך של החותם, ולכן
   * מה שמוצג כאן אינו "בערך המסמך" אלא הטקסט עצמו. קישור החתימה
   * קיים גם הוא, אבל פתיחתו היא כניסה למסך שבו אפשר לחתום —
   * והמתווך אינו אמור לחתום בשם הלקוח.
   */
  async function openPreview(id: string, title: string): Promise<void> {
    setError(null);
    try {
      const doc = await apiGet<{ body: string }>(`/agreements/${id}/document`);
      setPreview({ id, title, body: doc.body });
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "טעינת המסמך נכשלה");
    }
  }

  /**
   * שליחה בפועל.
   *
   * וואטסאפ נפתח בלשונית חדשה עם ההודעה מוכנה — הדפדפן חייב לפתוח
   * אותה בתוך אותו טיפול באירוע? לא: `window.open` אחרי `await`
   * נחסם בחלק מהדפדפנים כחלון קופץ, ולכן הלשונית נפתחת מיד ורק אחר
   * כך מקבלת כתובת.
   */
  async function deliver(id: string, channel: "whatsapp" | "email"): Promise<void> {
    setSending(id);
    setError(null);
    setSentNote(null);
    const tab = channel === "whatsapp" ? window.open("", "_blank", "noopener") : null;
    try {
      const res = await apiPost<{ waUrl?: string; sentTo?: string }>(
        `/agreements/${id}/send`,
        { channel },
      );
      if (channel === "whatsapp" && res.waUrl) {
        if (tab) tab.location.href = res.waUrl;
        else window.open(res.waUrl, "_blank", "noopener");
        /*
         * וואטסאפ אינו "נשלח" אלא "נפתח" — ההודעה מחכה בלשונית
         * ודורשת לחיצה אחרונה. ניסוח שאומר "נשלח" היה משקר, ומתווך
         * שסומך עליו לא היה חוזר ללשונית.
         */
        setDone("וואטסאפ נפתח עם ההודעה מוכנה. נותרה לחיצה אחת על ״שלח״ בלשונית שנפתחה.");
      } else if (res.sentTo) {
        setDone(`ההסכם נשלח לכתובת ${res.sentTo}. הלקוח יקבל קישור לחתימה.`);
      } else {
        setDone("הפעולה בוצעה.");
      }
      load();
    } catch (err: unknown) {
      tab?.close();
      setError(err instanceof ApiError ? err.message : "השליחה נכשלה");
    } finally {
      setSending(null);
    }
  }

  const signed = rows?.some((row) => row.status === "signed") ?? false;

  return (
    <section
      className="mb-6 rounded-xl border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {signed ? (
          <span
            className="rounded-full px-3 py-1 text-sm font-medium"
            style={{ background: "var(--color-success-soft)", color: "var(--color-success)" }}
          >
            ✓ נחתם
          </span>
        ) : null}
      </div>

      {loadFailed ? (
        <div className="mb-3">
          <LoadError message="לא הצלחנו לטעון את ההסכמים" onRetry={load} />
        </div>
      ) : rows === null ? (
        <p aria-live="polite">טוען…</p>
      ) : rows.length === 0 ? (
        <p className="mb-3" style={{ color: "var(--color-text-muted)" }}>
          עדיין לא נשלח הסכם.
        </p>
      ) : (
        /*
         * כל הסכם ככרטיס משלו: סטטוס ותאריך בשורה עליונה, פעולות
         * בשורה נפרדת מתחתיו. קודם הכול ישב בשורה אחת — הסטטוס
         * "נשלח — ממתין לחתימה", שני כפתורים וקישור התערבבו לרצף
         * אחד בלי היררכיה, ולא היה ברור מה מצב ההסכם ומה אפשר לעשות.
         */
        <ul className="mb-3 flex list-none flex-col gap-2 p-0">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded-xl border p-3"
              style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="mv-chip" style={{ cursor: "default" }}>
                  {STATUS_LABELS[row.status] ?? row.status}
                </span>
                {row.sentAt ? (
                  <span className="text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
                    נשלח {formatDate(row.sentAt)}
                  </span>
                ) : null}
              </div>

              {row.status !== "signed" && row.status !== "declined" ? (
                <div className="flex flex-wrap items-center gap-2">
                  {/*
                    התצוגה המקדימה ראשונה, ובכוונה. מי שרואה קודם את
                    המסמך שולח בביטחון; מי שרואה קודם שני כפתורי
                    שליחה שולח ומקווה.
                  */}
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void openPreview(row.id, title)}
                  >
                    <IconDoc s={15} /> תצוגה מקדימה
                  </Button>
                  <Button
                    type="button"
                    disabled={sending === row.id}
                    onClick={() => setAskSend({ id: row.id, channel: "whatsapp" })}
                  >
                    שלח בוואטסאפ
                  </Button>
                  {/* מייל רק כשיש כתובת — טלפון הוא שדה חובה, אימייל אינו */}
                  {row.canEmail ? (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={sending === row.id}
                      onClick={() => setAskSend({ id: row.id, channel: "email" })}
                    >
                      שלח במייל
                    </Button>
                  ) : null}
                  <a
                    href={row.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[length:var(--type-caption-lg)] underline"
                  >
                    קישור לחתימה
                  </a>
                </div>
              ) : null}

              {/*
                ‎**וגם אחרי השליחה.** רשימת ההסכמים היא מה שהמתווך
                ‏חוזר אליו כדי לבדוק „על מה הוא החתים”, והיא הציגה
                ‏הסכם בלי נכס בדיוק כמו הסכם עם נכס.
              */}
              {row.propertyId === undefined ? (
                <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
                  <IconWarning s={15} /> בלי נכס מסוים — התחייבות כללית, אינה פותחת הצעות על נכס
                </p>
              ) : null}

              {row.status === "signed" ? (
                /* המסמך החתום עצמו — עד כה החתימה נשמרה ולא היה מה להראות */
                <a href={`/agreements/${row.id}/document`} className="text-[length:var(--type-caption-lg)] underline">
                  <IconDoc s={15} /> המסמך החתום
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <Notice tone="danger">{error}</Notice>
      ) : null}

      {sentNote ? (
        <Notice tone="success">{sentNote}</Notice>
      ) : null}

      {link ? (
        <div
          className="mb-3 rounded-lg border p-3"
          style={{ borderColor: "var(--color-success)" }}
        >
          <p className="mb-1 font-medium">ההסכם מוכן — שלחו אותו ללקוח:</p>
          {createdId ? (
            <div className="mb-2 flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={sending === createdId}
                onClick={() => void deliver(createdId, "whatsapp")}
              >
                שלח בוואטסאפ
              </Button>
            </div>
          ) : null}
          <p className="mb-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
            או העתיקו את הקישור:
          </p>
          <a href={link} target="_blank" rel="noopener noreferrer" className="underline" dir="ltr">
            {link}
          </a>
          {unfilled.length > 0 ? (
            <p className="mt-2 text-sm" style={{ color: "var(--color-danger)" }}>
              <IconWarning s={15} /> פרטים שלא הושלמו במסמך: {unfilled.map((f) => f.replace(/_/gu, " ")).join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}

      {open ? (
        <div className="flex flex-col gap-3">
          {showPicker ? (
            <div>
              <label htmlFor={`prop-${kind}`} className="mb-1 block font-medium">
                {requiresProperty ? "הנכס שההסכם חל עליו" : "הנכס שההסכם חל עליו (לא חובה)"}
              </label>
              <p className="m-0 mb-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
                {requiresProperty
                  ? "הסכם בלעדיות נִתן על נכס מסוים, ולכן חובה לבחור אותו."
                  : "הזמנה בכתב היא התקשרות עם הלקוח. אפשר לחתום עליה גם לפני שידוע על איזה נכס מדובר."}
              </p>
              <select
                id={`prop-${kind}`}
                value={chosenProperty}
                onChange={(event) => setChosenProperty(event.target.value)}
                className="w-full rounded-lg border px-3 py-2.5"
                style={inputStyle}
              >
                {/*
                  ‎**„בלי נכס מסוים” ולא „בחרו נכס…” כשזה מותר.**
                  ‏ניסוח שמזמין לבחור מציג בחירה חוקית כשדה שלא מולא,
                  ‏והמתווך אינו יכול לדעת מהמסך שמותר להשאיר אותו ריק.
                */}
                <option value="">{requiresProperty ? "בחרו נכס…" : "בלי נכס מסוים"}</option>
                {(properties ?? []).map((option) => (
                  <option key={option.id} value={option.id}>
                    {propertyLabel(option)}
                  </option>
                ))}
              </select>
              {/*
                ‎**החיווי שהמתווך ביקש** — ולפני השליחה, לא אחריה.
                ‏שתי התוצאות כאן אומתו מול הקוד ואינן ניסוח שיווקי:
                ‏המסמך נוצר בלי תיאור הנכס, המחיר וסוג העסקה (הם
                ‏נפרסים מהנכס), ו-`signedPairs` מחפש צמד
                ‏`לקוח:נכס` ומסנן `propertyId` ריק — ולכן חתימה כזו
                ‏אינה פותחת הצעות על שום נכס.
              */}
              {!requiresProperty && effectiveProperty === "" ? (
                <>
                  <Notice tone="warning">
                    <strong>ההסכם ייחתם בלי נכס מהמערכת.</strong> הוא לא יהיה משויך לשום
                    כרטיס נכס, והחתימה לא תפתח הצעות על נכס מסוים — היא התחייבות כללית של
                    הלקוח מולכם. כדי שהחתימה תפתח הצעות, בחרו את הנכס.
                  </Notice>
                  {/*
                    ‎**ובכל זאת שלושה שדות, ולא מסמך עם חורים.**
                    ‏סוג העסקה, תיאור הנכס והמחיר המשוער הם פרטי חובה
                    ‏בתקנות המתווכים, והנוסח נוקב בהם. בלי נכס לקרוא
                    ‏מהם — המתווך כותב אותם, ולו במילה כללית („דירה
                    ‏באזור המרכז”). השרת דוחה מסמך חסר, ולכן שדה ריק
                    ‏כאן הוא שגיאה מפורשת ולא מסמך שנשלח פגום.
                  */}
                  <div className="flex flex-col gap-3">
                    <div>
                      <label htmlFor={`deal-${kind}`} className="mb-1 block font-medium">
                        סוג העסקה *
                      </label>
                      <input
                        id={`deal-${kind}`}
                        value={dealText}
                        onChange={(event) => setDealText(event.target.value)}
                        placeholder="מכר / שכירות"
                        className="w-full rounded-lg border px-3 py-2.5"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label htmlFor={`desc-${kind}`} className="mb-1 block font-medium">
                        תיאור הנכס *
                      </label>
                      <input
                        id={`desc-${kind}`}
                        value={propertyText}
                        onChange={(event) => setPropertyText(event.target.value)}
                        placeholder="דירת 4 חדרים באזור המרכז"
                        className="w-full rounded-lg border px-3 py-2.5"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label htmlFor={`price-${kind}`} className="mb-1 block font-medium">
                        מחיר משוער *
                      </label>
                      <input
                        id={`price-${kind}`}
                        value={priceText}
                        onChange={(event) => setPriceText(event.target.value)}
                        placeholder="עד 2,500,000 ₪"
                        className="w-full rounded-lg border px-3 py-2.5"
                        style={inputStyle}
                      />
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
          <div>
            <label htmlFor={`fee-${kind}`} className="mb-1 block font-medium">
              דמי תיווך
            </label>
            <input
              id={`fee-${kind}`}
              value={fee}
              placeholder="ברירת המחדל של המשרד"
              onChange={(event) => setFee(event.target.value)}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor={`pay-${kind}`} className="mb-1 block font-medium">
              מועד תשלום
            </label>
            <input
              id={`pay-${kind}`}
              value={payment}
              placeholder="ברירת המחדל של המשרד"
              onChange={(event) => setPayment(event.target.value)}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          {kind === "exclusivity" ? (
            <div>
              <label htmlFor="period" className="mb-1 block font-medium">
                תקופת הבלעדיות
              </label>
              <input
                id="period"
                value={period}
                placeholder="ברירת המחדל של המשרד"
                onChange={(event) => setPeriod(event.target.value)}
                className="w-full rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button type="button" disabled={busy} onClick={() => void send()}>
              {busy ? "מכין…" : "צור קישור לחתימה"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              ביטול
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          <IconEdit s={15} /> שלח הסכם לחתימה
        </Button>
      )}

      {/* ---- תצוגה מקדימה: מה שהלקוח יראה ---- */}
      <ConfirmDialog
        open={preview !== null}
        title={preview ? `תצוגה מקדימה — ${preview.title}` : ""}
        confirmLabel="סגור"
        onClose={() => setPreview(null)}
      >
        <p className="m-0 mb-3">
          זה הנוסח המלא שהלקוח יראה במסך החתימה. עדיין לא נשלח דבר.
        </p>
        <div className="mv-doc-preview" tabIndex={0}>
          {preview?.body}
        </div>
      </ConfirmDialog>

      {/* ---- אישור לפני שליחה ---- */}
      <ConfirmDialog
        open={askSend !== null}
        title="לשלוח את ההסכם ללקוח?"
        confirmLabel={askSend?.channel === "email" ? "שלח במייל" : "פתח וואטסאפ"}
        busy={sending !== null}
        onConfirm={() => {
          const target = askSend;
          if (!target) return;
          setAskSend(null);
          void deliver(target.id, target.channel);
        }}
        onClose={() => setAskSend(null)}
      >
        <p className="m-0 mb-3">
          {askSend?.channel === "email"
            ? "המסמך יישלח בדוא״ל אל הלקוח, עם קישור לחתימה."
            : "וואטסאפ ייפתח עם ההודעה מוכנה — נותרה לחיצה אחת על ״שלח״."}
        </p>
        <p className="m-0">
          <strong>זהו מסמך משפטי.</strong> אם עוד לא ראיתם אותו, סגרו כאן ופתחו
          קודם תצוגה מקדימה.
        </p>
      </ConfirmDialog>

      {/* ---- אישור ביצוע ---- */}
      <ConfirmDialog
        open={done !== null}
        title="✓ בוצע"
        tone="success"
        confirmLabel="סגור"
        onClose={() => setDone(null)}
      >
        <p className="m-0">{done}</p>
      </ConfirmDialog>
    </section>
  );
}
