"use client";

import { useState } from "react";
import { Button } from "@metavchim/ui";
import {
  callBulkConfirm,
  callBulkOutcome,
  callBulkRejectionReason,
  type CallBulkAction,
  type CallBulkResult,
} from "@metavchim/shared";
import { apiPost } from "@/lib/api";
import { useAssignees } from "../agent-picker";

/**
 * ‎**סרגל הפעולות המרוכזות של יומן השיחות.**
 *
 * ## ‏למה הוא מופיע רק כשיש בחירה
 *
 * ‏סרגל קבוע שאומר „נבחרו 0” גוזל שורה מהרשימה בכל טעינה ואינו
 * ‏אומר דבר. אותה הכרעה בדיוק של רשימת הנכסים, הקונים והגיוס.
 *
 * ## ‏שלוש פעולות, שלוש משמעויות שונות לחלוטין
 *
 * ‏אחת **מוחקת לצמיתות**, אחת **מעבירה לקוח בין סוכנים**, ואחת רק
 * ‏פותחת ליד. הן נראות דומות בשורה אחת, ולכן האישור, התקרה וניסוח
 * ‏התוצאה נגזרים מ-`call-bulk` המשותף ולא נכתבים כאן — אותו כלל
 * ‏שהשרת אוכף.
 */
export function CallsBulkBar({
  ids,
  mayAssign,
  onClear,
  onDone,
}: {
  /**
   * ‎**המזהים נגזרים מהשורות המוצגות**, ולא מקבוצת הבחירה הגולמית.
   *
   * ‏פעולה הרסנית לא אמורה להישען על סנכרון בין הבחירה לסינון: מה
   * ‏שנשלח הוא מה שרואים, מעצם הבנייה. אישור מספרי („למחוק 40”)
   * ‏אינו יכול לחשוף מה נכנס בטעות.
   */
  ids: string[];
  /** ‎`tasks.assign` — אותו שער שהשרת אוכף ב-`assertCanAssignAgents`. */
  mayAssign: boolean;
  onClear: () => void;
  /** ‏נקרא אחרי כל פעולה שהצליחה — הרשימה נטענת מחדש. */
  onDone: () => void | Promise<void>;
}) {
  const members = useAssignees(mayAssign);
  const [agentUserId, setAgentUserId] = useState("");
  const [busy, setBusy] = useState<CallBulkAction | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: CallBulkAction): Promise<void> {
    setError(null);
    setNote(null);

    /* ‏אותה תקרה שהשרת אוכף — כאן רק כדי לומר זאת מיד, בלי בקשה */
    const rejection = callBulkRejectionReason(ids.length);
    if (rejection !== null) {
      setError(rejection);
      return;
    }
    if (action === "assign" && agentUserId === "") {
      setError("בחרו נציג לפני ההעברה.");
      return;
    }

    const agentName = members.find((member) => member.id === agentUserId)?.name;
    const confirmText = callBulkConfirm(action, ids.length, agentName);
    if (confirmText !== null && !window.confirm(confirmText)) return;

    setBusy(action);
    let result: CallBulkResult;
    try {
      result = await apiPost<CallBulkResult>(PATHS[action], {
        ids,
        ...(action === "assign" ? { agentUserId } : {}),
      });
    } catch {
      setError("הפעולה נכשלה — נסו שוב.");
      setBusy(null);
      return;
    }

    /*
     * ‎**הריענון בנפרד מהפעולה, ולא באותו `try`.**
     *
     * ‏כישלון של הריענון היה מדווח „הפעולה נכשלה” על פעולה שהצליחה,
     * ‏ומזמין ללחוץ שוב — על מחיקה שכבר קרתה. אותו לקח בדיוק של
     * ‏המחיקה המרוכזת בנכסים ובגיוס.
     */
    setNote(callBulkOutcome(action, result));
    onClear();
    setBusy(null);
    await Promise.resolve(onDone()).catch(() =>
      setError("הרשימה לא רועננה — רעננו את העמוד"),
    );
  }

  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border p-3"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <span className="text-sm font-semibold">נבחרו {ids.length}</span>

      <Button variant="secondary" onClick={onClear}>
        ביטול הבחירה
      </Button>

      <button
        type="button"
        className="mv-btn-plain"
        disabled={busy !== null}
        onClick={() => void run("open_lead")}
      >
        {busy === "open_lead" ? "פותח…" : "פתיחת ליד"}
      </button>

      {/*
        ‎**„העברה” היא בורר וכפתור, ולא בורר שפועל בשינוי.**

        ‏בחירה בבורר היא מחשבה בקול; הפעולה עצמה מוציאה עשרים
        ‏כרטיסים מידיו של סוכן. הפרדה בין השתיים היא מה שנותן רגע
        ‏להתחרט — ומה שמאפשר לאישור לנקוב בשם שנבחר.
      */}
      {mayAssign ? (
        <>
          <label className="flex items-center gap-1.5 text-sm">
            <span className="mv-visually-hidden">נציג לשיוך</span>
            <select
              className="mv-select"
              value={agentUserId}
              onChange={(event) => setAgentUserId(event.target.value)}
            >
              <option value="">בחרו נציג…</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="mv-btn-plain"
            disabled={busy !== null || agentUserId === ""}
            onClick={() => void run("assign")}
          >
            {busy === "assign" ? "מעביר…" : "העברה לנציג"}
          </button>
        </>
      ) : null}

      <button
        type="button"
        className="mv-btn-plain"
        style={{ color: "var(--color-danger)", borderColor: "var(--color-danger)" }}
        disabled={busy !== null}
        onClick={() => void run("delete")}
      >
        {busy === "delete" ? "מוחק…" : "סימון לא רלוונטי"}
      </button>

      {note !== null ? <span className="text-sm">{note}</span> : null}
      {error !== null ? (
        <span role="alert" className="text-sm" style={{ color: "var(--color-danger)" }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** ‏נתיב לכל פעולה — במקום אחד, כדי ש„העברה” לא תפגע ב„מחיקה”. */
const PATHS: Record<CallBulkAction, string> = {
  delete: "/calls/bulk-delete",
  assign: "/calls/bulk-assign",
  open_lead: "/calls/bulk-lead",
};
