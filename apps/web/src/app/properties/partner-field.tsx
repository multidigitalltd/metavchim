"use client";

import { useEffect, useState } from "react";
import { apiGet, ApiError } from "@/lib/api";

/**
 * ‎**הסוכן השותף — מי סגר את זה יחד עם מי.**
 *
 * ## ‏למה זה כאן ולא ב-`AgentPicker`
 *
 * ‏שני הפקדים נראים דומה ושואלים שאלה שונה לגמרי:
 *
 * | | הסוכן המטפל | הסוכן השותף |
 * | --- | --- | --- |
 * | מה זה אומר | **בעלות** על הכרטיס | **תיעוד** של מי עוד היה שם |
 * | מי רשאי | `tasks.assign` | כל מי שרשאי לערוך את הנכס |
 * | משפיע על הניקוד | כן — העסקה נספרת עליו | **לא** |
 *
 * ‏שורת ההרשאה היא ההבדל המעשי: `AgentPicker` שולף את רשימת המשרד
 * ‏מ-`/tasks/assignees`, שדורש `tasks.assign` — כלומר סוכן רגיל
 * ‏היה מקבל רשימה ריקה. כאן הרשימה מגיעה מ-`/properties/office-agents`,
 * ‏מאחורי `properties.edit`. אותה שאילתה בשרת, שער אחר.
 *
 * ## ‏למה `select` ולא צ׳יפים
 *
 * ‏בשונה ממצב הנכס או מחזית/עורף, הרשימה כאן **אינה קבועה**: היא
 * ‏באורך הצוות. צ׳יפים למשרד של שנים-עשר סוכנים הם קיר.
 */
export function PartnerField({
  propertyId,
  partnerUserId,
  partnerName,
  agentUserId,
  onSaved,
}: {
  propertyId: string;
  partnerUserId?: string;
  partnerName?: string;
  /** ‏הסוכן המטפל — מסונן מהרשימה, כי „שת״פ עם עצמו” אינו שת״פ. */
  agentUserId?: string;
  onSaved: (saved: { partnerUserId?: string; partnerName?: string }) => void;
}): React.ReactNode {
  const [members, setMembers] = useState<{ id: string; name: string }[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<{ id: string; name: string }[]>("/properties/office-agents")
      .then((rows) => {
        if (!cancelled) setMembers(rows);
      })
      /* ‏כישלון = רשימה ריקה ולא מסך שבור; הפקד פשוט אינו נפתח */
      .catch(() => {
        if (!cancelled) setMembers([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function change(next: string): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const { apiPatch } = await import("@/lib/api");
      const saved = await apiPatch<{ partnerUserId?: string; partnerName?: string }>(
        `/properties/${propertyId}`,
        { partnerUserId: next },
      );
      /*
       * ‏השם מגיע **מהשרת** ולא מהרשימה המקומית: הרשימה נטענה פעם
       * ‏אחת, והשרת הוא זה שיודע מי במשרד עכשיו — אותו נימוק בדיוק
       * ‏כמו בבורר הסוכן המטפל.
       */
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      setSaving(false);
    }
  }

  /* ‏„שת״פ עם עצמו” נחסם בשרת ובמסד; כאן הוא פשוט אינו מוצע */
  const options = (members ?? []).filter((m) => m.id !== agentUserId);

  return (
    <div className="mt-2">
      <label className="block text-sm" htmlFor={`partner-${propertyId}`}>
        סוכן שותף בעסקה
      </label>
      <select
        id={`partner-${propertyId}`}
        className="mv-input mt-1"
        value={partnerUserId ?? ""}
        disabled={saving || members === null}
        onChange={(e) => void change(e.target.value)}
      >
        <option value="">ללא שת&quot;פ</option>
        {/*
          ‏מי שסומן ואינו ברשימה — עזב את המשרד. בלי האפשרות הזו
          ‏הבורר היה מציג „ללא שת״פ” על נכס שיש בו סימון, כלומר
          ‏משקר, והשמירה הבאה הייתה מוחקת אותו בשקט.
        */}
        {partnerUserId !== undefined && !options.some((m) => m.id === partnerUserId) ? (
          <option value={partnerUserId}>{partnerName ?? "סוכן שעזב"}</option>
        ) : null}
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <p className="m-0 mt-1 text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
        לתיעוד בלבד — הניקוד בלוח המשרד נשאר על הסוכן המטפל.
      </p>
      {error === null ? null : (
        <p className="m-0 mt-1 text-[length:var(--type-caption)]" role="alert" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
