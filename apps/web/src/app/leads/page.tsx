"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@metavchim/ui";
import { compareLeadsByUrgency, leadWaiting, type LeadWaitingLevel } from "@metavchim/shared";
import { apiGet } from "@/lib/api";
import { waMeUrl } from "@/lib/format";
import { LEAD_INTENT_LABELS, LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS } from "@/lib/lead-labels";
import { useRequireAuth } from "@/lib/use-auth";
import { useFeature } from "@/lib/use-features";
import { IconMic } from "../icons";
import { CapNote, FilterBar, FilterSelect, SearchField, textMatches,
  useFilterFromUrl,
} from "../list-controls";

/**
 * מסך הלידים לפי קובץ העיצוב: טבלת grid עם תג "דחוף", זמן המתנה
 * צבעוני, גלולת סטטוס ופעולות ישירות בשורה — חייג / וואטסאפ /
 * המר לקונה. למטה: תיבת קוד ההטמעה לטופס האתר.
 */

interface LeadRow {
  id: string;
  contact: { name: string; phone: string };
  source: string;
  intent: string;
  status: string;
  requiresHuman: boolean;
  createdAt: string;
}

/* צבעי זמן ההמתנה מהעיצוב; הענבר מועמק ל-AA (docs/06 §4) */
const WAITING_COLOR: Record<LeadWaitingLevel, string> = {
  ok: "var(--color-text-muted)",
  warn: "#8a6414",
  late: "#b0512c",
};

/* גלולת הסטטוס — אותה משפחת צבעים כמו בעיצוב */
const STATUS_PILL: Record<string, { fg: string; bg: string }> = {
  new: { fg: "#0C6E34", bg: "#E5FCEA" },
  in_progress: { fg: "#7a5c1f", bg: "#f7efdd" },
  converted: { fg: "#3F4742", bg: "#EDEFED" },
  closed: { fg: "#68716a", bg: "#eef1ec" },
};

const GRID = "1.4fr 1fr 1.6fr 1fr 0.9fr 1.3fr";

export default function LeadsPage() {
  const { loading: authLoading } = useRequireAuth();
  const canVoice = useFeature("voice_intake");
  const router = useRouter();
  const [items, setItems] = useState<LeadRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [urgency, setUrgency] = useState("");
  const [intent, setIntent] = useState("");

  // קישורי המשפך מהדשבורד: /leads?status=new וכדומה
  useFilterFromUrl({ status: setStatus, intent: setIntent });
  // שעון קפוא לרינדור — כדי שכל השורות ימדדו מול אותו רגע
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    if (authLoading) return;
    apiGet<{ items: LeadRow[] }>("/leads?limit=100")
      .then((res) => {
        setItems([...res.items].sort(compareLeadsByUrgency));
        setNow(new Date());
      })
      .catch(() => setError("טעינת הלידים נכשלה"));
  }, [authLoading]);

  const visible = useMemo(
    () =>
      (items ?? []).filter(
        (l) =>
          textMatches(query, l.contact.name, l.contact.phone) &&
          (!status || l.status === status) &&
          (!intent || l.intent === intent) &&
          // "מי מחכה יותר מדי" — הסינון שמייצר את שיחת הטלפון הבאה
          (urgency === "" ||
            (urgency === "human" && l.requiresHuman) ||
            (urgency === "late" &&
              now !== null &&
              leadWaiting(l.createdAt, l.status, now)?.level === "late")),
      ),
    [items, query, status, intent, urgency, now],
  );

  /*
   * "המר לקונה" מהשורה מוביל לטופס ההמרה בכרטיס הליד: ההמרה דורשת
   * דרישות חיפוש (תקציב, ערים) שאין ברשימה — פעולה עיוורת הייתה נכשלת.
   */
  function convert(lead: LeadRow): void {
    router.push(`/leads/${lead.id}#convert`);
  }

  return (
    <>
      <div className="mb-[18px] flex flex-wrap items-center gap-3">
        <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
          לידים מטופס האתר נכנסים לכאן אוטומטית, בלי העתקה ידנית.
        </p>
        <div className="ms-auto flex flex-wrap gap-2.5">
          {canVoice ? (
            <Link href="/leads/voice" className="mv-btn-plain" style={{ padding: "8px 14px", fontSize: "13.5px" }}>
              <IconMic s={15} /> ליד בקול
            </Link>
          ) : null}
          <Link href="/leads/new" className="mv-btn-action">
            + ליד ידני
          </Link>
        </div>
      </div>

      {error ? (
        <p role="alert" style={{ color: "var(--color-danger)" }}>{error}</p>
      ) : items === null ? (
        <p aria-live="polite">טוען לידים…</p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border p-8 text-center" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
          <p className="mb-3 text-lg font-semibold">אין לידים פתוחים</p>
          <p className="mb-4" style={{ color: "var(--color-text-muted)" }}>
            אפשר להוסיף ליד ידנית או בקול — וגם לחבר את טופס יצירת הקשר
            שבאתר המשרד, כך שכל פנייה תיכנס לכאן אוטומטית.
          </p>
          <Link href="/settings">
            <Button variant="secondary">חיבור לידים מהאתר</Button>
          </Link>
        </div>
      ) : (
        <>
          <FilterBar
            shown={visible.length}
            total={items.length}
            noun="לידים"
            active={query.trim() !== "" || status !== "" || intent !== "" || urgency !== ""}
            onClear={() => {
              setQuery("");
              setStatus("");
              setIntent("");
              setUrgency("");
            }}
          >
            <SearchField
              label="חיפוש ליד"
              placeholder="שם או טלפון"
              value={query}
              onChange={setQuery}
            />
            <FilterSelect
              label="סינון לפי סטטוס"
              value={status}
              onChange={setStatus}
              allLabel="כל הסטטוסים"
              options={Object.entries(LEAD_STATUS_LABELS)}
            />
            <FilterSelect
              label="סינון לפי כוונה"
              value={intent}
              onChange={setIntent}
              allLabel="כל הכוונות"
              options={Object.entries(LEAD_INTENT_LABELS)}
            />
            <FilterSelect
              label="סינון לפי דחיפות"
              value={urgency}
              onChange={setUrgency}
              allLabel="כל רמות הדחיפות"
              options={[
                ["human", "דורשים טיפול אנושי"],
                ["late", "ממתינים יותר מדי"],
              ]}
            />
          </FilterBar>

          {visible.length === 0 ? (
            <div
              className="rounded-xl border p-8 text-center"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <p className="mb-3">אף ליד לא תואם את הסינון.</p>
              <Button
                variant="secondary"
                onClick={() => {
                  setQuery("");
                  setStatus("");
                  setIntent("");
                  setUrgency("");
                }}
              >
                נקה סינון
              </Button>
            </div>
          ) : (
            <>
              {/* מובייל: כרטיסים (docs/06 §1.5) */}
              <ul className="flex flex-col gap-3 sm:hidden">
                {visible.map((lead) => {
                  const waiting = now ? leadWaiting(lead.createdAt, lead.status, now) : null;
                  const pill = STATUS_PILL[lead.status] ?? STATUS_PILL["closed"]!;
                  return (
                    <li
                      key={lead.id}
                      className="rounded-xl border p-3"
                      style={{
                        borderColor: lead.requiresHuman || waiting?.level === "late" ? "var(--color-danger)" : "var(--color-border)",
                        background: "var(--color-surface)",
                      }}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/leads/${lead.id}`} className="font-bold underline">
                          {lead.contact.name}
                        </Link>
                        {lead.requiresHuman ? (
                          <span className="mv-tag" style={{ background: "#faf1ec", color: "#b0512c" }}>דחוף</span>
                        ) : null}
                        <span className="mv-pill ms-auto" style={{ color: pill.fg, background: pill.bg }}>
                          {LEAD_STATUS_LABELS[lead.status] ?? lead.status}
                        </span>
                      </div>
                      <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
                        {LEAD_INTENT_LABELS[lead.intent] ?? lead.intent} ·{" "}
                        {LEAD_SOURCE_LABELS[lead.source] ?? lead.source}
                      </p>
                      {waiting ? (
                        <p className="text-sm font-extrabold" style={{ color: WAITING_COLOR[waiting.level] }}>
                          {waiting.label}
                        </p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <a href={`tel:${lead.contact.phone}`} className="mv-btn-soft">חייג</a>
                        <a href={waMeUrl(lead.contact.phone)} target="_blank" rel="noopener noreferrer" className="mv-btn-plain">
                          וואטסאפ
                        </a>
                        <button type="button" className="mv-btn-plain" onClick={() => convert(lead)}>
                          המר לקונה
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {/* שולחני: טבלת ה-grid מהעיצוב */}
              <div className="mv-list-card hidden sm:block">
                <div className="mv-list-head" style={{ gridTemplateColumns: GRID }}>
                  <span>שם</span>
                  <span>מקור</span>
                  <span>מה הוא רוצה</span>
                  <span>ממתין</span>
                  <span>סטטוס</span>
                  <span>פעולות</span>
                </div>
                {visible.map((lead) => {
                  const waiting = now ? leadWaiting(lead.createdAt, lead.status, now) : null;
                  const pill = STATUS_PILL[lead.status] ?? STATUS_PILL["closed"]!;
                  return (
                    <div key={lead.id} className="mv-list-row" style={{ gridTemplateColumns: GRID }}>
                      <span className="flex items-center gap-2 truncate text-[14.5px] font-bold">
                        <Link href={`/leads/${lead.id}`} className="truncate no-underline hover:underline" style={{ color: "inherit" }}>
                          {lead.contact.name}
                        </Link>
                        {lead.requiresHuman ? (
                          <span className="mv-tag" style={{ background: "#faf1ec", color: "#b0512c" }}>דחוף</span>
                        ) : null}
                      </span>
                      <span className="truncate text-[13px]" style={{ color: "var(--color-text-soft)" }}>
                        {LEAD_SOURCE_LABELS[lead.source] ?? lead.source}
                      </span>
                      <span className="truncate text-[13px]" style={{ color: "var(--color-text-soft)" }}>
                        {LEAD_INTENT_LABELS[lead.intent] ?? lead.intent}
                      </span>
                      <span className="text-[13px] font-extrabold" style={{ color: waiting ? WAITING_COLOR[waiting.level] : "var(--color-text-muted)" }}>
                        {waiting?.label ?? "—"}
                      </span>
                      <span>
                        <span className="mv-pill" style={{ color: pill.fg, background: pill.bg, fontSize: 12 }}>
                          {LEAD_STATUS_LABELS[lead.status] ?? lead.status}
                        </span>
                      </span>
                      <span className="flex gap-[7px]">
                        <a href={`tel:${lead.contact.phone}`} className="mv-btn-soft">חייג</a>
                        <a href={waMeUrl(lead.contact.phone)} target="_blank" rel="noopener noreferrer" className="mv-btn-plain">
                          וואטסאפ
                        </a>
                        <button type="button" className="mv-btn-plain" onClick={() => convert(lead)}>
                          המר לקונה
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* תיבת קוד ההטמעה — כמו בעיצוב; הקוד עצמו יושב בניהול משרד */}
          <div
            className="mt-3.5 flex flex-wrap items-center gap-3 rounded-xl border border-dashed px-[18px] py-3.5"
            style={{ borderColor: "#cfd6ce", background: "var(--color-surface)" }}
          >
            <span className="text-[13.5px]" style={{ color: "var(--color-text-muted)" }}>
              יש לכם אתר משרד? הדביקו את קוד הטופס — וכל פנייה תיכנס לכאן כליד.
            </span>
            <Link href="/settings" className="mv-btn-plain ms-auto" style={{ color: "var(--color-primary)" }}>
              העתק קוד הטמעה
            </Link>
          </div>

          <CapNote
            show={(query.trim() !== "" || status !== "" || intent !== "" || urgency !== "") && items.length === 100}
            noun="לידים"
          />
        </>
      )}
    </>
  );
}
