"use client";

import { useCallback, useEffect, useState } from "react";
import type { DuplicateGroup } from "@metavchim/shared";
import { ApiError, apiGet, apiPost } from "@/lib/api";

/**
 * "כפילויות אפשריות" בדשבורד.
 *
 * למה בדשבורד ולא במסך הגדרות: כפילות אינה תקלה טכנית אלא מצב שפוגע
 * בעבודה — חצי מההיסטוריה של הלקוח בכרטיס אחד וחצי בשני. מי שרואה
 * את זה כל בוקר מטפל בזה; מי שצריך לחפש את המסך, לא.
 *
 * הרכיב לא מציג דבר כשאין כפילויות — דשבורד עמוס בקופסאות ריקות
 * מאמן את המשתמש להתעלם מהן.
 */
export function DuplicateContacts() {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(() => {
    // 403 לסוכן ללא ראות רוחבית — לא שגיאה, פשוט לא בשבילו
    apiGet<DuplicateGroup[]>("/contacts/duplicates")
      .then(setGroups)
      .catch(() => setGroups([]));
  }, []);

  useEffect(load, [load]);

  async function merge(survivorId: string, duplicateId: string): Promise<void> {
    setBusyId(duplicateId);
    setError(null);
    setDone(null);
    try {
      const result = await apiPost<{ moved: number }>("/contacts/duplicates/merge", {
        survivorId,
        duplicateId,
      });
      setDone(
        result.moved === 0
          ? "הכרטיסים אוחדו"
          : `הכרטיסים אוחדו — ${result.moved} רשומות הועברו`,
      );
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "המיזוג נכשל");
    } finally {
      setBusyId(null);
    }
  }

  if (groups.length === 0 && done === null) return null;

  return (
    <section className="mv-list-card mb-[18px] px-5 py-[17px]" aria-labelledby="dupes-heading">
      <h2 id="dupes-heading" className="m-0 mb-1" style={{ fontSize: 15.5, fontWeight: 800 }}>
        כפילויות אפשריות
        {groups.length > 0 ? (
          <span className="mv-chip ms-2">{groups.length}</span>
        ) : null}
      </h2>
      <p className="m-0 mb-3 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
        אותו שם מופיע ביותר מכרטיס אחד — בדרך כלל אותו אדם שנקלט פעמיים עם שני
        מספרים. מיזוג מעביר את כל ההיסטוריה לכרטיס אחד ושומר את שני המספרים.
      </p>

      {done ? (
        <p role="status" className="m-0 mb-3 text-sm" style={{ color: "var(--color-primary)" }}>
          ✓ {done}
        </p>
      ) : null}

      <ul className="m-0 list-none p-0">
        {groups.map((group) => (
          <li
            key={group.key}
            className="border-t py-2.5 first:border-t-0 first:pt-0"
            style={{ borderColor: "var(--color-input-border)" }}
          >
            <div className="mb-1 flex flex-wrap items-baseline gap-2">
              <strong className="text-sm">{group.survivor.name}</strong>
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                נשמר: <span dir="ltr">{group.survivor.phone}</span>
                {group.survivor.activity > 0 ? ` · ${group.survivor.activity} רשומות` : " · ללא פעילות"}
              </span>
            </div>

            {group.duplicates.map((dupe) => (
              <div key={dupe.contactId} className="flex flex-wrap items-center gap-2 py-1">
                <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                  ימוזג: <span dir="ltr">{dupe.phone}</span>
                  {dupe.activity > 0 ? ` · ${dupe.activity} רשומות` : " · ללא פעילות"}
                </span>
                <button
                  type="button"
                  className="mv-btn-action ms-auto"
                  style={{ padding: "5px 12px", fontSize: 12.5 }}
                  disabled={busyId !== null}
                  onClick={() => void merge(group.survivor.contactId, dupe.contactId)}
                >
                  {busyId === dupe.contactId ? "ממזג…" : "מזג לכרטיס אחד"}
                </button>
              </div>
            ))}
          </li>
        ))}
      </ul>

      {error ? (
        <p role="alert" className="m-0 mt-2 text-sm" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}
    </section>
  );
}
