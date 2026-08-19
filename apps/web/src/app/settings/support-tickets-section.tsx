"use client";

import { useCallback, useEffect, useState } from "react";
import {
  SUPPORT_KIND_LABEL,
  SUPPORT_STATUS_LABEL,
  SUPPORT_SEVERITY_LABEL,
  type SupportKind,
  type SupportStatus,
  type SupportSeverity,
} from "@metavchim/shared";
import { API_BASE, apiGet } from "@/lib/api";
import { LoadError } from "../load-error";

/**
 * תיק הפניות של המשרד.
 *
 * זו הסיבה שפנייה נשמרת ולא רק נשלחת במייל: מי ששלח רוצה לדעת מה
 * עלה בגורלה, ומי שמנהל את המשרד רוצה לראות על מה הצוות שלו נתקע.
 * הרשימה משותפת לכל המשרד ולא אישית — תקלה שסוכן אחד דיווח עליה
 * חוסכת לשני את הדיווח החוזר.
 */

interface Ticket {
  id: string;
  kind: SupportKind;
  message: string;
  status: SupportStatus;
  area: string;
  severity: SupportSeverity;
  hasScreenshot: boolean;
  reply?: string;
  repliedAt?: string;
  createdAt: string;
  userName: string;
}

const STATUS_COLOR: Record<SupportStatus, string> = {
  open: "var(--color-danger)",
  in_progress: "var(--color-primary)",
  resolved: "var(--color-success)",
};

export function SupportTicketsSection(): React.JSX.Element {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    apiGet<Ticket[]>("/support/tickets")
      .then(setTickets)
      .catch(() => setFailed(true));
  }, []);

  useEffect(load, [load]);

  return (
    <section className="mv-list-card px-5 py-[17px]" aria-labelledby="support-tickets-heading">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 id="support-tickets-heading" className="m-0 grow" style={{ fontSize: 16.5, fontWeight: 800 }}>
          הפניות שלכם
        </h2>
        <button type="button" className="mv-btn-plain" onClick={load}>
          רענון
        </button>
      </div>
      <p className="m-0 mb-3 text-[14.5px]" style={{ color: "var(--color-text-muted)" }}>
        פנייה חדשה נשלחת מכפתור <b>„תמיכה”</b> שבצד כל מסך — משם היא נושאת איתה
        את המסך שבו הייתם ואת השגיאות שקרו בו, וזה מקצר את הטיפול.
      </p>

      {failed ? (
        <LoadError message="לא הצלחנו לטעון את הפניות" onRetry={load} />
      ) : tickets === null ? (
        <p aria-live="polite">טוען…</p>
      ) : tickets.length === 0 ? (
        <p className="m-0" style={{ color: "var(--color-text-muted)" }}>
          עוד לא נשלחו פניות מהמשרד הזה.
        </p>
      ) : (
        <ul className="flex list-none flex-col gap-2.5 p-0">
          {tickets.map((t) => (
            <li
              key={t.id}
              className="rounded-xl border p-3"
              style={{ borderColor: "var(--color-border)" }}
            >
              <div className="mb-1 flex flex-wrap items-center gap-2 text-[14.5px]">
                <span className="font-bold">{SUPPORT_KIND_LABEL[t.kind]}</span>
                <span style={{ color: "var(--color-text-muted)" }}>· {t.area}</span>
                {t.severity === "blocking" ? (
                  <span style={{ color: "var(--color-danger)" }}>
                    · {SUPPORT_SEVERITY_LABEL.blocking}
                  </span>
                ) : null}
                <span className="ms-auto font-bold" style={{ color: STATUS_COLOR[t.status] }}>
                  {SUPPORT_STATUS_LABEL[t.status]}
                </span>
              </div>
              <p className="m-0 whitespace-pre-wrap text-[15px]">{t.message}</p>
              <p className="m-0 mt-1 text-[14px]" style={{ color: "var(--color-text-muted)" }}>
                {t.userName} · {new Date(t.createdAt).toLocaleString("he-IL")}
                {t.hasScreenshot ? (
                  <>
                    {" · "}
                    <a
                      href={`${API_BASE}/support/tickets/${t.id}/screenshot`}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      צילום המסך
                    </a>
                  </>
                ) : null}
              </p>
              {t.reply !== undefined ? (
                /*
                 * התשובה בתוך הפנייה ולא במייל בלבד: מי ששלח לא בהכרח
                 * מי שקורא, וחיפוש במייל של מישהו אחר אינו מעקב.
                 */
                <div
                  className="mt-2 rounded-lg border p-2.5"
                  style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
                >
                  <p className="m-0 text-[14px] font-bold">תשובת התמיכה</p>
                  <p className="m-0 mt-0.5 whitespace-pre-wrap text-[15px]">{t.reply}</p>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
