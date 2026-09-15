"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  FORUM_KIND_LABELS,
  FORUM_REPLY_MAX,
  FORUM_TOPIC_LABELS,
  ForumReplyInputSchema,
} from "@metavchim/shared";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { formatDateTime, timeAgo } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";
import { ConfirmDialog } from "../../../confirm-dialog";
import {
  IconBell,
  IconCheck,
  IconEdit,
  IconEye,
  IconLock,
  IconPin,
  IconThumbUp,
  IconTrash,
  IconWarning,
} from "../../../icons";
import { LoadError } from "../../../load-error";
import { Notice } from "../../../notice";
import {
  AuthorBadge,
  KIND_DOMAIN,
  ReportDialog,
  type PostDto,
  type ReportTarget,
  type ThreadDto,
} from "../../forum-shared";

/**
 * שרשור בפורום — השאלה, התשובות, והתגובה שלכם (docs/16).
 *
 * הסדר קבוע: השאלה למעלה עם הפעולות עליה (מעקב, מועיל, דיווח),
 * התשובה המקובלת ראשונה ומסומנת, השאר כרונולוגי, ותיבת התגובה
 * בסוף. כל טקסט של משתמש מוצג כטקסט (`white-space: pre-wrap`) —
 * אין כאן HTML ואין Markdown; מה שנכתב הוא מה שרואים.
 */
export default function ForumThreadPage() {
  const { loading: authLoading } = useRequireAuth();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [thread, setThread] = useState<ThreadDto | null>(null);
  const [failed, setFailed] = useState<"load" | "missing" | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [report, setReport] = useState<{ type: ReportTarget; id: string } | null>(null);
  const [deleting, setDeleting] = useState<{ kind: "thread" } | { kind: "post"; id: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setFailed(null);
    apiGet<ThreadDto>(`/forum/threads/${id}`)
      .then(setThread)
      .catch((err: unknown) => setFailed(err instanceof ApiError && err.status === 404 ? "missing" : "load"));
  }, [id]);

  useEffect(() => {
    if (authLoading) return;
    load();
  }, [authLoading, load]);

  if (authLoading) return null;

  async function act(work: () => Promise<void>, failure: string): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch (err: unknown) {
      setMessage({ tone: "danger", text: err instanceof ApiError ? err.message : failure });
    } finally {
      setBusy(false);
    }
  }

  async function vote(target: "thread" | "post", targetId: string): Promise<void> {
    await act(async () => {
      const res = await apiPost<{ score: number; voted: boolean }>(`/forum/votes/${target}/${targetId}`, {});
      setThread((prev) => {
        if (prev === null) return prev;
        if (target === "thread") return { ...prev, score: res.score, voted: res.voted };
        return { ...prev, posts: prev.posts.map((p) => (p.id === targetId ? { ...p, score: res.score, voted: res.voted } : p)) };
      });
    }, "הסימון לא נשמר");
  }

  async function follow(following: boolean): Promise<void> {
    await act(async () => {
      await apiPost(`/forum/threads/${id}/follow`, { following });
      setThread((prev) => (prev === null ? prev : { ...prev, following }));
      setMessage({
        tone: "success",
        text: following ? "✓ עוקבים — תגובות חדשות יגיעו לפעמון, למייל ולוואטסאפ לפי ההעדפות שלכם." : "הפסקתם לעקוב אחרי השרשור.",
      });
    }, "השינוי לא נשמר");
  }

  async function accept(postId: string): Promise<void> {
    await act(async () => setThread(await apiPost<ThreadDto>(`/forum/threads/${id}/accept/${postId}`, {})), "הסימון לא נשמר");
  }

  async function moderate(target: "thread" | "post", targetId: string, body: Record<string, boolean>): Promise<void> {
    await act(async () => {
      await apiPatch(`/forum/moderate/${target}/${targetId}`, body);
      load();
    }, "פעולת הניהול נכשלה");
  }

  async function remove(): Promise<void> {
    if (deleting === null) return;
    await act(async () => {
      if (deleting.kind === "thread") {
        await apiDelete(`/forum/threads/${id}`);
        router.replace("/forum");
        return;
      }
      await apiDelete(`/forum/posts/${deleting.id}`);
      setDeleting(null);
      load();
    }, "המחיקה נכשלה");
  }

  if (failed === "missing") {
    return (
      <div className="mv-page mx-auto max-w-3xl py-6">
        <div className="mv-card mv-card--pad text-center">
          <p className="m-0 font-bold">השרשור לא נמצא</p>
          <p className="m-0 mt-1" style={{ color: "var(--color-text-muted)" }}>ייתכן שנמחק או הוסר.</p>
          <Link href="/forum" className="mv-btn-plain mt-4 inline-flex no-underline">לפורום</Link>
        </div>
      </div>
    );
  }
  if (failed === "load") {
    return (
      <div className="mv-page mx-auto max-w-3xl py-6">
        <LoadError message="לא הצלחנו לטעון את השרשור" onRetry={load} />
      </div>
    );
  }
  if (thread === null) {
    return (
      <div className="mv-page mx-auto max-w-3xl py-6">
        <p aria-live="polite">טוען את השרשור…</p>
      </div>
    );
  }

  const acceptedIn = thread.posts.some((p) => p.accepted);

  return (
    // div ולא main — העטיפה של AppShell היא ה-main landmark היחיד
    <div className="mv-page mx-auto max-w-3xl py-6">
      <nav aria-label="ניווט משני" className="mb-3 text-[length:var(--type-caption-lg)]">
        <Link href="/forum" className="font-bold no-underline" style={{ color: "var(--color-primary)" }}>
          ← לפורום
        </Link>
      </nav>

      {thread.hidden ? <Notice tone="warning">השרשור מוסתר — רואים אותו רק מנהלי הפלטפורמה.</Notice> : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      <article className="mv-card mv-card--pad" aria-labelledby="thread-title">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`mv-pill ${KIND_DOMAIN[thread.kind]}`}>{FORUM_KIND_LABELS[thread.kind]}</span>
          <span className="mv-pill mv-domain-neutral">{FORUM_TOPIC_LABELS[thread.topic]}</span>
          {thread.pinned ? <span className="inline-flex items-center gap-1 text-[length:var(--type-caption)] font-bold" style={{ color: "var(--color-primary)" }}><IconPin s={13} /> נעוץ</span> : null}
          {thread.locked ? <span className="inline-flex items-center gap-1 text-[length:var(--type-caption)] font-bold" style={{ color: "var(--color-text-muted)" }}><IconLock s={13} /> נעול</span> : null}
          {thread.answered ? <span className="inline-flex items-center gap-1 text-[length:var(--type-caption)] font-bold" style={{ color: "var(--color-success)" }}><IconCheck s={13} /> נענתה</span> : null}
        </div>
        <h1 id="thread-title" className="m-0 mt-2 text-2xl font-extrabold leading-snug">{thread.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <AuthorBadge author={thread.author} />
          <time className="text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }} dateTime={thread.createdAt} title={formatDateTime(thread.createdAt)}>
            {timeAgo(thread.createdAt)}
          </time>
          {thread.editedAt ? <span className="text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>· נערך</span> : null}
          {thread.mine && thread.author.anonymous ? (
            <span className="inline-flex items-center gap-1 text-[length:var(--type-caption)] font-bold" style={{ color: "var(--color-primary)" }}>
              <IconEye s={13} /> השאלה שלכם — רק אתם יודעים
            </span>
          ) : null}
        </div>
        <p className="mv-forum-body mt-4">{thread.body}</p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" className="mv-btn-soft" aria-pressed={thread.voted} disabled={busy} onClick={() => void vote("thread", thread.id)}>
            <IconThumbUp s={15} /> מועיל · {thread.score}
          </button>
          <button type="button" className="mv-btn-plain" aria-pressed={thread.following} disabled={busy} onClick={() => void follow(!thread.following)}>
            <IconBell s={15} /> {thread.following ? "עוקב/ת" : "לעקוב"}
          </button>
          {thread.mine ? (
            <>
              <EditThread thread={thread} onSaved={setThread} />
              {thread.replyCount === 0 ? (
                <button type="button" className="mv-btn-plain mv-btn-plain--danger" onClick={() => setDeleting({ kind: "thread" })}>
                  <IconTrash s={15} /> למחוק
                </button>
              ) : null}
            </>
          ) : (
            <button type="button" className="mv-btn-plain" onClick={() => setReport({ type: "thread", id: thread.id })}>
              <IconWarning s={15} /> דיווח
            </button>
          )}
          {thread.canModerate ? (
            <span className="ms-auto flex flex-wrap gap-1.5">
              <button type="button" className="mv-btn-ghost" disabled={busy} onClick={() => void moderate("thread", thread.id, { pinned: !thread.pinned })}>{thread.pinned ? "לבטל נעיצה" : "לנעוץ"}</button>
              <button type="button" className="mv-btn-ghost" disabled={busy} onClick={() => void moderate("thread", thread.id, { locked: !thread.locked })}>{thread.locked ? "לפתוח" : "לנעול"}</button>
              <button type="button" className="mv-btn-ghost" disabled={busy} onClick={() => void moderate("thread", thread.id, { hidden: !thread.hidden })}>{thread.hidden ? "להחזיר" : "להסתיר"}</button>
            </span>
          ) : null}
        </div>
      </article>

      <section className="mt-6" aria-labelledby="replies-heading">
        <h2 id="replies-heading" className="mv-card-head__title m-0 mb-3">
          {thread.posts.length === 0 ? "עדיין אין תגובות" : `${thread.posts.length} תגובות`}
        </h2>
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {thread.posts.map((post) => (
            <li key={post.id} className={`mv-forum-post${post.accepted ? " mv-forum-post--accepted" : ""}${post.hidden ? " mv-forum-post--hidden" : ""}`}>
              {post.accepted ? (
                <p className="m-0 mb-2 inline-flex items-center gap-1.5 text-[length:var(--type-caption-lg)] font-extrabold" style={{ color: "var(--color-success)" }}>
                  <IconCheck s={15} /> התשובה שהשואל/ת סימן/ה
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <AuthorBadge author={post.author} />
                <time className="text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }} dateTime={post.createdAt} title={formatDateTime(post.createdAt)}>
                  {timeAgo(post.createdAt)}
                </time>
                {post.editedAt ? <span className="text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>· נערך</span> : null}
                {post.hidden ? <span className="text-[length:var(--type-caption)] font-bold" style={{ color: "var(--color-danger)" }}>מוסתר</span> : null}
              </div>
              <PostBody post={post} onSaved={(updated) => setThread((prev) => prev === null ? prev : { ...prev, posts: prev.posts.map((p) => (p.id === updated.id ? updated : p)) })} />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" className="mv-btn-soft" aria-pressed={post.voted} disabled={busy} onClick={() => void vote("post", post.id)}>
                  <IconThumbUp s={15} /> מועיל · {post.score}
                </button>
                {thread.mine && thread.kind === "question" && (!acceptedIn || post.accepted) ? (
                  <button type="button" className="mv-btn-plain" disabled={busy} onClick={() => void accept(post.id)}>
                    <IconCheck s={15} /> {post.accepted ? "לבטל את הסימון" : "זו התשובה"}
                  </button>
                ) : null}
                {post.mine ? (
                  <button type="button" className="mv-btn-plain mv-btn-plain--danger" onClick={() => setDeleting({ kind: "post", id: post.id })}>
                    <IconTrash s={15} /> למחוק
                  </button>
                ) : (
                  <button type="button" className="mv-btn-plain" onClick={() => setReport({ type: "post", id: post.id })}>
                    <IconWarning s={15} /> דיווח
                  </button>
                )}
                {thread.canModerate ? (
                  <button type="button" className="mv-btn-ghost ms-auto" disabled={busy} onClick={() => void moderate("post", post.id, { hidden: !post.hidden })}>
                    {post.hidden ? "להחזיר" : "להסתיר"}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {thread.locked ? (
        <p className="mt-6 text-center" style={{ color: "var(--color-text-muted)" }}>השרשור נעול — אי אפשר להוסיף תגובות.</p>
      ) : (
        <ReplyComposer threadId={thread.id} onPosted={load} />
      )}

      <ReportDialog target={report} onClose={() => setReport(null)} />
      <ConfirmDialog
        open={deleting !== null}
        title={deleting?.kind === "thread" ? "למחוק את השרשור?" : "למחוק את התגובה?"}
        tone="danger"
        confirmLabel="למחוק"
        busy={busy}
        busyLabel="מוחק…"
        onConfirm={() => void remove()}
        onClose={() => setDeleting(null)}
      >
        <p className="m-0">המחיקה סופית ואינה ניתנת לשחזור.</p>
      </ConfirmDialog>
    </div>
  );
}

/* ---------- עריכה במקום ---------- */

function EditThread({ thread, onSaved }: { thread: ThreadDto; onSaved: (t: ThreadDto) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(thread.title);
  const [body, setBody] = useState(thread.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      onSaved(await apiPatch<ThreadDto>(`/forum/threads/${thread.id}`, { title: title.trim(), body: body.trim() }));
      setOpen(false);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="mv-btn-plain" onClick={() => setOpen(true)}>
        <IconEdit s={15} /> לערוך
      </button>
      <ConfirmDialog open={open} title="עריכת השרשור" confirmLabel="לשמור" busy={busy} busyLabel="שומר…" onConfirm={() => void save()} onClose={() => setOpen(false)}>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[length:var(--type-caption)] font-semibold">
            כותרת
            <input className="mv-control" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-[length:var(--type-caption)] font-semibold">
            תוכן
            <textarea className="mv-field" rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
          {error ? <Notice tone="danger">{error}</Notice> : null}
        </div>
      </ConfirmDialog>
    </>
  );
}

function PostBody({ post, onSaved }: { post: PostDto; onSaved: (p: PostDto) => void }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(post.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      onSaved(await apiPatch<PostDto>(`/forum/posts/${post.id}`, { body: body.trim() }));
      setEditing(false);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <>
        <p className="mv-forum-body mt-2">{post.body}</p>
        {post.mine ? (
          <button type="button" className="mv-btn-plain mt-2" onClick={() => setEditing(true)}>
            <IconEdit s={14} /> לערוך
          </button>
        ) : null}
      </>
    );
  }
  return (
    <div className="mt-2 flex flex-col gap-2">
      <textarea className="mv-field" rows={5} value={body} maxLength={FORUM_REPLY_MAX} onChange={(e) => setBody(e.target.value)} aria-label="עריכת התגובה" />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="flex gap-2">
        <button type="button" className="mv-btn-primary" disabled={busy} onClick={() => void save()}>{busy ? "שומר…" : "לשמור"}</button>
        <button type="button" className="mv-btn-plain" onClick={() => { setBody(post.body); setEditing(false); }}>ביטול</button>
      </div>
    </div>
  );
}

/* ---------- תגובה ---------- */

function ReplyComposer({ threadId, onPosted }: { threadId: string; onPosted: () => void }) {
  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    const parsed = ForumReplyInputSchema.safeParse({ body, anonymous });
    if (!parsed.success) {
      setError("כתבו תגובה — לפחות שתי מילים, ועד 6,000 תווים.");
      return;
    }
    setBusy(true);
    try {
      await apiPost(`/forum/threads/${threadId}/replies`, parsed.data);
      setBody("");
      onPosted();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "התגובה לא פורסמה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mv-card mv-card--pad mt-6" onSubmit={(e) => void post(e)} noValidate aria-labelledby="reply-heading">
      <h2 id="reply-heading" className="mv-card-head__title m-0 mb-3">התגובה שלכם</h2>
      <textarea
        className="mv-field"
        rows={5}
        value={body}
        maxLength={FORUM_REPLY_MAX}
        placeholder="מה הייתם עושים? מה עבד לכם? — מניסיון, לא מהספר."
        onChange={(e) => setBody(e.target.value)}
        aria-label="תוכן התגובה"
        required
      />
      <label className="mv-forum-anon mt-3">
        <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
        <span>
          <span className="inline-flex items-center gap-1.5 font-bold"><IconEye s={15} /> להגיב בעילום שם</span>
          <span className="mv-forum-anon__hint">השם והמשרד אינם נשמרים. בשרשור תופיעו כ„אנונימי” ממוספר.</span>
        </span>
      </label>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="submit" className="mv-btn-primary" disabled={busy}>{busy ? "מפרסם…" : "לפרסם תגובה"}</button>
        <span className="text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
          מי שמגיב עוקב אחרי השרשור מעצמו — אפשר להפסיק בלחיצה על הפעמון.
        </span>
      </div>
    </form>
  );
}
