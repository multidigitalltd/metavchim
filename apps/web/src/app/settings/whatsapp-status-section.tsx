"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

/**
 * סטטוס חיבור הוואטסאפ — שלושה שלבים עם חיווי ✓/✗, כתובת ה-webhook
 * להדבקה במטא, וההוכחה החיה: מתי התקבלה ההודעה הנכנסת האחרונה.
 */

interface WhatsAppStatus {
  serverConfigured: boolean;
  numberConfigured: boolean;
  lastInboundAt?: string;
}

function StatusRow({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <li className="flex items-start gap-2">
      <span aria-hidden="true" style={{ color: ok ? "var(--color-success)" : "var(--color-danger)" }}>
        {ok ? "✓" : "✗"}
      </span>
      <div>
        <span className="font-medium">{label}</span>
        <span className="mv-visually-hidden">{ok ? " — תקין" : " — לא מוגדר"}</span>
        {detail ? (
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>{detail}</p>
        ) : null}
      </div>
    </li>
  );
}

export function WhatsAppStatusSection() {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);

  useEffect(() => {
    apiGet<WhatsAppStatus>("/settings/whatsapp-status")
      .then(setStatus)
      .catch(() => undefined);
  }, []);

  if (!status) return null;

  return (
    <section aria-labelledby="wa-status-heading" className="mv-list-card px-5 py-[17px]">
      <h2 id="wa-status-heading" className="m-0 mb-1" style={{ fontSize: 15.5, fontWeight: 800 }}>חיבור וואטסאפ</h2>
      <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        הודעות וואטסאפ למספר העסקי הופכות ללידים אוטומטית. שלושה שלבים לחיבור:
      </p>
      <div className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <ul className="flex flex-col gap-3">
          <StatusRow
            ok={status.serverConfigured}
            label="1. חיבור השרת ל-Meta (WhatsApp Cloud API)"
            detail={
              status.serverConfigured
                ? "מפתחות ה-API מוגדרים בשרת"
                // בלי שמות משתני הסביבה: מנהל משרד אינו יכול להגדיר אותם,
                // והצגתם רק מזמינה אותו לחפש קובץ שאין לו גישה אליו
                : "החיבור הכללי טרם הופעל — פנו למנהל המערכת"
            }
          />
          <StatusRow
            ok={status.numberConfigured}
            label="2. המספר העסקי של המשרד"
            detail={
              status.numberConfigured
                ? "המספר מוגדר — הודעות אליו מנותבות למשרד הזה"
                : "הזינו את המספר העסקי בשדה 'מספר וואטסאפ עסקי' למעלה ושמרו"
            }
          />
          <StatusRow
            ok={status.lastInboundAt !== undefined}
            label="3. הודעות זורמות בפועל"
            detail={
              status.lastInboundAt
                ? `ההודעה האחרונה התקבלה: ${formatDateTime(status.lastInboundAt)}`
                : "עדיין לא התקבלה הודעה — שלחו הודעת ניסיון למספר העסקי מהנייד שלכם"
            }
          />
        </ul>
      </div>
    </section>
  );
}
