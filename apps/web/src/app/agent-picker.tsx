"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { AgentTag } from "./agent-tag";

/**
 * ‎**„של מי הכרטיס” — גלולה, לא טופס.**
 *
 * ## מה היה
 *
 * הבורר נכתב עם `mv-control`, שהוא `width: 100%` — כלומר פקד טופס.
 * בשורת הכותרת של הנכס, לצד גלולת הסטטוס, הוא תפס שורה שלמה ודחף
 * את המחיר והכתובת מטה. פקד שנכון בטופס אינו נכון בכותרת.
 *
 * ## מה עכשיו
 *
 * אותה שפה חזותית של גלולת הסטטוס שלצידו: `mv-pill` עם מסגרת פקד.
 * הצבע אומר את המצב — כחול כשמשויך, אפור כש„לא משויך” — בדיוק כמו
 * ‎`AgentTag`, כדי שמנהל שסורק רשימה ואז נכנס לכרטיס יחפש את אותו
 * דבר.
 *
 * ‎**המסגרת אינה קישוט.** זה `select` ולא תווית: גלולה בלי מסגרת
 * היא פקד שאיש אינו יודע שאפשר ללחוץ עליו. גבול פקד כפוף ל-3:1
 * ‎(WCAG 1.4.11) — אותו נימוק בדיוק שבגללו לגלולת הסטטוס יש מסגרת.
 *
 * ## „לא משויך” — יש בנכס, אין בקונה
 *
 * בנכס `agent_user_id` מתעד בלבד, וניתוק הוא מצב לגיטימי שהמסך
 * מציג. בקונה `ownerUserId` **מסנן ראייה**: קונה בלי בעלים אינו
 * ‎„של כולם” אלא בלתי נראה לכל סוכן שאין לו `buyers.view_all`.
 * ‎`allowUnassign` הוא ההבדל הזה, ולא העדפת תצוגה.
 */

export function AgentPicker({
  agentUserId,
  agentName,
  canAssign,
  allowUnassign,
  onChange,
  labelText,
}: {
  agentUserId?: string;
  agentName?: string;
  /** ‎`tasks.assign` — היכולת שהנתיב `/tasks/assignees` דורש. */
  canAssign: boolean;
  /** נכס: כן. קונה: לא — ראו ההסבר למעלה. */
  allowUnassign: boolean;
  onChange: (agentUserId: string) => void | Promise<void>;
  labelText: string;
}) {
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!canAssign) return;
    apiGet<{ id: string; name: string }[]>("/tasks/assignees")
      .then(setMembers)
      .catch(() => setMembers([]));
  }, [canAssign]);

  if (!canAssign) {
    return <AgentTag {...(agentName === undefined ? {} : { name: agentName })} />;
  }

  const assigned = agentUserId !== undefined;
  /*
   * ‎**סוכן שהושבת נשאר בבורר.** `/tasks/assignees` מחזיר פעילים
   * בלבד, ובלי השורה הזו כרטיס ששויך למי שעזב היה נראה „לא משויך” —
   * כלומר המסך היחיד שבו אפשר לתקן את זה היה גם זה שמסתיר אותו.
   */
  const missing = assigned && !members.some((member) => member.id === agentUserId);

  async function pick(next: string): Promise<void> {
    setSaving(true);
    try {
      await onChange(next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <label htmlFor="agent-picker" className="mv-visually-hidden">
        {labelText}
      </label>
      <select
        id="agent-picker"
        className="mv-pill"
        disabled={saving}
        value={agentUserId ?? ""}
        onChange={(event) => void pick(event.target.value)}
        style={{
          background: assigned ? "var(--domain-blue-bg)" : "var(--chip-neutral-bg)",
          color: assigned ? "var(--domain-blue-fg)" : "var(--chip-neutral-fg)",
          border: "1px solid var(--color-input-border)",
          cursor: "pointer",
          fontSize: "var(--type-caption-lg)",
          /* שם ארוך אינו מותר לדחוף את המחיר והכתובת מהשורה */
          maxWidth: "11rem",
        }}
      >
        {allowUnassign ? <option value="">לא משויך</option> : null}
        {missing ? (
          <option value={agentUserId}>
            {agentName ?? "סוכן שאינו במשרד"} (לא פעיל)
          </option>
        ) : null}
        {/*
          קונה בלי בעלים אינו מצב שאפשר לבחור בו — אבל הוא מצב שקיים
          במסד (כרטיסים שקדמו לשדה). בלי השורה הזו הבורר היה מציג את
          הסוכן הראשון ברשימה כאילו הכרטיס שלו.
        */}
        {!allowUnassign && !assigned ? (
          <option value="" disabled>
            בחרו סוכן
          </option>
        ) : null}
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
      </select>
    </>
  );
}
