"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@metavchim/ui";
import {
  DOCUMENT_KIND_LABELS,
  documentUnlocksOffers,
  formatFileSize,
  type DocumentKind,
} from "@metavchim/shared";
import { api, apiGet, API_BASE } from "@/lib/api";
import { ConfirmDialog } from "./confirm-dialog";
import { IconDoc, IconWarning } from "./icons";
import { LoadError } from "./load-error";
import { Notice } from "./notice";
import { formatDate } from "@/lib/format";

/**
 * ‎**מסמכים שנחתמו על נייר — באותה לשונית של ההסכמים.**
 *
 * המערכת יודעת לנסח הסכם, לשלוח קישור ולקלוט חתימה. מה שלא הייתה לה
 * עד כה הוא מסלול למתווך שהחתים לקוח על דף: הלשונית „הסכמים” הראתה
 * „עדיין לא נשלח הסכם” על לקוח שחתם, ולא היה שום מקום לשים בו את
 * הסריקה (בקשת המשתמשת).
 *
 * ## הצהרה, לא ניחוש
 *
 * המערכת אינה יכולה לקרוא את הדף ולדעת מה הוא. לכן המתווך בוחר את
 * הסוג, ומסמך מסוג „הזמנה בכתב” או „בלעדיות” הוא **הצהרה** — הוא
 * פותח את שער ההצעות בדיוק כמו חתימה במערכת, ולכן דורש את שם החותם
 * ואת תאריך החתימה. המסך אומר את זה במפורש לפני ההעלאה ולא אחריה.
 *
 * „מסמך אחר” — נספח, אישור זכויות, תעודה — אינו טוען דבר ואינו פותח
 * דבר, ולכן גם אינו דורש פרטים.
 */

interface DocumentRow {
  id: string;
  kind: DocumentKind;
  fileName: string;
  byteSize: number;
  propertyLabel?: string;
  signedOn?: string;
  signerName?: string;
  note?: string;
  createdAt: string;
  url: string;
}

const inputStyle = {
  borderColor: "var(--color-input-border)",
  background: "var(--color-field)",
} as const;

/**
 * מה שאפשר לצרף. `capture` אינו מוגדר במכוון — הוא היה כופה מצלמה
 * ומונע בחירת PDF מהסורק, שהוא המקרה הנפוץ יותר.
 */
const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/heic,.pdf,.heic";

/** נכס לבחירה כשהמסך אינו מזהה נכס בעצמו — כמו ב-`AgreementsPanel`. */
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

export function DocumentsPanel({
  contactId,
  propertyId,
  defaultKind,
  canEdit,
}: {
  contactId: string;
  /** מצורף למסמך כשהמסך יודע על איזה נכס מדובר (כרטיס הנכס). */
  propertyId?: string;
  /** הסוג שנבחר מראש — הבלעדיות בכרטיס הנכס, ההזמנה בכתב בכרטיס הקונה. */
  defaultKind: DocumentKind;
  canEdit: boolean;
}) {
  const [rows, setRows] = useState<DocumentRow[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [askDelete, setAskDelete] = useState<DocumentRow | null>(null);

  const [kind, setKind] = useState<DocumentKind>(defaultKind);
  const [signerName, setSignerName] = useState("");
  const [signedOn, setSignedOn] = useState("");
  const [note, setNote] = useState("");
  const [chosenProperty, setChosenProperty] = useState("");
  const [properties, setProperties] = useState<PropertyOption[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function load(): void {
    setLoadFailed(false);
    apiGet<DocumentRow[]>(
      `/signed-documents/contact/${contactId}` +
        (propertyId === undefined ? "" : `?propertyId=${encodeURIComponent(propertyId)}`),
    )
      .then(setRows)
      .catch(() => setLoadFailed(true));
  }

  useEffect(load, [contactId, propertyId]);

  const declares = documentUnlocksOffers(kind);

  /*
   * ‎**הנכס שההסכם חל עליו — נבחר כאן כשהמסך אינו מספק אותו.**
   *
   * ‎`hasSigned` מחפש חתימה על נכס מסוים, ולכן מסמך שנשמר בלי נכס
   * אינו פותח שום הצעה. הגרסה הראשונה של המסך הזה לא שאלה על נכס
   * בכרטיס הקונה, ובכל זאת הודיעה „אפשר לשלוח ללקוח הצעות על
   * הנכס” — הבטחה שהמערכת לא קיימה (ביקורת Codex). זו אותה בחירה
   * בדיוק שכבר קיימת ב-`AgreementsPanel`, ומאותה סיבה.
   */
  const needsProperty = propertyId === undefined && declares;
  const effectiveProperty = propertyId ?? chosenProperty;

  useEffect(() => {
    if (!open || !needsProperty || properties !== null) return;
    apiGet<{ items: PropertyOption[] }>("/properties?limit=100")
      .then((res) => setProperties(res.items ?? []))
      .catch(() => setProperties([]));
  }, [open, needsProperty, properties]);

  async function upload(): Promise<void> {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("בחרו קובץ לצירוף");
      return;
    }
    /*
     * שתי הבדיקות שהשרת עושה בכל מקרה, נעשות גם כאן — כדי שהמתווך
     * לא ימתין להעלאת 18MB רק כדי לגלות שחסר שם החותם.
     */
    if (declares && signerName.trim() === "") {
      setError("מי חתם? השם נדרש כדי לשמור את המסמך כהסכם חתום");
      return;
    }
    if (declares && signedOn === "") {
      setError("מתי נחתם? התאריך נדרש כדי לשמור את המסמך כהסכם חתום");
      return;
    }
    if (declares && effectiveProperty === "") {
      setError("בחרו את הנכס שההסכם חל עליו");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("contactId", contactId);
      form.append("kind", kind);
      form.append("fileName", file.name);
      /*
       * ‎**רק מה שהמסך מציג נשלח.**
       *
       * מי שמילא שם ותאריך עבור „הזמנה בכתב” ואז החליף ל„מסמך אחר”
       * ראה את השדות נעלמים — אבל הם נשארו ב-state ונשלחו, והשרת
       * דוחה בדיוק את הצירוף הזה. התוצאה הייתה מבוי סתום: כל העלאה
       * נכשלת, וההודעה מפנה לשדות שאינם על המסך כדי לרוקן אותם
       * (ביקורת Codex).
       *
       * הגבול הוא `declares` — אותו תנאי בדיוק שקובע אם השדות מוצגים.
       * שדה שאינו נראה אינו נשלח, ולכן אין מצב שבו המשתמש מתבקש
       * לתקן משהו שאין לו דרך להגיע אליו.
       */
      if (declares && effectiveProperty !== "") form.append("propertyId", effectiveProperty);
      if (declares && signerName.trim() !== "") form.append("signerName", signerName.trim());
      if (declares && signedOn !== "") form.append("signedOn", signedOn);
      if (note.trim() !== "") form.append("note", note.trim());

      // multipart — בלי Content-Type ידני; הדפדפן קובע boundary
      const res = await fetch(`${API_BASE}/signed-documents`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? "צירוף המסמך נכשל");
      }
      setDone(
        declares
          ? "המסמך צורף ונשמר כהסכם חתום. אפשר לשלוח ללקוח הצעות על אותו נכס."
          : "המסמך צורף לכרטיס.",
      );
      setSignerName("");
      setSignedOn("");
      setNote("");
      setKind(defaultKind);
      setChosenProperty("");
      if (fileRef.current) fileRef.current.value = "";
      setOpen(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "צירוף המסמך נכשל");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api(`/signed-documents/${id}`, { method: "DELETE" });
      load();
    } catch {
      setError("מחיקת המסמך נכשלה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="mb-6 rounded-xl border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <h2 className="mb-2 text-lg font-semibold">מסמכים שנחתמו על נייר</h2>

      {loadFailed ? (
        <div className="mb-3">
          <LoadError message="לא הצלחנו לטעון את המסמכים" onRetry={load} />
        </div>
      ) : rows === null ? (
        <p aria-live="polite">טוען…</p>
      ) : rows.length === 0 ? (
        <p className="mb-3" style={{ color: "var(--color-text-muted)" }}>
          {canEdit
            ? "אין כאן מסמכים. סרקו או צלמו דף חתום וצרפו אותו לכרטיס."
            : "אין כאן מסמכים."}
        </p>
      ) : (
        <ul className="mb-3 flex list-none flex-col gap-2 p-0">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded-xl border p-3"
              style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="mv-chip" style={{ cursor: "default" }}>
                  {DOCUMENT_KIND_LABELS[row.kind]}
                </span>
                {/* שם הקובץ וגודלו — SPEC-3c §6c. הגודל ב-LTR כמו כל מספר */}
                <span className="text-[length:var(--type-caption-lg)]">{row.fileName}</span>
                <span
                  className="text-[length:var(--type-caption)]"
                  dir="ltr"
                  style={{ color: "var(--color-text-muted)", unicodeBidi: "isolate" }}
                >
                  {formatFileSize(row.byteSize)}
                </span>
              </div>

              {/*
                לאיזה נכס המסמך שייך. בכרטיס הנכס זה אישור, ובכרטיס
                הקונה — שבו מוצגים כל המסמכים של הלקוח — זו ההבחנה
                שמונעת לקרוא סריקה של נכס אחד כשייכת לאחר.
              */}
              {/*
                ‎**הסכם חתום אומר תמיד על מה הוא חל** — גם כשהנכס
                עצמו נמחק לצמיתות. הסריקה נשמרת ומנותקת מהנכס, ובלי
                השורה הזו היא נראית בדיוק כמו „מסמך אחר” שלא חל על
                שום נכס. „מסמך אחר” באמת אינו נושא נכס, ולכן הוא
                נשאר בלי השורה.
              */}
              {row.propertyLabel !== undefined || documentUnlocksOffers(row.kind) ? (
                <p
                  className="m-0 mb-2 text-[length:var(--type-caption-lg)]"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {row.propertyLabel === undefined
                    ? "הנכס נמחק לצמיתות"
                    : `על הנכס: ${row.propertyLabel}`}
                </p>
              ) : null}

              {row.signerName || row.signedOn ? (
                <p
                  className="m-0 mb-2 text-[length:var(--type-caption-lg)]"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {row.signerName ? `חתם: ${row.signerName}` : null}
                  {row.signerName && row.signedOn ? " · " : null}
                  {row.signedOn ? `נחתם ${formatDate(row.signedOn)}` : null}
                </p>
              ) : null}

              {row.note ? <p className="m-0 mb-2 text-sm">{row.note}</p> : null}

              <div className="flex flex-wrap items-center gap-3">
                <a
                  href={API_BASE + row.url}
                  className="text-[length:var(--type-caption-lg)] underline"
                >
                  <IconDoc s={15} /> הורדת המסמך
                </a>
                {canEdit ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setAskDelete(row)}
                  >
                    מחיקה
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {error ? <Notice tone="danger">{error}</Notice> : null}

      {!canEdit ? null : open ? (
        <div className="flex flex-col gap-3">
          <div>
            <label htmlFor={`doc-kind-${contactId}`} className="mb-1 block font-medium">
              מה המסמך הזה
            </label>
            <select
              id={`doc-kind-${contactId}`}
              value={kind}
              onChange={(event) => setKind(event.target.value as DocumentKind)}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            >
              {(Object.keys(DOCUMENT_KIND_LABELS) as DocumentKind[]).map((option) => (
                <option key={option} value={option}>
                  {DOCUMENT_KIND_LABELS[option]}
                </option>
              ))}
            </select>
          </div>

          {/*
            מה שהבחירה עושה, לפני שהיא נעשית. הצהרה על הסכם חתום
            פותחת שער אמיתי במערכת, ומסך ששותק עליה מבקש מהמתווך
            להצהיר בלי לדעת על מה.
          */}
          {declares ? (
            <Notice tone="warning">
              <strong>זו הצהרה שלכם שהלקוח חתם.</strong> המערכת אינה יכולה לאמת את
              הדף, ולכן היא נסמכת עליכם — ומרגע השמירה אפשר לשלוח ללקוח הצעות על
              אותו נכס, בדיוק כמו אחרי חתימה במערכת.
            </Notice>
          ) : null}

          {/*
            הנכס שההסכם חל עליו. מוצג רק כשהמסך אינו יודע אותו
            בעצמו (כרטיס הקונה) וכשהסוג הוא הצהרה — „מסמך אחר”
            אינו נוגע לנכס מסוים ואינו פותח דבר.
          */}
          {needsProperty ? (
            <div>
              <label htmlFor={`doc-prop-${contactId}`} className="mb-1 block font-medium">
                הנכס שההסכם חל עליו
              </label>
              <p className="m-0 mb-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
                ההזמנה בכתב מתארת נכס מסוים, והחתימה עליה פותחת הצעות על אותו נכס
                בלבד.
              </p>
              <select
                id={`doc-prop-${contactId}`}
                value={chosenProperty}
                onChange={(event) => setChosenProperty(event.target.value)}
                className="w-full rounded-lg border px-3 py-2.5"
                style={inputStyle}
              >
                <option value="">בחרו נכס…</option>
                {(properties ?? []).map((option) => (
                  <option key={option.id} value={option.id}>
                    {propertyLabel(option)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div>
            <label htmlFor={`doc-file-${contactId}`} className="mb-1 block font-medium">
              הקובץ
            </label>
            <input
              id={`doc-file-${contactId}`}
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
            <p className="m-0 mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
              סריקה כ-PDF או צילום של הדף. עד 20MB.
            </p>
          </div>

          {declares ? (
            <>
              <div>
                <label htmlFor={`doc-signer-${contactId}`} className="mb-1 block font-medium">
                  מי חתם
                </label>
                <input
                  id={`doc-signer-${contactId}`}
                  value={signerName}
                  onChange={(event) => setSignerName(event.target.value)}
                  className="w-full rounded-lg border px-3 py-2.5"
                  style={inputStyle}
                />
              </div>
              <div>
                <label htmlFor={`doc-date-${contactId}`} className="mb-1 block font-medium">
                  מתי נחתם
                </label>
                <input
                  id={`doc-date-${contactId}`}
                  type="date"
                  value={signedOn}
                  onChange={(event) => setSignedOn(event.target.value)}
                  className="w-full rounded-lg border px-3 py-2.5"
                  style={inputStyle}
                />
              </div>
            </>
          ) : null}

          <div>
            <label htmlFor={`doc-note-${contactId}`} className="mb-1 block font-medium">
              הערה (רשות)
            </label>
            <input
              id={`doc-note-${contactId}`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>

          <div className="flex gap-2">
            <Button type="button" disabled={busy} onClick={() => void upload()}>
              {busy ? "מצרף…" : "צרף מסמך"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              ביטול
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          <IconDoc s={15} /> צרף מסמך חתום
        </Button>
      )}

      {/* ---- אישור מחיקה ---- */}
      <ConfirmDialog
        open={askDelete !== null}
        title="למחוק את המסמך?"
        tone="danger"
        confirmLabel="מחק"
        busy={busy}
        onConfirm={() => {
          const target = askDelete;
          if (!target) return;
          setAskDelete(null);
          void remove(target.id);
        }}
        onClose={() => setAskDelete(null)}
      >
        <p className="m-0 mb-3">
          הקובץ יימחק מהמערכת ולא ניתן יהיה לשחזר אותו.
        </p>
        {askDelete && documentUnlocksOffers(askDelete.kind) ? (
          /*
            „סוגרת” היה שקר כשקיים הסכם חתום נוסף על אותו נכס —
            ‎`hasSigned` עדיין מוצא אותו, והשער נשאר פתוח (ביקורת
            Codex). המסך אינו יודע מה עוד קיים, ולכן הוא אומר את מה
            שהוא כן יודע.
          */
          <p className="m-0">
            <IconWarning s={15} /> <strong>זהו הסכם חתום.</strong> אם זהו ההסכם
            החתום היחיד על הנכס הזה, מחיקתו תסגור את האפשרות לשלוח ללקוח הצעות
            עליו — עד שיצורף מסמך אחר או שייחתם הסכם במערכת.
          </p>
        ) : null}
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
