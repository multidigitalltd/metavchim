"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "@metavchim/ui";
import { API_BASE, ApiError, apiDelete, apiGet, apiPost } from "@/lib/api";
import { waMeUrl } from "@/lib/format";
import { useUserDismissed } from "@/lib/dismissed-panels";
import {
  CALL_OUTCOME_LABELS,
  recordingStateLabel,
  type RecordingStatus,
} from "@metavchim/shared";
import { can, useRequireAuth } from "@/lib/use-auth";
import { useFeature } from "@/lib/use-features";
import { FilterBar, SearchField, textMatches } from "../list-controls";
import { DictateFor } from "../dictation-field";
import { IconClock, IconDoc, IconMic, IconRefresh, IconX } from "../icons";
import { TelephonyPitch } from "./telephony-pitch";
import { Notice } from "../notice";

/**
 * יומן שיחות — תיעוד ידני של שיחות שהמתווך קיים.
 *
 * למה ידני: הקלטת שיחות ותמלולן דורשות חיבור לספק טלפוניה שאינו
 * קיים. המסך והמודל בנויים כך שכשייכנס ספק, שיחות אוטומטיות יופיעו
 * כאן לצד הידניות בלי מסך שני.
 */

interface CallRow {
  id: string;
  direction: "inbound" | "outbound";
  source: string;
  contactName?: string;
  leadId?: string;
  phone?: string;
  occurredAt: string;
  durationMinutes?: number;
  outcome: string;
  summary?: string;
  /** pending | running | done | failed | unavailable — חסר = לא הועלתה הקלטה. */
  transcriptionStatus?: string;
  transcript?: string;
  /** יש קובץ להשמעה — לא נגזר מסטטוס התמלול, ראו ה-DTO בשרת. */
  hasRecording?: boolean;
  /** למה אין — „אין בכלל”, „בדרך”, או „נכשלה” עם הסיבה. */
  recording?: RecordingStatus;
}

/* התוויות משותפות עם הכרטיס שהשרת כותב לוואטסאפ — מקור אחד. */
const OUTCOME_LABELS = CALL_OUTCOME_LABELS;

const FILTERS: [string, string][] = [
  ["", "הכול"],
  ["answered", "נענו"],
  ["missed", "לא נענו"],
  ["no_answer", "אין מענה"],
];

const inputStyle = { borderColor: "var(--color-input-border)", background: "var(--color-field)" } as const;

/** ערך ברירת מחדל לשדה datetime-local — "עכשיו" בשעון המקומי. */
function nowLocal(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

const timeFmt = new Intl.DateTimeFormat("he-IL", {
  day: "numeric",
  month: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export default function CallsPage() {
  const { user, loading: authLoading } = useRequireAuth();
  /*
   * הצפייה ביומן נפתחה גם לקונים, אבל כל נתיבי הכתיבה של השיחה
   * דורשים `leads.edit`. בלי הבדיקה הזו מי שרואה את המסך היה מקבל
   * „תעד שיחה”, מחיקה, העלאת הקלטה ותמלול חוזר — וכל אחד מהם היה
   * נכשל ב-403 (ביקורת Codex). מסך שמציג כפתור שייכשל הוא הבטחה
   * שבורה.
   */
  const mayEdit = can(user, "leads.edit");
  const [items, setItems] = useState<CallRow[] | null>(null);
  const [outcome, setOutcome] = useState("");
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState("");
  const [selected, setSelected] = useState<CallRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * הבאנר למי שטרם חיבר מרכזיה (בקשת המשתמש): מה מפסידים בלי
   * החיבור. מוצג רק כשבאמת אין חיבור — משרד מחובר לא צריך פרסומת
   * למה שכבר יש לו — וניתן לסגירה כמו שאר פאנלי העזרה.
   */
  const [pbxConnected, setPbxConnected] = useState<boolean | null>(null);
  const pbxPitch = useUserDismissed("calls-pbx-pitch");
  /** האם המרכזייה בכלל כלולה במסלול — ראו הקישור שב-`TelephonyPitch`. */
  const hasTelephony = useFeature("telephony");

  /*
   * השיחה שהכתובת מבקשת — `?call=<id>`.
   *
   * ההתראה על סיום תמלול מצביעה על שיחה מסוימת, ובלי הפרמטר הזה
   * היא הייתה נוחתת על הרשימה עם השיחה האחרונה מסומנת: הודעה
   * שמובילה למקום הנכון בערך, וזה גרוע מלא להוביל.
   *
   * נקרא פעם אחת בטעינה ולא בכל רינדור: מרגע שהמשתמש בחר שיחה
   * אחרת, הכתובת אינה אמורה למשוך אותו בחזרה.
   */
  const requestedIdRef = useRef<string | null>(
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("call"),
  );

  function load(current = outcome): void {
    const query = current ? `?outcome=${current}` : "";
    apiGet<CallRow[]>(`/calls${query}`)
      .then((rows) => {
        setItems(rows);
        const requested = requestedIdRef.current;
        setSelected((prev) => {
          if (requested !== null) {
            const match = rows.find((r) => r.id === requested);
            if (match) {
              // נצרך פעם אחת; אחרי זה הבחירה של המשתמש היא הקובעת
              requestedIdRef.current = null;
              return match;
            }
            /*
             * השיחה המבוקשת אינה בעמוד — נשלפת בנפרד למטה. עד אז
             * לא בוחרים כלום: נפילה לשיחה החדשה הייתה פותחת שיחה
             * של לקוח אחר לגמרי, וזה גרוע מלא לפתוח דבר.
             */
            return prev;
          }
          return rows.find((r) => r.id === prev?.id) ?? rows[0] ?? null;
        });
        if (requested !== null && !rows.some((r) => r.id === requested)) {
          /*
           * דרך נתיב הרשימה עם `?id=`, ולא נתיב חדש: אותו סינון
           * בעלות בדיוק חל עליה, ואין שער שני שאפשר לשכוח לעדכן.
           */
          apiGet<CallRow[]>(`/calls?id=${encodeURIComponent(requested)}`)
            .then((found) => {
              requestedIdRef.current = null;
              setSelected((prev) => found[0] ?? prev ?? rows[0] ?? null);
            })
            .catch(() => {
              requestedIdRef.current = null;
              setSelected((prev) => prev ?? rows[0] ?? null);
            });
        }
      })
      .catch(() => setError("טעינת השיחות נכשלה"));
  }

  useEffect(() => {
    if (!authLoading) load(outcome);
  }, [authLoading, outcome]);

  useEffect(() => {
    if (authLoading) return;
    apiGet<{ connected: boolean }>("/telephony/presence")
      .then((res) => setPbxConnected(res.connected))
      /*
       * תקלה משאירה `null` — „לא ידוע”, ולכן אין באנר.
       *
       * קודם נכתב כאן `setPbxConnected(true)`, שגם הוא השתיק את
       * הבאנר אבל אמר משהו אחר לגמרי: „המשרד מחובר”. זו טענה על
       * מצב שלא נבדק, והיא זו שהפכה 404 בכתובת שגויה להשתקה
       * שקטה במקום לתקלה שמישהו שם לב אליה.
       */
      .catch(() => undefined);
  }, [authLoading]);

  async function onAdd(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const duration = String(form.get("durationMinutes")).trim();
    const phone = String(form.get("phone")).trim();
    const summary = String(form.get("summary")).trim();
    try {
      await apiPost("/calls", {
        direction: String(form.get("direction")),
        outcome: String(form.get("outcome")),
        occurredAt: new Date(String(form.get("occurredAt"))).toISOString(),
        ...(phone ? { phone } : {}),
        ...(duration ? { durationMinutes: Number(duration) } : {}),
        ...(summary ? { summary } : {}),
      });
      setAdding(false);
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שמירת השיחה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  /* סינון מקומי: חיפוש בשם, בטלפון ובסיכום — סיכום השיחה הוא בדיוק
     המקום שבו המתווך זוכר "מישהו שאל על נכס בהרצל" */
  const visible = (items ?? []).filter(
    (c) =>
      textMatches(query, c.contactName, c.phone, c.summary) &&
      (direction === "" || c.direction === direction),
  );
  const filtering = query.trim() !== "" || direction !== "" || outcome !== "";

  async function onDelete(id: string): Promise<void> {
    if (!window.confirm("למחוק את תיעוד השיחה?")) return;
    await apiDelete(`/calls/${id}`);
    load();
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="m-0" style={{ fontSize: 22, fontWeight: 800 }}>
          שיחות
        </h1>
        {mayEdit ? (
          <button type="button" className="mv-btn-action ms-auto" onClick={() => setAdding((v) => !v)}>
            {adding ? "ביטול" : "+ תעד שיחה"}
          </button>
        ) : null}
      </div>

      {/*
        משרד בלי מרכזיה רואה קודם כול מה קורה כשהיא מחוברת — מסך
        ולא פסקה (בקשת המשתמש). רשימת השיחות נשארת מתחתיו: תיעוד
        ידני עובד גם בלי חיבור, ואין סיבה לקחת אותו ממי שמשתמש בו.
      */}
      {pbxConnected === false && !pbxPitch.hidden ? (
        <div className="relative mb-4">
          {/*
            שני התנאים, ולא רק ההרשאה: משרד שעבר למסלול בלי מרכזייה
            רואה במסך ההגדרות `LockedFeature` במקום סעיף החיבור,
            ונתיבי החיבור עצמם חסומים ב-`@RequireFeature("telephony")`.
            קישור „כבר יש לי מרכזיה” היה מוביל אותו למסך שאומר לו
            שהמודול אינו במסלול — הזמנה לפעולה שאי אפשר לבצע.
            „להצטרפות לשירות” נשאר לו, וזה בדיוק המסלול הנכון עבורו.
          */}
          <TelephonyPitch
            canOpenSettings={can(user, "settings.manage") && hasTelephony}
          />
          <div className="mv-pitch-dismiss">
            <button type="button" onClick={pbxPitch.never}>
              אל תציג יותר
            </button>
            <button type="button" aria-label="סגירת ההסבר על חיבור מרכזיה" onClick={pbxPitch.close}>
              <IconX s={16} />
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <Notice tone="danger">{error}</Notice>
      ) : null}

      {adding ? (
        <form
          onSubmit={(event) => void onAdd(event)}
          className="mb-5 rounded-xl border p-4"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className="mb-1 block font-medium">כיוון</span>
              <select name="direction" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle}>
                <option value="inbound">שיחה נכנסת</option>
                <option value="outbound">שיחה יוצאת</option>
              </select>
            </label>
            <label>
              <span className="mb-1 block font-medium">תוצאה</span>
              <select name="outcome" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle}>
                {Object.entries(OUTCOME_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-1 block font-medium">מתי</span>
              <input
                type="datetime-local"
                name="occurredAt"
                required
                defaultValue={nowLocal()}
                className="w-full rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
            </label>
            <label>
              <span className="mb-1 block font-medium">טלפון</span>
              <input
                name="phone"
                dir="ltr"
                inputMode="tel"
                className="w-full rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
            </label>
            <label>
              <span className="mb-1 block font-medium">משך (דקות)</span>
              <input
                name="durationMinutes"
                type="number"
                min={0}
                max={600}
                className="w-full rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
            </label>
          </div>
          <label className="mt-3 block">
            <span className="mb-1 block font-medium">סיכום השיחה</span>
            <textarea
              id="callSummary"
              name="summary"
              rows={3}
              placeholder="מה סוכם, מה הלקוח מחפש, מה הצעד הבא"
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </label>
          <DictateFor targetId="callSummary" />
          <div className="mt-3">
            <Button type="submit" disabled={busy}>
              {busy ? "שומר…" : "שמור שיחה"}
            </Button>
          </div>
        </form>
      ) : null}

      <div className="mb-[18px] flex flex-wrap items-center gap-2.5">
        {FILTERS.map(([value, label]) => (
          <button
            key={value || "all"}
            type="button"
            className="mv-chip"
            aria-pressed={outcome === value}
            onClick={() => setOutcome(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {items !== null && items.length > 0 ? (
        <FilterBar
          shown={visible.length}
          total={items.length}
          noun="שיחות"
          active={filtering}
          onClear={() => {
            setQuery("");
            setDirection("");
            setOutcome("");
          }}
        >
          <SearchField
            label="חיפוש שיחה"
            placeholder="שם, טלפון או מה נאמר בשיחה"
            value={query}
            onChange={setQuery}
          />
          <label className="flex items-center gap-1.5 text-sm">
            <span className="mv-visually-hidden">סינון לפי כיוון</span>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              className="rounded-lg border px-2 py-1.5"
              style={{ borderColor: "var(--color-input-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
            >
              <option value="">נכנסות ויוצאות</option>
              <option value="inbound">נכנסות</option>
              <option value="outbound">יוצאות</option>
            </select>
          </label>
        </FilterBar>
      ) : null}

      {items === null ? (
        <p aria-live="polite">טוען שיחות…</p>
      ) : items.length === 0 ? (
        <div
          className="rounded-xl border p-8 text-center"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <p className="mb-2 text-lg font-semibold">אין שיחות מתועדות</p>
          <p style={{ color: "var(--color-text-muted)" }}>
            תיעוד שיחה לוקח 20 שניות ושומר את ההקשר לפעם הבאה שתדברו עם הלקוח.
          </p>
        </div>
      ) : (
        /* שני חלוניות כמו בעיצוב: רשימה מימין, פרטים משמאל */
        <div className="grid gap-4 lg:grid-cols-[330px_1fr] lg:items-start">
          <ul className="mv-list-card">
            {visible.map((call) => {
              const active = selected?.id === call.id;
              return (
                <li key={call.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(call)}
                    aria-current={active ? "true" : undefined}
                    className="flex w-full items-center gap-3 px-4 py-[13px] text-start"
                    style={{
                      border: "none",
                      borderBottom: "1px solid var(--color-row-border)",
                      background: active ? "var(--color-row-hover)" : "transparent",
                      cursor: "pointer",
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-2.5 flex-none rounded-full"
                      style={{ background: call.outcome === "answered" ? "#12A150" : "#b0512c" }}
                    />
                    <span className="min-w-0" style={{ lineHeight: 1.35 }}>
                      <span className="block truncate text-[15.5px] font-bold">
                        {call.contactName ?? call.phone ?? "לא מזוהה"}
                      </span>
                      <span className="block text-[14px]" style={{ color: "var(--color-text-muted)" }}>
                        {call.direction === "inbound" ? "נכנסת" : "יוצאת"} ·{" "}
                        {timeFmt.format(new Date(call.occurredAt))}
                      </span>
                    </span>
                    <span className="ms-auto flex-none text-start" style={{ lineHeight: 1.4 }}>
                      <span
                        className="mv-pill block"
                        style={{
                          fontSize: 14,
                          padding: "2px 10px",
                          color: call.outcome === "answered" ? "#0C6E34" : "#b0512c",
                          background: call.outcome === "answered" ? "#E5FCEA" : "#faf1ec",
                        }}
                      >
                        {OUTCOME_LABELS[call.outcome] ?? call.outcome}
                      </span>
                      {call.durationMinutes !== undefined ? (
                        <span className="mt-[3px] block text-[14px]" style={{ color: "var(--color-text-muted)" }}>
                          {call.durationMinutes} דק׳
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {selected ? (
            <section aria-label="פרטי השיחה" className="mv-list-card">
              <div
                className="flex flex-wrap items-center gap-3 px-[22px] py-4"
                style={{ borderBottom: "1px solid var(--color-card-head-border)" }}
              >
                <div style={{ lineHeight: 1.35 }}>
                  <h2 className="m-0" style={{ fontSize: 18, fontWeight: 800 }}>
                    {selected.contactName ?? selected.phone ?? "לא מזוהה"}
                  </h2>
                  <p className="m-0 text-[14.5px]" style={{ color: "var(--color-text-muted)" }}>
                    {selected.phone ? <span dir="ltr">{selected.phone} · </span> : null}
                    {selected.direction === "inbound" ? "שיחה נכנסת" : "שיחה יוצאת"} ·{" "}
                    {timeFmt.format(new Date(selected.occurredAt))}
                    {selected.durationMinutes !== undefined ? ` · משך ${selected.durationMinutes} דק׳` : ""}
                  </p>
                </div>
                {selected.phone ? (
                  <div className="ms-auto flex gap-2">
                    <a
                      href={waMeUrl(selected.phone)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mv-btn-plain"
                      style={{ padding: "7px 14px", fontSize: 14.5 }}
                    >
                      וואטסאפ
                    </a>
                    <a href={`tel:${selected.phone}`} className="mv-btn-plain" style={{ padding: "7px 14px", fontSize: 14.5 }}>
                      חייג
                    </a>
                  </div>
                ) : null}
              </div>

              <div className="px-[22px] py-5">
                <p className="mb-2.5 mt-0 text-[14.5px] font-extrabold" style={{ color: "var(--color-text-muted)" }}>
                  סיכום השיחה
                </p>
                <div
                  className="whitespace-pre-wrap rounded-[13px] border p-3.5 text-sm"
                  style={{ background: "var(--color-field)", borderColor: "var(--color-border)", lineHeight: 1.55 }}
                >
                  {selected.summary ?? (
                    <span style={{ color: "var(--color-text-muted)" }}>לא נרשם סיכום.</span>
                  )}
                </div>

                <CallRecording call={selected} onChanged={load} mayEdit={mayEdit} />

                <div className="mt-4 flex flex-wrap gap-3">
                  {selected.leadId ? (
                    <Link href={`/leads/${selected.leadId}`} className="mv-btn-soft">
                      לכרטיס הליד
                    </Link>
                  ) : null}
                  {mayEdit ? (
                    <button
                      type="button"
                      onClick={() => void onDelete(selected.id)}
                      className="mv-btn-plain"
                      style={{ color: "var(--color-danger)" }}
                    >
                      מחק תיעוד
                    </button>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}
        </div>
      )}
    </>
  );
}

/**
 * הקלטת השיחה: העלאה, מצב התמלול, והתמלול המלא.
 *
 * ההקלטה **נשמרת** ואינה נמחקת אחרי התמלול — בניגוד להקלטת הכתבה
 * או הוראה קולית, שהיא אמצעי חד-פעמי. שיחה עם לקוח היא תיעוד של
 * הקשר, ומתווך שחוזר אליה בעוד חודש רוצה לשמוע מה נאמר ולא רק
 * לקרוא סיכום. מדיניות הפרטיות אומרת את ההבחנה הזו במפורש.
 */
function CallRecording({
  call,
  onChanged,
  /** הנגן והתמלול הם צפייה ונשארים; ההעלאה והתמלול-החוזר הם כתיבה. */
  mayEdit,
}: {
  call: CallRow;
  onChanged: () => void;
  mayEdit: boolean;
}) {
  const canTranscribe = useFeature("transcription");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFull, setShowFull] = useState(false);

  async function upload(file: File): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API_BASE}/calls/${call.id}/recording`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!res.ok) throw new Error("upload failed");
      onChanged();
    } catch {
      setError("העלאת ההקלטה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  /*
   * ניסיון תמלול נוסף — השרת מאפס ל-pending והעובד אוסף מחדש.
   * ‎onChanged()‎ מרענן את הרשימה, והמסך עובר ל"ממתין לתמלול".
   */
  async function retryTranscription(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/calls/${call.id}/transcription/retry`, {});
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הפעלת התמלול מחדש נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function retryRecording(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ queued: boolean }>(`/calls/${call.id}/recording/retry`, {});
      if (!res.queued) setError("אין מה למשוך — לשיחה אין נתיב הקלטה מהמרכזייה");
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הבקשה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  const status = call.transcriptionStatus;
  /*
   * ברירת המחדל היא „אין”, כדי ששרת ישן שאינו שולח את השדה יציג
   * בדיוק את מה שהוצג עד היום ולא ייפול.
   */
  const recording = call.recording ?? { state: "none" as const };

  /*
   * בלי הפיצ'ר **ובלי הקלטה** אין טעם בסעיף. הקלטה שכבר נמשכה
   * מהמרכזייה נשמעת גם כשהתמלול כבוי — היא הראיה למה שנאמר, וזה
   * ערך בפני עצמו שאינו תלוי בתמלול.
   */
  if (
    !canTranscribe &&
    status === undefined &&
    call.hasRecording !== true &&
    // „בדרך” ו„נכשלה” הם בדיוק המצבים שבגללם הסעיף נכתב — הסתרתם
    // הייתה מחזירה את המסך למצב שבו שלושה מצבים נראים כאחד
    (call.recording?.state ?? "none") === "none"
  ) {
    return null;
  }

  return (
    <div className="mt-4">
      <p className="mb-2 mt-0 text-[14.5px] font-extrabold" style={{ color: "var(--color-text-muted)" }}>
        הקלטת השיחה
      </p>

      {/*
        הנגן ראשון, לפני מצב התמלול: מי שפותח את הסעיף רוצה בדרך
        כלל לשמוע, לא לקרוא סטטוס.

        ‎`preload="none"`‎ — רשימה של עשרים שיחות לא תמשוך עשרים
        קבצי אודיו בטעינת המסך; המשיכה מתחילה בלחיצה על נגן.

        בלי `crossOrigin`, בדיוק כמו הלוגו של המשרד: ה-API יושב
        בתת-דומיין של אותו אתר, ולכן העוגייה נשלחת תחת `SameSite=Lax`.
        ‎`use-credentials`‎ היה מוסיף דרישת CORS מלאה על בקשת מדיה
        שכבר עובדת.
      */}
      {call.hasRecording === true ? (
        <audio
          controls
          preload="none"
          className="mb-2 w-full"
          src={`${API_BASE}/calls/${call.id}/recording`}
        >
          הדפדפן שלכם אינו תומך בהשמעת אודיו.
        </audio>
      ) : null}

      {/*
        מצב המשיכה מהמרכזייה — מעל הכול, כי הוא התשובה לשאלה
        „למה אין הקלטה”. עד היום כל שלושת המצבים הופיעו כמשפט
        אחד, „לא צורפה הקלטה”, והמתווך לא יכול היה לדעת אם להמתין,
        לתקן הגדרה, או לפנות לספק.
      */}
      {recording.state === "pending" ||
      recording.state === "retrying" ||
      recording.state === "failed" ? (
        <div className="mb-2">
          <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
            {recordingStateLabel(recording)}
          </p>
          {recording.state !== "pending" && mayEdit ? (
            <button
              type="button"
              className="mv-btn-plain mt-2"
              disabled={busy}
              onClick={() => void retryRecording()}
            >
              {busy ? "שולח…" : <><IconRefresh s={15} /> נסו למשוך שוב</>}
            </button>
          ) : null}
        </div>
      ) : null}

      {status === undefined && !mayEdit ? (
        recording.state === "none" ? (
          <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
            לא צורפה הקלטה לשיחה הזו.
          </p>
        ) : null
      ) : status === undefined ? (
        <label className="mv-btn-plain inline-block cursor-pointer">
          {busy ? "מעלה…" : <><IconMic s={15} /> צרף הקלטה</>}
          <input
            type="file"
            accept="audio/*"
            className="mv-visually-hidden"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
        </label>
      ) : status === "unavailable" ? (
        <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
          ההקלטה נשמרה. שירות התמלול אינו מופעל בשרת — ראו docs/10.
        </p>
      ) : status === "pending" || status === "running" ? (
        <p className="m-0 text-sm" aria-live="polite" style={{ color: "var(--color-text-muted)" }}>
          <IconClock s={15} /> ההקלטה נשמרה וממתינה לתמלול. זה לוקח כמה דקות — אפשר לעזוב את המסך.
        </p>
      ) : status === "failed" ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="m-0 text-sm" style={{ color: "var(--color-danger)" }}>
            התמלול נכשל. ההקלטה עצמה נשמרה ולא אבדה.
          </p>
          {/* כשל תמלול הוא לרוב זמני — ניסיון נוסף במקום העלאה מחדש */}
          {mayEdit ? (
            <button
              type="button"
              className="mv-btn-plain"
              disabled={busy}
              onClick={() => void retryTranscription()}
            >
              {busy ? "שולח…" : <><IconRefresh s={15} /> נסו תמלול שוב</>}
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <button
            type="button"
            className="mv-btn-plain"
            aria-expanded={showFull}
            onClick={() => setShowFull((v) => !v)}
          >
            {showFull ? "הסתר תמלול מלא" : <><IconDoc s={15} /> הצג תמלול מלא</>}
          </button>
          {showFull ? (
            <div
              className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-[13px] border p-3.5 text-sm"
              style={{ background: "var(--color-field)", borderColor: "var(--color-border)", lineHeight: 1.6 }}
            >
              {call.transcript}
            </div>
          ) : null}
        </>
      )}

      {error ? (
        <Notice tone="danger">{error}</Notice>
      ) : null}
    </div>
  );
}
