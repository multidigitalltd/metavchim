"use client";

import { useState } from "react";
import {
  INTAKE_SELLER_FEATURES,
  INTAKE_SELLER_FEATURE_LABEL,
  INTAKE_SELLER_NOTES_MAX,
  type IntakeSellerAnswers,
  type IntakeSellerFeature,
} from "@metavchim/shared";
import { ApiError, apiPost } from "@/lib/api";
import { PROPERTY_TYPE_LABELS } from "@/lib/format";
import { Notice } from "../../notice";
import { Choice, Field, Shell } from "./form-parts";

/**
 * „יש לי נכס” — הצד השני של הטופס שהלקוח ממלא בעצמו.
 *
 * ## מי קורא את העמוד הזה
 *
 * אותו אדם בדיוק כמו בצד הקונה: לא מתווך, פותח בטלפון, רוצה לסיים
 * תוך דקה. לכן אותה שפה, אותם רכיבים, ואותו כלל — **הכול רשות**
 * מלבד מה שבלעדיו אי אפשר לחזור אליו.
 *
 * ## למה שני שדות בלבד חובה
 *
 * מוכר שאינו יודע את השטח המדויק ימציא מספר, ומספר שהומצא גרוע
 * משדה ריק: הסוכן יראה אותו כעובדה ויתמחר לפיו. סוג העסקה והעיר הם
 * היחידים שבלעדיהם אין למה לחזור.
 *
 * ## מה **אין** כאן
 *
 * מפה, שכונות מהקטלוג הפנימי ומאפיינים מותאמים של המשרד. אלה
 * דורשים מינוח שאין ללקוח, והסוכן משלים אותם בכרטיס.
 */

/** סוגי הנכס שמוצעים למוכר. אותה רשימה קצרה של הצד השני. */
const TYPES = [
  "apartment",
  "garden_apartment",
  "penthouse",
  "duplex",
  "private_house",
  "plot",
];

function numOrUndefined(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

export function SellerForm({
  token,
  officeName,
  greetingName,
  needsIdentity,
  submittedAt,
  prefill,
  onBack,
}: {
  token: string;
  officeName: string;
  greetingName: string;
  needsIdentity: boolean;
  submittedAt: string | null;
  prefill: IntakeSellerAnswers;
  /** חזרה לשאלה הפותחת — מי שבחר בטעות אינו תקוע. */
  onBack: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [dealType, setDealType] = useState<"sale" | "rent">(
    prefill.dealType ?? "sale",
  );
  const [city, setCity] = useState(prefill.city ?? "");
  const [neighborhood, setNeighborhood] = useState(prefill.neighborhood ?? "");
  const [street, setStreet] = useState(prefill.street ?? "");
  const [houseNumber, setHouseNumber] = useState(prefill.houseNumber ?? "");
  const [propertyType, setPropertyType] = useState(prefill.propertyType ?? "");
  const [rooms, setRooms] = useState(
    prefill.rooms === undefined ? "" : String(prefill.rooms),
  );
  const [areaSqm, setAreaSqm] = useState(
    prefill.areaSqm === undefined ? "" : String(prefill.areaSqm),
  );
  const [floor, setFloor] = useState(
    prefill.floor === undefined ? "" : String(prefill.floor),
  );
  const [price, setPrice] = useState(
    prefill.priceAgorot === undefined
      ? ""
      : String(Math.round(prefill.priceAgorot / 100)),
  );
  const [priceFlexible, setPriceFlexible] = useState(
    prefill.priceFlexible ?? false,
  );
  const [features, setFeatures] = useState<
    Partial<Record<IntakeSellerFeature, boolean>>
  >(prefill.features ?? {});
  const [entryType, setEntryType] = useState<
    "immediate" | "from_date" | "flexible" | ""
  >(prefill.entryType ?? "");
  const [entryDate, setEntryDate] = useState(prefill.entryDate ?? "");
  const [notes, setNotes] = useState(prefill.notes ?? "");
  /** מלכודת דבש — נשארת ריקה אצל אדם. */
  const [website, setWebsite] = useState("");

  function toggleFeature(key: IntakeSellerFeature): void {
    /*
     * שלושה מצבים ולא שניים: „לא נשאל” → „יש” → „אין”. תיבת סימון
     * רגילה מייצרת „אין” לכל מה שהלקוח פשוט לא הגיע אליו, והסוכן
     * מקבל דירה שכתוב עליה במפורש שאין בה מרפסת — בלי שאיש אמר זאת.
     */
    setFeatures((prev) => {
      const next = { ...prev };
      if (next[key] === undefined) next[key] = true;
      else if (next[key] === true) next[key] = false;
      else delete next[key];
      return next;
    });
  }

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        ...(needsIdentity ? { fullName, phone } : {}),
        dealType,
        city: city.trim(),
        ...(neighborhood.trim() !== "" ? { neighborhood: neighborhood.trim() } : {}),
        ...(street.trim() !== "" ? { street: street.trim() } : {}),
        ...(houseNumber.trim() !== "" ? { houseNumber: houseNumber.trim() } : {}),
        ...(propertyType !== "" ? { propertyType } : {}),
        ...(numOrUndefined(rooms) !== undefined ? { rooms: numOrUndefined(rooms) } : {}),
        ...(numOrUndefined(areaSqm) !== undefined
          ? { areaSqm: numOrUndefined(areaSqm) }
          : {}),
        ...(numOrUndefined(floor) !== undefined
          ? { floor: numOrUndefined(floor) }
          : {}),
        ...(numOrUndefined(price) !== undefined
          ? { priceAgorot: Math.round((numOrUndefined(price) ?? 0) * 100) }
          : {}),
        /*
         * נשלח תמיד, גם `false`: לתיבת סימון יש מצב ידוע בכל רגע,
         * והשמטתו בשליחה חוזרת הייתה משאירה „המחיר גמיש” על הנכס
         * אחרי שהמוכר הוריד את הסימון (ביקורת Codex).
         */
        priceFlexible,
        ...(Object.keys(features).length > 0 ? { features } : {}),
        ...(notes.trim() !== "" ? { notes: notes.trim() } : {}),
        ...(website !== "" ? { website } : {}),
        ...(entryType !== ""
          ? {
              entryType,
              ...(entryType === "from_date" && entryDate !== "" ? { entryDate } : {}),
            }
          : {}),
      };
      await apiPost<{ ok: true }>(`/f/${token}/seller`, body);
      setDone(true);
    } catch (err: unknown) {
      // הסיבה שהשרת נתן — „הקישור פג” אינו „בדקו את החיבור”
      setError(
        err instanceof ApiError
          ? err.message
          : "השליחה נכשלה. בדקו את החיבור ונסו שוב.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Shell officeName={officeName}>
        <h1 className="m-0 text-center text-2xl font-extrabold">✓ קיבלנו, תודה!</h1>
        <p className="m-0 mt-3 text-center text-[length:var(--type-button)] leading-relaxed">
          הפרטים הגיעו ל{officeName}. ניצור אתכם קשר כדי להשלים את מה שחסר
          ולהתקדם.
        </p>
      </Shell>
    );
  }

  return (
    <Shell officeName={officeName}>
      <header className="text-center">
        <h1 className="m-0 text-2xl font-extrabold">
          שלום {greetingName}, ספרו לנו על הנכס
        </h1>
        <p className="m-0 mt-2 text-[length:var(--type-button)] leading-relaxed">
          {needsIdentity
            ? "רק השם, הטלפון, סוג העסקה והעיר נחוצים — את השאר מלאו כמה שידוע, ונשלים בשיחה."
            : "רק סוג העסקה והעיר נחוצים — את השאר מלאו כמה שידוע, ונשלים בשיחה."}
        </p>
        {submittedAt !== null ? (
          <p
            className="m-0 mt-2 text-[length:var(--type-body-sm)] font-semibold"
            style={{ color: "var(--color-primary)" }}
          >
            כבר מילאתם את הטופס. אפשר לעדכן ולשלוח שוב.
          </p>
        ) : null}
      </header>

      {needsIdentity ? (
        <>
          <Field label="איך קוראים לכם?">
            <input
              className="mv-field w-full"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
              placeholder="שם מלא"
            />
          </Field>
          <Field
            label="באיזה מספר להשיג אתכם?"
            hint="לשם כך בלבד — לא נעביר אותו לאף אחד"
          >
            <input
              className="mv-field w-full"
              dir="ltr"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
              placeholder="050-0000000"
            />
          </Field>
        </>
      ) : null}

      <Field label="מוכרים או משכירים?">
        <div className="flex flex-wrap gap-2">
          <Choice active={dealType === "sale"} onClick={() => setDealType("sale")}>
            מכירה
          </Choice>
          <Choice active={dealType === "rent"} onClick={() => setDealType("rent")}>
            השכרה
          </Choice>
        </div>
      </Field>

      <Field label="איפה הנכס?" hint="העיר מספיקה; כתובת מדויקת תעזור לנו להתכונן">
        <input
          className="mv-field w-full"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          placeholder="עיר"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            className="mv-field min-w-[140px] flex-1"
            value={neighborhood}
            onChange={(e) => setNeighborhood(e.target.value)}
            placeholder="שכונה (רשות)"
          />
          <input
            className="mv-field min-w-[140px] flex-1"
            value={street}
            onChange={(e) => setStreet(e.target.value)}
            placeholder="רחוב (רשות)"
          />
          <input
            className="mv-field w-24"
            value={houseNumber}
            onChange={(e) => setHouseNumber(e.target.value)}
            placeholder="מספר"
          />
        </div>
      </Field>

      <Field label="איזה סוג נכס?">
        <div className="flex flex-wrap gap-2">
          {TYPES.map((value) => (
            <Choice
              key={value}
              active={propertyType === value}
              /* לחיצה שנייה מבטלת — מי שסימן בטעות אינו תקוע */
              onClick={() => setPropertyType((prev) => (prev === value ? "" : value))}
            >
              {PROPERTY_TYPE_LABELS[value] ?? value}
            </Choice>
          ))}
        </div>
      </Field>

      <Field label="גודל הנכס">
        <div className="flex flex-wrap gap-2">
          <input
            className="mv-field min-w-[110px] flex-1"
            inputMode="decimal"
            value={rooms}
            onChange={(e) => setRooms(e.target.value)}
            placeholder="חדרים"
          />
          <input
            className="mv-field min-w-[110px] flex-1"
            inputMode="numeric"
            value={areaSqm}
            onChange={(e) => setAreaSqm(e.target.value)}
            placeholder='מ"ר'
          />
          <input
            className="mv-field min-w-[110px] flex-1"
            inputMode="numeric"
            value={floor}
            onChange={(e) => setFloor(e.target.value)}
            placeholder="קומה"
          />
        </div>
      </Field>

      <Field
        label={dealType === "rent" ? "כמה שכר דירה?" : "כמה אתם מבקשים?"}
        hint="בשקלים. אם עוד לא החלטתם — אפשר להשאיר ריק"
      >
        <input
          className="mv-field w-full"
          inputMode="numeric"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder={dealType === "rent" ? "לחודש" : "מחיר מבוקש"}
        />
        <div className="mt-2">
          <Choice active={priceFlexible} onClick={() => setPriceFlexible((v) => !v)}>
            המחיר גמיש
          </Choice>
        </div>
      </Field>

      <Field
        label="מה יש בנכס?"
        hint="לחיצה ראשונה — יש · שנייה — אין · שלישית — מבטלת"
      >
        <div className="flex flex-wrap gap-2">
          {INTAKE_SELLER_FEATURES.map((key) => (
            <Choice
              key={key}
              active={features[key] !== undefined}
              onClick={() => toggleFeature(key)}
            >
              {INTAKE_SELLER_FEATURE_LABEL[key]}
              {features[key] === true ? " ✓" : features[key] === false ? " ✕" : ""}
            </Choice>
          ))}
        </div>
      </Field>

      <Field label="מתי הנכס פנוי?">
        <div className="flex flex-wrap gap-2">
          <Choice
            active={entryType === "immediate"}
            onClick={() => setEntryType("immediate")}
          >
            מיד
          </Choice>
          <Choice
            active={entryType === "from_date"}
            onClick={() => setEntryType("from_date")}
          >
            מתאריך
          </Choice>
          <Choice
            active={entryType === "flexible"}
            onClick={() => setEntryType("flexible")}
          >
            גמיש
          </Choice>
        </div>
        {entryType === "from_date" ? (
          <input
            className="mv-field mt-2 w-full"
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
          />
        ) : null}
      </Field>

      <Field label="עוד משהו שכדאי שנדע?" hint="שוכר שגר בנכס, שיפוץ, מה שתרצו">
        <textarea
          className="mv-field w-full"
          rows={3}
          maxLength={INTAKE_SELLER_NOTES_MAX}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>

      {/* מלכודת דבש — מוסתרת מאדם ומקוראי מסך, גלויה לבוט */}
      <input
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }}
      />

      {error !== null ? <Notice tone="danger">{error}</Notice> : null}

      <button
        type="button"
        className="mv-btn-action mt-5 w-full"
        style={{ padding: "14px", fontSize: "calc(17 / 16 * 1rem)" }}
        disabled={busy}
        onClick={() => void submit()}
      >
        {busy ? "שולח…" : "שליחה"}
      </button>

      <button
        type="button"
        className="mv-btn-plain mt-3 w-full"
        onClick={onBack}
      >
        רגע, אני דווקא מחפש/ת נכס
      </button>

      <p
        className="m-0 mt-3 text-center text-[length:var(--type-caption)]"
        style={{ color: "var(--color-text-muted)" }}
      >
        הפרטים נשמרים אצל {officeName} בלבד ואינם מועברים לאיש.
      </p>
    </Shell>
  );
}
