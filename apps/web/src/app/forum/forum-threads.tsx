"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  FORUM_BODY_MAX,
  FORUM_BODY_MIN,
  FORUM_KIND_LABELS,
  FORUM_KINDS,
  FORUM_TITLE_MAX,
  FORUM_TITLE_MIN,
  FORUM_TOPIC_LABELS,
  FORUM_TOPICS,
  ForumThreadInputSchema,
  type ForumKind,
  type ForumTopic,
} from "@metavchim/shared";
import { ApiError, apiGet, apiList, apiPost } from "@/lib/api";
import { formatDateTime, timeAgo } from "@/lib/format";
import { IconBell, IconCheck, IconChat, IconEye, IconPin, IconPlus, IconLock } from "../icons";
import { FilterChips, SearchField, SortSelect } from "../list-controls";
import { LoadError } from "../load-error";
import { Notice } from "../notice";
import { SelectMenu } from "../select-menu";
import { AuthorBadge, KIND_DOMAIN, threadHref, type ThreadDto, type ThreadSummary } from "./forum-shared";

/**
 * רשימת השרשורים — הלשונית הראשית, וגם „שאלות אנונימיות” (עם
 * ‎`anonymousOnly`). הסינון בשרת: הרשימה מדפדפת, והמסך אינו מחזיק
 * את כל הפורום בזיכרון.
 */

type Sort = "active" | "newest" | "top";

const SORTS: [Sort, string][] = [
  ["active", "פעילות אחרונה"],
  ["newest", "החדשים"],
  ["top", "המועילים"],
];

export function ThreadList({
  anonymousOnly = false,
  followingOnly = false,
  reloadKey = 0,
}: {
  anonymousOnly?: boolean;
  followingOnly?: boolean;
  reloadKey?: number;
}) {
  const [items, setItems] = useState<ThreadSummary[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [q, setQ] = useState("");
  const [topic, setTopic] = useState("");
  const [sort, setSort] = useState<Sort>("active");
  const [unanswered, setUnanswered] = useState(false);
  const [composing, setComposing] = useState(false);

  const query = useCallback(
    (cursor: string | null): string => {
      const params = new URLSearchParams();
      if (q.trim() !== "") params.set("q", q.trim());
      if (topic !== "") params.set("topic", topic);
      if (sort !== "active") params.set("sort", sort);
      if (unanswered) params.set("unanswered", "1");
      if (anonymousOnly) params.set("anonymous", "1");
      if (followingOnly) params.set("following", "1");
      if (cursor !== null) params.set("cursor", cursor);
      const text = params.toString();
      return text === "" ? "" : `?${text}`;
    },
    [q, topic, sort, unanswered, anonymousOnly, followingOnly],
  );

  const load = useCallback(() => {
    setFailed(false);
    setItems(null);
    apiGet<{ items: ThreadSummary[]; nextCursor: string | null }>(`/forum/threads${query(null)}`)
      .then((res) => {
        setItems(apiList(res.items, "items"));
        setNextCursor(res.nextCursor);
      })
      .catch(() => setFailed(true));
  }, [query]);

  /* חיפוש מושהה ברבע שנייה — לא בקשה על כל תו */
  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load, reloadKey]);

  async function more(): Promise<void> {
    if (nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await apiGet<{ items: ThreadSummary[]; nextCursor: string | null }>(
        `/forum/threads${query(nextCursor)}`,
      );
      const page = apiList(res.items, "items");
      setItems((prev) => [...(prev ?? []), ...page]);
      setNextCursor(res.nextCursor);
    } catch {
      setFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }

  const filtering = q.trim() !== "" || topic !== "" || unanswered;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button type="button" className="mv-btn-primary" onClick={() => setComposing((v) => !v)}>
          <IconPlus s={16} /> {anonymousOnly ? "שאלה בעילום שם" : "שאלה או דיון חדש"}
        </button>
        <p className="m-0 text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>
          {anonymousOnly
            ? "כל מה שכאן פורסם בעילום שם — הזהות אינה נשמרת בשום מקום."
            : "מתווכים מכל הארץ עונים זה לזה. שאלה טובה נשארת ונמצאת בחיפוש."}
        </p>
      </div>

      {composing ? (
        <Composer
          defaultAnonymous={anonymousOnly}
          onClose={() => setComposing(false)}
        />
      ) : null}

      <div className="mv-filter-bar" data-active={filtering ? "on" : undefined}>
        <SearchField label="חיפוש בפורום" placeholder="חיפוש בשאלות ובתשובות…" value={q} onChange={setQ} />
        <SortSelect value={sort} onChange={(v) => setSort(v as Sort)} options={SORTS} />
        <button
          type="button"
          className="mv-chip"
          aria-pressed={unanswered}
          onClick={() => setUnanswered((v) => !v)}
        >
          ללא תשובה
        </button>
      </div>
      <div className="mb-4">
        <FilterChips
          label="נושא"
          value={topic}
          onChange={setTopic}
          options={[["", "כל הנושאים"], ...FORUM_TOPICS.map((t): [string, string] => [t, FORUM_TOPIC_LABELS[t]])]}
        />
      </div>

      {failed ? (
        <LoadError message="לא הצלחנו לטעון את הפורום" onRetry={load} />
      ) : items === null ? (
        <p aria-live="polite">טוען את הפורום…</p>
      ) : items.length === 0 ? (
        <div className="mv-card mv-card--pad text-center">
          <p className="m-0 font-bold">
            {filtering ? "לא נמצא שרשור שמתאים לסינון." : followingOnly ? "עדיין לא עוקבים אחרי אף שיחה." : "עדיין אין כאן שרשורים."}
          </p>
          <p className="m-0 mt-1 text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>
            {followingOnly
              ? "מעקב נוסף מעצמו לשאלה שאתם שואלים ולשיחה שאתם עונים בה — ואפשר גם ללחוץ על הפעמון בכל שרשור."
              : "השאלה הראשונה שלכם יכולה להיות זו שכולם חיפשו."}
          </p>
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {items.map((thread) => (
            <li key={thread.id}>
              <ThreadRow thread={thread} />
            </li>
          ))}
        </ul>
      )}

      {nextCursor !== null && items !== null ? (
        <div className="mt-4 text-center">
          <button type="button" className="mv-btn-plain" disabled={loadingMore} onClick={() => void more()}>
            {loadingMore ? "טוען…" : "עוד שרשורים"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** שורת שרשור — כותרת, קטע, מי ומתי, וכמה ענו. */
export function ThreadRow({ thread }: { thread: ThreadSummary }) {
  return (
    <Link href={threadHref(thread.id)} className="mv-forum-thread no-underline">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`mv-pill ${KIND_DOMAIN[thread.kind]}`}>{FORUM_KIND_LABELS[thread.kind]}</span>
          <span className="mv-pill mv-domain-neutral">{FORUM_TOPIC_LABELS[thread.topic]}</span>
          {thread.pinned ? (
            <span className="inline-flex items-center gap-1 text-[length:var(--type-caption)] font-bold" style={{ color: "var(--color-primary)" }}>
              <IconPin s={13} /> נעוץ
            </span>
          ) : null}
          {thread.locked ? (
            <span className="inline-flex items-center gap-1 text-[length:var(--type-caption)] font-bold" style={{ color: "var(--color-text-muted)" }}>
              <IconLock s={13} /> נעול
            </span>
          ) : null}
          {thread.answered ? (
            <span className="inline-flex items-center gap-1 text-[length:var(--type-caption)] font-bold" style={{ color: "var(--color-success)" }}>
              <IconCheck s={13} /> נענתה
            </span>
          ) : null}
        </div>
        <h3 className="mv-forum-thread__title m-0 mt-1.5">{thread.title}</h3>
        <p className="m-0 mt-1 text-[length:var(--type-body-sm)]" style={{ color: "var(--color-text-muted)" }}>
          {thread.snippet}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <AuthorBadge author={thread.author} small />
          {thread.mine ? (
            <span className="text-[length:var(--type-caption)] font-bold" style={{ color: "var(--color-primary)" }}>
              {thread.author.anonymous ? "שלי (בעילום שם)" : "שלי"}
            </span>
          ) : null}
          <span className="text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }} title={formatDateTime(thread.lastActivityAt)}>
            {timeAgo(thread.lastActivityAt)}
          </span>
        </div>
      </div>
      <div className="mv-forum-thread__stats" aria-label={`${thread.replyCount} תגובות, ${thread.score} סימוני מועיל`}>
        <span className="inline-flex items-center gap-1">
          <IconChat s={15} /> {thread.replyCount}
        </span>
        {thread.following ? (
          <span className="inline-flex items-center gap-1" style={{ color: "var(--color-primary)" }} title="עוקב/ת">
            <IconBell s={14} />
          </span>
        ) : null}
      </div>
    </Link>
  );
}

/* ---------- שאלה חדשה ---------- */

function Composer({ defaultAnonymous, onClose }: { defaultAnonymous: boolean; onClose: () => void }) {
  const router = useRouter();
  const [kind, setKind] = useState<ForumKind>("question");
  const [topic, setTopic] = useState<ForumTopic>("general");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(defaultAnonymous);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function publish(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    const parsed = ForumThreadInputSchema.safeParse({ kind, topic, title, body, anonymous });
    if (!parsed.success) {
      setError(`כותרת של ${FORUM_TITLE_MIN} עד ${FORUM_TITLE_MAX} תווים, ותוכן של ${FORUM_BODY_MIN} עד ${FORUM_BODY_MAX}.`);
      return;
    }
    setBusy(true);
    try {
      const thread = await apiPost<ThreadDto>("/forum/threads", parsed.data);
      router.push(threadHref(thread.id));
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הפרסום נכשל — נסו שוב");
      setBusy(false);
    }
  }

  return (
    <form className="mv-card mv-card--pad mb-4" onSubmit={(e) => void publish(e)} noValidate>
      <div className="mv-card-head">
        <h2 className="mv-card-head__title m-0">{anonymous ? "שאלה בעילום שם" : "שאלה או דיון חדש"}</h2>
        <button type="button" className="mv-btn-plain ms-auto" onClick={onClose}>
          סגירה
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="mv-seg" role="group" aria-label="סוג">
          {FORUM_KINDS.map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {FORUM_KIND_LABELS[k]}
            </button>
          ))}
        </div>
        <SelectMenu
          label="נושא"
          value={topic}
          onChange={(v) => setTopic(v as ForumTopic)}
          minWidth={190}
          options={FORUM_TOPICS.map((t) => ({ value: t, label: FORUM_TOPIC_LABELS[t] }))}
        />
      </div>
      <label className="mt-4 flex flex-col gap-1 text-[length:var(--type-caption)] font-semibold">
        כותרת — משפט אחד שמסכם את השאלה
        <input className="mv-control" value={title} maxLength={FORUM_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} required />
      </label>
      <label className="mt-3 flex flex-col gap-1 text-[length:var(--type-caption)] font-semibold">
        {kind === "tip" ? "הטיפ — מה למדתם, ומה הייתם עושים אחרת" : "הפרטים — מה קרה, מה ניסיתם, ומה בדיוק השאלה"}
        <textarea className="mv-field" rows={6} value={body} maxLength={FORUM_BODY_MAX} onChange={(e) => setBody(e.target.value)} required />
      </label>
      <label className="mv-forum-anon mt-3">
        <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
        <span>
          <span className="inline-flex items-center gap-1.5 font-bold">
            <IconEye s={15} /> לפרסם בעילום שם
          </span>
          <span className="mv-forum-anon__hint">
            השם והמשרד אינם נשמרים כלל — גם לא אצלנו. תוכלו לערוך ולסמן תשובה כרגיל, ובשרשור תופיעו כ„השואל/ת”.
          </span>
        </span>
      </label>
      <p className="mv-form-hint mt-3">
        בלי שמות של לקוחות, כתובות מדויקות או מספרי טלפון — הפורום נקרא בידי מתווכים מכל המשרדים.
      </p>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="submit" className="mv-btn-primary" disabled={busy}>
          {busy ? "מפרסם…" : anonymous ? "לפרסם בעילום שם" : "לפרסם"}
        </button>
      </div>
    </form>
  );
}
