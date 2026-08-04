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
      className="rounded-xl border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      aria-labelledby="system-update-title"
    >
      <h2 id="system-update-title" className="mb-2 text-lg font-semibold">
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
