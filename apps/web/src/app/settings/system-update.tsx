"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";

interface SystemInfo {
  version: string;
}

/**
 * הגרסה המותקנת — תצוגה בלבד. *הפעלת* העדכון עברה למסך הפלטפורמה:
 * העדכון מרים מחדש את השירות לכל המשרדים יחד, ולכן הוא בידי בעל
 * הפלטפורמה. המשתמשים מקבלים באנר "מה חדש" אחרי שהעדכון עלה.
 */
export function SystemUpdateSection() {
  const [info, setInfo] = useState<SystemInfo | null>(null);

  useEffect(() => {
    apiGet<SystemInfo>("/settings/system")
      .then(setInfo)
      .catch(() => undefined);
  }, []);

  if (!info) return null;

  return (
    <section
      className="mv-list-card px-5 py-[17px]"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      aria-labelledby="system-update-title"
    >
      <h2 id="system-update-title" className="m-0 mb-2" style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}>
        מערכת
      </h2>
      <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
        גרסה מותקנת: <code dir="ltr">{info.version.slice(0, 12)}</code>
      </p>
      <p className="mt-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
        עדכוני גרסה מותקנים אוטומטית בידי מפעיל המערכת — אין צורך בפעולה מצידכם.
      </p>
    </section>
  );
}
