"use client";

import { useEffect, useState } from "react";
import {
  contactErasureDisclosure,
  leadDeletionOutcome,
  type LeadDeletionScope,
} from "@metavchim/shared";
import { ApiError, apiDelete, apiGet } from "@/lib/api";
import { ConfirmDialog } from "../confirm-dialog";
import { Notice } from "../notice";

/**
 * מחיקת ליד — **עם בחירה מה בדיוק נמחק.**
 *
 * עד כה מחיקת ליד הייתה `window.confirm` אחד, ומאחוריו כלל שקוף:
 * אם לאיש הקשר לא נשאר שום קשר אחר במשרד, גם הכרטיס שלו ירד. לספאם
 * זו ההתנהגות הנכונה — מי שנמחק שם לא ביקש להיות במאגר. אבל אותה
 * לחיצה בדיוק שימשה גם למחיקת ליד כפול של לקוח אמיתי, ושם היא מחקה
 * את הלקוח: השם, הטלפון, ההערות — הכול, בלי שאיש ביקש.
 *
 * החלון הזה מפריד את שתי הכוונות ושואל. ברירת המחדל היא **הליד
 * בלבד**: הפעולה ההפיכה פחות היא זו שדורשת בחירה מודעת, לא זו
 * שקורית כשלוחצים מהר.
 *
 * הרכיב אחראי גם על הקריאה עצמה, כדי ששני המסכים שקוראים לו —
 * כרטיס הליד והרשימה — לא ינסחו את אותה מחיקה בשתי דרכים.
 */
export function DeleteLeadDialog({
  leadId,
  contactName,
  open,
  onClose,
  onDeleted,
}: {
  leadId: string;
  contactName: string;
  open: boolean;
  onClose: () => void;
  /** נקרא אחרי מחיקה מוצלחת, עם המשפט שאומר מה ירד ומה נשאר. */
  onDeleted: (outcome: string) => void;
}) {
  const [scope, setScope] = useState<LeadDeletionScope>("lead");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * ‎**הגילוי** — מה תגרור בחירת „גם את כרטיס הלקוח”.
   *
   * שלושה מצבים ולא שניים: `"loading"` עד שהשרת ענה, `null` =
   * הכרטיס יישאר, ואובייקט = הכרטיס יימחק עם מה שנספר בו. „כל מה
   * שאינו אובייקט = יישאר” היה מבטיח את ההבטחה הישנה בדיוק בזמן
   * שהתשובה עוד בדרך — אותה טעות שנתפסה בבאנר דף הנחיתה.
   */
  const [erasure, setErasure] = useState<
    { calls: number; messages: number; emails: number } | null | "loading"
  >("loading");

  // חלון שנפתח מחדש מתחיל נקי — גם אחרי כישלון וגם אחרי בחירה קודמת
  useEffect(() => {
    if (open) {
      setScope("lead");
      setError(null);
      setErasure("loading");
      apiGet<{ contactErasure: { calls: number; messages: number; emails: number } | null }>(
        `/leads/${leadId}/deletion-preview`,
      )
        .then((res) => setErasure(res.contactErasure))
        /*
         * כשל בבדיקה אינו „הכרטיס יישאר”. הבחירה הרחבה מציגה אזהרה
         * כללית במקום ספירה — „לא ידוע” לעולם אינו מוצג כ„לא יימחק”.
         */
        .catch(() => setErasure({ calls: 0, messages: 0, emails: 0 }));
    }
  }, [open, leadId]);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiDelete<{ contactDeleted: boolean }>(`/leads/${leadId}`, { scope });
      onDeleted(leadDeletionOutcome(contactName, res.contactDeleted));
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "המחיקה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      title={`מחיקת הליד של ${contactName}`}
      tone="danger"
      confirmLabel="מחק"
      busyLabel="מוחק…"
      busy={busy}
      onConfirm={() => void remove()}
      onClose={onClose}
    >
      {/*
        ‎**ההבטחה נגזרת מהבחירה ומתשובת השרת, לא ממשפט קבוע.**

        „שיחות מוקלטות נשארות” היה נכון ללא תנאי כשהמחיקה סירבה
        לגעת בכרטיס עם היסטוריה. הכרעת בעל המוצר החליפה את הסירוב
        בגילוי, ולכן המשפט חייב לומר את האמת של הבחירה הנוכחית:
        בבחירה הרחבה, כשהכרטיס יימחק — השיחות יורדות איתו, בספירה.
      */}
      <p className="mb-3 text-[length:var(--type-body-sm)]">
        ציר הזמן של הליד נמחק איתו, והפעולה אינה הפיכה.
        {scope === "lead_and_contact" && erasure !== null && erasure !== "loading" ? (
          <span className="block font-semibold" style={{ color: "var(--color-danger)" }}>
            {contactErasureDisclosure(erasure)}
          </span>
        ) : (
          " פגישות ושיחות מוקלטות שכבר נרשמו נשארות."
        )}
      </p>
      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-2 text-[length:var(--type-body-sm)] font-bold">מה למחוק?</legend>
        <label className="mb-2 flex items-start gap-2 text-[length:var(--type-body-sm)]">
          <input
            type="radio"
            name="lead-delete-scope"
            className="mt-1"
            checked={scope === "lead"}
            onChange={() => setScope("lead")}
          />
          <span>
            <b>את הליד בלבד</b>
            {/*
              בלי להבטיח שההערות נשארות: הערות הליד הן חלק מציר הזמן
              שלו והן נמחקות בשתי האפשרויות. לכרטיס הלקוח אין שדה
              הערות משלו, ומשפט שאמר "עם ההערות" היה מבטיח בדיוק את
              מה שהמחיקה מוחקת (ביקורת Codex).
            */}
            <span className="block" style={{ color: "var(--color-text-muted)" }}>
              כרטיס הלקוח נשאר במאגר — השם, הטלפון, בני המשפחה
              והקשרים שלו לשאר הכרטיסים. הערות הליד נמחקות עם ציר
              הזמן שלו בשתי האפשרויות.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-[length:var(--type-body-sm)]">
          <input
            type="radio"
            name="lead-delete-scope"
            className="mt-1"
            checked={scope === "lead_and_contact"}
            onChange={() => setScope("lead_and_contact")}
          />
          <span>
            <b>גם את כרטיס הלקוח</b>
            {/*
              ‎**התיאור נגזר מתשובת השרת, לא מרשימה קבועה.**

              הגלגול הקודם מנה את התנאים העוצרים ופסח על שניים —
              רשימה חלקית שנקראת כמלאה (ביקורת Codex, P1). עכשיו
              השרת עונה על הכרטיס **הזה**: יישאר (יש לו עוגן אחר),
              או יימחק — ואז הגילוי המלא מוצג למעלה, בספירה.
            */}
            <span className="block" style={{ color: "var(--color-text-muted)" }}>
              {erasure === "loading"
                ? "לספאם ולטעות במספר. בודק מה תלוי בכרטיס…"
                : erasure === null
                  ? "לספאם ולטעות במספר. הכרטיס הזה יישאר — הוא עדיין קונה, בעל נכס, ליד אחר, או בן/בת זוג בכרטיס פעיל."
                  : "לספאם ולטעות במספר. לכרטיס הזה אין עוגן נוסף במשרד — הוא יימחק, וההסכמים החתומים שלו יעברו לארכיון המשרד."}
            </span>
          </span>
        </label>
      </fieldset>
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </ConfirmDialog>
  );
}
