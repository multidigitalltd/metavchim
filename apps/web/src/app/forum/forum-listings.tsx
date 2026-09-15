"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FORUM_PRO_CATEGORIES,
  FORUM_PRO_CATEGORY_LABELS,
  FORUM_TOOL_CATEGORIES,
  FORUM_TOOL_CATEGORY_LABELS,
  ForumListingInputSchema,
  ForumRatingInputSchema,
  type ForumListingKind,
} from "@metavchim/shared";
import { ApiError, apiGet, apiList, apiPost } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { ConfirmDialog } from "../confirm-dialog";
import { IconEye, IconGlobe, IconMap, IconPhone, IconPlus, IconStar, IconWarning } from "../icons";
import { FilterChips, SearchField } from "../list-controls";
import { LoadError } from "../load-error";
import { Notice } from "../notice";
import { SelectMenu } from "../select-menu";
import { AuthorBadge, ReportDialog, StarInput, Stars, type ListingDto, type RatingDto } from "./forum-shared";

/**
 * המדריך — כלים ובעלי מקצוע, אותו מסך עם `kind` שונה (docs/14).
 *
 * הדירוג הוא הלב: „מניסיון אישי” ולא „מה שמעתם”. כל אחד מדרג פעם
 * אחת (דירוג חוזר מחליף), אפשר בעילום שם, והממוצע מוצג בכוכבים עם
 * מספר המדרגים — ממוצע של אחד אינו ממוצע.
 */

const COPY: Record<ForumListingKind, { add: string; empty: string; intro: string; nameLabel: string; ratePrompt: string }> = {
  pro: {
    add: "להוסיף בעל/ת מקצוע",
    empty: "עדיין אין בעלי מקצוע במדריך. מי שעבדתם איתו וממליצים — זה המקום.",
    intro: "עורכי דין, שמאים, יועצי משכנתאות, צלמים — מי שמתווכים אחרים עבדו איתם ומדרגים מניסיון אישי.",
    nameLabel: "שם בעל/ת המקצוע או המשרד",
    ratePrompt: "מה הייתה החוויה שלכם בעבודה איתו/ה?",
  },
  tool: {
    add: "להוסיף כלי",
    empty: "עדיין אין כלים משותפים. אתר, תבנית או אפליקציה שחוסכים לכם זמן — שתפו.",
    intro: "אתרים, תבניות, אפליקציות ומאגרי נתונים שמתווכים משתמשים בהם בפועל — עם דירוג של מי שניסה.",
    nameLabel: "שם הכלי",
    ratePrompt: "מה הכלי עשה בשבילכם בפועל?",
  },
};

export function ListingDirectory({ kind }: { kind: ForumListingKind }) {
  const [items, setItems] = useState<ListingDto[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [adding, setAdding] = useState(false);
  const [rating, setRating] = useState<ListingDto | null>(null);
  const [report, setReport] = useState<{ type: "listing" | "rating"; id: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const categories = kind === "pro" ? FORUM_PRO_CATEGORIES : FORUM_TOOL_CATEGORIES;
  const labels: Record<string, string> = kind === "pro" ? FORUM_PRO_CATEGORY_LABELS : FORUM_TOOL_CATEGORY_LABELS;
  const copy = COPY[kind];

  const load = useCallback(() => {
    setFailed(false);
    const params = new URLSearchParams({ kind });
    if (q.trim() !== "") params.set("q", q.trim());
    if (category !== "") params.set("category", category);
    apiGet<{ items: ListingDto[] }>(`/forum/listings?${params.toString()}`)
      .then((res) => setItems(apiList(res.items, "items")))
      .catch(() => setFailed(true));
  }, [kind, q, category]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button type="button" className="mv-btn-primary" onClick={() => setAdding((v) => !v)}>
          <IconPlus s={16} /> {copy.add}
        </button>
        <p className="m-0 text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>{copy.intro}</p>
      </div>

      {adding ? <AddListing kind={kind} onClose={() => setAdding(false)} onCreated={() => { setAdding(false); load(); }} /> : null}

      <div className="mv-filter-bar" data-active={q.trim() !== "" || category !== "" ? "on" : undefined}>
        <SearchField label="חיפוש במדריך" placeholder={kind === "pro" ? "שם, תחום או אזור…" : "שם או תיאור…"} value={q} onChange={setQ} />
      </div>
      <div className="mb-4">
        <FilterChips
          label="קטגוריה"
          value={category}
          onChange={setCategory}
          options={[["", "הכול"], ...categories.map((c): [string, string] => [c, labels[c] ?? c])]}
        />
      </div>

      {failed ? (
        <LoadError message="לא הצלחנו לטעון את המדריך" onRetry={load} />
      ) : items === null ? (
        <p aria-live="polite">טוען…</p>
      ) : items.length === 0 ? (
        <div className="mv-card mv-card--pad text-center">
          <p className="m-0 font-bold">{q.trim() !== "" || category !== "" ? "לא נמצא מה שחיפשתם." : copy.empty}</p>
        </div>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
          {items.map((item) => (
            <li key={item.id} className="mv-card mv-card--pad flex flex-col">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <span className="mv-pill mv-domain-neutral">{labels[item.category] ?? item.category}</span>
                  <h3 className="m-0 mt-1.5 text-[length:var(--type-row-title)] font-extrabold leading-snug">{item.name}</h3>
                </div>
                <Stars value={item.ratingAverage} count={item.ratingCount} />
              </div>
              <p className="mv-forum-body m-0 mt-2 text-[length:var(--type-body-sm)]" style={{ color: "var(--color-text-soft)" }}>{item.description}</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[length:var(--type-caption-lg)] font-semibold" style={{ color: "var(--color-text-muted)" }}>
                {item.area ? <span className="inline-flex items-center gap-1"><IconMap s={14} /> {item.area}</span> : null}
                {item.contact ? <span className="inline-flex items-center gap-1 mv-ltr"><IconPhone s={14} /> {item.contact}</span> : null}
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1" style={{ color: "var(--color-primary)" }}>
                    <IconGlobe s={14} /> לאתר
                  </a>
                ) : null}
              </div>
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
                <button type="button" className="mv-btn-soft" onClick={() => setRating(item)}>
                  <IconStar s={15} /> {item.myRating === null ? "לדרג מניסיון" : `הדירוג שלי: ${item.myRating.score}`}
                </button>
                <button type="button" className="mv-btn-plain" onClick={() => setOpen(open === item.id ? null : item.id)} aria-expanded={open === item.id}>
                  {item.ratingCount === 0 ? "אין חוות דעת" : open === item.id ? "לסגור" : `${item.ratingCount} חוות דעת`}
                </button>
                {!item.mine ? (
                  <button type="button" className="mv-btn-plain ms-auto" aria-label="דיווח" title="דיווח" onClick={() => setReport({ type: "listing", id: item.id })}>
                    <IconWarning s={15} />
                  </button>
                ) : null}
              </div>
              {open === item.id ? <Ratings listingId={item.id} onReport={(id) => setReport({ type: "rating", id })} /> : null}
            </li>
          ))}
        </ul>
      )}

      <RateDialog listing={rating} prompt={copy.ratePrompt} onClose={() => setRating(null)} onRated={() => { setRating(null); load(); }} />
      <ReportDialog target={report} onClose={() => setReport(null)} />
    </div>
  );
}

function Ratings({ listingId, onReport }: { listingId: string; onReport: (id: string) => void }) {
  const [items, setItems] = useState<RatingDto[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    setFailed(false);
    apiGet<{ items: RatingDto[] }>(`/forum/listings/${listingId}/ratings`)
      .then((res) => setItems(apiList(res.items, "items")))
      .catch(() => setFailed(true));
  }, [listingId]);
  useEffect(load, [load]);

  if (failed) return <div className="mt-3"><LoadError message="לא הצלחנו לטעון את חוות הדעת" onRetry={load} /></div>;
  if (items === null) return <p className="mt-3" aria-live="polite">טוען…</p>;
  return (
    <ul className="m-0 mt-3 flex list-none flex-col gap-2 border-t p-0 pt-3" style={{ borderColor: "var(--color-row-border)" }}>
      {items.map((r) => (
        <li key={r.id} className="text-[length:var(--type-body-sm)]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Stars value={r.score} count={1} />
            <AuthorBadge author={r.author} small />
            <span className="text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>{timeAgo(r.createdAt)}</span>
            <button type="button" className="mv-btn-plain ms-auto" aria-label="דיווח על חוות הדעת" title="דיווח" onClick={() => onReport(r.id)}>
              <IconWarning s={13} />
            </button>
          </div>
          {r.comment ? <p className="mv-forum-body m-0 mt-1">{r.comment}</p> : null}
        </li>
      ))}
    </ul>
  );
}

/* ---------- דירוג ---------- */

function RateDialog({ listing, prompt, onClose, onRated }: { listing: ListingDto | null; prompt: string; onClose: () => void; onRated: () => void }) {
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setScore(listing?.myRating?.score ?? 0);
    setComment(listing?.myRating?.comment ?? "");
    setAnonymous(listing?.myRating?.anonymous ?? false);
    setError(null);
  }, [listing]);

  async function send(): Promise<void> {
    if (listing === null) return;
    const parsed = ForumRatingInputSchema.safeParse({ score, anonymous, ...(comment.trim() === "" ? {} : { comment: comment.trim() }) });
    if (!parsed.success) {
      setError("בחרו כוכבים — אחד עד חמישה.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/forum/listings/${listing.id}/ratings`, parsed.data);
      onRated();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הדירוג לא נשמר");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog open={listing !== null} title={listing === null ? "" : `דירוג — ${listing.name}`} confirmLabel="לשמור דירוג" busy={busy} busyLabel="שומר…" confirmDisabled={score === 0} onConfirm={() => void send()} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="m-0">{prompt} דירוג מניסיון אישי בלבד — מה שקרה לכם, לא מה ששמעתם.</p>
        <StarInput value={score} onChange={setScore} />
        <label className="flex flex-col gap-1 text-[length:var(--type-caption)] font-semibold">
          משפט על החוויה (רשות)
          <textarea className="mv-field" rows={3} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>
        <label className="mv-forum-anon">
          <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
          <span>
            <span className="inline-flex items-center gap-1.5 font-bold"><IconEye s={15} /> לדרג בעילום שם</span>
            <span className="mv-forum-anon__hint">השם לא יופיע ליד הדירוג ולא יישמר.</span>
          </span>
        </label>
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </div>
    </ConfirmDialog>
  );
}

/* ---------- הוספה ---------- */

function AddListing({ kind, onClose, onCreated }: { kind: ForumListingKind; onClose: () => void; onCreated: () => void }) {
  const categories = kind === "pro" ? FORUM_PRO_CATEGORIES : FORUM_TOOL_CATEGORIES;
  const labels: Record<string, string> = kind === "pro" ? FORUM_PRO_CATEGORY_LABELS : FORUM_TOOL_CATEGORY_LABELS;
  const [category, setCategory] = useState<string>(categories[0]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [contact, setContact] = useState("");
  const [area, setArea] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    const parsed = ForumListingInputSchema.safeParse({
      kind,
      category,
      name,
      description,
      ...(url.trim() === "" ? {} : { url: url.trim() }),
      ...(contact.trim() === "" ? {} : { contact: contact.trim() }),
      ...(area.trim() === "" ? {} : { area: area.trim() }),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message === "כתובת חייבת להתחיל ב-http:// או https://" ? "כתובת האתר חייבת להתחיל ב-https://" : "שם ותיאור (לפחות משפט) הם חובה.");
      return;
    }
    setBusy(true);
    try {
      await apiPost("/forum/listings", parsed.data);
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "ההוספה נכשלה");
      setBusy(false);
    }
  }

  return (
    <form className="mv-card mv-card--pad mb-4" onSubmit={(e) => void submit(e)} noValidate>
      <div className="mv-card-head">
        <h2 className="mv-card-head__title m-0">{COPY[kind].add}</h2>
        <button type="button" className="mv-btn-plain ms-auto" onClick={onClose}>סגירה</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[length:var(--type-caption)] font-semibold">
          {COPY[kind].nameLabel}
          <input className="mv-control" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} required />
        </label>
        <div className="flex flex-col gap-1 text-[length:var(--type-caption)] font-semibold">
          קטגוריה
          <SelectMenu label="קטגוריה" value={category} onChange={setCategory} minWidth={200} options={categories.map((c) => ({ value: c, label: labels[c] ?? c }))} />
        </div>
        <label className="flex flex-col gap-1 text-[length:var(--type-caption)] font-semibold sm:col-span-2">
          למה כדאי — במשפט או שניים
          <textarea className="mv-field" rows={3} value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-[length:var(--type-caption)] font-semibold">
          {kind === "pro" ? "אזור שירות" : "אזור / רלוונטיות"}
          <input className="mv-control" value={area} maxLength={80} placeholder="גוש דן, הצפון, כל הארץ…" onChange={(e) => setArea(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[length:var(--type-caption)] font-semibold">
          {kind === "pro" ? "טלפון או מייל עסקי" : "איש קשר (רשות)"}
          <input className="mv-control mv-ltr" value={contact} maxLength={120} dir="ltr" onChange={(e) => setContact(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[length:var(--type-caption)] font-semibold sm:col-span-2">
          כתובת אתר (רשות)
          <input className="mv-control mv-ltr" value={url} maxLength={500} dir="ltr" placeholder="https://…" onChange={(e) => setUrl(e.target.value)} />
        </label>
      </div>
      <p className="mv-form-hint mt-3">
        {kind === "pro" ? "פרטים עסקיים בלבד — של המשרד או העסק, לא של אדם פרטי. הרשומה גלויה לכל המתווכים במערכת." : "הרשומה גלויה לכל המתווכים במערכת."}
      </p>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="mt-4">
        <button type="submit" className="mv-btn-primary" disabled={busy}>{busy ? "שומר…" : "להוסיף למדריך"}</button>
      </div>
    </form>
  );
}
